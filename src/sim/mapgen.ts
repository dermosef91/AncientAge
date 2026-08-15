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
 * middle of the island.
 */
const LAND_MIN_HEIGHT = 0.16;

export interface Decoration {
  kind: 'palm' | 'olive' | 'cypress' | 'rock' | 'grass' | 'reed' | 'ruin';
  x: number;
  z: number;
  scale: number;
  rot: number;
}

export interface GeneratedMap {
  grid: Grid;
  nodes: ResourceNode[];
  decorations: Decoration[];
  starts: { x: number; z: number }[];
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
 * Builds an L-shaped sea in the north-west, rolling inland terrain, rocky
 * outcrops, and a balanced spread of resources around the two start positions.
 */
export function generateMap(seed: number): GeneratedMap {
  nodeIdCounter = 1;
  const rng = new Rng(seed);
  const { fbm, noise2 } = makeNoise(rng);
  const grid = new Grid();
  const nodes: ResourceNode[] = [];
  const decorations: Decoration[] = [];

  const northOffset = rng.range(0, 100);
  const westOffset = rng.range(0, 100);

  // Distance (in tiles) from the sea; negative inside water.
  const seaField = (gx: number, gz: number): number => {
    const northCoast = 8.5 + Math.sin(gx * 0.16 + northOffset) * 2.6 + fbm(gx * 0.06, 11.3, 3) * 5;
    const westCoast = 9.5 + Math.cos(gz * 0.13 + westOffset) * 2.4 + fbm(3.7, gz * 0.06, 3) * 5;
    return Math.min(gz - northCoast, gx - westCoast);
  };

  // Start positions: player south-west, enemy north-east, pushed out towards
  // opposite corners so neither settlement is under early pressure. Both stay
  // within reach of the shoreline so docks are meaningful for either side.
  const starts = [
    { x: grid.worldX(18), z: grid.worldZ(59) },
    { x: grid.worldX(59), z: grid.worldZ(18) },
  ];

  const startTiles = starts.map((s) => ({ gx: grid.tileX(s.x), gz: grid.tileZ(s.z) }));

  const nearStart = (gx: number, gz: number, r: number): boolean =>
    startTiles.some((s) => Math.hypot(s.gx - gx, s.gz - gz) < r);

  // --- Height + terrain -----------------------------------------------------
  for (let gz = 0; gz < GRID_SIZE; gz++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const i = grid.idx(gx, gz);
      const sea = seaField(gx, gz);
      let h: number;
      let t: number;

      if (sea < 0) {
        // Water: shelves down away from the beach.
        const depth = clamp(-sea / 9, 0, 1);
        h = -0.25 - depth * 2.0;
        t = sea < -3.2 ? T_DEEP : T_SHALLOW;
      } else {
        const hills = fbm(gx * 0.045, gz * 0.045, 4);
        const detail = fbm(gx * 0.13 + 40, gz * 0.13 + 40, 3);
        h = 0.05 + smoothstep(0, 4, sea) * (0.35 + hills * 1.9 + detail * 0.35);
        // Beaches near the waterline, grass inland with dry patches.
        if (sea < 2.2) t = T_SAND;
        else {
          const dry = fbm(gx * 0.08 + 90, gz * 0.08 + 90, 3);
          t = dry > 0.02 ? T_DRY : T_GRASS;
          if (dry > 0.26 && rng.bool(0.45)) t = T_SAND;
        }
      }

      grid.height[i] = h;
      grid.terrain[i] = t;
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
  for (let gz = 1; gz < GRID_SIZE - 1; gz++) {
    for (let gx = 1; gx < GRID_SIZE - 1; gx++) {
      const i = grid.idx(gx, gz);
      if (grid.terrain[i] === T_DEEP || grid.terrain[i] === T_SHALLOW) continue;
      if (nearStart(gx, gz, 13)) continue;
      if (seaField(gx, gz) < 4) continue;
      const r = ridge(gx, gz);
      if (r > 0.74 && rng.bool(0.8)) {
        grid.terrain[i] = T_ROCK;
        grid.height[i] += 1.4 + rng.range(0, 1.3);
      }
    }
  }

  // Keep the map connected: erase rock tiles that form a full-width barrier by
  // punching gaps every few tiles along long runs.
  for (let gz = 0; gz < GRID_SIZE; gz++) {
    let run = 0;
    for (let gx = 0; gx < GRID_SIZE; gx++) {
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
  for (let gx = 0; gx < GRID_SIZE; gx++) {
    let run = 0;
    for (let gz = 0; gz < GRID_SIZE; gz++) {
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

  // --- Resource placement ---------------------------------------------------
  const occupiedByNode = new Uint8Array(GRID_SIZE * GRID_SIZE);

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

  startTiles.forEach((s, si) => {
    // Fan the kit around the base, angled towards the map centre.
    const toCenter = Math.atan2(GRID_SIZE / 2 - s.gz, GRID_SIZE / 2 - s.gx);
    kit.forEach((k, ki) => {
      const a = toCenter + (ki - kit.length / 2) * 0.85 + (si === 1 ? Math.PI : 0) * 0;
      let gx = Math.round(s.gx + Math.cos(a) * k.dist);
      let gz = Math.round(s.gz + Math.sin(a) * k.dist);
      gx = clamp(gx, 3, GRID_SIZE - 4);
      gz = clamp(gz, 3, GRID_SIZE - 4);
      // Nudge off water.
      for (let tries = 0; tries < 12 && grid.isWaterTile(gx, gz); tries++) {
        gx = clamp(gx + rng.int(-2, 2), 3, GRID_SIZE - 4);
        gz = clamp(gz + rng.int(-2, 2), 3, GRID_SIZE - 4);
      }
      placeCluster(k.type, gx, gz, k.count, k.spread, k.blocks);
    });
  });

  // Neutral resources scattered across the rest of the map.
  const neutral: { type: NodeTypeId; clusters: number; count: number; spread: number; blocks: boolean }[] = [
    { type: 'tree', clusters: 16, count: 11, spread: 3.1, blocks: true },
    { type: 'berry', clusters: 4, count: 5, spread: 1.8, blocks: false },
    { type: 'gold', clusters: 4, count: 5, spread: 1.7, blocks: true },
    { type: 'stone', clusters: 4, count: 4, spread: 1.6, blocks: true },
  ];
  for (const n of neutral) {
    for (let c = 0; c < n.clusters; c++) {
      let gx = 0;
      let gz = 0;
      let ok = false;
      for (let t = 0; t < 40; t++) {
        gx = rng.int(4, GRID_SIZE - 5);
        gz = rng.int(4, GRID_SIZE - 5);
        if (grid.isWaterTile(gx, gz)) continue;
        if (grid.terrain[grid.idx(gx, gz)] === T_ROCK) continue;
        if (nearStart(gx, gz, 12)) continue;
        ok = true;
        break;
      }
      if (ok) placeCluster(n.type, gx, gz, n.count, n.spread, n.blocks);
    }
  }

  // Fish shoals in shallow water, biased towards each player's nearest shore.
  for (let c = 0; c < 9; c++) {
    let gx = 0;
    let gz = 0;
    let ok = false;
    for (let t = 0; t < 60; t++) {
      gx = rng.int(1, GRID_SIZE - 2);
      gz = rng.int(1, GRID_SIZE - 2);
      const tt = grid.terrain[grid.idx(gx, gz)];
      if (tt !== T_SHALLOW && tt !== T_DEEP) continue;
      ok = true;
      break;
    }
    if (ok) placeCluster('fish', gx, gz, 4, 2.2, false, true);
  }

  // --- Decorative scatter ---------------------------------------------------
  for (let gz = 0; gz < GRID_SIZE; gz++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const i = grid.idx(gx, gz);
      const t = grid.terrain[i];
      if (occupiedByNode[i]) continue;
      const wx = grid.worldX(gx) + rng.spread(0.8);
      const wz = grid.worldZ(gz) + rng.spread(0.8);
      const sea = seaField(gx, gz);

      if (t === T_SHALLOW && rng.bool(0.05)) {
        decorations.push({ kind: 'reed', x: wx, z: wz, scale: rng.range(0.7, 1.2), rot: rng.range(0, 6.28) });
      } else if (t === T_SAND && sea >= 0 && sea < 4 && rng.bool(0.045)) {
        decorations.push({ kind: 'palm', x: wx, z: wz, scale: rng.range(0.85, 1.3), rot: rng.range(0, 6.28) });
      } else if ((t === T_GRASS || t === T_DRY) && !nearStart(gx, gz, 4)) {
        const r = rng.next();
        if (r < 0.035) {
          decorations.push({ kind: 'olive', x: wx, z: wz, scale: rng.range(0.8, 1.25), rot: rng.range(0, 6.28) });
        } else if (r < 0.05) {
          decorations.push({ kind: 'cypress', x: wx, z: wz, scale: rng.range(0.85, 1.35), rot: rng.range(0, 6.28) });
        } else if (r < 0.16) {
          decorations.push({ kind: 'grass', x: wx, z: wz, scale: rng.range(0.7, 1.3), rot: rng.range(0, 6.28) });
        } else if (r < 0.195) {
          decorations.push({ kind: 'rock', x: wx, z: wz, scale: rng.range(0.6, 1.4), rot: rng.range(0, 6.28) });
        }
      } else if (t === T_ROCK && rng.bool(0.25)) {
        decorations.push({ kind: 'rock', x: wx, z: wz, scale: rng.range(0.9, 1.8), rot: rng.range(0, 6.28) });
      }
    }
  }

  // A couple of weathered ruins as landmarks.
  for (let i = 0; i < 5; i++) {
    for (let t = 0; t < 30; t++) {
      const gx = rng.int(6, GRID_SIZE - 7);
      const gz = rng.int(6, GRID_SIZE - 7);
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

  return { grid, nodes, decorations, starts, seed };
}

/** World-space extent helper for the minimap and camera clamping. */
export const WORLD_EXTENT = (GRID_SIZE * TILE) / 2;
