import './style.css';
import { audio } from './audio/audio';
import { clamp } from './core/math';
import { Controls } from './input/controls';
import { Minimap } from './render/minimap';
import { SceneRenderer } from './render/scene';
import { SkirmishAI } from './sim/ai';
import { BUILDINGS, FACTIONS, TICK_DT, UNITS, buildingCost, canAfford } from './sim/data';
import { Game } from './sim/game';
import { TILE, WORLD_HALF } from './sim/grid';
import type {
  BuildingTypeId,
  Entity,
  FactionId,
  GameEvent,
  TechId,
  Unit,
  UnitTypeId,
} from './sim/types';
import { Hud, type Objective } from './ui/hud';
import { Screens } from './ui/screens';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

/** Rough device tier detection to pick sensible defaults. */
function detectQuality(): { shadows: boolean; maxPixelRatio: number } {
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && cores <= 4) return { shadows: false, maxPixelRatio: 1.4 };
  if (coarse) return { shadows: true, maxPixelRatio: 1.7 };
  return { shadows: true, maxPixelRatio: 2 };
}

class GameController {
  private scene: SceneRenderer;
  private hud: Hud;
  private screens: Screens;
  private minimap: Minimap;
  private controls!: Controls;

  private game: Game | null = null;
  private ai: SkirmishAI | null = null;
  private playerAi: SkirmishAI | null = null;

  private selection: Entity[] = [];
  private placing: BuildingTypeId | null = null;
  private buildMenuOpen = false;
  private rallyBuildingId = 0;

  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private paused = false;

  private playerFaction: FactionId = 'greece';
  private enemyFaction: FactionId = 'rome';

  private idleCycle = 0;
  private coachStep = 0;
  private coachDismissed = false;
  private coachTimer = 0;

  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsValue = 60;
  private lowFpsTime = 0;
  private autoDowngraded = false;

  private ghostTile = { gx: 0, gz: 0, valid: false, x: 0, z: 0 };
  private readonly showFps = new URLSearchParams(location.search).has('fps');

