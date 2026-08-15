import { Domain, Grid, PathFinder, TILE } from './grid';
import { clamp, dist, dist2 } from '../core/math';
import { Rng } from '../core/rng';
import {
  ABSOLUTE_POP_CAP,
  BUILDINGS,
  BUILD_RANGE,
  DEPOSIT_RANGE,
  ELITE_BUILDING,
  FACTIONS,
  FARM_FOOD,
  GATHER_RATE,
  NODE_WORKER_LIMIT,
  STARTING_RESOURCES,
  TECHS,
  TICK_DT,
  UNITS,
  VILLAGER_CARRY,
  buildingCost,
  canAfford,
  payCost,
  refundCost,
} from './data';

import { generateMap, type Decoration } from './mapgen';
import type {
  Building,
  BuildingTypeId,
  Entity,
  FactionId,
  GameEvent,
  Player,
  Projectile,
  ResourceKind,
  ResourceNode,
  TechId,
  Unit,
  UnitTypeId,
} from './types';

const PROJECTILE_SPEED = 24;
/** Path computations allowed per simulation tick. */
const PATH_BUDGET = 26;
const HASH_CELL = 4;

export interface Mods {
  meleeAtk: number;
  meleeArmor: number;
  rangedAtk: number;
  rangedRange: number;
  villagerSpeedMul: number;
  foodRateMul: number;
  buildingHpMul: number;
  buildSpeedMul: number;
  towerDmgMul: number;
  towerRangeAdd: number;
  unitHpAdd: number;
  eliteAtk: number;
  eliteArmor: number;
  eliteHp: number;
  eliteSpeedMul: number;
  selfRepair: boolean;
}

function baseMods(): Mods {
  return {
    meleeAtk: 0,
    meleeArmor: 0,
    rangedAtk: 0,
    rangedRange: 0,
    villagerSpeedMul: 1,
    foodRateMul: 1,
    buildingHpMul: 1,
    buildSpeedMul: 1,
    towerDmgMul: 1,
    towerRangeAdd: 0,
    unitHpAdd: 0,
    eliteAtk: 0,
    eliteArmor: 0,
    eliteHp: 0,
    eliteSpeedMul: 1,
    selfRepair: false,
  };
}

export interface PlacementResult {
  ok: boolean;
  reason?: 'terrain' | 'cost' | 'age' | 'occupied' | 'water';
  building?: Building;
}

export class Game {
  readonly grid: Grid;
  readonly pathfinder: PathFinder;
  readonly decorations: Decoration[];
  readonly starts: { x: number; z: number }[];
  readonly seed: number;

  units: Unit[] = [];
  buildings: Building[] = [];
  nodes: ResourceNode[] = [];
  projectiles: Projectile[] = [];
  entities = new Map<number, Entity>();
  nodeById = new Map<number, ResourceNode>();
  players: Player[] = [];
  mods: Mods[] = [];

  events: GameEvent[] = [];
  time = 0;
  winner = -1;
  over = false;

  private nextId = 1000;
  private nextProjectileId = 1;
  private pathBudget = PATH_BUDGET;
  private rng: Rng;
  private hash = new Map<number, number[]>();
  private tickCount = 0;

  constructor(playerFaction: FactionId, enemyFaction: FactionId, seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
    const map = generateMap(seed);
    this.grid = map.grid;
    this.pathfinder = new PathFinder(this.grid);
    this.decorations = map.decorations;
    this.starts = map.starts;
    this.nodes = map.nodes;
    for (const n of this.nodes) this.nodeById.set(n.id, n);
    this.rng = new Rng(seed ^ 0x9e3779b9);

    this.players = [
      this.makePlayer(0, 'human', playerFaction),
      this.makePlayer(1, 'ai', enemyFaction),
    ];
    this.mods = this.players.map(() => baseMods());
    this.players.forEach((p) => this.recomputeMods(p.index));

    this.players.forEach((p, i) => this.setupStart(p, map.starts[i]));
  }

  private makePlayer(index: number, kind: 'human' | 'ai', faction: FactionId): Player {
    return {
      index,
      kind,
      faction,
      res: { ...STARTING_RESOURCES },
      popCap: 0,
      pop: 0,
      techs: new Set<TechId>(),
      age: 1,
      defeated: false,
      stats: { gathered: 0, unitsTrained: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0 },
    };
  }

