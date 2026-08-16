import { dist, dist2 } from '../core/math';
import { Rng } from '../core/rng';
import {
  BUILDINGS,
  ELITE_BUILDING,
  FACTIONS,
  LEVEL_TECHS,
  TECHS,
  buildingCost,
  canAfford,
  levelPopCap,
} from './data';
import type { Game } from './game';
import type { Building, BuildingTypeId, ResourceKind, TechId, Unit, UnitTypeId } from './types';

type Phase = 'boom' | 'army' | 'push';

/**
 * Aggression dial. The opponent is meant to give a new player room to build a
 * settlement before it comes knocking, so the first push lands late, the gaps
 * between waves stay long, and each wave wants a real army behind it.
 */
const FIRST_ATTACK_TIME = 340;
const ATTACK_GAP_START = 150;
const ATTACK_GAP_MIN = 85;
const WAVE_SIZES = [6, 8, 10, 12, 14, 16, 18];
/** Seconds between AI decisions; a longer gap makes it visibly less twitchy. */
const THINK_INTERVAL = 0.95;

interface WorkerPlan {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

/**
 * A single-opponent skirmish AI. It runs a real economy (villager production,
 * drop-off buildings, farms when food runs out), techs up, keeps a standing
 * army, defends its base, and launches escalating attacks that scale in size
 * and composition until it can realistically win.
 */
export class SkirmishAI {
  private rng: Rng;
  private think = 0;
  private assignTimer = 0;
  private phase: Phase = 'boom';
  private armyMode: 'defend' | 'rally' | 'attack' = 'defend';
  private nextAttackTime: number;
  private waveNumber = 0;
  private attackTargetId = 0;
  private retargetTimer = 0;
  private rallyPoint = { x: 0, z: 0 };
  private lastDefendCheck = 0;
  private homeX = 0;
  private homeZ = 0;
  private enemyBaseX = 0;
  private enemyBaseZ = 0;

  constructor(
    private game: Game,
    private pi: number,
    private difficulty = 1,
  ) {
    this.rng = new Rng(game.seed ^ (0x51ed270b + pi));
    const tc = game.buildingsOfPlayer(pi).find((b) => b.def.main);
    this.homeX = tc?.x ?? 0;
    this.homeZ = tc?.z ?? 0;
    const enemyTc = game.buildingsOfPlayer(1 - pi).find((b) => b.def.main);
    this.enemyBaseX = enemyTc?.x ?? 0;
    this.enemyBaseZ = enemyTc?.z ?? 0;
    // Rally between home and the enemy, a short way out from the base.
    const d = Math.max(1, dist(this.homeX, this.homeZ, this.enemyBaseX, this.enemyBaseZ));
    this.rallyPoint = {
      x: this.homeX + ((this.enemyBaseX - this.homeX) / d) * 12,
      z: this.homeZ + ((this.enemyBaseZ - this.homeZ) / d) * 12,
    };
    this.nextAttackTime = FIRST_ATTACK_TIME / this.difficulty;
  }

  update(dt: number): void {
    if (this.game.over) return;
    this.think -= dt;
    this.assignTimer -= dt;

    if (this.assignTimer <= 0) {
      this.assignTimer = 2.5;
      this.assignWorkers();
    }
    if (this.think <= 0) {
      this.think = THINK_INTERVAL;
      this.research();
      this.construction();
      this.economy();
      this.military();
    }
    this.commandArmy(dt);
  }

  private get p() {
    return this.game.player(this.pi);
  }

  /** The settlement upgrade the AI should be working towards, if any. */
  private nextLevelTech(): TechId | null {
    const p = this.p;
    if (p.age >= LEVEL_TECHS.length + 1) return null;
    return LEVEL_TECHS[p.age - 1];
  }

