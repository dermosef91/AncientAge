import {
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { GeoBuilder } from './geo';
import { C } from './palette';

const _m = new Matrix4();
const _v = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _color = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);

/**
 * Fixed-capacity instanced mesh with a free list. Unused slots are parked at
 * zero scale so `count` can stay at capacity and never needs re-sorting.
 */
export class InstancePool {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  /** Free slots, kept sorted descending so `pop()` yields the lowest index. */
  private freeList: number[] = [];
  private isFree: Uint8Array;
  private used = 0;
  /** One past the highest live slot; drives `mesh.count`. */
  private high = 0;

  constructor(geo: BufferGeometry, mat: Material, capacity: number, castShadow = false) {
    this.capacity = Math.max(1, capacity);
    this.isFree = new Uint8Array(this.capacity).fill(1);
    this.mesh = new InstancedMesh(geo, mat, this.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    _color.set(0xffffff);
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, _color);
      this.freeList.push(this.capacity - 1 - i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  alloc(): number {
    const i = this.freeList.pop();
    if (i === undefined) return -1;
    this.isFree[i] = 0;
    this.used++;
    if (i + 1 > this.high) this.high = i + 1;
    return i;
  }

  free(i: number): void {
    if (i < 0 || i >= this.capacity || this.isFree[i]) return;
    this.mesh.setMatrixAt(i, ZERO);
    this.isFree[i] = 1;
    // Descending binary insert keeps allocation packed towards index 0.
    let lo = 0;
    let hi = this.freeList.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.freeList[mid] > i) lo = mid + 1;
      else hi = mid;
    }
    this.freeList.splice(lo, 0, i);
    this.used = Math.max(0, this.used - 1);
    while (this.high > 0 && this.isFree[this.high - 1]) this.high--;
  }

  /** Used by pools that index directly instead of allocating (bars, rings). */
  setCount(n: number): void {
    this.high = Math.min(this.capacity, Math.max(0, n));
  }

  setMatrix(i: number, m: Matrix4): void {
    this.mesh.setMatrixAt(i, m);
  }

  place(i: number, x: number, y: number, z: number, ry: number, scale: number, sy = scale, sz = scale): void {
    _v.set(x, y, z);
    _q.setFromAxisAngle(new Vector3(0, 1, 0), ry);
    _s.set(scale, sy, sz);
    _m.compose(_v, _q, _s);
    this.mesh.setMatrixAt(i, _m);
  }

  setColor(i: number, color: number | Color): void {
    if (typeof color === 'number') _color.set(color);
    else _color.copy(color);
    this.mesh.setColorAt(i, _color);
  }

  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO);
  }

  flush(colors = false): void {
    this.mesh.count = this.high;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.dispose();
  }
}

/** ---------------------------------------------------------------------------
 * Particles
 * ------------------------------------------------------------------------- */
type ParticleKind = 'dust' | 'spark' | 'chunk' | 'smoke' | 'splash';

interface Particle {
  slot: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  endSize: number;
  gravity: number;
  spin: number;
  rot: number;
  kind: ParticleKind;
  color: Color;
}

const MAX_PARTICLES = 340;

export class Particles {
  readonly pool: InstancePool;
  private items: Particle[] = [];
  private free: Particle[] = [];