  constructor() {
    const quality = detectQuality();
    this.scene = new SceneRenderer(canvas, quality);

    this.hud = new Hud(uiRoot, {
      onBuildToggle: () => this.toggleBuildMenu(),
      onPickBuilding: (t) => this.beginPlacement(t),
      onTrain: (id, t) => this.train(id, t),
      onCancelTrain: (id, i) => this.cancelTrain(id, i),
      onResearch: (id, t) => this.research(id, t),
      onCancelResearch: (id) => this.cancelResearch(id),
      onSetRally: (id) => this.beginRally(id),
      onStop: () => this.stopSelection(),
      onGather: () => this.gatherWithSelection(),
      onSelectArmy: () => this.selectArmy(),
      onSelectIdle: () => this.selectIdleVillager(),
      onFocusHome: () => this.focusHome(),
      onToggleMute: () => {
        audio.unlock();
        const muted = audio.toggleMute();
        return muted;
      },
      onMenu: () => this.openMenu(),
      onMinimapPoint: (px, py) => this.minimapJump(px, py),
      onCoachDismiss: () => this.dismissCoach(),
    });

    this.screens = new Screens(uiRoot, {
      onStart: (f) => this.startMatch(f),
      onRestart: () => this.startMatch(this.playerFaction),
      onChangeFaction: () => {
        this.running = false;
      },
      onResume: () => {
        this.paused = false;
        this.lastTime = performance.now();
      },
      onToggleSound: () => {
        audio.unlock();
        return !audio.toggleMute();
      },
      onToggleShadows: () => {
        const on = !this.scene.renderer.shadowMap.enabled;
        this.scene.setQuality({ shadows: on });
        return on;
      },
      onQuit: () => {
        this.running = false;
        this.paused = false;
      },
    });

    this.minimap = new Minimap(this.hud.minimapCanvas);

    this.controls = new Controls(
      this.scene,
      {
        onTap: (x, y) => this.handleTap(x, y),
        onDoubleTap: (x, y) => this.handleDoubleTap(x, y),
        onBoxSelect: (x0, y0, x1, y1) => this.handleBoxSelect(x0, y0, x1, y1),
        onGhostMove: (x, y) => this.updateGhost(x, y),
        onGhostPlace: (x, y) => this.commitPlacement(x, y),
        onHover: (x, y) => this.handleHover(x, y),
        onCancel: () => this.handleCancel(),
        onFocusHome: () => this.focusHome(),
        isPlacing: () => this.placing !== null,
      },
      uiRoot,
    );

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lastTime = performance.now();
    });
    // Block browser gestures that would otherwise scroll or zoom the page.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

    this.resize();
    this.screens.showTitle();
    this.hud.setObjectives([]);
    requestAnimationFrame(this.frame);
  }

  /** ---------------------------------------------------------------------
   * Match lifecycle
   * ------------------------------------------------------------------- */
  startMatch(faction: FactionId): void {
    audio.unlock();
    this.playerFaction = faction;
    // `?seed=` and `?enemy=` make a matchup reproducible (handy for sharing a
    // map or reporting a bug).
    const params = new URLSearchParams(location.search);
    const others = (['egypt', 'greece', 'rome'] as FactionId[]).filter((f) => f !== faction);
    const forced = params.get('enemy') as FactionId | null;
    this.enemyFaction =
      forced && others.includes(forced) ? forced : others[Math.floor(Math.random() * others.length)];
    const seedParam = Number(params.get('seed'));
    const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 1e9);

    this.game = new Game(faction, this.enemyFaction, seed);
    this.ai = new SkirmishAI(this.game, 1, 1);
    this.playerAi = null;
    this.scene.loadGame(this.game);
    this.minimap.setGame(this.game);
    this.minimap.resize();

    this.selection = [];
    this.placing = null;
    this.buildMenuOpen = false;
    this.rallyBuildingId = 0;
    this.accumulator = 0;
    this.coachStep = 0;
    this.coachDismissed = false;
    this.coachTimer = 0;
    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();

    this.hud.invalidate();
    this.hud.setCoach(null);
    this.hud.setMuted(audio.isMuted);
    this.scene.hideGhost();
    this.controls.reset();

    // Put the starting villagers to work so the opening minute has momentum.
    const villagers = this.game.unitsOfPlayer(0);
    for (const v of villagers) {
      const node = this.game.findNearestNode(v, 'food') ?? this.game.findNearestNode(v, null);
      if (node) this.game.commandGather([v], node.id);
    }
    this.hud.toast(`${FACTIONS[faction].name} vs ${FACTIONS[this.enemyFaction].name}`, 'info', 2600);

    // Debug handle: lets the browser console (and automated tests) inspect and
    // drive a live match.
    (window as unknown as { ancientAge: unknown }).ancientAge = {
      game: this.game,
      ai: this.ai,
      controller: this,
      scene: this.scene,
    };
  }

  /** Runs the simulation forward without rendering. Used by tests. */
  fastForward(seconds: number): void {
    if (!this.game) return;
    const steps = Math.floor(seconds / TICK_DT);
    for (let i = 0; i < steps && !this.game.over; i++) {
      this.game.update();
      this.ai?.update(TICK_DT);
      this.playerAi?.update(TICK_DT);
      this.consumeEvents(this.game.events);
      this.game.events.length = 0;
    }
  }

  /**
   * Hands the player's side to the skirmish AI. Used to balance-test a full
   * match end to end without a human at the controls.
   */
  autoPlay(on = true): void {
    if (!this.game) return;
    this.playerAi = on ? new SkirmishAI(this.game, 0, 1) : null;
  }

  private endMatch(winner: number): void {
    if (!this.game) return;
    this.running = false;
    const victory = winner === 0;
    audio.play(victory ? 'victory' : 'defeat');
    this.screens.showEnd({
      victory,
      time: this.game.time,
      player: this.game.player(0),
      reason: victory
        ? `The ${FACTIONS[this.enemyFaction].adjective} town centre lies in ruins.`
        : `Your town centre has fallen to ${FACTIONS[this.enemyFaction].name}.`,
    });
  }

  private openMenu(): void {
    if (!this.game) return;
    this.paused = true;
    this.screens.showPause({
      sound: !audio.isMuted,
      shadows: this.scene.renderer.shadowMap.enabled,
      player: this.game.player(0),
    });
  }

  /** ---------------------------------------------------------------------
   * Main loop
   * ------------------------------------------------------------------- */
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const rawDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fpsValue = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.checkPerformance(this.fpsValue);
    }

    if (!this.game) return;

    const simActive = this.running && !this.paused && !this.screens.anyVisible;
    if (simActive) {
      this.accumulator += rawDt;
      let steps = 0;
      while (this.accumulator >= TICK_DT && steps < 5) {
        this.game.update();
        this.ai?.update(TICK_DT);
        this.playerAi?.update(TICK_DT);
        this.accumulator -= TICK_DT;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
      this.controls.update(rawDt);
      this.scene.emitFootDust();
      this.coachTimer += rawDt;
      this.updateCoach();
    }

    const alpha = clamp(this.accumulator / TICK_DT, 0, 1);
    this.consumeEvents(this.game.events);
    this.game.events.length = 0;

    this.pruneSelection();
    this.scene.setSelection(this.selection.map((e) => e.id));
    this.scene.render(rawDt, simActive ? alpha : 1);

    this.hud.update(this.game, this.selection, this.placing, this.buildMenuOpen);
    this.hud.setIdleCount(this.idleVillagers().length);
    this.hud.setObjectives(this.objectives());
    this.hud.setFps(this.showFps ? this.fpsValue : 0);
    this.minimap.draw(this.scene.cameraTarget, this.scene.zoom * 1.15);
  };

  private checkPerformance(fps: number): void {
    if (this.autoDowngraded || !this.running) return;
    if (fps < 34) {
      this.lowFpsTime += 0.5;
      if (this.lowFpsTime > 3) {
        this.autoDowngraded = true;
        this.scene.setQuality({ shadows: false, maxPixelRatio: 1.25 });
        this.resize();
        this.hud.toast('Lowered graphics for smoother play', 'info');
      }
    } else {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - 0.5);
    }
  }

  /** ---------------------------------------------------------------------
   * Events -> feedback
   * ------------------------------------------------------------------- */
  private consumeEvents(events: GameEvent[]): void {
    if (events.length === 0) return;
    this.scene.handleEvents(events);
    for (const e of events) {
      switch (e.type) {
        case 'build-complete':
          if (e.building.owner === 0) {
            audio.play('complete');
            this.hud.toast(`${e.building.def.name} complete`, 'good', 1800);
          }
          break;
        case 'unit-spawned':
          if (e.unit.owner === 0) audio.play('train');
          break;
        case 'unit-died':
          audio.play('death');
          break;
        case 'building-destroyed':
          audio.play('destroy');
          if (e.building.owner === 0 && e.building.type === 'towncenter') {
            this.hud.toast('Your town centre has fallen!', 'bad', 3000);
          }
          break;
        case 'damage':
          audio.play(e.melee ? 'impact' : 'impact');
          break;
        case 'projectile':
          audio.play('bow');
          break;
        case 'deposit':
          audio.play('deposit');
          break;
        case 'gather-tick':
          audio.play('gather');
          break;
        case 'research-complete':
          if (e.player === 0) {
            audio.play(e.tech === 'bronzeAge' ? 'ageup' : 'research');
            const name =
              e.tech === 'doctrine'
                ? FACTIONS[this.playerFaction].doctrineName
                : e.tech === 'bronzeAge'
                  ? 'Bronze Age reached'
                  : `${e.tech} researched`;
            this.hud.toast(name, 'good', 2600);
          }
          break;
        case 'under-attack':
          audio.play('warning');
          this.hud.toast('Your settlement is under attack!', 'bad', 2600);
          this.hud.flashHurt();
          break;
        case 'game-over':
          this.endMatch(e.winner);
          break;
        default:
          break;
      }
    }
  }

  /** ---------------------------------------------------------------------
   * Selection
   * ------------------------------------------------------------------- */
  private pruneSelection(): void {
    if (!this.game) return;
    const g = this.game;
    this.selection = this.selection.filter((e) => g.isAlive(e) && g.entity(e.id) === e);
  }

  private setSelection(entities: Entity[], silent = false): void {
    this.selection = entities;
    if (!silent && entities.length) audio.play('select');
  }

  private selectedOwnUnits(): Unit[] {
    return this.selection.filter((e): e is Unit => e.kind === 'unit' && e.owner === 0);
  }

  private idleVillagers(): Unit[] {
    if (!this.game) return [];
    return this.game.units.filter(
      (u) => u.owner === 0 && u.state === 'idle' && u.type === 'villager',
    );
  }

  private selectArmy(): void {
    if (!this.game) return;
    const army = this.game.units.filter(
      (u) => u.owner === 0 && u.state !== 'dead' && u.def.attack > 0 && u.type !== 'villager',
    );
    if (army.length === 0) {
      this.hud.toast('No soldiers yet — build a Barracks', 'info');
      audio.play('deny');
      return;
    }
    this.setSelection(army);
    const cx = army.reduce((s, u) => s + u.x, 0) / army.length;
    const cz = army.reduce((s, u) => s + u.z, 0) / army.length;
    this.scene.focusOn(cx, cz);
  }

  private selectIdleVillager(): void {
    const idle = this.idleVillagers();
    if (idle.length === 0) {
      this.hud.toast('No idle villagers', 'info', 1500);
      audio.play('deny');
      return;
    }
    this.idleCycle = (this.idleCycle + 1) % idle.length;
    const u = idle[this.idleCycle];
    this.setSelection([u]);
    this.scene.focusOn(u.x, u.z);
  }

  private focusHome(): void {
    if (!this.game) return;
    const tc = this.game.buildingsOfPlayer(0).find((b) => b.type === 'towncenter');
    if (tc) this.scene.focusOn(tc.x, tc.z);
  }

  private minimapJump(px: number, py: number): void {
    const rect = this.hud.minimapCanvas.getBoundingClientRect();
    const size = rect.width;
    const world = this.minimap.mapToWorld((px / size) * size, (py / size) * size);
    this.scene.focusOn(world.x, world.z);
  }

  /** ---------------------------------------------------------------------
   * Pointer intents
   * ------------------------------------------------------------------- */
  private handleTap(cx: number, cy: number): void {
    if (!this.game || !this.running) return;
    const game = this.game;

    if (this.rallyBuildingId) {
      const b = game.entity(this.rallyBuildingId);
      const point = this.scene.screenToGround(cx, cy);
      if (b && b.kind === 'building') {
        b.rallyX = point.x;
        b.rallyZ = point.z;
        this.scene.addOrderPulse(point.x, point.z, 0xe9c46a);
        this.hud.toast('Rally point set', 'good', 1400);
        audio.play('command');
      }
      this.rallyBuildingId = 0;
      return;
    }

    if (this.buildMenuOpen) this.setBuildMenu(false);

    const hit = this.scene.pickAt(cx, cy);
    const own = this.selectedOwnUnits();

    // Enemy target -> attack.
    if (hit.entity && hit.entity.owner !== 0) {
      const attackers = own.filter((u) => u.def.attack > 0);
      if (attackers.length > 0) {
        game.commandAttack(attackers, hit.entity.id);
        this.scene.addOrderPulse(hit.entity.x, hit.entity.z, 0xef6a55);
        audio.play('command');
        return;
      }
      this.setSelection([hit.entity]);
      return;
    }

    // Own entity -> select.
    if (hit.entity && hit.entity.owner === 0) {
      this.setSelection([hit.entity]);
      if (hit.entity.kind === 'building' && !hit.entity.complete) {
        const builders = own.filter((u) => u.def.canBuild);
        if (builders.length) {
          game.commandBuild(builders, hit.entity.id);
          this.setSelection(builders, true);
          audio.play('command');
        }
      }
      return;
    }

    // Resource node -> gather.
    if (hit.node) {
      const gatherers = own.filter((u) => u.def.canGather);
      if (gatherers.length > 0 && game.commandGather(gatherers, hit.node.id)) {
        this.scene.addOrderPulse(hit.node.x, hit.node.z, 0xa8dc7a);
        audio.play('command');
        return;
      }
    }

    // Ground -> move, or clear the selection.
    if (own.length > 0) {
      const p = hit.point;
      game.commandMove(own, p.x, p.z, true);
      this.scene.addOrderPulse(p.x, p.z);
      audio.play('command');
      return;
    }
    if (this.selection.length) this.setSelection([], true);
  }

  private handleDoubleTap(cx: number, cy: number): void {
    if (!this.game) return;
    const hit = this.scene.pickAt(cx, cy);
    if (hit.entity && hit.entity.kind === 'unit' && hit.entity.owner === 0) {
      const type = hit.entity.type;
      const all = this.game.units.filter((u) => u.owner === 0 && u.state !== 'dead' && u.type === type);
      this.setSelection(all);
      this.hud.toast(`Selected all ${UNITS[type].name}s`, 'info', 1400);
      return;
    }
    this.handleTap(cx, cy);
  }

  private handleBoxSelect(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.game) return;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const rect = canvas.getBoundingClientRect();
    const picked: Unit[] = [];
    const out = { x: 0, y: 0, visible: false };
    for (const u of this.game.units) {
      if (u.owner !== 0 || u.state === 'dead') continue;
      const y = this.game.grid.heightAt(u.x, u.z) + 0.5;
      this.scene.worldToScreen(u.x, y, u.z, out);
      const sx = out.x + rect.left;
      const sy = out.y + rect.top;
      if (out.visible && sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) picked.push(u);
    }
    if (picked.length === 0) {
      this.setSelection([], true);
      return;
    }
    // Prefer combat units when a drag catches a mixed crowd.
    const fighters = picked.filter((u) => u.type !== 'villager');
    this.setSelection(fighters.length > 0 ? fighters : picked);
  }

  private handleHover(cx: number, cy: number): void {
    if (!this.game || !this.running) return;
    const hit = this.scene.pickAt(cx, cy);
    this.scene.setHighlight(hit.entity ? hit.entity.id : -1);
  }

  private handleCancel(): void {
    if (this.placing) {
      this.cancelPlacement();
      return;
    }
    if (this.buildMenuOpen) {
      this.setBuildMenu(false);
      return;
    }
    if (this.rallyBuildingId) {
      this.rallyBuildingId = 0;
      return;
    }
    if (this.selection.length) {
      this.setSelection([], true);
      return;
    }
    if (this.running) this.openMenu();
  }

  /** ---------------------------------------------------------------------
   * Building placement
   * ------------------------------------------------------------------- */
  private toggleBuildMenu(): void {
    if (this.placing) {
      this.cancelPlacement();
      return;
    }
    this.setBuildMenu(!this.buildMenuOpen);
  }

  private setBuildMenu(open: boolean): void {
    this.buildMenuOpen = open;
    audio.play('ui');
  }

  private beginPlacement(type: BuildingTypeId): void {
    if (!this.game) return;
    const p = this.game.player(0);
    const def = BUILDINGS[type];
    if ((def.age ?? 1) > p.age) {
      this.hud.toast('Requires the Bronze Age', 'bad');
      audio.play('deny');
      return;
    }
    if (!canAfford(p.res, buildingCost(type, p.faction))) {
      this.hud.toast(`Not enough resources for a ${def.name}`, 'bad');
      audio.play('deny');
      return;
    }
    this.placing = type;
    this.setBuildMenu(false);
    // Start the ghost in the middle of the view so it is immediately visible.
    const t = this.scene.cameraTarget;
    this.placeGhostAtWorld(t.x, t.z);
    this.hud.toast(`Tap valid ground to place the ${def.name}`, 'info', 2200);
  }

  private cancelPlacement(): void {
    this.placing = null;
    this.scene.hideGhost();
    audio.play('ui');
  }

  private updateGhost(cx: number, cy: number): void {
    const point = this.scene.screenToGround(cx, cy);
    this.placeGhostAtWorld(point.x, point.z);
  }

  private placeGhostAtWorld(x: number, z: number): void {
    if (!this.game || !this.placing) return;
    const game = this.game;
    const type = this.placing;
    const size = BUILDINGS[type].size;
    const half = ((size - 1) * TILE) / 2;
    const affordable = canAfford(game.player(0).res, buildingCost(type, game.player(0).faction));

    // Snap to the nearest legal footprint rather than flooring: a fingertip is
    // wider than a tile, so the ghost should forgive a near miss.
    const snap = (v: number): number => Math.round((v + WORLD_HALF) / TILE - 0.5 - (size - 1) / 2);
    let gx = snap(x);
    let gz = snap(z);
    let valid = game.canPlaceAt(0, type, gx, gz);

    if (!valid) {
      let bestD = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const tx = gx + dx;
          const tz = gz + dz;
          if (!game.canPlaceAt(0, type, tx, tz)) continue;
          const cxw = game.grid.worldX(tx) + half;
          const czw = game.grid.worldZ(tz) + half;
          const d = (cxw - x) ** 2 + (czw - z) ** 2;
          if (d < bestD) {
            bestD = d;
            gx = tx;
            gz = tz;
            valid = true;
          }
        }
      }
    }

    const wx = game.grid.worldX(gx) + half;
    const wz = game.grid.worldZ(gz) + half;
    this.ghostTile = { gx, gz, valid: valid && affordable, x: wx, z: wz };
    this.scene.showGhost(type, game.player(0).faction, size, wx, wz, valid && affordable);
  }

  private commitPlacement(cx: number, cy: number): void {
    if (!this.game || !this.placing) return;
    this.updateGhost(cx, cy);
    const game = this.game;
    const type = this.placing;
    if (!this.ghostTile.valid) {
      this.hud.toast('Cannot build there', 'bad', 1600);
      audio.play('deny');
      return;
    }
    const res = game.placeBuilding(0, type, this.ghostTile.gx, this.ghostTile.gz);
    if (!res.ok || !res.building) {
      const msg =
        res.reason === 'cost'
          ? 'Not enough resources'
          : res.reason === 'water'
            ? 'Docks must touch the shoreline'
            : res.reason === 'age'
              ? 'Requires the Bronze Age'
              : 'Cannot build there';
      this.hud.toast(msg, 'bad', 1600);
      audio.play('deny');
      return;
    }
    audio.play('place');
    this.scene.addOrderPulse(res.building.x, res.building.z, 0xe9c46a);

    // Send builders: selected villagers first, then the nearest free ones.
    let builders = this.selectedOwnUnits().filter((u) => u.def.canBuild);
    if (builders.length === 0) {
      const pool = game.units
        .filter((u) => u.owner === 0 && u.state !== 'dead' && u.def.canBuild)
        .sort(
          (a, b) =>
            (a.state === 'idle' ? -1000 : 0) -
            (b.state === 'idle' ? -1000 : 0) +
            (Math.hypot(a.x - res.building!.x, a.z - res.building!.z) -
              Math.hypot(b.x - res.building!.x, b.z - res.building!.z)),
        );
      builders = pool.slice(0, Math.min(2, pool.length));
    }
    if (builders.length) game.commandBuild(builders, res.building.id);
    else this.hud.toast('No villagers available to build', 'info', 1800);

    // Walls chain naturally; everything else exits placement mode.
    if (type !== 'wall') {
      this.placing = null;
      this.scene.hideGhost();
    } else if (!canAfford(game.player(0).res, buildingCost('wall', game.player(0).faction))) {
      this.placing = null;
      this.scene.hideGhost();
    }
  }

  /** ---------------------------------------------------------------------
   * Building actions
   * ------------------------------------------------------------------- */
  private train(buildingId: number, type: UnitTypeId): void {
    if (!this.game) return;
    const b = this.game.entity(buildingId);
    if (!b || b.kind !== 'building') return;
    const check = this.game.canTrain(b, type);
    if (!check.ok) {
      this.hud.toast(check.reason ?? 'Cannot train', 'bad', 1700);
      audio.play('deny');
      return;
    }
    if (this.game.trainUnit(b, type)) {
      audio.play('ui');
      const p = this.game.player(0);
      if (p.pop + UNITS[type].pop > p.popCap) {
        this.hud.toast('Population limit — build a House', 'info', 2200);
      }
    }
  }

  private cancelTrain(buildingId: number, index: number): void {
    if (!this.game) return;
    const b = this.game.entity(buildingId);
    if (!b || b.kind !== 'building') return;
    this.game.cancelTrain(b, index);
    audio.play('ui');
  }

  private research(buildingId: number, tech: TechId): void {
    if (!this.game) return;
    const b = this.game.entity(buildingId);
    if (!b || b.kind !== 'building') return;
    const check = this.game.canResearch(b, tech);
    if (!check.ok) {
      this.hud.toast(check.reason ?? 'Cannot research', 'bad', 1700);
      audio.play('deny');
      return;
    }
    this.game.startResearch(b, tech);
    audio.play('ui');
    this.hud.toast('Research started', 'info', 1500);
  }

  private cancelResearch(buildingId: number): void {
    if (!this.game) return;
    const b = this.game.entity(buildingId);
    if (!b || b.kind !== 'building') return;
    this.game.cancelResearch(b);
    audio.play('ui');
  }

  private beginRally(buildingId: number): void {
    this.rallyBuildingId = buildingId;
    this.hud.toast('Tap the map to set a rally point', 'info', 2200);
    audio.play('ui');
  }

  private stopSelection(): void {
    if (!this.game) return;
    const own = this.selectedOwnUnits();
    if (own.length) {
      this.game.commandStop(own);
      audio.play('command');
    }
  }

  private gatherWithSelection(): void {
    if (!this.game) return;
    const game = this.game;
    const villagers = this.selectedOwnUnits().filter((u) => u.def.canGather);
    if (villagers.length === 0) return;
    let sent = 0;
    for (const v of villagers) {
      const node = game.findNearestNode(v, null);
      if (node && game.commandGather([v], node.id)) sent++;
    }
    if (sent > 0) {
      audio.play('command');
      this.hud.toast(`${sent} villager${sent > 1 ? 's' : ''} back to work`, 'good', 1500);
    } else {
      this.hud.toast('No resources in range — build farms', 'info', 2000);
      audio.play('deny');
    }
  }

  /** ---------------------------------------------------------------------
   * Objectives & onboarding
   * ------------------------------------------------------------------- */
  private objectives(): Objective[] {
    const game = this.game;
    if (!game || !this.running) return [];
    const p = game.player(0);
    const villagers = game.countUnits(0, (u) => u.type === 'villager');
    const houses = game.countBuildings(0, 'house');
    const barracks = game.countBuildings(0, 'barracks');
    const army = game.countUnits(0, (u) => u.def.attack > 0 && u.type !== 'villager');

    const list: Objective[] = [
      { text: 'Train villagers', detail: `${villagers}/8`, done: villagers >= 8 },
      { text: 'Build a House', detail: `${Math.min(houses, 2)}/2`, done: houses >= 2 },
      { text: 'Build a Barracks', detail: `${barracks}/1`, done: barracks >= 1 },
      { text: 'Train soldiers', detail: `${army}/6`, done: army >= 6 },
      { text: 'Reach the Bronze Age', detail: p.age >= 2 ? '✓' : '0/1', done: p.age >= 2 },
      { text: 'Raze the enemy town centre', done: false },
    ];
    // Show the next few steps only, so the panel stays compact.
    const firstOpen = list.findIndex((o) => !o.done);
    return list.slice(Math.max(0, Math.min(firstOpen, list.length - 3)), Math.max(3, firstOpen + 3));
  }

  private updateCoach(): void {
    const game = this.game;
    if (!game || this.coachDismissed) return;
    const p = game.player(0);
    const steps: { done: () => boolean; text: string }[] = [
      {
        text: '<b>Drag</b> to look around and <b>pinch</b> to zoom. Your villagers are already gathering food.',
        done: () => this.coachTimer > 11,
      },
      {
        text: 'Tap your <b>Town Center</b>, then tap <b>Villager</b> to train more workers. More villagers means a faster economy.',
        done: () => game.countUnits(0, (u) => u.type === 'villager') >= 5,
      },
      {
        text: 'Tap <b>Build</b> and place a <b>House</b> on clear ground to raise your population limit.',
        done: () => game.countBuildings(0, 'house') >= 1,
      },
      {
        text: 'Tap a villager, then tap <b>trees</b> or a <b>gold deposit</b> to send them to a new resource.',
        done: () => this.coachTimer > 70,
      },
      {
        text: 'Build a <b>Barracks</b> — the enemy will attack before long.',
        done: () => game.countBuildings(0, 'barracks') >= 1,
      },
      {
        text: 'Research <b>Bronze Age</b> at the Town Center to unlock towers, your monument and your elite unit.',
        done: () => p.age >= 2,
      },
    ];
    while (this.coachStep < steps.length && steps[this.coachStep].done()) {
      this.coachStep++;
      this.coachTimer = 0;
    }
    if (this.coachStep >= steps.length) {
      this.hud.setCoach(null);
      this.coachDismissed = true;
      return;
    }
    this.hud.setCoach(steps[this.coachStep].text);
  }

  private dismissCoach(): void {
    this.coachStep++;
    this.coachTimer = 0;
    if (this.coachStep >= 6) {
      this.coachDismissed = true;
      this.hud.setCoach(null);
    }
    audio.play('ui');
  }

  /** ---------------------------------------------------------------------
   * Layout
   * ------------------------------------------------------------------- */
  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.scene.resize(w, h);
    this.minimap.resize();
  }
}

// Guard against WebGL-less environments with a readable message.
try {
  new GameController();
} catch (err) {
  console.error(err);
  uiRoot.innerHTML = `<div class="screen"><div class="screen-inner">
      <div class="title-block"><h1>ANCIENT AGE</h1>
      <p>This game needs WebGL. Try a different browser or device.</p></div>
    </div></div>`;
}