  /**
   * Resources held back for the next settlement upgrade. Without this the AI
   * spends every scrap on villagers and spearmen and never levels up.
   */
  private ageReserve(): { food: number; gold: number } {
    const next = this.nextLevelTech();
    if (!next || this.game.time < 120) return { food: 0, gold: 0 };
    const tc = this.townCenter();
    if (!tc || tc.research) return { food: 0, gold: 0 };
    return { food: TECHS[next].cost.food ?? 0, gold: TECHS[next].cost.gold ?? 0 };
  }

  private villagers(): Unit[] {
    return this.game.units.filter(
      (u) => u.owner === this.pi && u.state !== 'dead' && u.type === 'villager',
    );
  }

  private army(): Unit[] {
    return this.game.units.filter(
      (u) =>
        u.owner === this.pi &&
        u.state !== 'dead' &&
        u.def.attack > 0 &&
        u.type !== 'villager' &&
        u.def.role !== 'navalWorker',
    );
  }

  private townCenter(): Building | null {
    return (
      this.game.buildings.find((b) => b.owner === this.pi && b.def.main && !b.dead) ?? null
    );
  }

  /** ---------------------------------------------------------------------
   * Economy
   * ------------------------------------------------------------------- */
  private economy(): void {
    const p = this.p;
    const tc = this.townCenter();
    if (!tc || !tc.complete) return;
    const vills = this.villagers().length;
    // Cap worker count so resources flow into buildings and army instead.
    const targetVills = Math.min(15 + (p.age - 1) * 3, this.phase === 'boom' ? 17 : 27);
    const headroom = p.popCap - p.pop;

    const reserve = this.ageReserve();
    // Early workers always get made; later ones wait for the age-up fund.
    const affordable = vills < 10 || p.res.food - 50 >= reserve.food + 60;
    if (vills < targetVills && tc.queue.length < 2 && headroom > 0 && affordable) {
      this.game.trainUnit(tc, 'villager');
    }
  }

  /**
   * Demand-driven worker split: each resource gets a share proportional to how
   * far its stockpile sits below the target for the current phase. A fixed
   * split leaves the AI banking 600 gold while starving for the food it needs
   * to keep an army in the field.
   */
  private workerPlan(): WorkerPlan {
    const p = this.p;
    const kinds: ResourceKind[] = ['food', 'wood', 'gold', 'stone'];
    const needMonument = p.age >= 5 && !this.game.hasCompleteBuilding(this.pi, 'monument');
    const target: Record<ResourceKind, number> = {
      food: 520,
      wood: 380,
      gold: p.age < 4 ? 280 : 340,
      stone: p.age < 4 ? 140 : needMonument ? 320 : 220,
    };
    const base: Record<ResourceKind, number> = { food: 0.36, wood: 0.28, gold: 0.2, stone: 0.16 };
    const raw: Record<ResourceKind, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
    let total = 0;
    for (const k of kinds) {
      const deficit = Math.max(0, target[k] - p.res[k]) / target[k];
      // Keep a trickle on everything, then bias hard towards the shortfall.
      raw[k] = base[k] * (0.3 + 1.9 * deficit);
      total += raw[k];
    }
    if (total <= 0.0001) return { food: 0.4, wood: 0.3, gold: 0.2, stone: 0.1 };
    return {
      food: raw.food / total,
      wood: raw.wood / total,
      gold: raw.gold / total,
      stone: raw.stone / total,
    };
  }

