import { Rng } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import {
  GRID_SIZE,
  Grid,
  T_DEEP,
  T_DRY,
  T_GRASS,
  T_ROCK,
  T_SAND,
  T_SHALLOW,
  TILE,
} from './grid';
import { NODE_AMOUNT, NODE_RESOURCE } from './data';
import type { NodeTypeId, ResourceNode } from './types';

/**
 * Lowest a land tile may sit. The water mesh is a single plane at y=0.02
 * covering the whole map, so anything below this would show sea through the
 * middle of the continent.
 */
const LAND_MIN_HEIGHT = 0.16;

/**
 * A biome is now a *region* of the map rather than the whole of it: the
 * continent carries deserts, mediterranean scrub and green lowland side by
 * side, drawn from the same three homeland palettes. The player's and the
 * enemy's founding grounds are biased towards their own civilisation's
 * homeland so a match still opens on familiar terrain.
 */
export type Biome = 'egypt' | 'greece' | 'rome';

export const BIOME_INDEX: Record<Biome, number> = { egypt: 0, greece: 1, rome: 2 };
export const BIOME_BY_INDEX: readonly Biome[] = ['egypt', 'greece', 'rome'];

interface BiomeProfile {
  /** Noise cutoff above which inland tiles go dry rather than green. */
  dryBias: number;
  /** Chance a dry tile turns to open sand. */
  sandChance: number;
  /** How far inland the beach reaches, in tiles. */
  beachWidth: number;
  /** Tree-cluster density multiplier for the region. */
  woods: number;
  /** Decoration weights, sampled in this order against one roll. */
  palm: number;
  olive: number;
  cypress: number;
  grass: number;
  rock: number;
}

const BIOMES: Record<Biome, BiomeProfile> = {
  // Desert: broad sand, palms along every shore, little undergrowth.
  egypt: { dryBias: -0.3, sandChance: 0.72, beachWidth: 3.6, woods: 0.55, palm: 0.075, olive: 0.012, cypress: 0.006, grass: 0.05, rock: 0.035 },
  // Rocky Mediterranean: olive groves, cypress stands, stony ground.
  greece: { dryBias: 0.02, sandChance: 0.45, beachWidth: 2.2, woods: 1.0, palm: 0.03, olive: 0.045, cypress: 0.032, grass: 0.11, rock: 0.05 },
  // Green hills: grass through to the shoreline, dark pine-like cypress.
  rome: { dryBias: 0.34, sandChance: 0.16, beachWidth: 1.6, woods: 1.35, palm: 0.012, olive: 0.022, cypress: 0.05, grass: 0.16, rock: 0.03 },
};

export interface Decoration {
  kind: 'palm' | 'olive' | 'cypress' | 'rock' | 'grass' | 'reed' | 'ruin';
  x: number;
  z: number;
  scale: number;
  rot: number;
}

/** A point of interest scattered across the wilds, spawned by the sim. */
export type EncounterKind =
  | 'wolves'
  | 'boars'
  | 'deer'
  | 'bandits'
  | 'treasure'
  | 'wanderer'
  | 'merchant';

export interface EncounterSpawn {
  kind: EncounterKind;
  x: number;
  z: number;
}

export interface GeneratedMap {
  /** The player's homeland biome — drives sky/air, not the whole ground. */
  biome: Biome;
  /** Region biome per tile, indexed by BIOME_INDEX values. */
  biomes: Uint8Array;
  grid: Grid;
  nodes: ResourceNode[];
  decorations: Decoration[];
  starts: { x: number; z: number }[];
  encounters: EncounterSpawn[];
  seed: number;
}

/** Cheap deterministic value noise. */
function makeNoise(rng: Rng) {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  rng.shuffle(Array.from(base)).forEach((v, i) => (base[i] = v));
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  const grad = (h: number, x: number, y: number): number => {
    switch (h & 3) {
      case 0:
        return x + y;
      case 1:
        return -x + y;
      case 2:
        return x - y;
      default:
        return -x - y;
    }
  };

  const noise2 = (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 0.5;
  };

  const fbm = (x: number, y: number, octaves = 4): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.05;
    }
    return sum / norm;
  };

  return { noise2, fbm };
}

let nodeIdCounter = 1;

