import type {
  BuildingDef,
  BuildingTypeId,
  Cost,
  FactionDef,
  FactionId,
  NodeTypeId,
  ResourceKind,
  Stockpile,
  TechDef,
  TechId,
  UnitDef,
  UnitTypeId,
} from './types';

/** ---------------------------------------------------------------------------
 * Global tuning constants. A match is paced to run roughly 8-15 minutes.
 * ------------------------------------------------------------------------- */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export const STARTING_RESOURCES: Stockpile = { food: 220, wood: 170, gold: 40, stone: 30 };
export const VILLAGER_CARRY = 15;
export const BUILD_RANGE = 2.4;
export const DEPOSIT_RANGE = 2.2;

/** ---------------------------------------------------------------------------
 * Settlement levels. A settlement grows from a camp of tents to a metropolis;
 * each level unlocks buildings, units and technologies, and raises the pop
 * ceiling. The old two-age system lives on in the same numeric `age` field.
 * ------------------------------------------------------------------------- */
export interface SettlementLevel {
  name: string;
  numeral: string;
  popCap: number;
}

export const SETTLEMENT_LEVELS: SettlementLevel[] = [
  { name: 'Camp', numeral: 'I', popCap: 14 },
  { name: 'Hamlet', numeral: 'II', popCap: 22 },
  { name: 'Village', numeral: 'III', popCap: 32 },
  { name: 'Town', numeral: 'IV', popCap: 42 },
  { name: 'City', numeral: 'V', popCap: 52 },
  { name: 'Metropolis', numeral: 'VI', popCap: 64 },
];

export const MAX_LEVEL = SETTLEMENT_LEVELS.length;

export function levelName(age: number): string {
  return SETTLEMENT_LEVELS[Math.min(MAX_LEVEL, Math.max(1, age)) - 1].name;
}

export function levelNumeral(age: number): string {
  return SETTLEMENT_LEVELS[Math.min(MAX_LEVEL, Math.max(1, age)) - 1].numeral;
}

/** Hard population ceiling for a settlement of the given level. */
export function levelPopCap(age: number): number {
  return SETTLEMENT_LEVELS[Math.min(MAX_LEVEL, Math.max(1, age)) - 1].popCap;
}

/** The settlement-upgrade techs in order. */
export const LEVEL_TECHS: TechId[] = ['toHamlet', 'toVillage', 'toTown', 'toCity', 'toMetropolis'];

/** Seconds of villager work per resource unit, per node type. */
export const FARM_FOOD = 380;
export const FARM_GATHER_RATE = 0.78;

export const GATHER_RATE: Record<NodeTypeId, number> = {
  tree: 0.62,
  berry: 0.6,
  gold: 0.6,
  stone: 0.56,
  fish: 0.72,
  farm: FARM_GATHER_RATE,
  carcass: 0.85,
};

export const NODE_AMOUNT: Record<NodeTypeId, number> = {
  tree: 130,
  berry: 240,
  gold: 560,
  stone: 520,
  fish: 320,
  farm: FARM_FOOD,
  // Placeholder for type completeness — real carcass amounts come from the
  // hunted animal's UnitDef.carcassFood, not from mapgen.
  carcass: 140,
};

export const NODE_RESOURCE: Record<NodeTypeId, ResourceKind> = {
  tree: 'wood',
  berry: 'food',
  gold: 'gold',
  stone: 'stone',
  fish: 'food',
  farm: 'food',
  carcass: 'food',
};

/** Max villagers that will crowd a single node before others look elsewhere. */
export const NODE_WORKER_LIMIT: Record<NodeTypeId, number> = {
  tree: 2,
  berry: 3,
  gold: 4,
  stone: 4,
  fish: 2,
  farm: 3,
  carcass: 3,
};

/** ---------------------------------------------------------------------------
 * Units
 * ------------------------------------------------------------------------- */