  private assignWorkers(): void {
    const vills = this.villagers();
    if (vills.length === 0) return;
    const plan = this.workerPlan();
    const kinds: ResourceKind[] = ['food', 'wood', 'gold', 'stone'];
    const want: Record<ResourceKind, number> = {
      food: Math.round(plan.food * vills.length),
      wood: Math.round(plan.wood * vills.length),
      gold: Math.round(plan.gold * vills.length),
      stone: Math.round(plan.stone * vills.length),
    };

    const current: Record<ResourceKind, Unit[]> = { food: [], wood: [], gold: [], stone: [] };
    const free: Unit[] = [];
    for (const u of vills) {
      if (u.state === 'build') continue; // busy raising something
      const node = u.nodeId ? this.game.nodeById.get(u.nodeId) : null;
      if ((u.state === 'gather' || u.state === 'deliver') && node && !node.depleted) {
        current[node.resource].push(u);
      } else {
        free.push(u);
      }
    }

    // Move surplus workers off over-staffed resources.
    for (const k of kinds) {
      while (current[k].length > want[k] + 1) {
        const u = current[k].pop();
        if (u) free.push(u);
      }
    }
    // Fill shortfalls.
    for (const k of kinds) {
      while (current[k].length < want[k] && free.length > 0) {
        const u = free.pop()!;
        const node = this.game.findNearestNodeOfResource(this.pi, u.x, u.z, k);
        if (node) {
          this.game.commandGather([u], node.id);
          current[k].push(u);
        } else if (k === 'food') {
          // No berries left - farms will be built by construction().
          const alt = this.game.findNearestNodeOfResource(this.pi, u.x, u.z, 'wood');
          if (alt) this.game.commandGather([u], alt.id);
        } else {
          const alt = this.game.findNearestNodeOfResource(this.pi, u.x, u.z, 'wood');
          if (alt) this.game.commandGather([u], alt.id);
          break;
        }
      }
    }
    // Anything still idle goes to the nearest node.
    for (const u of free) {
      if (u.state !== 'idle') continue;
      const node = this.game.findNearestNode(u, null);
      if (node) this.game.commandGather([u], node.id);
    }
  }

  /** ---------------------------------------------------------------------
   * Construction
   * ------------------------------------------------------------------- */
  private construction(): void {
    const p = this.p;
    const g = this.game;

    // One site at a time keeps the economy from stalling.
    const inProgress = g.buildings.filter((b) => b.owner === this.pi && !b.complete && !b.dead);
    if (inProgress.length > 0) {
      this.assignBuilders(inProgress[0]);
      if (inProgress.length >= 2) return;
    }

    const count = (t: BuildingTypeId) => g.countBuildings(this.pi, t);
    const popCeiling = levelPopCap(p.age);

    const wants: BuildingTypeId[] = [];

    // Housing first - never get supply blocked. Tents until houses unlock.
    const shelter: BuildingTypeId = p.age >= 3 ? 'house' : 'tent';
    if (p.popCap - p.pop <= 3 && p.popCap < popCeiling) wants.push(shelter);

    // The next settlement upgrade's building prerequisites come next — the
    // ladder itself is the strategy now.
    const next = this.nextLevelTech();
    if (next) {
      for (const need of TECHS[next].prereqBuildings ?? []) {
        if (count(need) < 1) wants.push(need);
      }
    }

    // A storehouse out by the woods early.
    if (p.age >= 2 && count('storehouse') < 1 && g.time > 50) wants.push('storehouse');
    if (p.age >= 3 && count('barracks') < 1 && g.time > 90) wants.push('barracks');
    if (p.age >= 2 && count('storehouse') < 2 && g.time > 170) wants.push('storehouse');
    if (p.age >= 4 && count('range') < 1 && g.time > 200) wants.push('range');
    if (p.age >= 2 && count('storehouse') < 3 && g.time > 340) wants.push('storehouse');
    // Farms once food nodes are thin.
    const foodNodes = g.nodes.filter(
      (n) => !n.depleted && n.resource === 'food' && n.type !== 'fish' &&
        dist2(n.x, n.z, this.homeX, this.homeZ) < 60 * 60,
    ).length;
    if (p.age >= 2 && foodNodes < 10 && count('farm') < 8) wants.push('farm');
    if (p.age >= 4) {
      if (count('tower') < 2 && g.time > 280) wants.push('tower');
      if (count('barracks') < 2 && g.time > 320) wants.push('barracks');
      if (count('range') < 2 && g.time > 380) wants.push('range');
      if (count('tower') < 4 && g.time > 440) wants.push('tower');
    }
    if (p.age >= 5) {
      // Never wonder up before there is an army building to defend it.
      if (count('monument') < 1 && count('barracks') > 0) wants.push('monument');
    }
    if (p.popCap - p.pop <= 6 && p.popCap < popCeiling) wants.push(shelter);

    for (const type of wants) {
      const cost = buildingCost(type, p.faction);
      const def = BUILDINGS[type];
      if ((def.age ?? 1) > p.age) continue;
      if (!canAfford(p.res, cost)) continue;
      const spot = this.findPlacement(type);
      if (!spot) continue;
      const res = g.placeBuilding(this.pi, type, spot.gx, spot.gz);
      if (res.ok && res.building) {
        this.assignBuilders(res.building);
        return;
      }
    }
  }