  constructor() {
    const b = new GeoBuilder();
    // A chunky faceted mote reads well at this camera distance.
    b.rock(0, 0, 0, 0.5, 0xffffff, 1, 0);
    const geo = b.build();
    const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.95 });
    this.pool = new InstancePool(geo, mat, MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.free.push({
        slot: -1,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.2, endSize: 0, gravity: -6,
        spin: 0, rot: 0, kind: 'dust', color: new Color(),
      });
    }
  }

  private spawn(): Particle | null {
    const p = this.free.pop();
    if (!p) return null;
    const slot = this.pool.alloc();
    if (slot < 0) {
      this.free.push(p);
      return null;
    }
    p.slot = slot;
    this.items.push(p);
    return p;
  }

  emit(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    count: number,
    opts: {
      color?: number;
      speed?: number;
      size?: number;
      life?: number;
      gravity?: number;
      up?: number;
      spread?: number;
    } = {},
  ): void {
    const color = opts.color ?? C.dust;
    const speed = opts.speed ?? 1.6;
    const size = opts.size ?? 0.18;
    const life = opts.life ?? 0.6;
    const gravity = opts.gravity ?? -5;
    const up = opts.up ?? 1.6;
    const spread = opts.spread ?? 0.3;
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      p.x = x + Math.cos(a) * r;
      p.y = y + Math.random() * 0.2;
      p.z = z + Math.sin(a) * r;
      const sp = speed * (0.5 + Math.random());
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = up * (0.4 + Math.random());
      p.life = life * (0.7 + Math.random() * 0.6);
      p.maxLife = p.life;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.endSize = kind === 'smoke' ? p.size * 1.9 : 0.01;
      p.gravity = gravity;
      p.spin = (Math.random() - 0.5) * 9;
      p.rot = Math.random() * 6.28;
      p.kind = kind;
      p.color.set(color);
      this.pool.setColor(p.slot, p.color);
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.free(p.slot);
        p.slot = -1;
        this.items.splice(i, 1);
        this.free.push(p);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind !== 'smoke') {
        p.vx *= 1 - 2.2 * dt;
        p.vz *= 1 - 2.2 * dt;
      }
      p.rot += p.spin * dt;
      const t = 1 - p.life / p.maxLife;
      const size = p.size + (p.endSize - p.size) * t;
      this.pool.place(p.slot, p.x, p.y, p.z, p.rot, Math.max(0.001, size));
    }
    this.pool.flush(true);
  }

  get activeCount(): number {
    return this.items.length;
  }
}

/** ---------------------------------------------------------------------------
 * Projectiles
 * ------------------------------------------------------------------------- */
interface Shot {
  slot: number;
  id: number;
  trail: number;
}

export class ProjectileRenderer {
  readonly pool: InstancePool;
  private map = new Map<number, Shot>();
  private up = new Vector3(0, 1, 0);

  constructor(private particles: Particles) {
    const b = new GeoBuilder();
    // Arrow lying along +Z.
    b.box(0, 0, -0.06, 0.035, 0.035, 0.72, C.woodLight);
    b.cone(0, 0, 0.36, 0.06, 0.2, C.iron, 6);
    b.box(0, 0, -0.4, 0.02, 0.16, 0.16, C.cloth);
    const geo = b.build();
    const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.pool = new InstancePool(geo, mat, 72);
  }

  sync(
    shots: { id: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; tx: number; ty: number; tz: number; t: number; duration: number; kind: string }[],
    dt: number,
  ): void {
    const seen = new Set<number>();
    for (const s of shots) {
      seen.add(s.id);
      let entry = this.map.get(s.id);
      if (!entry) {
        const slot = this.pool.alloc();
        if (slot < 0) continue;
        entry = { slot, id: s.id, trail: 0 };
        this.map.set(s.id, entry);
        this.pool.setColor(slot, s.kind === 'javelin' ? 0xf0e0b0 : s.kind === 'bolt' ? 0xd0d8e0 : 0xffffff);
      }
      // Orient along the instantaneous velocity, including the arc.
      const k = Math.min(1, s.t / s.duration);
      const ahead = Math.min(1, k + 0.06);
      const px = s.sx + (s.tx - s.sx) * ahead;
      const pz = s.sz + (s.tz - s.sz) * ahead;
      const arcNow = Math.sin(k * Math.PI) * Math.min(2.2, s.duration * 3.2);
      const arcNext = Math.sin(ahead * Math.PI) * Math.min(2.2, s.duration * 3.2);
      const py = s.sy + (s.ty - s.sy) * ahead + arcNext;
      _v.set(px - s.x, py - (s.y - arcNow + arcNow), pz - s.z);
      if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
      _v.normalize();
      _q.setFromUnitVectors(new Vector3(0, 0, 1), _v);
      const scale = s.kind === 'bolt' ? 1.35 : s.kind === 'javelin' ? 1.15 : 1;
      _m.compose(new Vector3(s.x, s.y, s.z), _q, new Vector3(scale, scale, scale));
      this.pool.setMatrix(entry.slot, _m);

      entry.trail -= dt;
      if (entry.trail <= 0) {
        entry.trail = 0.035;
        this.particles.emit('spark', s.x, s.y, s.z, 1, {
          color: 0xf6e7c0,
          speed: 0.05,
          size: 0.07,
          life: 0.2,
          gravity: -0.4,
          up: 0.05,
          spread: 0.02,
        });
      }
    }
    for (const [id, entry] of this.map) {
      if (!seen.has(id)) {
        this.pool.free(entry.slot);
        this.map.delete(id);
      }
    }
    this.pool.flush(true);
    void this.up;
  }
}