export const UNITS: Record<UnitTypeId, UnitDef> = {
  villager: {
    id: 'villager',
    name: 'Villager',
    role: 'worker',
    cost: { food: 50 },
    hp: 30,
    attack: 4,
    armor: 0,
    range: 0.5,
    attackSpeed: 1.5,
    windup: 0.4,
    speed: 3.2,
    radius: 0.42,
    buildTime: 13,
    pop: 1,
    aggroRange: 0,
    canBuild: true,
    canGather: true,
    blurb: 'Gathers resources and raises buildings.',
  },
  spearman: {
    id: 'spearman',
    name: 'Spearman',
    role: 'melee',
    cost: { food: 60, wood: 20 },
    hp: 62,
    attack: 8,
    armor: 1,
    range: 0.7,
    attackSpeed: 1.35,
    windup: 0.45,
    speed: 3.0,
    radius: 0.45,
    buildTime: 15,
    pop: 1,
    aggroRange: 7,
    blurb: 'Cheap line infantry. The backbone of any army.',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    role: 'ranged',
    cost: { food: 40, wood: 40 },
    hp: 44,
    attack: 7,
    armor: 0,
    range: 7.4,
    attackSpeed: 1.7,
    windup: 0.55,
    speed: 3.1,
    radius: 0.42,
    buildTime: 17,
    pop: 1,
    aggroRange: 9,
    blurb: 'Fires arrows from safety. Fragile in melee.',
  },
  chariot: {
    id: 'chariot',
    name: 'War Chariot',
    role: 'ranged',
    cost: { food: 80, wood: 70 },
    hp: 105,
    attack: 9,
    armor: 1,
    range: 6.4,
    attackSpeed: 1.6,
    windup: 0.4,
    speed: 4.7,
    radius: 0.6,
    buildTime: 22,
    pop: 2,
    aggroRange: 9,
    blurb: 'Egyptian elite. Fast mobile archer platform that outruns infantry.',
  },
  hoplite: {
    id: 'hoplite',
    name: 'Hoplite',
    role: 'melee',
    cost: { food: 80, gold: 50 },
    hp: 145,
    attack: 13,
    armor: 5,
    range: 0.8,
    attackSpeed: 1.5,
    windup: 0.5,
    speed: 2.7,
    radius: 0.48,
    buildTime: 24,
    pop: 2,
    aggroRange: 7,
    blurb: 'Greek elite. Bronze shield wall that shrugs off arrows.',
  },
  legionary: {
    id: 'legionary',
    name: 'Legionary',
    role: 'melee',
    cost: { food: 70, gold: 45 },
    hp: 115,
    attack: 12,
    armor: 3,
    range: 0.75,
    attackSpeed: 1.25,
    windup: 0.4,
    speed: 3.1,
    radius: 0.45,
    buildTime: 21,
    pop: 2,
    siegeBonus: 2.2,
    blurb: 'Roman elite. Disciplined swordsman that tears down buildings.',
    aggroRange: 7,
  },
  fishingBoat: {
    id: 'fishingBoat',
    name: 'Fishing Boat',
    role: 'navalWorker',
    cost: { wood: 55 },
    hp: 90,
    attack: 0,
    armor: 0,
    range: 0,
    attackSpeed: 1,
    windup: 0,
    speed: 3.4,
    radius: 0.7,
    buildTime: 15,
    pop: 1,
    aggroRange: 0,
    canGather: true,
    blurb: 'Harvests fish shoals and returns the catch to a Dock.',
  },
  warship: {
    id: 'warship',
    name: 'War Galley',
    role: 'naval',
    cost: { wood: 100, gold: 45 },
    hp: 190,
    attack: 15,
    armor: 2,
    range: 9.5,
    attackSpeed: 2,
    windup: 0.5,
    speed: 4.0,
    radius: 0.9,
    buildTime: 26,
    pop: 2,
    aggroRange: 11,
    age: 5,
    blurb: 'Rakes the shoreline with arrows. Untouchable by land melee.',
  },

  /** -------------------------------------------------------------------------
   * The wilds. Gaia-owned, never trained, no population cost.
   * ---------------------------------------------------------------------- */
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    role: 'melee',
    cost: {},
    hp: 42,
    attack: 7,
    armor: 0,
    range: 0.55,
    attackSpeed: 1.2,
    windup: 0.35,
    speed: 3.9,
    radius: 0.38,
    buildTime: 0,
    pop: 0,
    aggroRange: 8.5,
    stance: 'hostile',
    carcassFood: 0,
    blurb: 'Hunts in packs and harries anything that strays too close to its ground.',
  },
  boar: {
    id: 'boar',
    name: 'Boar',
    role: 'melee',
    cost: {},
    hp: 68,
    attack: 6,
    armor: 1,
    range: 0.6,
    attackSpeed: 1.5,
    windup: 0.45,
    speed: 3.0,
    radius: 0.5,
    buildTime: 0,
    pop: 0,
    aggroRange: 0,
    stance: 'passive',
    carcassFood: 210,
    blurb: 'Rich meat on dangerous hooves. Bring more than one hunter.',
  },
  deer: {
    id: 'deer',
    name: 'Deer',
    role: 'melee',
    cost: {},
    hp: 26,
    attack: 0,
    armor: 0,
    range: 0.5,
    attackSpeed: 1,
    windup: 0.3,
    speed: 4.4,
    radius: 0.4,
    buildTime: 0,
    pop: 0,
    aggroRange: 0,
    stance: 'passive',
    carcassFood: 130,
    blurb: 'Skittish and quick. Easy food for a patient hunter.',
  },
  bandit: {
    id: 'bandit',
    name: 'Bandit',
    role: 'melee',
    cost: {},
    hp: 55,
    attack: 7,
    armor: 0,
    range: 0.7,
    attackSpeed: 1.35,
    windup: 0.45,
    speed: 3.1,
    radius: 0.45,
    buildTime: 0,
    pop: 0,
    aggroRange: 9,
    stance: 'hostile',
    blurb: 'Lawless muscle guarding a stolen hoard.',
  },
  banditArcher: {
    id: 'banditArcher',
    name: 'Bandit Archer',
    role: 'ranged',
    cost: {},
    hp: 40,
    attack: 6,
    armor: 0,
    range: 7,
    attackSpeed: 1.8,
    windup: 0.55,
    speed: 3.0,
    radius: 0.42,
    buildTime: 0,
    pop: 0,
    aggroRange: 9.5,
    stance: 'hostile',
    blurb: 'Keeps a stolen hoard covered from a distance.',
  },
  wanderer: {
    id: 'wanderer',
    name: 'Wanderer',
    role: 'worker',
    cost: {},
    hp: 30,
    attack: 0,
    armor: 0,
    range: 0.5,
    attackSpeed: 1.5,
    windup: 0.4,
    speed: 3.0,
    radius: 0.42,
    buildTime: 0,
    pop: 0,
    aggroRange: 0,
    stance: 'friendly',
    blurb: 'A lost soul looking for a settlement to call home.',
  },
};