  private setupStart(p: Player, start: { x: number; z: number }): void {
    const size = BUILDINGS.towncenter.size;
    const gx = this.grid.tileX(start.x) - Math.floor(size / 2);
    const gz = this.grid.tileZ(start.z) - Math.floor(size / 2);
    const tc = this.createBuilding(p.index, 'towncenter', gx, gz, true);
    if (tc) {
      tc.rallyX = tc.x + (p.index === 0 ? 0 : 0);
      tc.rallyZ = tc.z + 5;
    }
    // Three villagers fanned out in front of the town centre.
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * 0.5 + (i - 1) * 0.7;
      const px = start.x + Math.cos(a) * 5;
      const pz = start.z + Math.sin(a) * 5;
      this.spawnUnit(p.index, 'villager', px, pz);
    }
    this.recomputePop(p.index);
  }

  /** ---------------------------------------------------------------------
   * Lookups & helpers
   * ------------------------------------------------------------------- */
  player(i: number): Player {
    return this.players[i];
  }

  entity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  isAlive(e: Entity | undefined): e is Entity {
    if (!e) return false;
    if (e.kind === 'unit') return e.state !== 'dead';
    return !e.dead;
  }

  buildingRadius(b: Building): number {
    return (b.size * TILE) / 2 - 0.15;
  }

  entityRadius(e: Entity): number {
    return e.kind === 'unit' ? e.def.radius : this.buildingRadius(e);
  }

  /** Gap between the two entities' edges (negative when overlapping). */
  edgeDistance(a: Entity, b: Entity): number {
    return dist(a.x, a.z, b.x, b.z) - this.entityRadius(a) - this.entityRadius(b);
  }

  domainOf(u: Unit): Domain {
    return u.def.role === 'naval' || u.def.role === 'navalWorker' ? 'water' : 'land';
  }

  /** ---------------------------------------------------------------------
   * Modifiers
   * ------------------------------------------------------------------- */
  recomputeMods(pi: number): void {
    const p = this.players[pi];
    const m = baseMods();
    const f = p.faction;

    if (f === 'egypt') m.foodRateMul *= 1.15;
    if (f === 'greece') {
      m.meleeArmor += 2;
      m.towerRangeAdd += 2;
      m.towerDmgMul *= 1.2;
    }
    if (f === 'rome') {
      m.buildSpeedMul *= 1.35;
      m.buildingHpMul *= 1.2;
    }

    if (p.techs.has('bronzeAge')) m.unitHpAdd += 10;
    if (p.techs.has('wheel')) m.villagerSpeedMul *= 1.2;
    if (p.techs.has('irrigation')) m.foodRateMul *= 1.3;
    if (p.techs.has('bronzeWeapons')) {
      m.meleeAtk += 3;
      m.meleeArmor += 1;
    }
    if (p.techs.has('fletching')) {
      m.rangedAtk += 2;
      m.rangedRange += 1;
    }
    if (p.techs.has('masonry')) {
      m.buildingHpMul *= 1.3;
      m.towerDmgMul *= 1.25;
    }
    if (p.techs.has('doctrine')) {
      if (f === 'egypt') {
        m.eliteAtk += 2;
        m.eliteSpeedMul *= 1.2;
      } else if (f === 'greece') {
        m.eliteHp += 35;
        m.eliteArmor += 2;
      } else {
        m.eliteAtk += 4;
        m.selfRepair = true;
      }
    }
    this.mods[pi] = m;
  }

  isElite(p: Player, type: UnitTypeId): boolean {
    return FACTIONS[p.faction].elite === type;
  }

  unitMaxHp(pi: number, type: UnitTypeId): number {
    const p = this.players[pi];
    const m = this.mods[pi];
    let hp = UNITS[type].hp + m.unitHpAdd;
    if (this.isElite(p, type)) hp += m.eliteHp;
    return Math.round(hp);
  }

  statAttack(u: Unit): number {
    const m = this.mods[u.owner];
    let a = u.def.attack;
    if (u.def.role === 'melee') a += m.meleeAtk;
    else if (u.def.role === 'ranged' || u.def.role === 'naval') a += m.rangedAtk;
    if (this.isElite(this.players[u.owner], u.type)) a += m.eliteAtk;
    return a;
  }

  statArmor(u: Unit): number {
    const m = this.mods[u.owner];
    let a = u.def.armor;
    if (u.def.role === 'melee') a += m.meleeArmor;
    if (this.isElite(this.players[u.owner], u.type)) a += m.eliteArmor;
    return a;
  }

  statRange(u: Unit): number {
    const m = this.mods[u.owner];
    let r = u.def.range;
    if (u.def.role === 'ranged' || u.def.role === 'naval') r += m.rangedRange;
    return r;
  }

  statSpeed(u: Unit): number {
    const m = this.mods[u.owner];
    let s = u.def.speed;
    if (u.def.role === 'worker') s *= m.villagerSpeedMul;
    if (this.isElite(this.players[u.owner], u.type)) s *= m.eliteSpeedMul;
    return s;
  }

  buildingMaxHp(pi: number, type: BuildingTypeId): number {
    return Math.round(BUILDINGS[type].hp * this.mods[pi].buildingHpMul);
  }

  towerDamage(b: Building): number {
    return (b.def.attack ?? 0) * this.mods[b.owner].towerDmgMul;
  }

  towerRange(b: Building): number {
    return (b.def.range ?? 0) + this.mods[b.owner].towerRangeAdd;
  }

  /** ---------------------------------------------------------------------
   * Spawning / construction
   * ------------------------------------------------------------------- */
  spawnUnit(pi: number, type: UnitTypeId, x: number, z: number): Unit {
    const def = UNITS[type];
    const hp = this.unitMaxHp(pi, type);
    const u: Unit = {
      id: this.nextId++,
      kind: 'unit',
      owner: pi,
      type,
      def,
      x,
      z,
      px: x,
      pz: z,
      vx: 0,
      vz: 0,
      angle: pi === 0 ? 0 : Math.PI,
      pangle: pi === 0 ? 0 : Math.PI,
      hp,
      maxHp: hp,
      state: 'idle',
      goalX: x,
      goalZ: z,
      path: [],
      pathIdx: 0,
      repathCooldown: 0,
      pathFails: 0,
      targetId: 0,
      nodeId: 0,
      siteId: 0,
      carryKind: null,
      carryAmount: 0,
      attackCooldown: this.rng.range(0, 0.6),
      swingTimer: 0,
      swingTargetId: 0,
      hurtTimer: 0,
      age: 0,
      phase: this.rng.range(0, Math.PI * 2),
      ordered: false,
      lastNodeId: 0,
      deathTimer: 0,
    };
    this.units.push(u);
    this.entities.set(u.id, u);
    this.recomputePop(pi);
    this.events.push({ type: 'unit-spawned', unit: u });
    return u;
  }

  createBuilding(
    pi: number,
    type: BuildingTypeId,
    gx: number,
    gz: number,
    instant = false,
  ): Building | null {
    const def = BUILDINGS[type];
    if (!this.grid.canPlace(gx, gz, def.size, !!def.water)) return null;
    const maxHp = this.buildingMaxHp(pi, type);
    const cx = this.grid.worldX(gx) + ((def.size - 1) * TILE) / 2;
    const cz = this.grid.worldZ(gz) + ((def.size - 1) * TILE) / 2;
    const b: Building = {
      id: this.nextId++,
      kind: 'building',
      owner: pi,
      type,
      def,
      x: cx,
      z: cz,
      gx,
      gz,
      size: def.size,
      // Models face -Z; the fixed camera sees +Z, so present the front.
      angle: Math.PI,
      hp: instant ? maxHp : maxHp * 0.2,
      maxHp,
      complete: instant,
      progress: instant ? 1 : 0,
      builders: 0,
      queue: [],
      research: null,
      rallyX: cx,
      rallyZ: cz + def.size * TILE * 0.7,
      attackCooldown: 0,
      hurtTimer: 0,
      storedFood: 0,
      dead: false,
      deathTimer: 0,
      phase: this.rng.range(0, Math.PI * 2),
    };
    this.buildings.push(b);
    this.entities.set(b.id, b);
    this.grid.setOccupied(gx, gz, def.size, b.id);
    this.events.push({ type: 'build-start', building: b });
    if (instant) this.onBuildingComplete(b);
    return b;
  }

  /** Player/AI action: pay for and start a construction site. */
  placeBuilding(pi: number, type: BuildingTypeId, gx: number, gz: number): PlacementResult {
    const p = this.players[pi];
    const def = BUILDINGS[type];
    if ((def.age ?? 1) > p.age) return { ok: false, reason: 'age' };
    const cost = buildingCost(type, p.faction);
    if (!canAfford(p.res, cost)) return { ok: false, reason: 'cost' };
    if (!this.grid.canPlace(gx, gz, def.size, !!def.water)) {
      return { ok: false, reason: def.water ? 'water' : 'terrain' };
    }
    const b = this.createBuilding(pi, type, gx, gz, false);
    if (!b) return { ok: false, reason: 'occupied' };
    payCost(p.res, cost);
    return { ok: true, building: b };
  }

  private onBuildingComplete(b: Building): void {
    b.complete = true;
    b.progress = 1;
    b.hp = b.maxHp;
    this.recomputePop(b.owner);
    this.players[b.owner].stats.buildingsBuilt++;
    if (b.type === 'farm') {
      const bonus = this.players[b.owner].faction === 'egypt' ? 1.4 : 1;
      const amount = Math.round(FARM_FOOD * bonus);
      b.storedFood = amount;
      const node: ResourceNode = {
        id: this.nextId++,
        kind: 'node',
        type: 'farm',
        resource: 'food',
        x: b.x,
        z: b.z,
        amount,
        maxAmount: amount,
        workers: 0,
        radius: (b.size * TILE) / 2 - 0.4,
        variant: 0,
        depleted: false,
        fadeTimer: 0,
        ownerBuildingId: b.id,
      };
      this.nodes.push(node);
      this.nodeById.set(node.id, node);
    }
    this.events.push({ type: 'build-complete', building: b });
  }

  /** ---------------------------------------------------------------------
   * Population
   * ------------------------------------------------------------------- */
  recomputePop(pi: number): void {
    const p = this.players[pi];
    let pop = 0;
    for (const u of this.units) if (u.owner === pi && u.state !== 'dead') pop += u.def.pop;
    let cap = 0;
    for (const b of this.buildings) {
      if (b.owner === pi && b.complete && !b.dead) cap += b.def.popCap ?? 0;
    }
    p.pop = pop;
    p.popCap = Math.min(cap, ABSOLUTE_POP_CAP);
  }

  /** ---------------------------------------------------------------------
   * Orders
   * ------------------------------------------------------------------- */
  private clearOrder(u: Unit): void {
    u.targetId = 0;
    u.nodeId = 0;
    u.siteId = 0;
    u.path.length = 0;
    u.pathIdx = 0;
    u.pathFails = 0;
    u.swingTimer = 0;
  }

  /** Move a group, spreading them into a loose formation around the point. */
  commandMove(units: Unit[], x: number, z: number, attackMove = true): void {
    const slots = this.formationSlots(units.length, x, z, units[0] ? this.domainOf(units[0]) : 'land');
    // Assign each unit to the nearest free slot (greedy, small N).
    const used = new Array(slots.length).fill(false);
    const sorted = [...units].sort((a, b) => dist2(a.x, a.z, x, z) - dist2(b.x, b.z, x, z));
    for (const u of sorted) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < slots.length; i++) {
        if (used[i]) continue;
        const d = dist2(u.x, u.z, slots[i][0], slots[i][1]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const tx = best >= 0 ? slots[best][0] : x;
      const tz = best >= 0 ? slots[best][1] : z;
      if (best >= 0) used[best] = true;
      this.clearOrder(u);
      u.goalX = tx;
      u.goalZ = tz;
      u.ordered = true;
      u.state = attackMove && u.def.aggroRange > 0 ? 'attackMove' : 'move';
      u.repathCooldown = 0;
    }
  }

  private formationSlots(count: number, x: number, z: number, domain: Domain): [number, number][] {
    const slots: [number, number][] = [];
    if (count <= 1) return [[x, z]];
    const spacing = 1.5;
    let ring = 0;
    while (slots.length < count) {
      if (ring === 0) {
        if (this.grid.passableWorld(x, z, domain)) slots.push([x, z]);
        ring++;
        continue;
      }
      const r = ring * spacing;
      const n = Math.max(4, Math.floor((Math.PI * 2 * r) / spacing));
      for (let i = 0; i < n && slots.length < count; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.4;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        if (this.grid.passableWorld(sx, sz, domain)) slots.push([sx, sz]);
      }
      ring++;
      if (ring > 12) break;
    }
    while (slots.length < count) slots.push([x, z]);
    return slots;
  }

  commandAttack(units: Unit[], targetId: number): void {
    const target = this.entity(targetId);
    if (!this.isAlive(target)) return;
    for (const u of units) {
      if (u.def.attack <= 0) continue;
      this.clearOrder(u);
      u.targetId = targetId;
      u.state = 'chase';
      u.ordered = true;
      u.repathCooldown = 0;
    }
  }

  commandGather(units: Unit[], nodeId: number): boolean {
    const node = this.nodeById.get(nodeId);
    if (!node || node.depleted) return false;
    let any = false;
    for (const u of units) {
      if (!u.def.canGather) continue;
      const domain = this.domainOf(u);
      const nodeIsWater = node.type === 'fish';
      if (nodeIsWater !== (domain === 'water')) continue;
      this.clearOrder(u);
      u.nodeId = nodeId;
      u.lastNodeId = nodeId;
      u.state = 'gather';
      u.ordered = true;
      u.repathCooldown = 0;
      any = true;
    }
    return any;
  }

  commandBuild(units: Unit[], buildingId: number): boolean {
    const b = this.entity(buildingId);
    if (!b || b.kind !== 'building' || b.dead) return false;
    let any = false;
    for (const u of units) {
      if (!u.def.canBuild) continue;
      this.clearOrder(u);
      u.siteId = buildingId;
      u.state = 'build';
      u.ordered = true;
      u.repathCooldown = 0;
      any = true;
    }
    return any;
  }

  commandStop(units: Unit[]): void {
    for (const u of units) {
      this.clearOrder(u);
      u.state = 'idle';
      u.ordered = false;
    }
  }

  /** ---------------------------------------------------------------------
   * Production
   * ------------------------------------------------------------------- */
  canTrain(b: Building, type: UnitTypeId): { ok: boolean; reason?: string } {
    const p = this.players[b.owner];
    if (!b.complete) return { ok: false, reason: 'Under construction' };
    if (b.queue.length >= 6) return { ok: false, reason: 'Queue full' };
    if (this.isElite(p, type)) {
      if (p.age < 2) return { ok: false, reason: 'Requires Bronze Age' };
      if (!this.hasCompleteBuilding(p.index, 'monument')) return { ok: false, reason: 'Requires Monument' };
      if (ELITE_BUILDING[p.faction] !== b.type) return { ok: false, reason: 'Wrong building' };
    }
    if (!canAfford(p.res, UNITS[type].cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  trainUnit(b: Building, type: UnitTypeId): boolean {
    const check = this.canTrain(b, type);
    if (!check.ok) return false;
    const p = this.players[b.owner];
    payCost(p.res, UNITS[type].cost);
    const time = UNITS[type].buildTime;
    b.queue.push({ type, remaining: time, total: time });
    return true;
  }

  cancelTrain(b: Building, index: number): void {
    const item = b.queue[index];
    if (!item) return;
    refundCost(this.players[b.owner].res, UNITS[item.type].cost);
    b.queue.splice(index, 1);
  }

  canResearch(b: Building, tech: TechId): { ok: boolean; reason?: string } {
    const p = this.players[b.owner];
    if (!b.complete) return { ok: false, reason: 'Under construction' };
    if (p.techs.has(tech)) return { ok: false, reason: 'Already researched' };
    if (b.research) return { ok: false, reason: 'Busy' };
    const def = TECHS[tech];
    if ((def.age ?? 1) > p.age) return { ok: false, reason: 'Requires Bronze Age' };
    if (tech === 'bronzeAge' && p.age >= 2) return { ok: false, reason: 'Already advanced' };
    // Only one research of a given tech at a time across the empire.
    for (const other of this.buildings) {
      if (other.owner === p.index && other.research?.tech === tech) {
        return { ok: false, reason: 'In progress' };
      }
    }
    if (!canAfford(p.res, def.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  startResearch(b: Building, tech: TechId): boolean {
    const check = this.canResearch(b, tech);
    if (!check.ok) return false;
    const p = this.players[b.owner];
    payCost(p.res, TECHS[tech].cost);
    b.research = { tech, remaining: TECHS[tech].time, total: TECHS[tech].time };
    return true;
  }

  cancelResearch(b: Building): void {
    if (!b.research) return;
    refundCost(this.players[b.owner].res, TECHS[b.research.tech].cost);
    b.research = null;
  }

  hasCompleteBuilding(pi: number, type: BuildingTypeId): boolean {
    return this.buildings.some((b) => b.owner === pi && b.type === type && b.complete && !b.dead);
  }

  countBuildings(pi: number, type: BuildingTypeId, includeIncomplete = true): number {
    let n = 0;
    for (const b of this.buildings) {
      if (b.owner !== pi || b.dead || b.type !== type) continue;
      if (!includeIncomplete && !b.complete) continue;
      n++;
    }
    return n;
  }

  countUnits(pi: number, filter?: (u: Unit) => boolean): number {
    let n = 0;
    for (const u of this.units) {
      if (u.owner !== pi || u.state === 'dead') continue;
      if (filter && !filter(u)) continue;
      n++;
    }
    return n;
  }

  private completeResearch(b: Building, tech: TechId): void {
    const p = this.players[b.owner];
    const prevUnitHp = this.mods[p.index].unitHpAdd;
    const prevBuildingMul = this.mods[p.index].buildingHpMul;
    const prevEliteHp = this.mods[p.index].eliteHp;
    p.techs.add(tech);
    if (tech === 'bronzeAge') {
      p.age = 2;
      this.events.push({ type: 'age-up', player: p.index, age: 2 });
    }
    this.recomputeMods(p.index);
    const m = this.mods[p.index];

    const unitDelta = m.unitHpAdd - prevUnitHp;
    const eliteDelta = m.eliteHp - prevEliteHp;
    if (unitDelta !== 0 || eliteDelta !== 0) {
      for (const u of this.units) {
        if (u.owner !== p.index || u.state === 'dead') continue;
        const d = unitDelta + (this.isElite(p, u.type) ? eliteDelta : 0);
        if (d === 0) continue;
        u.maxHp += d;
        u.hp = Math.min(u.maxHp, u.hp + Math.max(0, d));
      }
    }
    if (m.buildingHpMul !== prevBuildingMul) {
      const ratio = m.buildingHpMul / prevBuildingMul;
      for (const bb of this.buildings) {
        if (bb.owner !== p.index || bb.dead) continue;
        bb.maxHp = Math.round(bb.maxHp * ratio);
        bb.hp = Math.min(bb.maxHp, bb.hp * ratio);
      }
    }
    this.events.push({ type: 'research-complete', player: p.index, tech });
  }

  /** ---------------------------------------------------------------------
   * Simulation tick
   * ------------------------------------------------------------------- */
  update(): void {
    if (this.over) return;
    const dt = TICK_DT;
    this.time += dt;
    this.tickCount++;
    this.pathBudget = PATH_BUDGET;

    for (const u of this.units) {
      u.px = u.x;
      u.pz = u.z;
      u.pangle = u.angle;
    }

    this.rebuildHash();

    for (const u of this.units) this.updateUnit(u, dt);
    for (const b of this.buildings) this.updateBuilding(b, dt);
    this.updateProjectiles(dt);
    this.separateUnits();
    this.cleanup();

    if (this.tickCount % 10 === 0) {
      this.recomputePop(0);
      this.recomputePop(1);
    }
    this.checkVictory();
  }

  /** ---------------------------------------------------------------------
   * Spatial hash
   * ------------------------------------------------------------------- */
  private key(x: number, z: number): number {
    const cx = Math.floor(x / HASH_CELL) + 512;
    const cz = Math.floor(z / HASH_CELL) + 512;
    return cz * 1024 + cx;
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state === 'dead') continue;
      const k = this.key(u.x, u.z);
      let arr = this.hash.get(k);
      if (!arr) {
        arr = [];
        this.hash.set(k, arr);
      }
      arr.push(i);
    }
  }

  private forEachNearby(x: number, z: number, radius: number, fn: (u: Unit) => void): void {
    const r = Math.ceil(radius / HASH_CELL);
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const arr = this.hash.get((cz + dz + 512) * 1024 + (cx + dx + 512));
        if (!arr) continue;
        for (const i of arr) fn(this.units[i]);
      }
    }
  }

  /** ---------------------------------------------------------------------
   * Unit behaviour
   * ------------------------------------------------------------------- */
  private updateUnit(u: Unit, dt: number): void {
    if (u.state === 'dead') {
      u.deathTimer -= dt;
      return;
    }
    u.age += dt;
    if (u.hurtTimer > 0) u.hurtTimer -= dt;
    if (u.attackCooldown > 0) u.attackCooldown -= dt;
    if (u.repathCooldown > 0) u.repathCooldown--;

    // Resolve a swing that is mid-flight.
    if (u.swingTimer > 0) {
      u.swingTimer -= dt;
      if (u.swingTimer <= 0) this.resolveSwing(u);
    }

    switch (u.state) {
      case 'idle':
        this.tickIdle(u);
        break;
      case 'move':
      case 'attackMove':
        this.tickMove(u, dt);
        break;
      case 'chase':
      case 'attack':
        this.tickCombat(u, dt);
        break;
      case 'gather':
        this.tickGather(u, dt);
        break;
      case 'deliver':
        this.tickDeliver(u, dt);
        break;
      case 'build':
        this.tickBuild(u, dt);
        break;
    }

    this.integrate(u, dt);
  }

  private tickIdle(u: Unit): void {
    u.vx *= 0.5;
    u.vz *= 0.5;
    if (u.def.aggroRange > 0) {
      const t = this.acquireTarget(u, u.def.aggroRange);
      if (t) {
        u.targetId = t.id;
        u.state = 'chase';
        u.ordered = false;
      }
    } else if (u.def.canGather && u.lastNodeId) {
      // Villagers drift back to work when left alone.
      const node = this.nodeById.get(u.lastNodeId);
      if (node && !node.depleted) {
        u.nodeId = node.id;
        u.state = 'gather';
      } else {
        u.lastNodeId = 0;
      }
    }
  }

  private tickMove(u: Unit, dt: number): void {
    if (u.state === 'attackMove') {
      const t = this.acquireTarget(u, u.def.aggroRange);
      if (t) {
        u.targetId = t.id;
        u.state = 'chase';
        return;
      }
    }
    const arrived = this.navigate(u, u.goalX, u.goalZ, 0.45, dt);
    if (arrived) {
      u.state = 'idle';
      u.ordered = false;
    }
  }

  private tickCombat(u: Unit, dt: number): void {
    const target = this.entity(u.targetId);
    if (!this.isAlive(target)) {
      u.targetId = 0;
      // Look for something else nearby before standing down.
      const next = u.def.aggroRange > 0 ? this.acquireTarget(u, u.def.aggroRange) : null;
      if (next) {
        u.targetId = next.id;
        return;
      }
      u.state = 'idle';
      u.ordered = false;
      return;
    }
    const range = this.statRange(u);
    const gap = this.edgeDistance(u, target);
    if (gap <= range) {
      u.state = 'attack';
      u.path.length = 0;
      u.vx *= 0.4;
      u.vz *= 0.4;
      this.faceTowards(u, target.x, target.z, dt);
      if (u.attackCooldown <= 0 && u.swingTimer <= 0 && u.def.attack > 0) {
        u.swingTimer = u.def.windup;
        u.swingTargetId = target.id;
        u.attackCooldown = u.def.attackSpeed;
      }
    } else {
      u.state = 'chase';
      // Stand just inside weapon range, approaching from our own side.
      const r = this.entityRadius(target) + u.def.radius + range * 0.75;
      const d = Math.max(0.001, dist(u.x, u.z, target.x, target.z));
      const tx = target.x + ((u.x - target.x) / d) * r;
      const tz = target.z + ((u.z - target.z) / d) * r;
      this.navigate(u, tx, tz, 0.4, dt);
    }
  }

  private resolveSwing(u: Unit): void {
    const target = this.entity(u.swingTargetId);
    u.swingTimer = 0;
    if (!this.isAlive(target)) return;
    const range = this.statRange(u) + 0.8;
    if (this.edgeDistance(u, target) > range) return;
    const damage = this.statAttack(u);
    if (u.def.role === 'ranged' || u.def.role === 'naval') {
      this.spawnProjectile(u, target, damage);
    } else {
      this.damageEntity(target, damage, u, true);
    }
  }

  private spawnProjectile(u: Unit, target: Entity, damage: number): void {
    const h = this.grid.heightAt(u.x, u.z);
    const th = this.grid.heightAt(target.x, target.z);
    const d = dist(u.x, u.z, target.x, target.z);
    const p: Projectile = {
      id: this.nextProjectileId++,
      owner: u.owner,
      x: u.x,
      y: h + 1.1,
      z: u.z,
      sx: u.x,
      sy: h + 1.1,
      sz: u.z,
      tx: target.x,
      ty: th + (target.kind === 'unit' ? 0.8 : 1.4),
      tz: target.z,
      t: 0,
      duration: Math.max(0.12, d / PROJECTILE_SPEED),
      damage,
      targetId: target.id,
      kind: u.type === 'chariot' ? 'javelin' : u.type === 'warship' ? 'bolt' : 'arrow',
      siegeBonus: u.def.siegeBonus ?? 1,
      dead: false,
    };
    this.projectiles.push(p);
    this.events.push({ type: 'projectile', projectile: p });
  }

  private spawnTowerProjectile(b: Building, target: Entity, damage: number): void {
    const h = this.grid.heightAt(b.x, b.z);
    const th = this.grid.heightAt(target.x, target.z);
    const d = dist(b.x, b.z, target.x, target.z);
    const p: Projectile = {
      id: this.nextProjectileId++,
      owner: b.owner,
      x: b.x,
      y: h + 5.2,
      z: b.z,
      sx: b.x,
      sy: h + 5.2,
      sz: b.z,
      tx: target.x,
      ty: th + 0.8,
      tz: target.z,
      t: 0,
      duration: Math.max(0.12, d / PROJECTILE_SPEED),
      damage,
      targetId: target.id,
      kind: 'arrow',
      siegeBonus: 1,
      dead: false,
    };
    this.projectiles.push(p);
    this.events.push({ type: 'projectile', projectile: p });
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.t += dt;
      const target = this.entity(p.targetId);
      if (this.isAlive(target)) {
        // Home in gently so shots don't visibly miss moving units.
        p.tx = target.x;
        p.tz = target.z;
      }
      const k = clamp(p.t / p.duration, 0, 1);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.z = p.sz + (p.tz - p.sz) * k;
      const arc = Math.sin(k * Math.PI) * Math.min(2.2, p.duration * 3.2);
      p.y = p.sy + (p.ty - p.sy) * k + arc;
      if (k >= 1) {
        p.dead = true;
        this.events.push({ type: 'projectile-hit', x: p.x, y: p.ty, z: p.z });
        if (this.isAlive(target)) {
          const mult = target.kind === 'building' ? p.siegeBonus : 1;
          this.damageEntity(target, p.damage * mult, null, false, p.owner);
        }
      }
    }
  }

  private acquireTarget(u: Unit, radius: number): Entity | null {
    if (u.def.attack <= 0 || radius <= 0) return null;
    let best: Entity | null = null;
    let bestD = Infinity;
    const naval = this.domainOf(u) === 'water';
    this.forEachNearby(u.x, u.z, radius, (o) => {
      if (o.owner === u.owner || o.state === 'dead') return;
      // Land melee cannot reach boats and vice versa.
      const otherNaval = this.domainOf(o) === 'water';
      if (naval !== otherNaval && this.statRange(u) < 1.5) return;
      const d = dist2(u.x, u.z, o.x, o.z);
      if (d < bestD && d <= radius * radius) {
        bestD = d;
        best = o;
      }
    });
    if (best) return best;
    if (naval) return null;
    // Fall back to buildings only when actively pushing forward.
    if (u.state !== 'attackMove') return null;
    for (const b of this.buildings) {
      if (b.owner === u.owner || b.dead) continue;
      const d = dist2(u.x, u.z, b.x, b.z);
      if (d < bestD && d <= radius * radius * 1.4) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** ---------------------------------------------------------------------
   * Gathering
   * ------------------------------------------------------------------- */

  /**
   * How close a worker must get before it can harvest. Trees and ore occupy a
   * blocked tile, so the worker stands in the *next* tile over - the reach has
   * to clear a whole tile or gathering silently never starts.
   */
  private gatherReach(u: Unit, node: ResourceNode): number {
    const blocking = node.type === 'tree' || node.type === 'gold' || node.type === 'stone';
    return u.def.radius + node.radius + (blocking ? TILE * 0.9 : 0.6);
  }

  private tickGather(u: Unit, dt: number): void {
    let node = this.nodeById.get(u.nodeId);
    if (!node || node.depleted) {
      node = this.findNearestNode(u, node?.resource ?? null) ?? undefined;
      if (!node) {
        u.state = 'idle';
        u.nodeId = 0;
        u.lastNodeId = 0;
        return;
      }
      u.nodeId = node.id;
      u.lastNodeId = node.id;
      u.path.length = 0;
    }
    if (u.carryKind && u.carryKind !== node.resource) {
      // Drop off the old load first.
      u.state = 'deliver';
      return;
    }
    const reach = this.gatherReach(u, node);
    const d = dist(u.x, u.z, node.x, node.z);
    if (d > reach) {
      this.navigate(u, node.x, node.z, reach - 0.1, dt);
      return;
    }
    u.path.length = 0;
    u.vx *= 0.3;
    u.vz *= 0.3;
    this.faceTowards(u, node.x, node.z, dt);

    const m = this.mods[u.owner];
    let rate = GATHER_RATE[node.type];
    if (node.resource === 'food') rate *= m.foodRateMul;
    const take = Math.min(rate * dt, node.amount, VILLAGER_CARRY - u.carryAmount);
    node.amount -= take;
    u.carryAmount += take;
    u.carryKind = node.resource;

    if (this.tickCount % 8 === 0 && take > 0) {
      this.events.push({ type: 'gather-tick', x: node.x, z: node.z, resource: node.resource });
    }

    if (node.amount <= 0.001) this.depleteNode(node);
    if (u.carryAmount >= VILLAGER_CARRY - 0.01 || node.depleted) {
      u.state = 'deliver';
      u.path.length = 0;
    }
  }

  private depleteNode(node: ResourceNode): void {
    if (node.depleted) return;
    node.depleted = true;
    node.amount = 0;
    node.fadeTimer = 1.1;
    const gx = this.grid.tileX(node.x);
    const gz = this.grid.tileZ(node.z);
    if (this.grid.inBounds(gx, gz)) this.grid.blocked[this.grid.idx(gx, gz)] = 0;
    this.events.push({ type: 'node-depleted', node });
    if (node.ownerBuildingId) {
      const b = this.entity(node.ownerBuildingId);
      if (b && b.kind === 'building' && !b.dead) this.destroyBuilding(b);
    }
  }

  private tickDeliver(u: Unit, dt: number): void {
    if (!u.carryKind || u.carryAmount <= 0) {
      u.state = u.lastNodeId ? 'gather' : 'idle';
      u.nodeId = u.lastNodeId;
      return;
    }
    const drop = this.findNearestDropOff(u);
    if (!drop) {
      u.state = 'idle';
      return;
    }
    const reach = this.buildingRadius(drop) + u.def.radius + DEPOSIT_RANGE;
    const d = dist(u.x, u.z, drop.x, drop.z);
    if (d > reach) {
      this.navigate(u, drop.x, drop.z, reach - 0.2, dt);
      return;
    }
    const p = this.players[u.owner];
    const amount = u.carryAmount;
    p.res[u.carryKind] += amount;
    p.stats.gathered += amount;
    this.events.push({ type: 'deposit', x: drop.x, z: drop.z, resource: u.carryKind, amount });
    u.carryAmount = 0;
    u.carryKind = null;
    u.path.length = 0;
    const node = this.nodeById.get(u.lastNodeId);
    if (node && !node.depleted) {
      u.state = 'gather';
      u.nodeId = node.id;
    } else {
      const next = this.findNearestNode(u, null);
      if (next) {
        u.state = 'gather';
        u.nodeId = next.id;
        u.lastNodeId = next.id;
      } else {
        u.state = 'idle';
      }
    }
  }

  findNearestDropOff(u: Unit): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    const naval = this.domainOf(u) === 'water';
    for (const b of this.buildings) {
      if (b.owner !== u.owner || !b.complete || b.dead) continue;
      if (!b.def.dropOff) continue;
      if (naval && b.type !== 'dock') continue;
      const d = dist2(u.x, u.z, b.x, b.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /**
   * Nearest usable node, preferring the same resource and skipping nodes that
   * already have enough workers so villagers spread out naturally.
   */
  findNearestNode(u: Unit, preferred: ResourceKind | null): ResourceNode | null {
    const naval = this.domainOf(u) === 'water';
    let best: ResourceNode | null = null;
    let bestScore = Infinity;
    for (const n of this.nodes) {
      if (n.depleted) continue;
      const isFish = n.type === 'fish';
      if (isFish !== naval) continue;
      if (preferred && n.resource !== preferred) continue;
      const d = Math.sqrt(dist2(u.x, u.z, n.x, n.z));
      if (d > 55) continue;
      const crowd = Math.max(0, n.workers - NODE_WORKER_LIMIT[n.type]) * 14;
      const score = d + crowd;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best && preferred) return this.findNearestNode(u, null);
    return best;
  }

  findNearestNodeOfResource(pi: number, x: number, z: number, res: ResourceKind): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestScore = Infinity;
    for (const n of this.nodes) {
      if (n.depleted || n.resource !== res) continue;
      if (n.type === 'fish') continue;
      const d = Math.sqrt(dist2(x, z, n.x, n.z));
      const crowd = Math.max(0, n.workers - NODE_WORKER_LIMIT[n.type]) * 16;
      const score = d + crowd;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    void pi;
    return best;
  }

  /** ---------------------------------------------------------------------
   * Construction by villagers
   * ------------------------------------------------------------------- */
  private tickBuild(u: Unit, dt: number): void {
    const site = this.entity(u.siteId);
    if (!site || site.kind !== 'building' || site.dead || site.complete) {
      u.siteId = 0;
      u.state = u.lastNodeId ? 'gather' : 'idle';
      u.nodeId = u.lastNodeId;
      return;
    }
    const reach = this.buildingRadius(site) + u.def.radius + BUILD_RANGE;
    const d = dist(u.x, u.z, site.x, site.z);
    if (d > reach) {
      this.navigate(u, site.x, site.z, reach - 0.2, dt);
      return;
    }
    u.path.length = 0;
    u.vx *= 0.3;
    u.vz *= 0.3;
    this.faceTowards(u, site.x, site.z, dt);
    site.builders++;
  }

  /** ---------------------------------------------------------------------
   * Buildings
   * ------------------------------------------------------------------- */
  private updateBuilding(b: Building, dt: number): void {
    if (b.dead) {
      b.deathTimer -= dt;
      return;
    }
    if (b.hurtTimer > 0) b.hurtTimer -= dt;

    if (!b.complete) {
      if (b.builders > 0) {
        const speed = this.mods[b.owner].buildSpeedMul;
        // Extra builders help, with diminishing returns.
        const workers = 1 + (b.builders - 1) * 0.55;
        const inc = (dt / b.def.buildTime) * speed * workers;
        b.progress = Math.min(1, b.progress + inc);
        b.hp = Math.max(b.hp, b.maxHp * (0.2 + 0.8 * b.progress));
        if (b.progress >= 1) this.onBuildingComplete(b);
      }
      b.builders = 0;
      return;
    }
    b.builders = 0;

    if (this.mods[b.owner].selfRepair && b.hp < b.maxHp) {
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.006 * dt);
    }

    // Production queue.
    if (b.queue.length > 0) {
      const p = this.players[b.owner];
      const item = b.queue[0];
      const popOk = p.pop + UNITS[item.type].pop <= p.popCap;
      if (popOk) {
        item.remaining -= dt;
        if (item.remaining <= 0) {
          const spot = this.findSpawnSpot(b, item.type);
          if (spot) {
            const u = this.spawnUnit(b.owner, item.type, spot.x, spot.z);
            p.stats.unitsTrained++;
            b.queue.shift();
            const rallyDomain = this.domainOf(u);
            if (
              dist2(b.rallyX, b.rallyZ, b.x, b.z) > 1 &&
              this.grid.passableWorld(b.rallyX, b.rallyZ, rallyDomain)
            ) {
              this.commandMove([u], b.rallyX, b.rallyZ, u.def.aggroRange > 0);
            } else if (u.def.canGather) {
              const node = this.findNearestNode(u, null);
              if (node) this.commandGather([u], node.id);
            }
          } else {
            item.remaining = 0.4; // retry shortly
          }
        }
      }
    }

    if (b.research) {
      b.research.remaining -= dt;
      if (b.research.remaining <= 0) {
        const tech = b.research.tech;
        b.research = null;
        this.completeResearch(b, tech);
      }
    }

    // Tower / defensive fire.
    if (b.def.attack) {
      if (b.attackCooldown > 0) b.attackCooldown -= dt;
      if (b.attackCooldown <= 0) {
        const range = this.towerRange(b);
        let best: Entity | null = null;
        let bestD = Infinity;
        this.forEachNearby(b.x, b.z, range + 2, (o) => {
          if (o.owner === b.owner || o.state === 'dead') return;
          const d = dist2(b.x, b.z, o.x, o.z);
          if (d < bestD && d <= range * range) {
            bestD = d;
            best = o;
          }
        });
        if (best) {
          this.spawnTowerProjectile(b, best, this.towerDamage(b));
          b.attackCooldown = b.def.attackSpeed ?? 1.5;
        }
      }
    }
  }

  private findSpawnSpot(b: Building, type: UnitTypeId): { x: number; z: number } | null {
    const domain: Domain = UNITS[type].role === 'naval' || UNITS[type].role === 'navalWorker' ? 'water' : 'land';
    const half = b.size / 2;
    for (let ring = 1; ring <= 6; ring++) {
      const candidates: [number, number][] = [];
      for (let dz = -half - ring; dz <= half + ring; dz++) {
        for (let dx = -half - ring; dx <= half + ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) < half + ring - 0.5) continue;
          candidates.push([dx, dz]);
        }
      }
      this.rng.shuffle(candidates);
      for (const [dx, dz] of candidates) {
        const gx = b.gx + Math.floor(half) + Math.round(dx);
        const gz = b.gz + Math.floor(half) + Math.round(dz);
        if (this.grid.passable(gx, gz, domain)) {
          return { x: this.grid.worldX(gx), z: this.grid.worldZ(gz) };
        }
      }
    }
    return null;
  }

  /** ---------------------------------------------------------------------
   * Damage & death
   * ------------------------------------------------------------------- */
  damageEntity(target: Entity, amount: number, source: Unit | null, melee: boolean, ownerOverride = -1): void {
    if (!this.isAlive(target)) return;
    let dmg = amount;
    if (target.kind === 'unit') {
      dmg = Math.max(1, amount - this.statArmor(target));
    } else {
      if (source && source.def.siegeBonus) dmg = amount * source.def.siegeBonus;
    }
    target.hp -= dmg;
    target.hurtTimer = 0.28;
    this.events.push({
      type: 'damage',
      x: target.x,
      z: target.z,
      amount: dmg,
      melee,
      targetId: target.id,
    });

    const attackerOwner = source ? source.owner : ownerOverride;
    if (target.owner === 0 && attackerOwner === 1) this.notifyUnderAttack(target.x, target.z);

    // Villagers and idle troops fight back.
    if (target.kind === 'unit' && target.state === 'idle' && source && target.def.attack > 0) {
      target.targetId = source.id;
      target.state = 'chase';
    }

    if (target.hp <= 0) {
      if (target.kind === 'unit') this.killUnit(target, attackerOwner);
      else this.destroyBuilding(target, attackerOwner);
    }
  }

  private lastAttackWarn = -99;
  private notifyUnderAttack(x: number, z: number): void {
    if (this.time - this.lastAttackWarn < 12) return;
    this.lastAttackWarn = this.time;
    this.events.push({ type: 'under-attack', player: 0, x, z });
  }

  killUnit(u: Unit, killerOwner = -1): void {
    if (u.state === 'dead') return;
    u.state = 'dead';
    u.hp = 0;
    u.deathTimer = 1.4;
    u.path.length = 0;
    this.players[u.owner].stats.unitsLost++;
    if (killerOwner >= 0) this.players[killerOwner].stats.kills++;
    this.events.push({ type: 'unit-died', unit: u, x: u.x, z: u.z });
    this.recomputePop(u.owner);
  }

  destroyBuilding(b: Building, killerOwner = -1): void {
    if (b.dead) return;
    b.dead = true;
    b.hp = 0;
    b.deathTimer = 1.8;
    this.grid.setOccupied(b.gx, b.gz, b.size, 0);
    if (killerOwner >= 0) this.players[killerOwner].stats.kills++;
    // Release any farm harvest point.
    for (const n of this.nodes) {
      if (n.ownerBuildingId === b.id && !n.depleted) {
        n.depleted = true;
        n.amount = 0;
        n.fadeTimer = 0.6;
      }
    }
    // Refund queued production.
    for (const item of b.queue) refundCost(this.players[b.owner].res, UNITS[item.type].cost, 1);
    b.queue.length = 0;
    if (b.research) {
      refundCost(this.players[b.owner].res, TECHS[b.research.tech].cost, 1);
      b.research = null;
    }
    this.events.push({ type: 'building-destroyed', building: b });
    this.recomputePop(b.owner);
  }

  /** ---------------------------------------------------------------------
   * Movement
   * ------------------------------------------------------------------- */
  private faceTowards(u: Unit, x: number, z: number, dt: number): void {
    const want = Math.atan2(x - u.x, z - u.z);
    let d = (want - u.angle) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    u.angle += clamp(d, -9 * dt, 9 * dt);
  }

  /** Steer toward (tx,tz), pathing when needed. Returns true once arrived. */
  private navigate(u: Unit, tx: number, tz: number, stopDist: number, dt: number): boolean {
    const d = dist(u.x, u.z, tx, tz);
    if (d <= stopDist) {
      u.path.length = 0;
      u.pathIdx = 0;
      u.vx *= 0.35;
      u.vz *= 0.35;
      return true;
    }
    const domain = this.domainOf(u);
    const goalMoved = dist2(u.goalX, u.goalZ, tx, tz) > 4;
    const needPath = u.path.length === 0 || goalMoved;

    if (needPath && u.repathCooldown <= 0) {
      if (this.pathBudget > 0) {
        this.pathBudget--;
        u.goalX = tx;
        u.goalZ = tz;
        const path = this.pathfinder.find(u.x, u.z, tx, tz, domain);
        if (path && path.length >= 2) {
          u.path = path;
          u.pathIdx = 0;
          u.pathFails = 0;
        } else {
          u.path.length = 0;
          u.pathFails++;
          u.repathCooldown = 12 + u.pathFails * 8;
          if (u.pathFails > 4) {
            u.pathFails = 0;
            u.state = 'idle';
            return true;
          }
        }
      } else {
        u.repathCooldown = 2;
      }
    }

    let dirX = 0;
    let dirZ = 0;
    if (u.path.length >= 2) {
      const count = u.path.length / 2;
      let wx = u.path[u.pathIdx * 2];
      let wz = u.path[u.pathIdx * 2 + 1];
      const last = u.pathIdx === count - 1;
      const arriveR = last ? Math.max(0.3, stopDist) : 0.9;
      if (dist(u.x, u.z, wx, wz) <= arriveR) {
        u.pathIdx++;
        if (u.pathIdx >= count) {
          u.path.length = 0;
          u.pathIdx = 0;
          return dist(u.x, u.z, tx, tz) <= stopDist + 0.6;
        }
        wx = u.path[u.pathIdx * 2];
        wz = u.path[u.pathIdx * 2 + 1];
      }
      const dd = Math.max(0.0001, dist(u.x, u.z, wx, wz));
      dirX = (wx - u.x) / dd;
      dirZ = (wz - u.z) / dd;
    } else {
      // No path available - nudge straight at the goal.
      dirX = (tx - u.x) / Math.max(0.0001, d);
      dirZ = (tz - u.z) / Math.max(0.0001, d);
    }

    const speed = this.statSpeed(u);
    const desiredX = dirX * speed;
    const desiredZ = dirZ * speed;
    const k = 1 - Math.pow(0.0015, dt);
    u.vx += (desiredX - u.vx) * k;
    u.vz += (desiredZ - u.vz) * k;
    if (dirX !== 0 || dirZ !== 0) this.faceTowards(u, u.x + dirX, u.z + dirZ, dt);
    return false;
  }

  private integrate(u: Unit, dt: number): void {
    if (u.state === 'dead') return;
    const speed = this.statSpeed(u) * 1.25;
    const vlen = Math.hypot(u.vx, u.vz);
    if (vlen > speed) {
      u.vx = (u.vx / vlen) * speed;
      u.vz = (u.vz / vlen) * speed;
    }
    if (vlen < 0.02) {
      u.vx = 0;
      u.vz = 0;
      return;
    }
    const domain = this.domainOf(u);

    // A building can be raised on the tile a unit is standing on. When that
    // happens the unit is inside solid geometry and every candidate move looks
    // blocked, so walk it straight out to the nearest open tile instead.
    if (!this.grid.passableWorld(u.x, u.z, domain)) {
      const near = this.grid.nearestPassable(this.grid.tileX(u.x), this.grid.tileZ(u.z), domain, 10);
      if (near) {
        const tx = this.grid.worldX(near.gx);
        const tz = this.grid.worldZ(near.gz);
        const d = Math.max(0.001, dist(u.x, u.z, tx, tz));
        const step = Math.min(d, speed * dt);
        u.x += ((tx - u.x) / d) * step;
        u.z += ((tz - u.z) / d) * step;
        u.path.length = 0;
        u.pathIdx = 0;
      }
      return;
    }

    let nx = u.x + u.vx * dt;
    let nz = u.z + u.vz * dt;

    if (!this.grid.passableWorld(nx, nz, domain)) {
      // Try sliding along each axis before giving up.
      if (this.grid.passableWorld(nx, u.z, domain)) {
        nz = u.z;
        u.vz = 0;
      } else if (this.grid.passableWorld(u.x, nz, domain)) {
        nx = u.x;
        u.vx = 0;
      } else {
        nx = u.x;
        nz = u.z;
        u.vx = 0;
        u.vz = 0;
        // Stuck: force a fresh path next chance.
        u.path.length = 0;
        u.repathCooldown = Math.min(u.repathCooldown, 3);
      }
    }
    u.x = nx;
    u.z = nz;
  }

  /** Positional de-overlap so crowds spread instead of stacking. */
  private separateUnits(): void {
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      if (a.state === 'dead') continue;
      const domainA = this.domainOf(a);
      let pushX = 0;
      let pushZ = 0;
      let n = 0;
      this.forEachNearby(a.x, a.z, 2.4, (b) => {
        if (b === a || b.state === 'dead') return;
        if (this.domainOf(b) !== domainA) return;
        const minD = a.def.radius + b.def.radius;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-6) return;
        const d = Math.sqrt(d2);
        const overlap = (minD - d) * 0.5;
        pushX += (dx / d) * overlap;
        pushZ += (dz / d) * overlap;
        n++;
      });
      if (n === 0) continue;
      const maxPush = 0.28;
      const len = Math.hypot(pushX, pushZ);
      if (len > maxPush) {
        pushX = (pushX / len) * maxPush;
        pushZ = (pushZ / len) * maxPush;
      }
      const nx = a.x + pushX;
      const nz = a.z + pushZ;
      if (this.grid.passableWorld(nx, nz, domainA)) {
        a.x = nx;
        a.z = nz;
      }
    }
  }

  /** ---------------------------------------------------------------------
   * Bookkeeping
   * ------------------------------------------------------------------- */
  private cleanup(): void {
    // Node worker counts (used to spread villagers across nodes).
    for (const n of this.nodes) n.workers = 0;
    for (const u of this.units) {
      if (u.state === 'gather' && u.nodeId) {
        const n = this.nodeById.get(u.nodeId);
        if (n) n.workers++;
      }
    }

    if (this.units.some((u) => u.state === 'dead' && u.deathTimer <= 0)) {
      this.units = this.units.filter((u) => {
        if (u.state === 'dead' && u.deathTimer <= 0) {
          this.entities.delete(u.id);
          return false;
        }
        return true;
      });
    }
    if (this.buildings.some((b) => b.dead && b.deathTimer <= 0)) {
      this.buildings = this.buildings.filter((b) => {
        if (b.dead && b.deathTimer <= 0) {
          this.entities.delete(b.id);
          return false;
        }
        return true;
      });
    }
    if (this.projectiles.length > 0) {
      this.projectiles = this.projectiles.filter((p) => !p.dead);
    }
    for (const n of this.nodes) {
      if (n.depleted && n.fadeTimer > 0) n.fadeTimer -= TICK_DT;
    }
    if (this.nodes.some((n) => n.depleted && n.fadeTimer <= -2)) {
      this.nodes = this.nodes.filter((n) => {
        if (n.depleted && n.fadeTimer <= -2) {
          this.nodeById.delete(n.id);
          return false;
        }
        return true;
      });
    }
    for (const n of this.nodes) {
      if (n.depleted && n.fadeTimer <= 0 && n.fadeTimer > -2) n.fadeTimer -= TICK_DT;
    }
  }

  private checkVictory(): void {
    if (this.over) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      const hasTc = this.buildings.some((b) => b.owner === p.index && b.type === 'towncenter' && !b.dead);
      if (!hasTc) p.defeated = true;
    }
    const alive = this.players.filter((p) => !p.defeated);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive.length === 1 ? alive[0].index : -1;
      this.events.push({ type: 'game-over', winner: this.winner });
    }
  }

  /** ---------------------------------------------------------------------
   * Queries used by UI / AI
   * ------------------------------------------------------------------- */
  unitsOfPlayer(pi: number): Unit[] {
    return this.units.filter((u) => u.owner === pi && u.state !== 'dead');
  }

  buildingsOfPlayer(pi: number): Building[] {
    return this.buildings.filter((b) => b.owner === pi && !b.dead);
  }

  /** Nearest selectable entity to a world point, within `maxDist`. */
  pick(x: number, z: number, maxDist = 3): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.state === 'dead') continue;
      const d = dist(u.x, u.z, x, z) - u.def.radius;
      if (d < bestD && d < maxDist) {
        bestD = d;
        best = u;
      }
    }
    if (best && bestD < 0.9) return best;
    for (const b of this.buildings) {
      if (b.dead) continue;
      const half = (b.size * TILE) / 2;
      const dx = Math.abs(b.x - x) - half;
      const dz = Math.abs(b.z - z) - half;
      const d = Math.max(dx, dz);
      if (d < bestD && d < maxDist * 0.6) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  pickNode(x: number, z: number, maxDist = 2.2): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (n.depleted || n.type === 'farm') continue;
      const d = dist(n.x, n.z, x, z) - n.radius;
      if (d < bestD && d < maxDist) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Is this world tile a legal spot for the given building? */
  canPlaceAt(pi: number, type: BuildingTypeId, gx: number, gz: number): boolean {
    void pi;
    const def = BUILDINGS[type];
    return this.grid.canPlace(gx, gz, def.size, !!def.water);
  }
}