/** ---------------------------------------------------------------------------
 * Selection rings & ground markers
 * ------------------------------------------------------------------------- */
export class SelectionRings {
  readonly pool: InstancePool;
  private used = 0;

  constructor(capacity = 96) {
    const geo = new RingGeometry(0.78, 1.0, 22);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
    });
    this.pool = new InstancePool(geo, mat, capacity);
    this.pool.mesh.renderOrder = 2;
  }

  begin(): void {
    this.used = 0;
  }

  add(x: number, y: number, z: number, radius: number, color: number): void {
    if (this.used >= this.pool.capacity) return;
    this.pool.place(this.used, x, y, z, 0, radius);
    this.pool.setColor(this.used, color);
    this.used++;
  }

  end(): void {
    this.pool.setCount(this.used);
    this.pool.flush(true);
  }
}

/** Expanding ring pulse used for move/attack order feedback. */
interface Pulse {
  slot: number;
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  radius: number;
  color: number;
}

export class OrderPulses {
  readonly pool: InstancePool;
  private items: Pulse[] = [];

  constructor() {
    const geo = new RingGeometry(0.72, 1.0, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: DoubleSide,
    });
    this.pool = new InstancePool(geo, mat, 16);
    this.pool.mesh.renderOrder = 3;
  }

  add(x: number, y: number, z: number, color = 0x8fe3c4, radius = 1.4): void {
    const slot = this.pool.alloc();
    if (slot < 0) return;
    this.items.push({ slot, x, y, z, t: 0, life: 0.65, radius, color });
    this.pool.setColor(slot, color);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.pool.free(p.slot);
        this.items.splice(i, 1);
        continue;
      }
      const k = p.t / p.life;
      this.pool.place(p.slot, p.x, p.y + 0.06, p.z, 0, p.radius * (0.4 + k * 1.1));
      _color.set(p.color).multiplyScalar(1 - k * 0.85);
      this.pool.setColor(p.slot, _color);
    }
    this.pool.flush(true);
  }
}

/** ---------------------------------------------------------------------------
 * Health bars (billboarded quads)
 * ------------------------------------------------------------------------- */
export class HealthBars {
  readonly back: InstancePool;
  readonly fill: InstancePool;
  private used = 0;
  private billboard = new Quaternion();