/** ---------------------------------------------------------------------------
 * Buildings
 * ------------------------------------------------------------------------- */
export const BUILDINGS: Record<BuildingTypeId, BuildingDef> = {
  camp: {
    id: 'camp',
    name: 'Camp',
    cost: { wood: 160 },
    hp: 950,
    size: 3,
    buildTime: 45,
    popCap: 6,
    trains: ['villager'],
    researches: ['toHamlet', 'toVillage', 'toTown', 'toCity', 'toMetropolis', 'wheel', 'irrigation'],
    dropOff: 'all',
    main: true,
    blurb: 'The founding hearth. Trains villagers, takes in resources, and raises the settlement itself.',
  },
  tent: {
    id: 'tent',
    name: 'Tent',
    cost: { wood: 20 },
    hp: 120,
    size: 2,
    buildTime: 8,
    popCap: 4,
    blurb: 'Shelter for 4 more settlers. All a camp can raise.',
  },
  towncenter: {
    id: 'towncenter',
    name: 'Town Center',
    cost: { wood: 350, stone: 100 },
    hp: 1500,
    size: 4,
    buildTime: 60,
    popCap: 8,
    trains: ['villager'],
    researches: ['toHamlet', 'toVillage', 'toTown', 'toCity', 'toMetropolis', 'wheel', 'irrigation'],
    dropOff: 'all',
    age: 4,
    main: true,
    blurb: 'A grand second heart for an expanding town.',
  },
  house: {
    id: 'house',
    name: 'House',
    cost: { wood: 30 },
    hp: 250,
    size: 2,
    buildTime: 14,
    popCap: 5,
    age: 3,
    blurb: 'Supports 5 more population.',
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    cost: { wood: 60 },
    hp: 200,
    size: 3,
    buildTime: 16,
    storesFood: FARM_FOOD,
    age: 2,
    blurb: 'A renewable food plot villagers can work forever-ish.',
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    cost: { wood: 80 },
    hp: 350,
    size: 2,
    buildTime: 18,
    dropOff: 'all',
    age: 2,
    blurb: 'Drop-off point. Build near woods and mines to save walking.',
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    cost: { wood: 130 },
    hp: 640,
    size: 3,
    buildTime: 30,
    trains: ['spearman'],
    researches: ['bronzeWeapons'],
    age: 3,
    blurb: 'Trains melee infantry.',
  },
  range: {
    id: 'range',
    name: 'Archery Range',
    cost: { wood: 160, gold: 25 },
    hp: 600,
    size: 3,
    buildTime: 32,
    trains: ['archer'],
    researches: ['fletching'],
    age: 4,
    blurb: 'Trains ranged infantry.',
  },
  tower: {
    id: 'tower',
    name: 'Watch Tower',
    cost: { wood: 90, stone: 70 },
    hp: 800,
    size: 2,
    buildTime: 28,
    attack: 15,
    range: 9,
    attackSpeed: 1.5,
    age: 4,
    blurb: 'Shoots attackers on sight. Anchor your defensive line.',
  },
  monument: {
    id: 'monument',
    name: 'Monument',
    cost: { stone: 180, gold: 120 },
    hp: 1050,
    size: 3,
    buildTime: 50,
    researches: ['masonry', 'doctrine'],
    age: 5,
    blurb: 'Faction wonder. Unlocks your elite unit — and the road to a Metropolis.',
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    cost: { stone: 6 },
    hp: 500,
    size: 1,
    buildTime: 6,
    age: 4,
    blurb: 'Blocks movement. Funnel raiders into your towers.',
  },
  dock: {
    id: 'dock',
    name: 'Dock',
    cost: { wood: 100 },
    hp: 500,
    size: 3,
    buildTime: 26,
    trains: ['fishingBoat', 'warship'],
    dropOff: 'all',
    water: true,
    age: 3,
    blurb: 'Built on the shoreline. Trains boats and receives their catch.',
  },
};

