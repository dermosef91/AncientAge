import type { BufferGeometry } from 'three';
import { GeoBuilder, mixHex, shade } from './geo';
import { C } from './palette';
import type { NodeTypeId, ResourceKind } from '../sim/types';

const cache = new Map<string, BufferGeometry>();

function cached(key: string, make: (b: GeoBuilder) => void): BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new GeoBuilder();
  make(b);
  const geo = b.build();
  cache.set(key, geo);
  return geo;
}

/** ---------------------------------------------------------------------------
 * Trees
 * ------------------------------------------------------------------------- */
function palm(b: GeoBuilder, tall: boolean): void {
  const h = tall ? 3.1 : 2.4;
  const lean = tall ? 0.1 : 0.16;
  // Segmented, slightly leaning trunk.
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const t = i / seg;
    const y = t * h;
    const r = 0.15 - t * 0.05;
    b.cylinder(Math.sin(t * 1.6) * lean, y + h / seg / 2, 0, r * 0.9, r, h / seg + 0.02, mixHex(C.palmTrunk, C.woodLight, t * 0.4), 6);
  }
  const tx = Math.sin(1.6) * lean;
  // Fronds.
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const droop = -0.42 - (i % 2) * 0.16;
    const len = 1.25 + (i % 3) * 0.15;
    b.box(
      tx + Math.cos(a) * len * 0.42,
      h + 0.12 + Math.sin(droop) * len * 0.3,
      Math.sin(a) * len * 0.42,
      len,
      0.07,
      0.4,
      i % 2 ? C.palmLeaf : C.palmLeafDark,
      -a,
      0,
      droop,
    );
  }
  b.sphere(tx, h + 0.12, 0, 0.2, shade(C.palmTrunk, 0.9), 6);
  // Dates.
  b.sphere(tx + 0.12, h - 0.05, 0.1, 0.11, 0xc47c3a, 5);
}

function oliveTree(b: GeoBuilder): void {
  b.cylinder(0, 0.55, 0, 0.16, 0.26, 1.1, C.oliveTrunk, 6);
  b.box(0.1, 1.15, 0, 0.14, 0.5, 0.14, C.oliveTrunk, 0, 0, -0.3);
  b.box(-0.12, 1.2, 0.05, 0.13, 0.45, 0.13, C.oliveTrunk, 0, 0, 0.35);
  b.sphere(0, 1.62, 0, 0.78, C.oliveLeaf, 7, 0.72);
  b.sphere(-0.5, 1.4, 0.22, 0.5, shade(C.oliveLeaf, 0.9), 6, 0.75);
  b.sphere(0.48, 1.5, -0.2, 0.46, shade(C.oliveLeaf, 1.06), 6, 0.75);
  b.sphere(0.1, 2.05, 0.14, 0.42, shade(C.oliveLeaf, 1.1), 6, 0.7);
}

function pineTree(b: GeoBuilder): void {
  b.cylinder(0, 0.5, 0, 0.13, 0.2, 1.0, C.oliveTrunk, 6);
  b.cone(0, 0.95, 0, 0.85, 1.25, C.cypress, 7);
  b.cone(0, 1.75, 0, 0.66, 1.0, shade(C.cypress, 1.1), 7);
  b.cone(0, 2.42, 0, 0.42, 0.75, shade(C.cypress, 1.18), 7);
}

function cypressTree(b: GeoBuilder): void {
  b.cylinder(0, 0.28, 0, 0.11, 0.16, 0.55, C.oliveTrunk, 6);
  b.cylinder(0, 1.55, 0, 0.16, 0.62, 2.3, C.cypressDark, 7);
  b.cone(0, 2.55, 0, 0.34, 0.75, C.cypress, 7);
}

/** ---------------------------------------------------------------------------
 * Resource nodes
 * ------------------------------------------------------------------------- */
function berryBush(b: GeoBuilder): void {
  b.sphere(0, 0.42, 0, 0.62, C.bush, 7, 0.8);
  b.sphere(-0.35, 0.32, 0.2, 0.36, shade(C.bush, 0.9), 6, 0.8);
  b.sphere(0.3, 0.34, -0.22, 0.34, shade(C.bush, 1.08), 6, 0.8);
  const spots: [number, number, number][] = [
    [0.3, 0.62, 0.22],
    [-0.28, 0.58, -0.24],
    [0.05, 0.86, 0.05],
    [-0.4, 0.4, 0.34],
    [0.42, 0.44, -0.06],
    [0.12, 0.5, 0.5],
  ];
  for (const [x, y, z] of spots) b.sphere(x, y, z, 0.1, C.berry, 5);
}