  constructor(capacity = 140) {
    const geo = new PlaneGeometry(1, 1);
    const backMat = new MeshBasicMaterial({ color: 0x1c1a18, transparent: true, opacity: 0.72, depthTest: false });
    const fillMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98, depthTest: false });
    this.back = new InstancePool(geo, backMat, capacity);
    this.fill = new InstancePool(geo.clone(), fillMat, capacity);
    this.back.mesh.renderOrder = 10;
    this.fill.mesh.renderOrder = 11;
  }

  setCameraQuaternion(q: Quaternion): void {
    this.billboard.copy(q);
  }

  begin(): void {
    this.used = 0;
  }

  add(x: number, y: number, z: number, ratio: number, color: number, width = 1.1): void {
    if (this.used >= this.back.capacity) return;
    const h = width * 0.155;
    _v.set(x, y, z);
    _s.set(width, h, 1);
    _m.compose(_v, this.billboard, _s);
    this.back.setMatrix(this.used, _m);

    const w = Math.max(0.001, width - h * 0.42) * Math.max(0, Math.min(1, ratio));
    // Left-align the fill inside the backing bar.
    const off = (width - h * 0.42) * 0.5 - w * 0.5;
    _v.set(x, y, z).add(new Vector3(off, 0, 0).applyQuaternion(this.billboard));
    _s.set(w, h * 0.58, 1);
    _m.compose(_v, this.billboard, _s);
    this.fill.setMatrix(this.used, _m);
    this.fill.setColor(this.used, color);
    this.used++;
  }

  end(): void {
    this.back.setCount(this.used);
    this.fill.setCount(this.used);
    this.back.flush(false);
    this.fill.flush(true);
  }
}

/** ---------------------------------------------------------------------------
 * Waving faction flags
 * ------------------------------------------------------------------------- */
export class Flags {
  readonly pool: InstancePool;
  private time = { value: 0 };
  private used = 0;

  constructor(capacity = 64) {
    const geo = new PlaneGeometry(1, 0.62, 8, 2);
    geo.translate(0.5, 0, 0);
    const mat = new MeshLambertMaterial({
      vertexColors: false,
      side: DoubleSide,
      transparent: false,
    });
    const t = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = t;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float phase = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.5;
           float amp = transformed.x;
           transformed.z += sin(transformed.x * 5.0 - uTime * 5.5 + phase) * 0.16 * amp;
           transformed.y += sin(transformed.x * 3.4 - uTime * 4.2 + phase) * 0.07 * amp;`,
        );
    };
    this.pool = new InstancePool(geo, mat, capacity);
  }

  update(t: number): void {
    this.time.value = t;
  }

  begin(): void {
    this.used = 0;
  }

  add(x: number, y: number, z: number, ry: number, scale: number, color: number): void {
    if (this.used >= this.pool.capacity) return;
    this.pool.place(this.used, x, y, z, ry, scale);
    this.pool.setColor(this.used, color);
    this.used++;
  }

  end(): void {
    this.pool.setCount(this.used);
    this.pool.flush(true);
  }
}

/** ---------------------------------------------------------------------------
 * Building placement ghost
 * ------------------------------------------------------------------------- */
export class PlacementGhost {
  readonly group: Object3D;
  private mesh: Mesh | null = null;
  private tiles: Mesh;
  private okColor = new Color(0x6fe6a8);
  private badColor = new Color(0xff7a6a);

  constructor() {
    this.group = new Object3D();
    this.group.visible = false;
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: 0x6fe6a8,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.tiles = new Mesh(geo, mat);
    this.tiles.renderOrder = 4;
    this.group.add(this.tiles);
  }

  setModel(geo: BufferGeometry): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      (this.mesh.material as Material).dispose();
      this.mesh = null;
    }
    const mat = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.renderOrder = 5;
    this.group.add(this.mesh);
  }

  show(x: number, y: number, z: number, footprint: number, valid: boolean): void {
    this.group.visible = true;
    this.group.position.set(x, y, z);
    this.tiles.scale.set(footprint * 2, 1, footprint * 2);
    this.tiles.position.y = 0.05;
    const c = valid ? this.okColor : this.badColor;
    (this.tiles.material as MeshBasicMaterial).color.copy(c);
    if (this.mesh) {
      const m = this.mesh.material as MeshLambertMaterial;
      m.opacity = valid ? 0.6 : 0.35;
      m.color.copy(valid ? new Color(0xffffff) : new Color(0xff9a8a));
    }
  }

  hide(): void {
    this.group.visible = false;
  }
}