/** ---------------------------------------------------------------------------
 * Technologies
 * ------------------------------------------------------------------------- */
export const TECHS: Record<TechId, TechDef> = {
  toHamlet: {
    id: 'toHamlet',
    name: 'Found the Hamlet',
    cost: { food: 110, wood: 70 },
    time: 22,
    advancesTo: 2,
    prereqPop: 7,
    blurb: 'Raise the camp into a working hamlet. Unlocks farms and storehouses.',
  },
  toVillage: {
    id: 'toVillage',
    name: 'Found the Village',
    cost: { food: 240, wood: 170 },
    time: 32,
    requires: 'toHamlet',
    advancesTo: 3,
    prereqBuildings: ['farm', 'storehouse'],
    blurb: 'Grow into a true village. Unlocks houses, the barracks and the dock.',
  },
  toTown: {
    id: 'toTown',
    name: 'Charter the Town',
    cost: { food: 380, wood: 250, gold: 120 },
    time: 42,
    requires: 'toVillage',
    advancesTo: 4,
    prereqBuildings: ['barracks'],
    prereqPop: 16,
    blurb: 'A chartered town. Unlocks the archery range, towers, walls and new town centers.',
  },
  toCity: {
    id: 'toCity',
    name: 'Proclaim the City',
    cost: { food: 550, wood: 300, gold: 260, stone: 170 },
    time: 52,
    requires: 'toTown',
    advancesTo: 5,
    prereqBuildings: ['tower'],
    prereqPop: 24,
    blurb: 'Proclaim a city. Unlocks the monument, war galleys and your elite unit.',
  },
  toMetropolis: {
    id: 'toMetropolis',
    name: 'Rise of the Metropolis',
    cost: { food: 800, wood: 420, gold: 460, stone: 340 },
    time: 70,
    requires: 'toCity',
    advancesTo: 6,
    prereqBuildings: ['monument'],
    prereqPop: 32,
    blurb: 'The final ascent. Complete it and your civilisation stands eternal — victory.',
  },
  wheel: {
    id: 'wheel',
    name: 'The Wheel',
    cost: { food: 150, wood: 100 },
    time: 25,
    age: 2,
    blurb: 'Villagers move 20% faster.',
  },
  irrigation: {
    id: 'irrigation',
    name: 'Irrigation',
    cost: { food: 250, wood: 100 },
    time: 30,
    age: 3,
    blurb: 'Food is gathered 30% faster.',
  },
  bronzeWeapons: {
    id: 'bronzeWeapons',
    name: 'Bronze Weapons',
    cost: { food: 200, gold: 100 },
    time: 35,
    age: 3,
    blurb: 'Melee units gain +3 attack and +1 armour.',
  },
  fletching: {
    id: 'fletching',
    name: 'Fletching',
    cost: { food: 180, wood: 100 },
    time: 30,
    age: 4,
    blurb: 'Ranged units gain +2 attack and +1 range.',
  },
  masonry: {
    id: 'masonry',
    name: 'Masonry',
    cost: { stone: 250, gold: 100 },
    time: 40,
    age: 5,
    blurb: 'Buildings gain +30% HP, towers +25% damage.',
  },
  doctrine: {
    id: 'doctrine',
    name: 'Doctrine',
    cost: { food: 300, gold: 250 },
    time: 45,
    age: 5,
    blurb: 'Your faction doctrine. See the faction panel.',
  },
};

