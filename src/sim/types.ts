export type ResourceKind = 'food' | 'wood' | 'gold' | 'stone';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['food', 'wood', 'gold', 'stone'];

export type Cost = Partial<Record<ResourceKind, number>>;

export interface Stockpile {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

export type FactionId = 'egypt' | 'greece' | 'rome';

export type UnitTypeId =
  | 'villager'
  | 'spearman'
  | 'archer'
  | 'chariot'
  | 'hoplite'
  | 'legionary'
  | 'fishingBoat'
  | 'warship';

export type BuildingTypeId =
  | 'towncenter'
  | 'house'
  | 'farm'
  | 'storehouse'
  | 'barracks'
  | 'range'
  | 'tower'
  | 'monument'
  | 'wall'
  | 'dock';

export type TechId =
  | 'bronzeAge'
  | 'wheel'
  | 'irrigation'
  | 'bronzeWeapons'
  | 'fletching'
  | 'masonry'
  | 'doctrine';

/** `farm` nodes are invisible harvest points owned by a Farm building. */
export type NodeTypeId = 'tree' | 'berry' | 'gold' | 'stone' | 'fish' | 'farm';

/** Unit behavioural class - drives movement domain and AI role. */
export type UnitRole = 'worker' | 'melee' | 'ranged' | 'naval' | 'navalWorker';

export interface UnitDef {
  id: UnitTypeId;
  name: string;
  role: UnitRole;
  cost: Cost;
  hp: number;
  /** Damage per attack before upgrades/armour. */
  attack: number;
  /** Subtractive damage reduction. */
  armor: number;
  /** Attack reach measured between unit edges, in world units. */
  range: number;
  /** Seconds between attacks. */
  attackSpeed: number;
  /** Portion of the attack cycle before damage lands - drives windup animation. */
  windup: number;
  /** World units per second. */
  speed: number;
  /** Collision radius. */
  radius: number;
  /** Seconds to train. */
  buildTime: number;
  pop: number;
  /** Auto-acquire targets within this radius when idle/moving. */
  aggroRange: number;
  /** Extra damage multiplier against buildings. */
  siegeBonus?: number;
  /** Villager-style: can construct, gather and repair. */
  canBuild?: boolean;
  canGather?: boolean;
  /** Description shown in the selection panel. */
  blurb: string;
}

export interface BuildingDef {
  id: BuildingTypeId;
  name: string;
  cost: Cost;
  hp: number;
  /** Footprint in grid tiles (square). */
  size: number;
  /** Seconds of villager work to complete. */
  buildTime: number;
  /** Population capacity granted when complete. */
  popCap?: number;
  /** Units this building can train. */
  trains?: UnitTypeId[];
  /** Technologies researchable here. */
  researches?: TechId[];
  /** Villagers can deposit these resources here. */
  dropOff?: ResourceKind[] | 'all';
  attack?: number;
  range?: number;
  attackSpeed?: number;
  /** Requires Bronze Age. */
  age?: number;
  /** Must be placed on/adjacent to water. */
  water?: boolean;
  /** Farms hold a finite food store. */
  storesFood?: number;
  blurb: string;
}

export interface TechDef {
  id: TechId;
  name: string;
  cost: Cost;
  time: number;
  /** Tech that must be researched first. */
  requires?: TechId;
  age?: number;
  blurb: string;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  adjective: string;
  elite: UnitTypeId;
  /** Short passive name + description shown on the faction picker. */
  bonusName: string;
  bonusText: string;
  eliteText: string;
  doctrineName: string;
  doctrineText: string;
  colors: {
    /** Primary banner / player colour. */
    accent: number;
    /** Secondary trim. */
    trim: number;
    /** Dominant wall material. */
    wall: number;
    /** Roof material. */
    roof: number;
    /** Cloth / tunic colour for units. */
    cloth: number;
  };
}

export type UnitState =
  | 'idle'
  | 'move'
  | 'attackMove'
  | 'chase'
  | 'attack'
  | 'gather'
  | 'deliver'
  | 'build'
  | 'dead';

export interface Unit {
  id: number;
  kind: 'unit';
  owner: number;
  type: UnitTypeId;
  def: UnitDef;
  x: number;
  z: number;
  /** Position at the start of the current sim tick, for render interpolation. */
  px: number;
  pz: number;
  vx: number;
  vz: number;
  angle: number;
  pangle: number;
  hp: number;
  maxHp: number;
  state: UnitState;
  /** Final destination of the current order. */
  goalX: number;
  goalZ: number;
  /** Flat [x0,z0,x1,z1,...] waypoint list in world space. */
  path: number[];
  pathIdx: number;
  /** Ticks until the unit may request a new path (throttling). */
  repathCooldown: number;
  /** Number of consecutive failed path requests. */
  pathFails: number;
  targetId: number;
  /** Resource node currently being harvested. */
  nodeId: number;
  /** Building site being constructed. */
  siteId: number;
  carryKind: ResourceKind | null;
  carryAmount: number;
  attackCooldown: number;
  /** Counts down through the attack windup; damage lands at 0. */
  swingTimer: number;
  swingTargetId: number;
  /** Time since last damage taken, drives the damage flash. */
  hurtTimer: number;
  /** Seconds since spawn - used for idle animation offsets. */
  age: number;
  /** Random phase so units don't animate in lockstep. */
  phase: number;
  /** Command issued by the player takes priority over auto-acquire. */
  ordered: boolean;
  /** Remembered gather node so villagers resume after delivering. */
  lastNodeId: number;
  deathTimer: number;
}

export interface TrainItem {
  type: UnitTypeId;
  remaining: number;
  total: number;
}

export interface ResearchItem {
  tech: TechId;
  remaining: number;
  total: number;
}

export interface Building {
  id: number;
  kind: 'building';
  owner: number;
  type: BuildingTypeId;
  def: BuildingDef;
  x: number;
  z: number;
  /** Grid tile of the lower-left footprint corner. */
  gx: number;
  gz: number;
  size: number;
  angle: number;
  hp: number;
  maxHp: number;
  complete: boolean;
  /** 0..1 construction progress. */
  progress: number;
  /** Villagers currently working on the site this tick. */
  builders: number;
  queue: TrainItem[];
  research: ResearchItem | null;
  /** Rally point in world space. */
  rallyX: number;
  rallyZ: number;
  attackCooldown: number;
  hurtTimer: number;
  /** Remaining food in a farm. */
  storedFood: number;
  dead: boolean;
  deathTimer: number;
  /** Random phase for flags / idle motion. */
  phase: number;
}

export interface ResourceNode {
  id: number;
  kind: 'node';
  type: NodeTypeId;
  resource: ResourceKind;
  x: number;
  z: number;
  amount: number;
  maxAmount: number;
  /** Villagers currently assigned, used to spread workers out. */
  workers: number;
  radius: number;
  /** Visual variant index. */
  variant: number;
  depleted: boolean;
  /** Shrink animation timer once depleted. */
  fadeTimer: number;
  /** Set for `farm` nodes: the Farm building that owns this harvest point. */
  ownerBuildingId?: number;
}

export type Entity = Unit | Building;

export interface Projectile {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  t: number;
  duration: number;
  damage: number;
  targetId: number;
  kind: 'arrow' | 'javelin' | 'bolt';
  siegeBonus: number;
  dead: boolean;
}

export type PlayerKind = 'human' | 'ai';

export interface Player {
  index: number;
  kind: PlayerKind;
  faction: FactionId;
  res: Stockpile;
  popCap: number;
  pop: number;
  techs: Set<TechId>;
  age: number;
  defeated: boolean;
  /** Cumulative stats for the end screen. */
  stats: {
    gathered: number;
    unitsTrained: number;
    unitsLost: number;
    kills: number;
    buildingsBuilt: number;
  };
}

export type GameEvent =
  | { type: 'build-complete'; building: Building }
  | { type: 'build-start'; building: Building }
  | { type: 'unit-spawned'; unit: Unit }
  | { type: 'unit-died'; unit: Unit; x: number; z: number }
  | { type: 'building-destroyed'; building: Building }
  | { type: 'damage'; x: number; z: number; amount: number; melee: boolean; targetId: number }
  | { type: 'projectile'; projectile: Projectile }
  | { type: 'projectile-hit'; x: number; y: number; z: number }
  | { type: 'gather-tick'; x: number; z: number; resource: ResourceKind }
  | { type: 'deposit'; x: number; z: number; resource: ResourceKind; amount: number }
  | { type: 'node-depleted'; node: ResourceNode }
  | { type: 'research-complete'; player: number; tech: TechId }
  | { type: 'age-up'; player: number; age: number }
  | { type: 'under-attack'; player: number; x: number; z: number }
  | { type: 'game-over'; winner: number };