function goldDeposit(b: GeoBuilder, variant: number): void {
  b.rock(0, 0.34, 0, 0.72, C.goldRock, variant, 0);
  b.rock(-0.55, 0.22, 0.32, 0.42, shade(C.goldRock, 0.9), variant + 1, 0);
  b.rock(0.5, 0.2, -0.3, 0.36, shade(C.goldRock, 1.06), variant + 2, 0);
  // Exposed veins.
  b.rock(0.1, 0.66, 0.12, 0.24, C.goldOre, variant + 3, 0);
  b.rock(-0.3, 0.44, -0.28, 0.18, C.goldOre, variant + 5, 0);
  b.rock(0.42, 0.4, 0.3, 0.15, shade(C.goldOre, 1.1), variant + 4, 0);
}

function stoneDeposit(b: GeoBuilder, variant: number): void {
  b.rock(0, 0.36, 0, 0.78, C.stoneRock, variant, 0);
  b.rock(-0.58, 0.24, 0.3, 0.46, shade(C.stoneRock, 1.1), variant + 1, 0);
  b.rock(0.52, 0.26, -0.34, 0.42, shade(C.stoneRock, 0.9), variant + 2, 0);
  b.rock(0.16, 0.72, -0.1, 0.3, C.stoneOre, variant + 3, 0);
  b.box(-0.2, 0.16, 0.6, 0.5, 0.3, 0.42, shade(C.stoneOre, 1.05), 0.6);
}

function fishShoal(b: GeoBuilder): void {
  const fish: [number, number, number][] = [
    [0, 0, 0],
    [0.55, 0.02, 0.3],
    [-0.45, -0.01, 0.4],
    [0.2, 0.01, -0.5],
  ];
  for (let i = 0; i < fish.length; i++) {
    const [x, y, z] = fish[i];
    const a = i * 1.3;
    b.sphere(x, y + 0.06, z, 0.2, 0x4a6f8a, 6, 0.45);
    b.cone(x - Math.cos(a) * 0.24, y + 0.06, z - Math.sin(a) * 0.24, 0.11, 0.2, 0x3d5c73, 5, a);
    b.box(x, y + 0.16, z, 0.06, 0.12, 0.16, 0x5c839e, a);
  }
}

/** ---------------------------------------------------------------------------
 * Scenery
 * ------------------------------------------------------------------------- */
function grassTuft(b: GeoBuilder): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    b.box(Math.cos(a) * 0.13, 0.16, Math.sin(a) * 0.13, 0.07, 0.36, 0.07, i % 2 ? C.grassDry : C.grass, a, 0, Math.cos(a) * 0.32);
  }
  b.box(0, 0.2, 0, 0.08, 0.42, 0.08, C.grass);
}

function smallRock(b: GeoBuilder): void {
  b.rock(0, 0.2, 0, 0.44, C.rock, 1, 0);
  b.rock(0.32, 0.12, 0.2, 0.24, C.rockLight, 3, 0);
  b.rock(-0.26, 0.1, -0.18, 0.2, C.rockDark, 5, 0);
}

function reeds(b: GeoBuilder): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 0.12 + (i % 3) * 0.08;
    b.box(Math.cos(a) * r, 0.4, Math.sin(a) * r, 0.05, 0.8 + (i % 3) * 0.2, 0.05, i % 2 ? 0x7f9a55 : 0x93a862, 0, 0, Math.cos(a) * 0.2);
    b.box(Math.cos(a) * r * 1.4, 0.86 + (i % 3) * 0.2, Math.sin(a) * r * 1.4, 0.07, 0.2, 0.07, 0xa88f5a);
  }
}