/** ---------------------------------------------------------------------------
 * Factions
 * ------------------------------------------------------------------------- */
export const FACTIONS: Record<FactionId, FactionDef> = {
  egypt: {
    id: 'egypt',
    name: 'Egypt',
    adjective: 'Egyptian',
    elite: 'chariot',
    bonusName: 'Gift of the Nile',
    bonusText: 'Farms cost 25% less and hold 40% more food. Villagers gather food 15% faster.',
    eliteText: 'War Chariot - a fast ranged elite that outruns any infantry.',
    doctrineName: 'Chariotry of Pharaoh',
    doctrineText: 'War Chariots gain +2 attack and +20% speed.',
    colors: { accent: 0x2f6fd0, trim: 0xe9c46a, wall: 0xd9c39b, roof: 0xc9b184, cloth: 0x3a7bd5 },
  },
  greece: {
    id: 'greece',
    name: 'Greece',
    adjective: 'Greek',
    elite: 'hoplite',
    bonusName: 'Phalanx Discipline',
    bonusText: 'Melee units gain +2 armour. Towers gain +2 range and +20% damage.',
    eliteText: 'Hoplite - a heavily armoured spearman that holds any line.',
    doctrineName: 'Spartan Agoge',
    doctrineText: 'Hoplites gain +35 HP and +2 armour.',
    colors: { accent: 0x2f6fd0, trim: 0xf2f0e6, wall: 0xe8e4d6, roof: 0x2f5fae, cloth: 0x2f6fd0 },
  },
  rome: {
    id: 'rome',
    name: 'Rome',
    adjective: 'Roman',
    elite: 'legionary',
    bonusName: 'Legion Engineering',
    bonusText: 'Buildings are raised 35% faster and have +20% HP.',
    eliteText: 'Legionary - a fast, disciplined swordsman that demolishes buildings.',
    doctrineName: 'Marian Reforms',
    doctrineText: 'Legionaries gain +4 attack. Buildings slowly repair themselves.',
    colors: { accent: 0xb03a2e, trim: 0xe4d5b7, wall: 0xefe6d2, roof: 0xa8402f, cloth: 0xb5433a },
  },
};