function makeNode(type: NodeTypeId, x: number, z: number, rng: Rng): ResourceNode {
  const amount = Math.round(NODE_AMOUNT[type] * rng.range(0.85, 1.15));
  return {
    id: nodeIdCounter++,
    kind: 'node',
    type,
    resource: NODE_RESOURCE[type],
    x,
    z,
    amount,
    maxAmount: amount,
    workers: 0,
    radius: type === 'tree' ? 0.75 : type === 'berry' ? 0.7 : type === 'fish' ? 1.1 : 1.0,
    variant: rng.int(0, 3),
    depleted: false,
    fadeTimer: 0,
  };
}

/**
 * Two-pass chamfer distance transform. Returns, for every tile, the distance
 * in tiles to the nearest tile where `isSource` is true (0 on sources).
 */
function chamfer(isSource: (i: number) => boolean): Float32Array {
  const N = GRID_SIZE;
  const d = new Float32Array(N * N).fill(1e9);
  for (let i = 0; i < N * N; i++) if (isSource(i)) d[i] = 0;
  const D = Math.SQRT2;
  // Forward pass.
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const i = gz * N + gx;
      if (gx > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (gz > 0) d[i] = Math.min(d[i], d[i - N] + 1);
      if (gx > 0 && gz > 0) d[i] = Math.min(d[i], d[i - N - 1] + D);
      if (gx < N - 1 && gz > 0) d[i] = Math.min(d[i], d[i - N + 1] + D);
    }
  }
  // Backward pass.
  for (let gz = N - 1; gz >= 0; gz--) {
    for (let gx = N - 1; gx >= 0; gx--) {
      const i = gz * N + gx;
      if (gx < N - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (gz < N - 1) d[i] = Math.min(d[i], d[i + N] + 1);
      if (gx < N - 1 && gz < N - 1) d[i] = Math.min(d[i], d[i + N + 1] + D);
      if (gx > 0 && gz < N - 1) d[i] = Math.min(d[i], d[i + N - 1] + D);
    }
  }
  return d;
}

/**
 * Builds a fresh world every match: one big continent ringed by sea, a
 * scattering of offshore islands, desert / mediterranean / verdant regions
 * blended across it, randomly-sited founding grounds for both settlements,
 * resources that grow richer the further from home they lie, and the wild
 * encounters that make the space between the two settlements worth walking.
 */