function ruin(b: GeoBuilder): void {
  b.boxOn(0, 0, 0, 3.0, 0.22, 2.2, C.limestoneDark);
  for (let i = 0; i < 4; i++) {
    const x = -1.1 + i * 0.74;
    const h = [1.5, 0.7, 1.2, 0.35][i];
    b.column(x, 0.22, -0.6, 0.16, 0.19, h, C.limestoneShade, 8);
    if (h > 1) b.cylinder(x, 0.22 + h + 0.06, -0.6, 0.24, 0.19, 0.12, C.limestoneShade, 8);
  }
  b.boxOn(0.5, 0.22, 0.65, 1.6, 0.4, 0.5, C.limestoneShade, 0.2);
  b.cylinder(-1.0, 0.35, 0.7, 0.2, 0.2, 1.1, C.limestoneDark, 8, 0, 0.4, Math.PI / 2);
  b.rock(1.3, 0.3, 0.2, 0.34, C.rock, 2);
}

/** ---------------------------------------------------------------------------
 * Carried resources (held above the villager's shoulder)
 * ------------------------------------------------------------------------- */
function carry(b: GeoBuilder, res: ResourceKind): void {
  switch (res) {
    case 'wood':
      b.box(0, 0, 0, 0.16, 0.16, 0.75, C.wood, 0.2);
      b.box(0.02, 0.14, 0.04, 0.14, 0.14, 0.7, C.woodLight, -0.15);
      break;
    case 'food':
      b.sphere(0, 0.04, 0, 0.19, C.thatch, 6, 0.8);
      b.sphere(0.1, 0.16, 0.06, 0.1, C.berry, 5);
      b.sphere(-0.08, 0.16, -0.05, 0.09, C.crop, 5);
      break;
    case 'gold':
      b.box(0, 0, 0, 0.3, 0.16, 0.24, C.woodDark);
      b.rock(0.02, 0.14, 0, 0.13, C.goldOre, 1);
      b.rock(-0.09, 0.12, 0.05, 0.09, C.gold, 3);
      break;
    case 'stone':
      b.rock(0, 0.02, 0, 0.2, C.stoneOre, 2);
      b.rock(0.12, 0.14, -0.04, 0.13, C.rockLight, 4);
      break;
  }
}

/** ---------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */
export function nodeModel(type: NodeTypeId, variant: number): BufferGeometry {
  const v = variant & 3;
  switch (type) {
    case 'tree':
      return cached(`tree${v}`, (b) => {
        if (v === 0) palm(b, false);
        else if (v === 1) palm(b, true);
        else if (v === 2) oliveTree(b);
        else pineTree(b);
      });
    case 'berry':
      return cached('berry', berryBush);
    case 'gold':
      return cached(`gold${v}`, (b) => goldDeposit(b, v));
    case 'stone':
      return cached(`stone${v}`, (b) => stoneDeposit(b, v));
    case 'fish':
      return cached('fish', fishShoal);
    default:
      return cached('empty', () => {});
  }
}

export type DecorationKind = 'palm' | 'olive' | 'cypress' | 'rock' | 'grass' | 'reed' | 'ruin';

export function decorationModel(kind: DecorationKind): BufferGeometry {
  switch (kind) {
    case 'palm':
      return cached('decPalm', (b) => palm(b, false));
    case 'olive':
      return cached('decOlive', oliveTree);
    case 'cypress':
      return cached('decCypress', cypressTree);
    case 'rock':
      return cached('decRock', smallRock);
    case 'grass':
      return cached('decGrass', grassTuft);
    case 'reed':
      return cached('decReed', reeds);
    case 'ruin':
      return cached('decRuin', ruin);
  }
}

export function carryModel(res: ResourceKind): BufferGeometry {
  return cached(`carry-${res}`, (b) => carry(b, res));
}

/** Scaffolding shown around a construction site. */
export function scaffoldModel(): BufferGeometry {
  return cached('scaffold', (b) => {
    const r = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      b.column(x, 0, z, 0.06, 0.07, 1.6, C.woodLight, 5);
      b.box(x * 0.7, 0.7, z * 0.7, 0.1, 0.1, 0.1, C.woodDark);
    }
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      const x0 = Math.cos(a0) * r;
      const z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r;
      const z1 = Math.sin(a1) * r;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(x1 - x0, z1 - z0);
      b.box(mx, 1.15, mz, 0.06, 0.06, len, C.woodLight, ang);
      b.box(mx, 0.55, mz, 0.05, 0.05, len, C.wood, ang);
    }
  });
}

export function clearPropCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