/** Where each faction's elite unit is trained. */
export const ELITE_BUILDING: Record<FactionId, BuildingTypeId> = {
  egypt: 'range',
  greece: 'barracks',
  rome: 'barracks',
};

/** Monument silhouette varies per faction. */
export const MONUMENT_NAME: Record<FactionId, string> = {
  egypt: 'Great Obelisk',
  greece: 'Temple of Athena',
  rome: 'Triumphal Arch',
};

/** Build menu ordering. */
export const BUILD_ORDER: BuildingTypeId[] = [
  'tent',
  'house',
  'farm',
  'storehouse',
  'barracks',
  'range',
  'dock',
  'tower',
  'wall',
  'monument',
  'towncenter',
  'camp',
];

/** ---------------------------------------------------------------------------
 * Cost helpers
 * ------------------------------------------------------------------------- */
export function canAfford(res: Stockpile, cost: Cost): boolean {
  return (
    (res.food ?? 0) >= (cost.food ?? 0) &&
    (res.wood ?? 0) >= (cost.wood ?? 0) &&
    (res.gold ?? 0) >= (cost.gold ?? 0) &&
    (res.stone ?? 0) >= (cost.stone ?? 0)
  );
}

export function payCost(res: Stockpile, cost: Cost): void {
  res.food -= cost.food ?? 0;
  res.wood -= cost.wood ?? 0;
  res.gold -= cost.gold ?? 0;
  res.stone -= cost.stone ?? 0;
}

export function refundCost(res: Stockpile, cost: Cost, ratio = 1): void {
  res.food += (cost.food ?? 0) * ratio;
  res.wood += (cost.wood ?? 0) * ratio;
  res.gold += (cost.gold ?? 0) * ratio;
  res.stone += (cost.stone ?? 0) * ratio;
}

export function scaleCost(cost: Cost, factor: number): Cost {
  const out: Cost = {};
  for (const k of Object.keys(cost) as ResourceKind[]) {
    out[k] = Math.round((cost[k] ?? 0) * factor);
  }
  return out;
}

/** Faction-adjusted building cost (Egypt's cheap farms). */
export function buildingCost(type: BuildingTypeId, faction: FactionId): Cost {
  const base = BUILDINGS[type].cost;
  if (faction === 'egypt' && type === 'farm') return scaleCost(base, 0.75);
  return base;
}

/** The settlement level at which a faction's elite unit unlocks. */
export const ELITE_LEVEL = 5;

/** Units a building can train for a given faction, including the elite. */
export function trainableAt(type: BuildingTypeId, faction: FactionId, age: number): UnitTypeId[] {
  const base = BUILDINGS[type].trains ? [...BUILDINGS[type].trains!] : [];
  if (ELITE_BUILDING[faction] === type && age >= ELITE_LEVEL) base.push(FACTIONS[faction].elite);
  return base;
}