export function generateMap(
  seed: number,
  biome: Biome = 'greece',
  enemyBiome: Biome = 'rome',
): GeneratedMap {
  nodeIdCounter = 1;
  const rng = new Rng(seed);
  const { fbm, noise2 } = makeNoise(rng);
  const grid = new Grid();
  const nodes: ResourceNode[] = [];
  const decorations: Decoration[] = [];
  const N = GRID_SIZE;
  const NN = N * N;

  const edgeDist = (gx: number, gz: number): number => Math.min(gx, gz, N - 1 - gx, N - 1 - gz);

  // --- Landmass: continent + islands ---------------------------------------
  // Domain-warped fbm carves bays and inland lakes out of a big central mass;
  // an ocean ring at the map edge guarantees the world reads as a continent.
  const islands: { gx: number; gz: number; r: number }[] = [];
  for (let i = 0; i < 9; i++) {
    for (let t = 0; t < 60; t++) {
      const gx = rng.int(10, N - 11);
      const gz = rng.int(10, N - 11);
      const e = edgeDist(gx, gz);
      if (e < 6 || e > 24) continue;
      if (islands.some((o) => Math.hypot(o.gx - gx, o.gz - gz) < o.r + 18)) continue;
      islands.push({ gx, gz, r: rng.range(5, 10.5) });
      break;
    }
  }

  const landField = (gx: number, gz: number): number => {
    const wx = fbm(gx * 0.05 + 7.7, gz * 0.05 + 3.1, 3) * 16;
    const wz = fbm(gx * 0.05 - 4.9, gz * 0.05 + 9.3, 3) * 16;
    const body = fbm((gx + wx) * 0.016, (gz + wz) * 0.016, 4);
    let v = 0.34 + body * 0.95 - (1 - smoothstep(0, 26, edgeDist(gx, gz))) * 1.5;
    for (const o of islands) {
      const d = Math.hypot(gx - o.gx, gz - o.gz);
      const bump = smoothstep(o.r, o.r * 0.3, d) * (0.75 + fbm(gx * 0.14, gz * 0.14, 2) * 0.3);
      v = Math.max(v, bump - 0.28);
    }
    return v;
  };

  const land = new Uint8Array(NN);
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      land[gz * N + gx] = landField(gx, gz) > 0.2 ? 1 : 0;
    }
  }

  // Signed distance to the coast, in tiles: positive inland, negative at sea.
  const dToWater = chamfer((i) => land[i] === 0);
  const dToLand = chamfer((i) => land[i] === 1);
  const coast = new Float32Array(NN);
  for (let i = 0; i < NN; i++) coast[i] = land[i] ? dToWater[i] : -dToLand[i];

  // --- Heights --------------------------------------------------------------
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const i = gz * N + gx;
      const sea = coast[i];
      if (!land[i]) {
        const depth = clamp(-sea / 8, 0, 1);
        grid.height[i] = -0.25 - depth * 2.1;
      } else {
        const hills = fbm(gx * 0.045, gz * 0.045, 4);
        const detail = fbm(gx * 0.13 + 40, gz * 0.13 + 40, 3);
        grid.height[i] = 0.05 + smoothstep(0, 5, sea) * (0.32 + hills * 1.9 + detail * 0.35);
      }
    }
  }

  // --- Connected components (before rocks) ----------------------------------
  // The mainland is the biggest land component; both settlements and every
  // encounter go there so nothing important is stranded on an island.
  const comp = new Int32Array(NN).fill(-1);
  const compSizes: number[] = [];
  {
    const stack: number[] = [];
    for (let s = 0; s < NN; s++) {
      if (!land[s] || comp[s] !== -1) continue;
      const id = compSizes.length;
      let size = 0;
      stack.push(s);
      comp[s] = id;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const gx = i % N;
        const gz = (i / N) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const ni = nz * N + nx;
          if (land[ni] && comp[ni] === -1) {
            comp[ni] = id;
            stack.push(ni);
          }
        }
      }
      compSizes.push(size);
    }
  }
  let mainComp = 0;
  for (let c = 1; c < compSizes.length; c++) if (compSizes[c] > compSizes[mainComp]) mainComp = c;

  // --- Founding grounds ------------------------------------------------------
  // Score flat, roomy mainland tiles; the player settles at a random good one,
  // the enemy at a good one far away. No more fixed corners.
  interface Candidate {
    gx: number;
    gz: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (let gz = 16; gz < N - 16; gz += 3) {
    for (let gx = 16; gx < N - 16; gx += 3) {
      const i = gz * N + gx;
      if (comp[i] !== mainComp) continue;
      const sea = coast[i];
      if (sea < 5) continue;
      let lo = Infinity;
      let hi = -Infinity;
      let roomy = 0;
      for (let dz = -6; dz <= 6; dz += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const ni = (gz + dz) * N + (gx + dx);
          if (!land[ni]) {
            lo = -9;
            continue;
          }
          const h = grid.height[ni];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
          roomy++;
        }
      }
      const flat = hi - lo;
      if (lo < -1 || flat > 1.25) continue;
      const coastal = sea < 22 ? 0.5 : 0;
      candidates.push({ gx, gz, score: 2 - flat + coastal + roomy * 0.01 + rng.next() * 0.5 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) {
    // Degenerate seed; settle for the mainland tile nearest the centre.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < NN; i++) {
      if (comp[i] !== mainComp) continue;
      const gx = i % N;
      const gz = (i / N) | 0;
      const d = Math.hypot(gx - N / 2, gz - N / 2);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    candidates.push({ gx: best % N, gz: (best / N) | 0, score: 0 });
  }

  const playerSite = candidates[rng.int(0, Math.min(29, candidates.length - 1))];
  let enemySite: Candidate | null = null;
  for (const minFrac of [0.55, 0.45, 0.35, 0.22, 0]) {
    const far = candidates.filter(
      (c) => Math.hypot(c.gx - playerSite.gx, c.gz - playerSite.gz) >= N * minFrac,
    );
    if (far.length > 0) {
      enemySite = far[rng.int(0, Math.min(14, far.length - 1))];
      break;
    }
  }
  const startTiles = [
    { gx: playerSite.gx, gz: playerSite.gz },
    { gx: enemySite!.gx, gz: enemySite!.gz },
  ];
  const starts = startTiles.map((s) => ({ x: grid.worldX(s.gx), z: grid.worldZ(s.gz) }));

  const nearStart = (gx: number, gz: number, r: number): boolean =>
    startTiles.some((s) => Math.hypot(s.gx - gx, s.gz - gz) < r);

  // --- Biome regions ---------------------------------------------------------
  // Two big noise fields split the continent into desert, mediterranean and
  // verdant country; each civilisation's founding ground is pulled towards its
  // own homeland so the opening minutes look like home.
  const biomes = new Uint8Array(NN);
  const heatOff = rng.range(0, 60);
  const wetOff = rng.range(0, 60);
  const startBiome = [BIOME_INDEX[biome], BIOME_INDEX[enemyBiome]];
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const i = gz * N + gx;
      const heat = fbm(gx * 0.013 + heatOff, gz * 0.013 + heatOff, 3);
      const wet = fbm(gx * 0.016 - wetOff, gz * 0.016 + wetOff, 3);
      let b: number;
      if (heat > 0.13) b = BIOME_INDEX.egypt;
      else if (wet > 0.09) b = BIOME_INDEX.rome;
      else b = BIOME_INDEX.greece;
      // Homeland pull, dithered at the rim so the seam stays organic.
      for (let s = 0; s < 2; s++) {
        const d = Math.hypot(startTiles[s].gx - gx, startTiles[s].gz - gz);
        if (d < 20 + noise2(gx * 0.3, gz * 0.3) * 8) b = startBiome[s];
      }
      biomes[i] = b;
    }
  }

  // --- Terrain paint ---------------------------------------------------------
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const i = gz * N + gx;
      const sea = coast[i];
      if (!land[i]) {
        grid.terrain[i] = sea < -3.4 ? T_DEEP : T_SHALLOW;
        continue;
      }
      const bio = BIOMES[BIOME_BY_INDEX[biomes[i]]];
      if (sea < bio.beachWidth) {
        grid.terrain[i] = T_SAND;
      } else {
        const dry = fbm(gx * 0.08 + 90, gz * 0.08 + 90, 3);
        let t = dry > bio.dryBias ? T_DRY : T_GRASS;
        if (dry > bio.dryBias + 0.24 && rng.bool(bio.sandChance)) t = T_SAND;
        grid.terrain[i] = t;
      }
    }
  }

  // Flatten a plateau around each start so the base looks tidy.
  for (const s of startTiles) {
    for (let gz = s.gz - 8; gz <= s.gz + 8; gz++) {
      for (let gx = s.gx - 8; gx <= s.gx + 8; gx++) {
        if (!grid.inBounds(gx, gz)) continue;
        const d = Math.hypot(gx - s.gx, gz - s.gz);
        if (d > 8) continue;
        const i = grid.idx(gx, gz);
        if (grid.terrain[i] === T_DEEP || grid.terrain[i] === T_SHALLOW) continue;
        const k = 1 - smoothstep(3.5, 8, d);
        grid.height[i] = grid.height[i] * (1 - k) + 0.55 * k;
        if (d < 5 && grid.terrain[i] === T_GRASS) grid.terrain[i] = T_DRY;
      }
    }
  }

  // --- Rocky outcrops (impassable cliffs) -----------------------------------
  const ridge = (gx: number, gz: number): number => {
    const n = Math.abs(noise2(gx * 0.07 + 200, gz * 0.07 + 200));
    return 1 - n * 3.2;
  };
  for (let gz = 1; gz < N - 1; gz++) {
    for (let gx = 1; gx < N - 1; gx++) {
      const i = grid.idx(gx, gz);
      if (grid.terrain[i] === T_DEEP || grid.terrain[i] === T_SHALLOW) continue;
      if (nearStart(gx, gz, 13)) continue;
      if (coast[i] < 4) continue;
      const r = ridge(gx, gz);
      if (r > 0.74 && rng.bool(0.8)) {
        grid.terrain[i] = T_ROCK;
        grid.height[i] += 1.4 + rng.range(0, 1.3);
      }
    }
  }

  // Keep the map crossable: erase rock tiles that form long straight barriers
  // by punching gaps every few tiles along runs.
  for (let gz = 0; gz < N; gz++) {
    let run = 0;
    for (let gx = 0; gx < N; gx++) {
      const i = grid.idx(gx, gz);
      if (grid.terrain[i] === T_ROCK) {
        run++;
        if (run > 4) {
          grid.terrain[i] = T_DRY;
          grid.height[i] -= 1.2;
          run = 0;
        }
      } else run = 0;
    }
  }
  for (let gx = 0; gx < N; gx++) {
    let run = 0;
    for (let gz = 0; gz < N; gz++) {
      const i = grid.idx(gx, gz);
      if (grid.terrain[i] === T_ROCK) {
        run++;
        if (run > 4) {
          grid.terrain[i] = T_DRY;
          grid.height[i] -= 1.2;
          run = 0;
        }
      } else run = 0;
    }
  }

  // The water plane spans the whole map, so any land that dips below it would
  // be flooded from the inside. Lift every land tile clear of the waterline
  // after all the height passes have had their say.
  for (let i = 0; i < grid.height.length; i++) {
    const t = grid.terrain[i];
    if (t === T_DEEP || t === T_SHALLOW) continue;
    if (grid.height[i] < LAND_MIN_HEIGHT) grid.height[i] = LAND_MIN_HEIGHT;
  }

  // --- Guarantee the two settlements can reach each other -------------------
  // BFS over what land units can walk (everything except deep water and rock);
  // if the enemy is cut off, carve a corridor along the straight line.
  {
    const walkable = (i: number): boolean =>
      grid.terrain[i] !== T_DEEP && grid.terrain[i] !== T_ROCK;
    const seen = new Uint8Array(NN);
    const queue: number[] = [startTiles[0].gz * N + startTiles[0].gx];
    seen[queue[0]] = 1;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const gx = i % N;
      const gz = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (!seen[ni] && walkable(ni)) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    const goal = startTiles[1].gz * N + startTiles[1].gx;
    if (!seen[goal]) {
      let x = startTiles[0].gx;
      let z = startTiles[0].gz;
      const tx = startTiles[1].gx;
      const tz = startTiles[1].gz;
      while (x !== tx || z !== tz) {
        if (Math.abs(tx - x) > Math.abs(tz - z)) x += Math.sign(tx - x);
        else z += Math.sign(tz - z);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const gx = x + dx;
            const gz = z + dz;
            if (!grid.inBounds(gx, gz)) continue;
            const i = grid.idx(gx, gz);
            if (grid.terrain[i] === T_ROCK) {
              grid.terrain[i] = T_DRY;
              grid.height[i] = Math.max(LAND_MIN_HEIGHT, grid.height[i] - 1.6);
            } else if (grid.terrain[i] === T_DEEP) {
              grid.terrain[i] = T_SHALLOW;
              grid.height[i] = -0.3;
            }
          }
        }
      }
    }
  }

  // --- Resource placement ---------------------------------------------------
  const occupiedByNode = new Uint8Array(NN);

  const tileFree = (gx: number, gz: number, allowWater = false): boolean => {
    if (!grid.inBounds(gx, gz)) return false;
    const i = grid.idx(gx, gz);
    if (occupiedByNode[i]) return false;
    const t = grid.terrain[i];
    if (allowWater) return t === T_SHALLOW || t === T_DEEP;
    return t !== T_ROCK && t !== T_DEEP && t !== T_SHALLOW;
  };

  const placeCluster = (
    type: NodeTypeId,
    cgx: number,
    cgz: number,
    count: number,
    spread: number,
    blocks: boolean,
    water = false,
  ): number => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * spread;
      const gx = Math.round(cgx + Math.cos(a) * r);
      const gz = Math.round(cgz + Math.sin(a) * r);
      if (!tileFree(gx, gz, water)) continue;
      // Never seal a base in.
      if (blocks && nearStart(gx, gz, 5.5)) continue;
      occupiedByNode[grid.idx(gx, gz)] = 1;
      if (blocks) grid.blocked[grid.idx(gx, gz)] = 1;
      const jx = grid.worldX(gx) + rng.spread(0.45);
      const jz = grid.worldZ(gz) + rng.spread(0.45);
      nodes.push(makeNode(type, jx, jz, rng));
      placed++;
    }
    return placed;
  };

  // Guaranteed starting kit around each base, mirrored for fairness.
  const kit: { type: NodeTypeId; count: number; spread: number; dist: number; blocks: boolean }[] = [
    { type: 'berry', count: 6, spread: 1.8, dist: 7, blocks: false },
    { type: 'tree', count: 14, spread: 3.2, dist: 9, blocks: true },
    { type: 'tree', count: 12, spread: 3.0, dist: 10, blocks: true },
    { type: 'gold', count: 5, spread: 1.6, dist: 10, blocks: true },
    { type: 'stone', count: 4, spread: 1.5, dist: 11, blocks: true },
  ];

  startTiles.forEach((s) => {
    // Fan the kit around the base, angled towards the map centre.
    const toCenter = Math.atan2(N / 2 - s.gz, N / 2 - s.gx);
    kit.forEach((k, ki) => {
      const a = toCenter + (ki - kit.length / 2) * 0.85;
      let gx = Math.round(s.gx + Math.cos(a) * k.dist);
      let gz = Math.round(s.gz + Math.sin(a) * k.dist);
      gx = clamp(gx, 3, N - 4);
      gz = clamp(gz, 3, N - 4);
      // Nudge off water.
      for (let tries = 0; tries < 12 && grid.isWaterTile(gx, gz); tries++) {
        gx = clamp(gx + rng.int(-2, 2), 3, N - 4);
        gz = clamp(gz + rng.int(-2, 2), 3, N - 4);
      }
      placeCluster(k.type, gx, gz, k.count, k.spread, k.blocks);
    });
  });

  // Distance from the nearest settlement, used to make the frontier richer:
  // the further a lode sits from anyone's home, the more it holds.
  const startDistFrac = (gx: number, gz: number): number => {
    const d = Math.min(
      Math.hypot(gx - startTiles[0].gx, gz - startTiles[0].gz),
      Math.hypot(gx - startTiles[1].gx, gz - startTiles[1].gz),
    );
    return clamp(d / (N * 0.5), 0, 1);
  };

  // Neutral resources scattered across the continent.
  const neutral: { type: NodeTypeId; clusters: number; count: number; spread: number; blocks: boolean }[] = [
    { type: 'tree', clusters: 60, count: 10, spread: 3.2, blocks: true },
    { type: 'berry', clusters: 15, count: 5, spread: 1.8, blocks: false },
    { type: 'gold', clusters: 14, count: 5, spread: 1.7, blocks: true },
    { type: 'stone', clusters: 12, count: 4, spread: 1.6, blocks: true },
  ];
  for (const n of neutral) {
    for (let c = 0; c < n.clusters; c++) {
      let gx = 0;
      let gz = 0;
      let ok = false;
      for (let t = 0; t < 40; t++) {
        gx = rng.int(4, N - 5);
        gz = rng.int(4, N - 5);
        if (grid.isWaterTile(gx, gz)) continue;
        if (grid.terrain[grid.idx(gx, gz)] === T_ROCK) continue;
        if (nearStart(gx, gz, 12)) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      let count = n.count;
      if (n.type === 'tree') {
        count = Math.round(count * BIOMES[BIOME_BY_INDEX[biomes[grid.idx(gx, gz)]]].woods);
      }
      // Frontier bonus: remote clusters run deeper.
      count += Math.round(startDistFrac(gx, gz) * (n.type === 'tree' ? 4 : 3));
      if (count > 0) placeCluster(n.type, gx, gz, count, n.spread, n.blocks);
    }
  }

  // Fish shoals in the water — around the coasts and the islands.
  for (let c = 0; c < 26; c++) {
    let gx = 0;
    let gz = 0;
    let ok = false;
    for (let t = 0; t < 60; t++) {
      gx = rng.int(1, N - 2);
      gz = rng.int(1, N - 2);
      const tt = grid.terrain[grid.idx(gx, gz)];
      if (tt !== T_SHALLOW && tt !== T_DEEP) continue;
      ok = true;
      break;
    }
    if (ok) placeCluster('fish', gx, gz, 4, 2.2, false, true);
  }

  // --- Encounters ------------------------------------------------------------
  // Everything spawns on the mainland, clear of both settlements and of each
  // other, so striking out from home always turns something up.
  const encounters: EncounterSpawn[] = [];
  const placeEncounters = (kind: EncounterKind, want: number, minStartDist: number): void => {
    let placed = 0;
    for (let t = 0; t < want * 60 && placed < want; t++) {
      const gx = rng.int(8, N - 9);
      const gz = rng.int(8, N - 9);
      const i = grid.idx(gx, gz);
      if (comp[i] !== mainComp) continue;
      if (grid.terrain[i] === T_ROCK || grid.isWaterTile(gx, gz)) continue;
      if (occupiedByNode[i]) continue;
      if (coast[i] < 3) continue;
      if (nearStart(gx, gz, minStartDist)) continue;
      const x = grid.worldX(gx);
      const z = grid.worldZ(gz);
      if (encounters.some((e) => Math.hypot(e.x - x, e.z - z) < 9 * TILE)) continue;
      encounters.push({ kind, x, z });
      placed++;
    }
  };
  placeEncounters('bandits', 7, 26);
  placeEncounters('wolves', 8, 22);
  placeEncounters('boars', 10, 14);
  placeEncounters('deer', 8, 12);
  placeEncounters('treasure', 12, 16);
  placeEncounters('wanderer', 4, 18);
  placeEncounters('merchant', 3, 18);

  // --- Decorative scatter ---------------------------------------------------
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const i = grid.idx(gx, gz);
      const t = grid.terrain[i];
      if (occupiedByNode[i]) continue;
      const bio = BIOMES[BIOME_BY_INDEX[biomes[i]]];
      const wx = grid.worldX(gx) + rng.spread(0.8);
      const wz = grid.worldZ(gz) + rng.spread(0.8);
      const sea = coast[i];

      if (t === T_SHALLOW && rng.bool(0.05)) {
        decorations.push({ kind: 'reed', x: wx, z: wz, scale: rng.range(0.7, 1.2), rot: rng.range(0, 6.28) });
      } else if (t === T_SAND && sea >= 0 && sea < 5 && rng.bool(bio.palm)) {
        decorations.push({ kind: 'palm', x: wx, z: wz, scale: rng.range(0.85, 1.3), rot: rng.range(0, 6.28) });
      } else if (t === T_SAND) {
        // Open sand carries its own small litter: stones and dry tufts.
        const r = rng.next();
        if (r < 0.02) {
          decorations.push({ kind: 'rock', x: wx, z: wz, scale: rng.range(0.35, 0.8), rot: rng.range(0, 6.28) });
        } else if (r < 0.05) {
          decorations.push({ kind: 'grass', x: wx, z: wz, scale: rng.range(0.55, 1.0), rot: rng.range(0, 6.28) });
        }
      } else if ((t === T_GRASS || t === T_DRY) && !nearStart(gx, gz, 4)) {
        // One roll walked through the biome's weights, heaviest cover last.
        const r = rng.next();
        let acc = bio.olive;
        if (r < acc) {
          decorations.push({ kind: 'olive', x: wx, z: wz, scale: rng.range(0.8, 1.25), rot: rng.range(0, 6.28) });
        } else if (r < (acc += bio.cypress)) {
          decorations.push({ kind: 'cypress', x: wx, z: wz, scale: rng.range(0.85, 1.35), rot: rng.range(0, 6.28) });
        } else if (r < (acc += bio.grass)) {
          decorations.push({ kind: 'grass', x: wx, z: wz, scale: rng.range(0.7, 1.3), rot: rng.range(0, 6.28) });
        } else if (r < acc + bio.rock) {
          decorations.push({ kind: 'rock', x: wx, z: wz, scale: rng.range(0.6, 1.4), rot: rng.range(0, 6.28) });
        }
      } else if (t === T_ROCK && rng.bool(0.25)) {
        decorations.push({ kind: 'rock', x: wx, z: wz, scale: rng.range(0.9, 1.8), rot: rng.range(0, 6.28) });
      }
    }
  }

  // Weathered ruins as landmarks for the explorer.
  for (let i = 0; i < 16; i++) {
    for (let t = 0; t < 30; t++) {
      const gx = rng.int(6, N - 7);
      const gz = rng.int(6, N - 7);
      const idx = grid.idx(gx, gz);
      if (grid.isWaterTile(gx, gz) || grid.terrain[idx] === T_ROCK) continue;
      if (occupiedByNode[idx] || nearStart(gx, gz, 12)) continue;
      decorations.push({
        kind: 'ruin',
        x: grid.worldX(gx),
        z: grid.worldZ(gz),
        scale: rng.range(0.9, 1.3),
        rot: rng.range(0, 6.28),
      });
      break;
    }
  }

  return { biome, biomes, grid, nodes, decorations, starts, encounters, seed };
}

/** World-space extent helper for the minimap and camera clamping. */
export const WORLD_EXTENT = (GRID_SIZE * TILE) / 2;
