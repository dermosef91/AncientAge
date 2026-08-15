import './style.css';
import { audio } from './audio/audio';
import { clamp } from './core/math';
import { Controls, type HotkeyMods, type PointerIntent } from './input/controls';
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

  /** Control groups, keyed 1-9 and 0, holding entity ids like AoE. */
  private groups = new Map<number, number[]>();
  private lastGroupKey = -1;
  private lastGroupTime = 0;
  private helpOpen = false;

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
      onMinimapCommand: (px, py) => this.minimapCommand(px, py),
      onCoachDismiss: () => this.dismissCoach(),
      onHelp: () => this.setHelp(!this.helpOpen),
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
        onTap: (i) => this.handleTap(i),
        onDoubleTap: (i) => this.handleDoubleTap(i),
        onCommand: (i) => this.handleCommand(i),
        onBoxSelect: (x0, y0, x1, y1, add) => this.handleBoxSelect(x0, y0, x1, y1, add),
        onGhostMove: (x, y) => this.updateGhost(x, y),
        onGhostPlace: (x, y) => this.commitPlacement(x, y),
        onGhostCancel: () => this.cancelPlacement(),
        onHover: (x, y) => this.handleHover(x, y),
        onCancel: () => this.handleCancel(),
        onHotkey: (key, mods) => this.handleHotkey(key, mods),
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
    this.groups.clear();
    this.lastGroupKey = -1;
    this.helpOpen = false;
    this.hud.setHelpVisible(false);
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
    this.hud.setGroups(this.groupSizes());
    this.hud.setDesktop(this.controls.hasMouse);
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

  /** Shift+click semantics: add what is missing, drop what is already held. */
  private toggleSelection(entity: Entity): void {
    const i = this.selection.findIndex((e) => e.id === entity.id);
    if (i >= 0) {
      const next = this.selection.slice();
      next.splice(i, 1);
      this.setSelection(next, true);
      return;
    }
    this.setSelection([...this.selection, entity]);
  }

  private addSelection(entities: Entity[]): void {
    const seen = new Set(this.selection.map((e) => e.id));
    const added = entities.filter((e) => !seen.has(e.id));
    if (added.length === 0) return;
    this.setSelection([...this.selection, ...added]);
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
    this.cycleIdleVillager(1);
  }

  /** `.` and `,` walk the idle list forwards and backwards, as AoE does. */
  private cycleIdleVillager(dir: number): void {
    const idle = this.idleVillagers();
    if (idle.length === 0) {
      this.hud.toast('No idle villagers', 'info', 1500);
      audio.play('deny');
      return;
    }
    this.idleCycle = (this.idleCycle + dir + idle.length * 2) % idle.length;
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

  /** Right-click on the minimap marches the selection there. */
  private minimapCommand(px: number, py: number): void {
    if (!this.game || !this.running) return;
    const own = this.selectedOwnUnits();
    if (own.length === 0) {
      this.minimapJump(px, py);
      return;
    }
    const rect = this.hud.minimapCanvas.getBoundingClientRect();
    const size = rect.width;
    const world = this.minimap.mapToWorld((px / size) * size, (py / size) * size);
    this.game.commandMove(own, world.x, world.z, true);
    this.scene.addOrderPulse(world.x, world.z);
    audio.play('command');
  }

  /** ---------------------------------------------------------------------
   * Pointer intents
   * ------------------------------------------------------------------- */
  /**
   * Left-click / tap. A mouse only ever selects here — orders live on the right
   * button, as in Age of Empires. Touch keeps the one-finger context action,
   * because a phone has no second button to put it on.
   */
  private handleTap(intent: PointerIntent): void {
    if (!this.game || !this.running) return;
    if (this.consumeRally(intent)) return;
    if (this.buildMenuOpen && !intent.mouse) this.setBuildMenu(false);

    if (intent.mouse) {
      this.selectAt(intent);
      return;
    }
    this.contextAction(intent, true);
  }

  /** Right-click: the context order, never a selection change. */
  private handleCommand(intent: PointerIntent): void {
    if (!this.game || !this.running) return;
    if (this.consumeRally(intent)) return;
    this.contextAction(intent, false);
  }

  /** Consumes the click that places a pending rally point. */
  private consumeRally(intent: PointerIntent): boolean {
    if (!this.rallyBuildingId || !this.game) return false;
    const b = this.game.entity(this.rallyBuildingId);
    const point = this.scene.screenToGround(intent.x, intent.y);
    if (b && b.kind === 'building') {
      b.rallyX = point.x;
      b.rallyZ = point.z;
      this.scene.addOrderPulse(point.x, point.z, 0xe9c46a);
      this.hud.toast('Rally point set', 'good', 1400);
      audio.play('command');
    }
    this.rallyBuildingId = 0;
    return true;
  }

  private selectAt(intent: PointerIntent): void {
    const hit = this.scene.pickAt(intent.x, intent.y);
    if (hit.entity) {
      if (intent.additive) this.toggleSelection(hit.entity);
      else this.setSelection([hit.entity]);
      return;
    }
    if (!intent.additive && this.selection.length) this.setSelection([], true);
  }

  /**
   * Move / attack / gather / assist, picked from whatever sits under the cursor.
   * `allowSelect` lets a touch tap fall back to selecting, which a right-click
   * must never do.
   */
  private contextAction(intent: PointerIntent, allowSelect: boolean): void {
    if (!this.game) return;
    const game = this.game;
    const hit = this.scene.pickAt(intent.x, intent.y);
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
      if (allowSelect) this.setSelection([hit.entity]);
      return;
    }

    // Own construction site -> send the selected villagers to help.
    if (hit.entity && hit.entity.owner === 0) {
      if (hit.entity.kind === 'building' && !hit.entity.complete) {
        const builders = own.filter((u) => u.def.canBuild);
        if (builders.length) {
          game.commandBuild(builders, hit.entity.id);
          if (allowSelect) this.setSelection(builders, true);
          audio.play('command');
          return;
        }
      }
      if (allowSelect) {
        this.setSelection([hit.entity]);
        return;
      }
      // Right-clicking your own building walks the selection over to it.
      if (own.length > 0) {
        game.commandMove(own, hit.entity.x, hit.entity.z, false);
        this.scene.addOrderPulse(hit.entity.x, hit.entity.z);
        audio.play('command');
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
    if (allowSelect && this.selection.length) this.setSelection([], true);
  }

  /** Double-click a unit to take every one of its kind currently on screen. */
  private handleDoubleTap(intent: PointerIntent): void {
    if (!this.game) return;
    const hit = this.scene.pickAt(intent.x, intent.y);
    if (hit.entity && hit.entity.kind === 'unit' && hit.entity.owner === 0) {
      const type = hit.entity.type;
      const onScreen = this.game.units.filter(
        (u) => u.owner === 0 && u.state !== 'dead' && u.type === type && this.isOnScreen(u),
      );
      const picked = onScreen.length > 0 ? onScreen : [hit.entity];
      if (intent.additive) this.addSelection(picked);
      else this.setSelection(picked);
      this.hud.toast(`Selected ${picked.length} ${UNITS[type].name}${picked.length > 1 ? 's' : ''}`, 'info', 1400);
      return;
    }
    this.handleTap(intent);
  }

  private isOnScreen(u: Unit): boolean {
    if (!this.game) return false;
    const y = this.game.grid.heightAt(u.x, u.z) + 0.5;
    const out = this.scene.worldToScreen(u.x, y, u.z);
    return out.visible && out.x >= 0 && out.y >= 0 && out.x <= window.innerWidth && out.y <= window.innerHeight;
  }

  private handleBoxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
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
      if (!additive) this.setSelection([], true);
      return;
    }
    // Prefer combat units when a drag catches a mixed crowd.
    const fighters = picked.filter((u) => u.type !== 'villager');
    const chosen = fighters.length > 0 ? fighters : picked;
    if (additive) this.addSelection(chosen);
    else this.setSelection(chosen);
  }

  private handleHover(cx: number, cy: number): void {
    if (!this.game || !this.running) return;
    const hit = this.scene.pickAt(cx, cy);
    this.scene.setHighlight(hit.entity ? hit.entity.id : -1);

    // Tell the player what a right-click would do here.
    let cursor = 'default';
    if (this.selectedOwnUnits().length > 0) {
      if (hit.entity && hit.entity.owner !== 0) cursor = 'crosshair';
      else if (hit.node || (hit.entity && hit.entity.owner === 0)) cursor = 'pointer';
    } else if (hit.entity) {
      cursor = 'pointer';
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  /** ---------------------------------------------------------------------
   * Keyboard
   * ------------------------------------------------------------------- */
  private handleHotkey(key: string, mods: HotkeyMods): boolean {
    if (key === 'f1' || key === '?' || key === '/') {
      this.setHelp(!this.helpOpen);
      return true;
    }
    if (this.helpOpen) {
      this.setHelp(false);
      return true;
    }
    if (!this.game || !this.running || this.paused || this.screens.anyVisible) return false;

    const digit = /^(?:Digit|Numpad)(\d)$/.exec(mods.code);
    if (digit) {
      const n = Number(digit[1]);
      // Ctrl+digit is the AoE binding, but browsers keep it for tab switching
      // and will not let a page cancel it — so Shift+digit assigns as well.
      if (mods.ctrl || mods.shift) this.assignGroup(n);
      else this.recallGroup(n);
      return true;
    }

    switch (key) {
      case ' ':
      case 'home':
        this.focusHome();
        return true;
      case 'h':
        this.selectTownCentre();
        return true;
      case '.':
      case '>':
        this.cycleIdleVillager(1);
        return true;
      case ',':
      case '<':
        this.cycleIdleVillager(-1);
        return true;
      case 'b':
        this.toggleBuildMenu();
        return true;
      case 'delete':
        this.deleteSelection();
        return true;
      case '+':
      case '=':
        this.scene.zoomBy(Math.exp(-0.34));
        return true;
      case '-':
      case '_':
        this.scene.zoomBy(Math.exp(0.34));
        return true;
      default:
        break;
    }

    // Everything else is a grid hotkey aimed at whichever panel is showing.
    return this.hud.triggerGrid(key, this.buildMenuOpen);
  }

  private assignGroup(n: number): void {
    const ids = this.selection.filter((e) => e.owner === 0).map((e) => e.id);
    if (ids.length === 0) {
      this.groups.delete(n);
      this.hud.toast(`Group ${n} cleared`, 'info', 1200);
      return;
    }
    this.groups.set(n, ids);
    this.hud.setGroups(this.groupSizes());
    this.hud.toast(`Group ${n}: ${ids.length} selected`, 'good', 1300);
    audio.play('ui');
  }

  private recallGroup(n: number): void {
    if (!this.game) return;
    const game = this.game;
    const ids = this.groups.get(n);
    const members = (ids ?? [])
      .map((id) => game.entity(id))
      .filter((e): e is Entity => !!e && game.isAlive(e));
    if (members.length === 0) {
      if (ids) {
        this.groups.delete(n);
        this.hud.setGroups(this.groupSizes());
      }
      audio.play('deny');
      return;
    }
    this.setSelection(members);

    // A second press inside the window jumps the camera to the group.
    const now = performance.now();
    if (this.lastGroupKey === n && now - this.lastGroupTime < 420) {
      const cx = members.reduce((s, e) => s + e.x, 0) / members.length;
      const cz = members.reduce((s, e) => s + e.z, 0) / members.length;
      this.scene.focusOn(cx, cz);
    }
    this.lastGroupKey = n;
    this.lastGroupTime = now;
  }

  private groupSizes(): Map<number, number> {
    const out = new Map<number, number>();
    const game = this.game;
    if (!game) return out;
    for (const [n, ids] of this.groups) {
      const live = ids.filter((id) => game.isAlive(game.entity(id))).length;
      if (live > 0) out.set(n, live);
    }
    return out;
  }

  private selectTownCentre(): void {
    if (!this.game) return;
    const tc = this.game.buildingsOfPlayer(0).find((b) => b.type === 'towncenter');
    if (!tc) {
      audio.play('deny');
      return;
    }
    this.setSelection([tc]);
    this.scene.focusOn(tc.x, tc.z);
  }

  /** Deletes the selected units, as Delete does in Age of Empires. */
  private deleteSelection(): void {
    if (!this.game) return;
    const game = this.game;
    const units = this.selection.filter((e): e is Unit => e.kind === 'unit' && e.owner === 0);
    const buildings = this.selection.filter(
      (e) => e.kind === 'building' && e.owner === 0 && e.type !== 'towncenter',
    );
    if (units.length === 0 && buildings.length === 0) {
      if (this.selection.some((e) => e.kind === 'building' && e.type === 'towncenter')) {
        this.hud.toast('The town centre cannot be deleted', 'bad', 1800);
      }
      audio.play('deny');
      return;
    }
    for (const u of units) game.killUnit(u);
    for (const b of buildings) {
      if (b.kind === 'building') game.destroyBuilding(b);
    }
    this.setSelection([], true);
    this.hud.toast(`Deleted ${units.length + buildings.length}`, 'info', 1400);
  }

  private setHelp(open: boolean): void {
    this.helpOpen = open;
    this.hud.setHelpVisible(open);
    audio.play('ui');
  }

  private handleCancel(): void {
    if (this.helpOpen) {
      this.setHelp(false);
      return;
    }
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
    const pc = this.controls.hasMouse;
    const steps: { done: () => boolean; text: string }[] = [
      {
        text: pc
          ? 'Scroll with the <b>screen edge</b> or the <b>arrow keys</b>, zoom with the <b>wheel</b>. Press <b>F1</b> for the full controls. Your villagers are already gathering food.'
          : '<b>Drag</b> to look around and <b>pinch</b> to zoom. Your villagers are already gathering food.',
        done: () => this.coachTimer > 11,
      },
      {
        text: pc
          ? 'Press <b>H</b> for your <b>Town Center</b>, then <b>Q</b> to train a villager. More villagers means a faster economy.'
          : 'Tap your <b>Town Center</b>, then tap <b>Villager</b> to train more workers. More villagers means a faster economy.',
        done: () => game.countUnits(0, (u) => u.type === 'villager') >= 5,
      },
      {
        text: pc
          ? 'Press <b>B</b> for the build menu, <b>Q</b> for a <b>House</b>, then click clear ground to raise your population limit.'
          : 'Tap <b>Build</b> and place a <b>House</b> on clear ground to raise your population limit.',
        done: () => game.countBuildings(0, 'house') >= 1,
      },
      {
        text: pc
          ? 'Left-click a villager, then <b>right-click</b> <b>trees</b> or a <b>gold deposit</b> to send them to a new resource.'
          : 'Tap a villager, then tap <b>trees</b> or a <b>gold deposit</b> to send them to a new resource.',
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
