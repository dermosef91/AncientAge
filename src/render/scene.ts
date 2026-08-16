import {
  ACESFilmicToneMapping,
  AmbientLight,
  PCFSoftShadowMap,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Material,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { clamp, lerp, lerpAngle, smoothstep } from '../core/math';
import type { Game } from '../sim/game';
import type { Biome } from '../sim/mapgen';
import { TILE, WORLD_HALF } from '../sim/grid';
import type { Entity, GameEvent, ResourceNode } from '../sim/types';
import { buildingModel, clearBuildingCache } from './buildings';
import {
  Flags,
  HealthBars,
  InstancePool,
  OrderPulses,
  Particles,
  PlacementGhost,
  ProjectileRenderer,
  SelectionRings,
} from './effects';
import { C } from './palette';
import { carryModel, clearPropCache, decorationModel, nodeModel, scaffoldModel } from './props';
import { buildTerrain, type Polyline, type TerrainBuild } from './terrain';
import { clearUnitCache, unitModel } from './units';
import { RingGeometry, MeshBasicMaterial, DoubleSide } from 'three';

export const TEAM_COLORS = [0x3fb8e8, 0xe8563f];

/** Sky, haze and sunlight per homeland. */
const BIOME_AIR: Record<Biome, { sky: number; fog: number; sun: number }> = {
  egypt: { sky: 0xa8cfe0, fog: 0xdcd0b0, sun: 0xfff0c8 },
  greece: { sky: 0x8fc6dd, fog: 0xaed4e0, sun: 0xfff1d4 },
  rome: { sky: 0x8dbfd8, fog: 0xc2d6c8, sun: 0xfff4e2 },
};

const _m = new Matrix4();
const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _color = new Color();
const YAXIS = new Vector3(0, 1, 0);

interface UnitVisual {
  key: string;
  slot: number;
  carrySlot: number;
  carryKey: string;
  /** Smoothed animation state. */
  bobPhase: number;
  spawnT: number;
  /** Previous tick's swing timer, to catch the frame the blow lands. */
  lastSwing: number;
  /** Counts 1 → 0 through the strike and its recovery. */
  strikeT: number;
  /** Counts 1 → 0 through a flinch when the unit is hit. */
  flinchT: number;
}

interface BuildingVisual {
  key: string;
  slot: number;
  scaffold: number;
  completeT: number;
  height: number;
}

interface NodeVisual {
  key: string;
  slot: number;
}

export interface Quality {
  shadows: boolean;
  maxPixelRatio: number;
}

export class SceneRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  // Camera rig (fixed three-quarter isometric).
  private target = new Vector3(0, 0, 0);
  private targetGoal = new Vector3(0, 0, 0);
  private distance = 52;
  private distanceGoal = 52;
  readonly minDistance = 22;
  readonly maxDistance = 96;
  private readonly yaw = 0.66;
  private readonly pitch = 0.735;

  private sun: DirectionalLight;
  private terrain!: TerrainBuild;

  private unitPools = new Map<string, InstancePool>();
  private buildingPools = new Map<string, InstancePool>();
  private nodePools = new Map<string, InstancePool>();
  private carryPools = new Map<string, InstancePool>();
  private scaffoldPool!: InstancePool;
  private teamDiscs!: InstancePool;

  private unitVisuals = new Map<number, UnitVisual>();
  private buildingVisuals = new Map<number, BuildingVisual>();
  private nodeVisuals = new Map<number, NodeVisual>();

  private particles = new Particles();
  private projectiles: ProjectileRenderer;
  private rings = new SelectionRings();
  private pulses = new OrderPulses();
  private bars = new HealthBars();
  private flags = new Flags();
  readonly ghost = new PlacementGhost();

  private staticGroup = new Group();
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  private time = 0;
  private selection = new Set<number>();
  private highlighted = -1;
  private quality: Quality;
  private game!: Game;
  private teamDiscCount = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.maxPixelRatio <= 1.5,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.background = new Color(0x8fc6dd);
    this.scene.fog = new Fog(0xaed4e0, 115, 240);

    this.camera = new PerspectiveCamera(34, 1, 1, 400);

    // Warm key light with a cool sky fill - just enough ambient to keep the
    // shadow side readable without flattening the diorama.
    const hemi = new HemisphereLight(0xbcd9f0, 0xb08a5c, 0.78);
    this.scene.add(hemi);
    const ambient = new AmbientLight(0xffeeda, 0.16);
    this.scene.add(ambient);

    this.sun = new DirectionalLight(0xfff1d4, 3.15);
    this.sun.position.set(38, 60, 26);
    this.sun.castShadow = quality.shadows;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 200;
    cam.left = -52;
    cam.right = 52;
    cam.top = 52;
    cam.bottom = -52;
    this.sun.shadow.mapSize.set(quality.shadows ? 2048 : 512, quality.shadows ? 2048 : 512);
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.projectiles = new ProjectileRenderer(this.particles);

    this.scene.add(this.staticGroup);
    this.scene.add(this.particles.pool.mesh);
    this.scene.add(this.projectiles.pool.mesh);
    this.scene.add(this.rings.pool.mesh);
    this.scene.add(this.pulses.pool.mesh);
    this.scene.add(this.bars.back.mesh);
    this.scene.add(this.bars.fill.mesh);
    this.scene.add(this.flags.pool.mesh);
    this.scene.add(this.ghost.group);
  }

  /** ---------------------------------------------------------------------
   * World setup
   * ------------------------------------------------------------------- */
  loadGame(game: Game): void {
    this.disposeWorld();
    this.game = game;

    // Sky and haze follow the homeland too: a bleached desert glare for Egypt,
    // the warm Aegean default for Greece, cooler green air for Rome.
    const air = BIOME_AIR[game.biome];
    (this.scene.background as Color).set(air.sky);
    (this.scene.fog as Fog).color.set(air.fog);
    this.sun.color.set(air.sun);

    this.terrain = buildTerrain(game.grid, this.makePaths(game), game.biome);
    this.staticGroup.add(this.terrain.ground);
    this.staticGroup.add(this.terrain.water);

    // Static decoration instancing.
    const byKind = new Map<string, { x: number; z: number; scale: number; rot: number }[]>();
    for (const d of game.decorations) {
      let arr = byKind.get(d.kind);
      if (!arr) {
        arr = [];
        byKind.set(d.kind, arr);
      }
      arr.push(d);
    }
    for (const [kind, list] of byKind) {
      const geo = decorationModel(kind as never);
      const mat = this.solidMaterial();
      const pool = new InstancePool(geo, mat, list.length, this.quality.shadows && kind !== 'grass');
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const y = game.grid.heightAt(d.x, d.z);
        pool.place(i, d.x, y - 0.05, d.z, d.rot, d.scale);
      }
      pool.flush(true);
      this.staticGroup.add(pool.mesh);
      this.nodePools.set(`dec-${kind}`, pool);
    }

    // Construction scaffolding.
    this.scaffoldPool = new InstancePool(scaffoldModel(), this.solidMaterial(), 24);
    this.scene.add(this.scaffoldPool.mesh);

    // Team ownership discs under every unit.
    const discGeo = new RingGeometry(0.0, 1.0, 16);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: DoubleSide,
    });
    this.teamDiscs = new InstancePool(discGeo, discMat, 160);
    this.teamDiscs.mesh.renderOrder = 1;
    this.scene.add(this.teamDiscs.mesh);

    // Start the camera on the player's town centre.
    const tc = game.buildingsOfPlayer(0).find((b) => b.type === 'towncenter');
    if (tc) {
      this.target.set(tc.x, 0, tc.z + 6);
      this.targetGoal.copy(this.target);
    }
    this.distance = 46;
    this.distanceGoal = 46;
    this.updateCamera(1);
  }

  /** Worn routes painted into the terrain colours. */
  private makePaths(game: Game): Polyline[] {
    const paths: Polyline[] = [];
    const starts = game.starts;
    // Main road between the two settlements, bent slightly for character.
    const a = starts[0];
    const b = starts[1];
    const nx = -(b.z - a.z);
    const nz = b.x - a.x;
    const nlen = Math.hypot(nx, nz) || 1;
    const bend = 12;
    const road: Polyline = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const w = Math.sin(t * Math.PI);
      road.push({
        x: lerp(a.x, b.x, t) + (nx / nlen) * bend * w,
        z: lerp(a.z, b.z, t) + (nz / nlen) * bend * w,
      });
    }
    paths.push(road);

    // Short spurs from each base out to its nearest resources.
    for (const s of starts) {
      const near = game.nodes
        .filter((n) => n.type !== 'fish')
        .map((n) => ({ n, d: Math.hypot(n.x - s.x, n.z - s.z) }))
        .filter((e) => e.d < 26)
        .sort((p, q) => p.d - q.d);
      const picked: ResourceNode[] = [];
      for (const e of near) {
        if (picked.some((p) => Math.hypot(p.x - e.n.x, p.z - e.n.z) < 12)) continue;
        picked.push(e.n);
        if (picked.length >= 4) break;
      }
      for (const p of picked) paths.push([{ x: s.x, z: s.z }, { x: p.x, z: p.z }]);
    }
    return paths;
  }

  private solidMaterial(): Material {
    return new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  }

  private unitPool(faction: string, type: string): InstancePool {
    const key = `${faction}|${type}`;
    let pool = this.unitPools.get(key);
    if (!pool) {
      const model = unitModel(type as never, faction as never);
      pool = new InstancePool(model.geo, this.solidMaterial(), 64, this.quality.shadows);
      this.unitPools.set(key, pool);
      this.scene.add(pool.mesh);
    }
    return pool;
  }

  private buildingPool(faction: string, type: string, size: number): InstancePool {
    const key = `${faction}|${type}`;
    let pool = this.buildingPools.get(key);
    if (!pool) {
      const model = buildingModel(type as never, faction as never, size);
      pool = new InstancePool(model.geo, this.solidMaterial(), 30, this.quality.shadows);
      this.buildingPools.set(key, pool);
      this.scene.add(pool.mesh);
    }
    return pool;
  }

  private nodePool(type: string, variant: number): InstancePool {
    const key = `node-${type}-${variant}`;
    let pool = this.nodePools.get(key);
    if (!pool) {
      const geo = nodeModel(type as never, variant);
      pool = new InstancePool(geo, this.solidMaterial(), 120, this.quality.shadows && type !== 'fish');
      this.nodePools.set(key, pool);
      this.scene.add(pool.mesh);
    }
    return pool;
  }

  private carryPool(res: string): InstancePool {
    let pool = this.carryPools.get(res);
    if (!pool) {
      pool = new InstancePool(carryModel(res as never), this.solidMaterial(), 40);
      this.carryPools.set(res, pool);
      this.scene.add(pool.mesh);
    }
    return pool;
  }

  /** ---------------------------------------------------------------------
   * Camera
   * ------------------------------------------------------------------- */
  private updateCamera(smoothing: number): void {
    this.target.lerp(this.targetGoal, smoothing);
    this.distance = lerp(this.distance, this.distanceGoal, smoothing);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    _v.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(_v);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();

    // Keep the shadow frustum centred on what we can see.
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).add(_v2.set(38, 62, 26));
    this.sun.target.updateMatrixWorld();
    const span = clamp(this.distance * 0.85, 26, 68);
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - span) > 0.5) {
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.updateProjectionMatrix();
    }
  }

  panBy(dxPixels: number, dyPixels: number): void {
    // Convert screen delta to world movement on the ground plane.
    const h = this.canvas.clientHeight || 1;
    const worldPerPixel = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.targetGoal.addScaledVector(right, -dxPixels * worldPerPixel);
    this.targetGoal.addScaledVector(forward, -dyPixels * worldPerPixel / Math.sin(this.pitch));
    this.clampTarget();
  }

  zoomBy(factor: number): void {
    this.distanceGoal = clamp(this.distanceGoal * factor, this.minDistance, this.maxDistance);
  }

  get zoom(): number {
    return this.distanceGoal;
  }

  focusOn(x: number, z: number, instant = false): void {
    this.targetGoal.set(x, 0, z);
    this.clampTarget();
    if (instant) this.target.copy(this.targetGoal);
  }

  private clampTarget(): void {
    const m = WORLD_HALF - 6;
    this.targetGoal.x = clamp(this.targetGoal.x, -m, m);
    this.targetGoal.z = clamp(this.targetGoal.z, -m, m);
  }

  get cameraTarget(): Vector3 {
    return this.target;
  }

  /** Ground-plane intersection for a client-space point. */
  screenToGround(clientX: number, clientY: number, out = new Vector3()): Vector3 {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const planeY = 0.45;
    if (Math.abs(dir.y) < 1e-5) return out.set(origin.x, planeY, origin.z);
    const t = (planeY - origin.y) / dir.y;
    return out.set(origin.x + dir.x * t, planeY, origin.z + dir.z * t);
  }

  worldToScreen(x: number, y: number, z: number, out = { x: 0, y: 0, visible: false }): { x: number; y: number; visible: boolean } {
    _v.set(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    out.x = ((_v.x + 1) / 2) * rect.width;
    out.y = ((1 - _v.y) / 2) * rect.height;
    out.visible = _v.z < 1;
    return out;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
    this.renderer.setSize(width, height, false);
  }

  setQuality(q: Partial<Quality>): void {
    Object.assign(this.quality, q);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.sun.castShadow = this.quality.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
  }

  /** ---------------------------------------------------------------------
   * Selection state
   * ------------------------------------------------------------------- */
  setSelection(ids: Iterable<number>): void {
    this.selection = new Set(ids);
  }

  setHighlight(id: number): void {
    this.highlighted = id;
  }

  addOrderPulse(x: number, z: number, color = 0x8fe3c4): void {
    const y = this.game.grid.heightAt(x, z);
    this.pulses.add(x, y, z, color);
  }

  /** ---------------------------------------------------------------------
   * Per-frame update
   * ------------------------------------------------------------------- */
  render(dt: number, alpha: number): void {
    this.time += dt;
    this.updateCamera(1 - Math.pow(0.0025, dt));
    this.terrain.update(this.time);
    this.flags.update(this.time);
    _q.copy(this.camera.quaternion);
    this.bars.setCameraQuaternion(_q);

    this.flags.begin();
    this.rings.begin();
    this.bars.begin();
    this.teamDiscCount = 0;

    this.syncNodes();
    this.syncBuildings(alpha);
    this.syncUnits(dt, alpha);

    this.teamDiscs.setCount(this.teamDiscCount);
    this.teamDiscs.flush(true);

    this.flags.end();
    this.rings.end();
    this.bars.end();

    this.projectiles.sync(this.game.projectiles, dt);
    this.particles.update(dt);
    this.pulses.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  /** ---------------------------------------------------------------------
   * Units
   * ------------------------------------------------------------------- */
  private syncUnits(dt: number, alpha: number): void {
    const game = this.game;
    const seen = new Set<number>();
    const carryUsed = new Map<string, number>();

    for (const u of game.units) {
      seen.add(u.id);
      const faction = game.player(u.owner).faction;
      const key = `${faction}|${u.type}`;
      let vis = this.unitVisuals.get(u.id);
      if (!vis || vis.key !== key) {
        if (vis) this.unitPool(...(vis.key.split('|') as [string, string])).free(vis.slot);
        const pool = this.unitPool(faction, u.type);
        const slot = pool.alloc();
        if (slot < 0) continue;
        vis = {
          key,
          slot,
          carrySlot: -1,
          carryKey: '',
          bobPhase: u.phase,
          spawnT: 0,
          lastSwing: 0,
          strikeT: 0,
          flinchT: 0,
        };
        this.unitVisuals.set(u.id, vis);
      }
      const pool = this.unitPool(faction, u.type);

      const x = lerp(u.px, u.x, alpha);
      const z = lerp(u.pz, u.z, alpha);
      const naval = u.def.role === 'naval' || u.def.role === 'navalWorker';
      let y = naval ? 0.0 : game.grid.heightAt(x, z);
      const angle = lerpAngle(u.pangle, u.angle, alpha);

      const speed = Math.hypot(u.vx, u.vz);
      const moving = clamp(speed / Math.max(0.5, u.def.speed), 0, 1);
      vis.bobPhase += dt * (6.5 + moving * 7.5);
      vis.spawnT = Math.min(1, vis.spawnT + dt * 3.2);

      let scale = smoothstep(0, 1, vis.spawnT);
      let bob = 0;
      let roll = 0;
      let lean = 0;

      if (naval) {
        y = 0.02 + Math.sin(this.time * 1.4 + u.phase) * 0.07;
        roll = Math.sin(this.time * 1.1 + u.phase * 1.7) * 0.05;
        lean = -moving * 0.04;
      } else {
        // Walking bounce plus a gentle idle sway.
        bob = Math.abs(Math.sin(vis.bobPhase)) * 0.11 * moving + Math.sin(this.time * 1.6 + u.phase) * 0.012;
        roll = Math.sin(vis.bobPhase) * 0.075 * moving;
        lean = moving * 0.1;
      }

      // Attack: anticipation while the blow winds up, a sharp strike on the
      // frame it lands, then a recovery. The sim owns the timing — swingTimer
      // counts down through the windup and hits zero exactly when damage is
      // dealt — so the motion stays locked to what actually happens.
      if (u.swingTimer <= 0 && vis.lastSwing > 0) vis.strikeT = 1;
      vis.lastSwing = u.swingTimer;
      if (vis.strikeT > 0) vis.strikeT = Math.max(0, vis.strikeT - dt * 4.2);

      const ranged = u.def.role === 'ranged' || u.def.role === 'naval';
      if (u.swingTimer > 0 && u.def.windup > 0) {
        // Wind-up: pull back, further the closer the release gets.
        const w = clamp(1 - u.swingTimer / u.def.windup, 0, 1);
        const pull = Math.sin(w * Math.PI * 0.5);
        if (ranged) {
          // Drawing a bow: settle, lean into the shot, steady the shoulders.
          lean -= pull * 0.1;
          roll += pull * 0.07;
          bob += pull * 0.02;
        } else {
          lean -= pull * 0.2;
          roll -= pull * 0.13;
          bob += pull * 0.05;
        }
      }
      if (vis.strikeT > 0) {
        // Strike: fast out, slower back. The curve is front-loaded so the hit
        // reads on the frame the damage lands.
        const k = vis.strikeT;
        const snap = k > 0.72 ? (1 - k) / 0.28 : k / 0.72;
        if (ranged) {
          lean += snap * 0.16;
          roll -= snap * 0.1;
        } else {
          lean += snap * 0.42;
          roll += snap * 0.16;
          bob -= snap * 0.06;
        }
      }

      // Flinch when hit, so a fight reads from both sides.
      if (u.hurtTimer > 0) vis.flinchT = 1;
      else if (vis.flinchT > 0) vis.flinchT = Math.max(0, vis.flinchT - dt * 5);
      if (vis.flinchT > 0 && u.state !== 'dead') {
        const f = Math.sin(vis.flinchT * Math.PI) * 0.9;
        lean -= f * 0.13;
        roll += f * 0.09;
      }

      // Working: a repeating hammer stroke, so a building site reads as busy.
      if (u.state === 'build' || u.state === 'gather') {
        const rate = u.state === 'build' ? 6.4 : 4.6;
        const swing = Math.sin(this.time * rate + u.phase * 3.1);
        const stroke = Math.max(0, swing);
        lean += stroke * (u.state === 'build' ? 0.34 : 0.26);
        bob += stroke * 0.05;
        roll += swing * 0.06;
      }

      let tilt = 0;
      if (u.state === 'dead') {
        const k = clamp(1 - u.deathTimer / 1.4, 0, 1);
        tilt = smoothstep(0, 0.55, k) * (Math.PI / 2) * 0.92;
        y -= smoothstep(0.55, 1, k) * 0.9;
        scale *= 1 - smoothstep(0.7, 1, k) * 0.35;
      }

      _v.set(x, y + bob, z);
      _q.setFromAxisAngle(YAXIS, angle);
      const tiltQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -(lean + tilt));
      const rollQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll);
      _q.multiply(tiltQ).multiply(rollQ);
      _m.compose(_v, _q, new Vector3(scale, scale, scale));
      pool.setMatrix(vis.slot, _m);

      // Damage flash / dead desaturation.
      if (u.hurtTimer > 0) {
        const k = clamp(u.hurtTimer / 0.28, 0, 1);
        _color.setRGB(1 + k * 1.6, 1 - k * 0.55, 1 - k * 0.55);
      } else if (u.state === 'dead') {
        _color.setRGB(0.72, 0.68, 0.66);
      } else {
        _color.setRGB(1, 1, 1);
      }
      pool.setColor(vis.slot, _color);

      // Team disc.
      if (u.state !== 'dead' && this.teamDiscCount < this.teamDiscs.capacity) {
        this.teamDiscs.place(this.teamDiscCount, x, (naval ? 0.03 : game.grid.heightAt(x, z)) + 0.045, z, 0, u.def.radius * 1.35);
        this.teamDiscs.setColor(this.teamDiscCount, TEAM_COLORS[u.owner]);
        this.teamDiscCount++;
      }

      // Carried resource.
      const carrying = u.carryKind && u.carryAmount > 0.5 && u.state !== 'dead';
      if (carrying) {
        const ck = u.carryKind!;
        const cpool = this.carryPool(ck);
        if (vis.carryKey !== ck) {
          if (vis.carrySlot >= 0 && vis.carryKey) this.carryPool(vis.carryKey).free(vis.carrySlot);
          vis.carrySlot = -1;
          vis.carryKey = ck;
        }
        const idx = carryUsed.get(ck) ?? 0;
        carryUsed.set(ck, idx + 1);
        if (idx < cpool.capacity) {
          const off = new Vector3(0.06, 1.12, -0.14).applyQuaternion(_q);
          cpool.place(idx, x + off.x, y + bob + off.y, z + off.z, angle, 1);
          vis.carrySlot = idx;
        }
      } else if (vis.carryKey) {
        vis.carryKey = '';
        vis.carrySlot = -1;
      }

      // Selection ring + health bar.
      const selected = this.selection.has(u.id);
      if (selected || this.highlighted === u.id) {
        this.rings.add(x, y + 0.07, z, u.def.radius * 1.7, selected ? 0xffffff : 0xffe9a8);
      }
      if (u.state !== 'dead') {
        const showBar = selected || u.hp < u.maxHp - 0.01;
        if (showBar) {
          const model = unitModel(u.type, faction);
          const ratio = u.hp / u.maxHp;
          this.bars.add(
            x,
            y + model.height * 1.02 + 0.34,
            z,
            ratio,
            u.owner === 0 ? (ratio > 0.4 ? 0x6de08a : 0xe8c04a) : 0xe8563f,
            0.95 + u.def.radius,
          );
        }
      }
    }

    // Hide instances whose units are gone.
    for (const [res, cpool] of this.carryPools) {
      cpool.setCount(carryUsed.get(res) ?? 0);
      cpool.flush(false);
    }
    for (const [id, vis] of this.unitVisuals) {
      if (seen.has(id)) continue;
      const [f, t] = vis.key.split('|');
      this.unitPool(f, t).free(vis.slot);
      this.unitVisuals.delete(id);
    }
    for (const pool of this.unitPools.values()) pool.flush(true);
  }

  /** ---------------------------------------------------------------------
   * Buildings
   * ------------------------------------------------------------------- */
  private syncBuildings(alpha: number): void {
    void alpha;
    const game = this.game;
    const seen = new Set<number>();
    let scaffoldUsed = 0;

    // Sites with a villager actually working them animate; abandoned ones rest.
    const activeSites = new Set<number>();
    for (const u of game.units) {
      if (u.state === 'build' && u.siteId) activeSites.add(u.siteId);
    }

    for (const b of game.buildings) {
      seen.add(b.id);
      const faction = game.player(b.owner).faction;
      const key = `${faction}|${b.type}`;
      let vis = this.buildingVisuals.get(b.id);
      const model = buildingModel(b.type, faction, b.size);
      if (!vis || vis.key !== key) {
        const pool = this.buildingPool(faction, b.type, b.size);
        const slot = pool.alloc();
        if (slot < 0) continue;
        vis = { key, slot, scaffold: -1, completeT: b.complete ? 1 : 0, height: model.height };
        this.buildingVisuals.set(b.id, vis);
      }
      const pool = this.buildingPool(faction, b.type, b.size);
      const y = game.grid.heightAt(b.x, b.z) - 0.12;

      let sy = 1;
      let sxz = 1;
      let sink = 0;
      const working = !b.complete && activeSites.has(b.id);
      if (!b.complete) {
        const p = smoothstep(0, 1, b.progress);
        sy = 0.06 + 0.94 * p;
        sxz = 0.86 + 0.14 * p;
        // Each hammer stroke settles the frame a little; idle sites sit still.
        if (working) {
          const beat = Math.sin(this.time * 6.4 + b.phase);
          sy *= 1 + Math.max(0, beat) * 0.035;
          sxz *= 1 - Math.max(0, beat) * 0.012;
        }
      } else if (vis.completeT < 1) {
        vis.completeT = Math.min(1, vis.completeT + 0.06);
        const pop = Math.sin(vis.completeT * Math.PI) * 0.07;
        sy = 1 + pop;
        sxz = 1 - pop * 0.5;
      }
      if (b.dead) {
        const k = clamp(1 - b.deathTimer / 1.8, 0, 1);
        sink = smoothstep(0.15, 1, k) * (vis.height + 1);
        sy = Math.max(0.02, 1 - k * 0.25);
      }

      // A touch of per-building jitter so rows of houses don't look stamped.
      const minor = b.type === 'house' || b.type === 'farm' || b.type === 'storehouse';
      const yaw = b.angle + (minor ? (b.phase - Math.PI) * 0.022 : 0);
      const jitter = minor ? 1 + Math.sin(b.phase * 3.1) * 0.035 : 1;
      _v.set(b.x, y - sink, b.z);
      _q.setFromAxisAngle(YAXIS, yaw);
      _m.compose(_v, _q, new Vector3(sxz * jitter, sy * jitter, sxz * jitter));
      pool.setMatrix(vis.slot, _m);

      if (b.hurtTimer > 0) {
        const k = clamp(b.hurtTimer / 0.28, 0, 1);
        _color.setRGB(1 + k * 1.3, 1 - k * 0.45, 1 - k * 0.45);
      } else if (!b.complete) {
        _color.setRGB(0.94, 0.92, 0.88);
      } else {
        _color.setRGB(1, 1, 1);
      }
      pool.setColor(vis.slot, _color);

      // Scaffolding while under construction. It climbs with the building and
      // sways while someone is actually swinging a hammer at it.
      if (!b.complete && !b.dead && scaffoldUsed < this.scaffoldPool.capacity) {
        const r = (b.size * TILE) / 2 + 0.35;
        const climb = 1 + b.size * 0.35 * (0.55 + 0.45 * smoothstep(0, 1, b.progress));
        const sway = working ? Math.sin(this.time * 3.2 + b.phase) * 0.045 : 0;
        this.scaffoldPool.place(scaffoldUsed, b.x, y, b.z, 0.3 + sway, r, climb, r);
        this.scaffoldPool.setColor(scaffoldUsed, working ? 0xfff0d2 : 0xffffff);
        scaffoldUsed++;
      }

      // Flags.
      if (!b.dead && b.complete) {
        for (const f of model.flags) {
          this.flags.add(b.x + f.x, y + f.y, b.z + f.z, b.phase * 0.3, f.scale, f.color);
        }
      }

      // Selection + health.
      const selected = this.selection.has(b.id);
      if (selected || this.highlighted === b.id) {
        this.rings.add(b.x, y + 0.09, b.z, (b.size * TILE) / 2 + 0.35, selected ? 0xffffff : 0xffe9a8);
      }
      if (!b.dead) {
        const showBar = selected || b.hp < b.maxHp || !b.complete;
        if (showBar) {
          const ratio = b.complete ? b.hp / b.maxHp : b.progress;
          const color = !b.complete ? 0x69c8ee : b.owner === 0 ? 0x6de08a : 0xe8563f;
          this.bars.add(b.x, y + vis.height + 0.55, b.z, ratio, color, 1.1 + b.size * 0.35);
        }
      }
    }

    this.scaffoldPool.setCount(scaffoldUsed);
    this.scaffoldPool.flush(true);

    for (const [id, vis] of this.buildingVisuals) {
      if (seen.has(id)) continue;
      const [f, t] = vis.key.split('|');
      const pool = this.buildingPools.get(`${f}|${t}`);
      pool?.free(vis.slot);
      this.buildingVisuals.delete(id);
    }
    for (const pool of this.buildingPools.values()) pool.flush(true);
  }

  /** ---------------------------------------------------------------------
   * Resource nodes
   * ------------------------------------------------------------------- */
  private syncNodes(): void {
    const game = this.game;
    const seen = new Set<number>();
    for (const n of game.nodes) {
      if (n.type === 'farm') continue;
      seen.add(n.id);
      const key = `node-${n.type}-${n.variant & 3}`;
      let vis = this.nodeVisuals.get(n.id);
      if (!vis) {
        const pool = this.nodePool(n.type, n.variant & 3);
        const slot = pool.alloc();
        if (slot < 0) continue;
        vis = { key, slot };
        this.nodeVisuals.set(n.id, vis);
        const y = n.type === 'fish' ? 0.0 : game.grid.heightAt(n.x, n.z) - 0.05;
        pool.place(slot, n.x, y, n.z, (n.id % 16) * 0.4, 1);
        pool.setColor(slot, 0xffffff);
        pool.flush(true);
      }
      const pool = this.nodePools.get(key);
      if (!pool) continue;

      if (n.type === 'fish') {
        // Shoals drift gently.
        const y = 0.02 + Math.sin(this.time * 0.9 + n.id) * 0.05;
        pool.place(vis.slot, n.x, y, n.z, this.time * 0.12 + n.id, 1);
        pool.flush(false);
      }

      // Shrink as the node is worked out, then vanish.
      const ratio = n.maxAmount > 0 ? n.amount / n.maxAmount : 0;
      if (n.depleted || ratio < 0.98) {
        const y = n.type === 'fish' ? 0.02 : game.grid.heightAt(n.x, n.z) - 0.05;
        let s = 0.55 + 0.45 * ratio;
        if (n.depleted) s *= clamp(n.fadeTimer / 1.1, 0, 1);
        if (s <= 0.001) {
          pool.hide(vis.slot);
        } else {
          pool.place(vis.slot, n.x, y, n.z, (n.id % 16) * 0.4, s, s, s);
        }
        pool.flush(false);
      }
    }
    for (const [id, vis] of this.nodeVisuals) {
      if (seen.has(id)) continue;
      const pool = this.nodePools.get(vis.key);
      pool?.free(vis.slot);
      pool?.flush(false);
      this.nodeVisuals.delete(id);
    }
  }

  /** ---------------------------------------------------------------------
   * Simulation events -> visual feedback
   * ------------------------------------------------------------------- */
  handleEvents(events: GameEvent[]): void {
    const game = this.game;
    for (const e of events) {
      switch (e.type) {
        case 'damage': {
          const y = game.grid.heightAt(e.x, e.z) + 0.7;
          this.particles.emit(e.melee ? 'chunk' : 'spark', e.x, y, e.z, e.melee ? 4 : 3, {
            color: e.melee ? 0xffd9a0 : 0xfff0c8,
            speed: 2.1,
            size: 0.12,
            life: 0.32,
            up: 2.0,
            spread: 0.25,
          });
          break;
        }
        case 'projectile-hit':
          this.particles.emit('spark', e.x, e.y, e.z, 4, {
            color: 0xffe6b0,
            speed: 2.4,
            size: 0.1,
            life: 0.26,
            up: 1.6,
            spread: 0.15,
          });
          break;
        case 'unit-died': {
          const y = game.grid.heightAt(e.x, e.z);
          this.particles.emit('dust', e.x, y + 0.35, e.z, 8, {
            color: C.dust,
            speed: 1.9,
            size: 0.2,
            life: 0.75,
            up: 1.2,
            spread: 0.45,
          });
          break;
        }
        case 'building-destroyed': {
          const b = e.building;
          const y = game.grid.heightAt(b.x, b.z);
          const r = (b.size * TILE) / 2;
          this.particles.emit('chunk', b.x, y + 0.9, b.z, 18, {
            color: 0xcbb894,
            speed: 4.2,
            size: 0.3,
            life: 1.2,
            up: 4.0,
            spread: r,
          });
          this.particles.emit('smoke', b.x, y + 1.2, b.z, 12, {
            color: 0x9a9186,
            speed: 1.1,
            size: 0.55,
            life: 1.9,
            gravity: 0.7,
            up: 1.4,
            spread: r * 0.8,
          });
          break;
        }
        case 'build-complete': {
          const b = e.building;
          const y = game.grid.heightAt(b.x, b.z);
          const r = (b.size * TILE) / 2;
          this.particles.emit('dust', b.x, y + 0.25, b.z, 14, {
            color: C.dust,
            speed: 2.6,
            size: 0.26,
            life: 0.85,
            up: 1.0,
            spread: r,
          });
          break;
        }
        case 'gather-tick': {
          const y = game.grid.heightAt(e.x, e.z) + 0.6;
          const color =
            e.resource === 'wood' ? 0xc79a63 : e.resource === 'gold' ? 0xf0cf5c : e.resource === 'stone' ? 0xc6c2b8 : 0xa8c46a;
          this.particles.emit('spark', e.x, y, e.z, 2, {
            color,
            speed: 0.9,
            size: 0.1,
            life: 0.45,
            up: 1.5,
            spread: 0.3,
          });
          break;
        }
        case 'deposit': {
          const y = game.grid.heightAt(e.x, e.z) + 1.4;
          const color =
            e.resource === 'wood' ? 0xc79a63 : e.resource === 'gold' ? 0xf0cf5c : e.resource === 'stone' ? 0xc6c2b8 : 0xa8c46a;
          this.particles.emit('spark', e.x, y, e.z, 5, {
            color,
            speed: 1.2,
            size: 0.13,
            life: 0.6,
            gravity: -1.2,
            up: 1.8,
            spread: 0.4,
          });
          break;
        }
        case 'unit-spawned': {
          const u = e.unit;
          const y = game.grid.heightAt(u.x, u.z);
          this.particles.emit('dust', u.x, y + 0.15, u.z, 5, {
            color: C.dust,
            speed: 1.4,
            size: 0.16,
            life: 0.5,
            up: 0.7,
            spread: 0.4,
          });
          break;
        }
        default:
          break;
      }
    }
  }

  /** Continuous walking dust for moving units, throttled for performance. */
  emitFootDust(): void {
    const game = this.game;
    let budget = 3;
    for (const u of game.units) {
      if (budget <= 0) break;
      if (u.state === 'dead') continue;
      if (u.def.role === 'naval' || u.def.role === 'navalWorker') continue;
      const speed = Math.hypot(u.vx, u.vz);
      if (speed < u.def.speed * 0.55) continue;
      if (Math.random() > 0.25) continue;
      const y = game.grid.heightAt(u.x, u.z);
      this.particles.emit('dust', u.x, y + 0.05, u.z, 1, {
        color: C.dust,
        speed: 0.35,
        size: 0.14,
        life: 0.42,
        gravity: -1.1,
        up: 0.5,
        spread: 0.12,
      });
      budget--;
    }
    this.emitBuildDust();
  }

  /** Chips and dust thrown off wherever a villager is raising a building. */
  private emitBuildDust(): void {
    const game = this.game;
    let budget = 2;
    for (const u of game.units) {
      if (budget <= 0) break;
      if (u.state !== 'build' || !u.siteId) continue;
      if (Math.random() > 0.3) continue;
      const site = game.entity(u.siteId);
      if (!site || site.kind !== 'building' || site.complete) continue;
      const y = game.grid.heightAt(u.x, u.z);
      this.particles.emit('dust', u.x, y + 0.35, u.z, 1, {
        color: C.dust,
        speed: 0.5,
        size: 0.11,
        life: 0.5,
        gravity: -1.6,
        up: 1.1,
        spread: 0.3,
      });
      budget--;
    }
  }

  /** ---------------------------------------------------------------------
   * Ghost placement helper
   * ------------------------------------------------------------------- */
  showGhost(type: string, faction: string, size: number, x: number, z: number, valid: boolean): void {
    const model = buildingModel(type as never, faction as never, size);
    if ((this.ghost as unknown as { _lastKey?: string })._lastKey !== `${faction}|${type}`) {
      this.ghost.setModel(model.geo);
      (this.ghost as unknown as { _lastKey?: string })._lastKey = `${faction}|${type}`;
    }
    const y = this.game.grid.heightAt(x, z) - 0.1;
    this.ghost.show(x, y, z, (size * TILE) / 2, valid);
  }

  hideGhost(): void {
    this.ghost.hide();
  }

  /** ---------------------------------------------------------------------
   * Teardown
   * ------------------------------------------------------------------- */
  private disposeWorld(): void {
    for (const pool of this.unitPools.values()) {
      this.scene.remove(pool.mesh);
      (pool.mesh.material as Material).dispose();
      pool.mesh.dispose();
    }
    this.unitPools.clear();
    for (const pool of this.buildingPools.values()) {
      this.scene.remove(pool.mesh);
      (pool.mesh.material as Material).dispose();
      pool.mesh.dispose();
    }
    this.buildingPools.clear();
    for (const pool of this.nodePools.values()) {
      this.scene.remove(pool.mesh);
      this.staticGroup.remove(pool.mesh);
      (pool.mesh.material as Material).dispose();
      pool.mesh.dispose();
    }
    this.nodePools.clear();
    for (const pool of this.carryPools.values()) {
      this.scene.remove(pool.mesh);
      (pool.mesh.material as Material).dispose();
      pool.mesh.dispose();
    }
    this.carryPools.clear();
    if (this.scaffoldPool) {
      this.scene.remove(this.scaffoldPool.mesh);
      this.scaffoldPool.dispose();
    }
    if (this.teamDiscs) {
      this.scene.remove(this.teamDiscs.mesh);
      this.teamDiscs.dispose();
    }
    if (this.terrain) {
      this.staticGroup.remove(this.terrain.ground);
      this.staticGroup.remove(this.terrain.water);
      this.terrain.dispose();
    }
    this.unitVisuals.clear();
    this.buildingVisuals.clear();
    this.nodeVisuals.clear();
    this.selection.clear();
  }

  /** Full teardown, including the shared model caches. */
  dispose(): void {
    this.disposeWorld();
    clearBuildingCache();
    clearUnitCache();
    clearPropCache();
    this.renderer.dispose();
  }

  /** Entity under a screen point, preferring units. */
  pickAt(clientX: number, clientY: number): { entity: Entity | null; node: ResourceNode | null; point: Vector3 } {
    const point = this.screenToGround(clientX, clientY);
    // Widen the pick radius when zoomed out so taps stay forgiving on phones.
    const tol = clamp(this.distance / 26, 1, 2.6);
    const entity = this.game.pick(point.x, point.z, 2.4 * tol);
    const node = entity ? null : this.game.pickNode(point.x, point.z, 2.0 * tol);
    return { entity, node, point };
  }
}