  private assignBuilders(site: Building): void {
    const wanted = site.type === 'towncenter' || site.type === 'monument' ? 3 : 2;
    const already = this.game.units.filter(
      (u) => u.owner === this.pi && u.state === 'build' && u.siteId === site.id,
    );
    if (already.length >= wanted) return;
    const candidates = this.villagers()
      .filter((u) => u.state !== 'build')
      .sort((a, b) => dist2(a.x, a.z, site.x, site.z) - dist2(b.x, b.z, site.x, site.z));
    const take = candidates.slice(0, wanted - already.length);
    if (take.length) this.game.commandBuild(take, site.id);
  }

  /** Spiral search for a legal, tidy spot near the base. */
  private findPlacement(type: BuildingTypeId): { gx: number; gz: number } | null {
    const g = this.game;
    const def = BUILDINGS[type];
    const size = def.size;
    let anchorX = this.homeX;
    let anchorZ = this.homeZ;

    if (type === 'storehouse') {
      // First drop-off goes to the woodline, then the mines.
      const built = g.countBuildings(this.pi, 'storehouse');
      const target: ResourceKind = built === 0 ? 'wood' : built === 1 ? 'gold' : 'stone';
      const node = g.findNearestNodeOfResource(this.pi, this.homeX, this.homeZ, target);
      if (node) {
        anchorX = node.x;
        anchorZ = node.z;
      }
    } else if (type === 'tower') {
      const d = Math.max(1, dist(this.homeX, this.homeZ, this.enemyBaseX, this.enemyBaseZ));
      anchorX = this.homeX + ((this.enemyBaseX - this.homeX) / d) * 14 + this.rng.spread(6);
      anchorZ = this.homeZ + ((this.enemyBaseZ - this.homeZ) / d) * 14 + this.rng.spread(6);
    }

    const agx = g.grid.tileX(anchorX);
    const agz = g.grid.tileZ(anchorZ);
    const minRing = type === 'farm' || type === 'house' ? 3 : 4;

    for (let ring = minRing; ring < 22; ring++) {
      const candidates: { gx: number; gz: number }[] = [];
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          candidates.push({ gx: agx + dx - (size >> 1), gz: agz + dz - (size >> 1) });
        }
      }
      this.rng.shuffle(candidates);
      for (const c of candidates) {
        // Prefer a one-tile gap so the base stays navigable.
        if (g.grid.canPlace(c.gx - 1, c.gz - 1, size + 2, !!def.water)) return c;
      }
      for (const c of candidates) {
        if (g.canPlaceAt(this.pi, type, c.gx, c.gz)) return c;
      }
    }
    return null;
  }

  /** ---------------------------------------------------------------------
   * Research
   * ------------------------------------------------------------------- */
  private research(): void {
    const g = this.game;
    const p = this.p;
    const tc = this.townCenter();
    const next = this.nextLevelTech();
    // The settlement upgrade always leads; supporting techs slot in around it.
    const order: { tech: TechId; where: BuildingTypeId | 'main' }[] = [
      ...(next ? [{ tech: next, where: 'main' as const }] : []),
      { tech: 'wheel', where: 'main' },
      { tech: 'bronzeWeapons', where: 'barracks' },
      { tech: 'doctrine', where: 'monument' },
      { tech: 'fletching', where: 'range' },
      { tech: 'irrigation', where: 'main' },
      { tech: 'masonry', where: 'monument' },
    ];
    for (const step of order) {
      if (p.techs.has(step.tech)) continue;
      const def = TECHS[step.tech];
      if ((def.age ?? 1) > p.age) continue;
      const building =
        step.where === 'main'
          ? tc
          : g.buildings.find((b) => b.owner === this.pi && b.type === step.where && b.complete && !b.dead);
      if (!building) continue;
      if (building.research) continue;
      if (next && step.tech !== next) {
        // Hold back enough for the settlement upgrade before lesser techs.
        const reserve = TECHS[next].cost;
        if (p.res.food - (def.cost.food ?? 0) < (reserve.food ?? 0) * 0.7) continue;
        if (p.res.gold - (def.cost.gold ?? 0) < (reserve.gold ?? 0) * 0.7) continue;
      }
      if (g.startResearch(building, step.tech)) return;
    }
  }

  /** ---------------------------------------------------------------------
   * Military production
   * ------------------------------------------------------------------- */
  private military(): void {
    const g = this.game;
    const p = this.p;
    const elite = FACTIONS[p.faction].elite;
    const eliteHome = ELITE_BUILDING[p.faction];
    const headroom = p.popCap - p.pop;
    if (headroom <= 1) return;

    const producers = g.buildings.filter(
      (b) =>
        b.owner === this.pi &&
        b.complete &&
        !b.dead &&
        (b.type === 'barracks' || b.type === 'range'),
    );
    if (producers.length === 0) return;

    // Keep a token defence force while saving, but don't drain the age fund.
    const reserve = this.ageReserve();
    const standing = this.army().length;
    if (reserve.food > 0 && standing >= 5 && p.res.food < reserve.food + 120) return;

    const eliteReady =
      p.age >= 5 && g.hasCompleteBuilding(this.pi, 'monument');

    for (const b of producers) {
      if (b.queue.length >= 2) continue;
      let type: UnitTypeId;
      if (b.type === eliteHome && eliteReady && this.rng.bool(0.62)) {
        type = elite;
      } else if (b.type === 'barracks') {
        type = 'spearman';
      } else {
        type = 'archer';
      }
      if (!g.trainUnit(b, type)) {
        // Fall back to the cheap unit if the elite is unaffordable.
        if (type !== 'spearman' && b.type === 'barracks') g.trainUnit(b, 'spearman');
        else if (type !== 'archer' && b.type === 'range') g.trainUnit(b, 'archer');
      }
    }
  }

  /** ---------------------------------------------------------------------
   * Army control
   * ------------------------------------------------------------------- */
  private commandArmy(dt: number): void {
    const g = this.game;
    this.retargetTimer -= dt;
    this.lastDefendCheck -= dt;

    const army = this.army();

    // Defence always wins: pull everyone home if enemies are inside the base.
    if (this.lastDefendCheck <= 0) {
      this.lastDefendCheck = 1.2;
      const intruder = this.findIntruder();
      if (intruder) {
        this.armyMode = 'defend';
        const defenders = army.filter((u) => u.state === 'idle' || dist2(u.x, u.z, this.homeX, this.homeZ) < 55 * 55);
        if (defenders.length) g.commandAttack(defenders, intruder.id);
        // Villagers near the fight help out when things get desperate.
        if (army.length < 3) {
          const vills = this.villagers().filter(
            (u) => dist2(u.x, u.z, intruder.x, intruder.z) < 16 * 16,
          );
          if (vills.length >= 3) g.commandAttack(vills.slice(0, 6), intruder.id);
        }
        return;
      }
      if (this.armyMode === 'defend') this.armyMode = 'rally';
    }

    // Escalating attack waves.
    if (g.time >= this.nextAttackTime && this.armyMode !== 'attack') {
      // The longer a wave is overdue, the smaller a force it will commit.
      const overdue = Math.floor((g.time - this.nextAttackTime) / 40);
      const needed = Math.max(3, this.waveSize() - overdue);
      if (army.length >= needed) {
        this.waveNumber++;
        this.armyMode = 'attack';
        this.attackTargetId = 0;
        this.retargetTimer = 0;
        this.nextAttackTime =
          g.time + Math.max(ATTACK_GAP_MIN, ATTACK_GAP_START - this.waveNumber * 5) / this.difficulty;
        this.phase = 'push';
      } else {
        this.phase = 'army';
      }
    }

    if (this.armyMode === 'attack') {
      if (army.length === 0) {
        this.armyMode = 'rally';
        return;
      }
      if (this.retargetTimer <= 0) {
        this.retargetTimer = 2.5;
        // Stick with the current objective while it still stands.
        const current = this.attackTargetId ? g.entity(this.attackTargetId) : undefined;
        if (current && g.isAlive(current) && current.kind === 'building') {
          const idlers = army.filter((u) => u.state === 'idle' || u.targetId === 0);
          if (idlers.length) g.commandAttack(idlers, current.id);
          if (army.length <= 2 && this.waveNumber > 0) this.armyMode = 'rally';
          return;
        }
        const target = this.pickAttackTarget(army);
        if (target) {
          this.attackTargetId = target.id;
          g.commandAttack(army, target.id);
        } else {
          g.commandMove(army, this.enemyBaseX, this.enemyBaseZ, true);
        }
        // Give up the push if the army is spent.
        if (army.length <= 2 && this.waveNumber > 0) this.armyMode = 'rally';
      }
    } else if (this.armyMode === 'rally') {
      if (this.retargetTimer <= 0) {
        this.retargetTimer = 4;
        const stragglers = army.filter(
          (u) => u.state === 'idle' && dist2(u.x, u.z, this.rallyPoint.x, this.rallyPoint.z) > 9 * 9,
        );
        if (stragglers.length) g.commandMove(stragglers, this.rallyPoint.x, this.rallyPoint.z, true);
      }
    }
  }

  private waveSize(): number {
    // First push is small and early enough to punish a greedy player, then
    // each wave demands a bigger commitment.
    const base = WAVE_SIZES[Math.min(this.waveNumber, WAVE_SIZES.length - 1)];
    return Math.max(4, Math.round(base / this.difficulty));
  }

  private findIntruder(): Unit | null {
    const g = this.game;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of g.units) {
      if (u.owner === this.pi || u.state === 'dead') continue;
      if (!g.isHostile(this.pi, u)) continue;
      if (u.def.role === 'naval' || u.def.role === 'navalWorker') continue;
      const d = dist2(u.x, u.z, this.homeX, this.homeZ);
      if (d < 34 * 34 && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private pickAttackTarget(army: Unit[]): Building | Unit | null {
    const g = this.game;
    const enemy = 1 - this.pi;
    let cx = 0;
    let cz = 0;
    for (const u of army) {
      cx += u.x;
      cz += u.z;
    }
    cx /= army.length;
    cz /= army.length;

    // Prefer nearby enemy units so the army does not walk past defenders.
    let bestUnit: Unit | null = null;
    let bestUnitD = Infinity;
    for (const u of g.units) {
      if (u.owner !== enemy || u.state === 'dead') continue;
      if (u.def.role === 'naval' || u.def.role === 'navalWorker') continue;
      const d = dist2(cx, cz, u.x, u.z);
      if (d < 22 * 22 && d < bestUnitD) {
        bestUnitD = d;
        bestUnit = u;
      }
    }
    if (bestUnit) return bestUnit;

    // Otherwise head for structures, weighting the town centre highest.
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const b of g.buildings) {
      if (b.owner !== enemy || b.dead) continue;
      const d = Math.sqrt(dist2(cx, cz, b.x, b.z));
      let weight = 1;
      if (b.type === 'towncenter') weight = 0.45;
      else if (b.type === 'tower') weight = 0.8;
      else if (b.type === 'barracks' || b.type === 'range') weight = 0.85;
      else if (b.type === 'wall') weight = 1.8;
      const score = d * weight;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  /** Debug/HUD helper. */
  get status(): string {
    return `${this.armyMode} w${this.waveNumber} next@${Math.round(this.nextAttackTime)}`;
  }
}
