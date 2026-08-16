import type { BufferGeometry } from 'three';
import { GeoBuilder, mixHex, shade } from './geo';
import { C } from './palette';
import { FACTIONS } from '../sim/data';
import { TILE } from '../sim/grid';
import type { BuildingTypeId, FactionId } from '../sim/types';

export interface FlagAnchor {
  x: number;
  y: number;
  z: number;
  scale: number;
  color: number;
}

export interface BuildingModel {
  geo: BufferGeometry;
  /** Height used for health bars and selection feedback. */
  height: number;
  flags: FlagAnchor[];
  /** Radius of the construction scaffold ring. */
  footprint: number;
}

interface Style {
  wall: number;
  wallDark: number;
  wallLight: number;
  roof: number;
  roofDark: number;
  accent: number;
  trim: number;
  base: number;
  column: number;
  door: number;
}

function styleFor(f: FactionId): Style {
  const col = FACTIONS[f].colors;
  if (f === 'egypt') {
    return {
      wall: C.mudbrick,
      wallDark: C.mudbrickDark,
      wallLight: C.mudbrickLight,
      roof: C.mudbrickDark,
      roofDark: shade(C.mudbrickDark, 0.88),
      accent: col.accent,
      trim: C.gold,
      base: C.sandstone,
      column: C.sandstone,
      door: 0x4a3a2a,
    };
  }
  if (f === 'greece') {
    return {
      wall: C.limestone,
      wallDark: C.limestoneShade,
      wallLight: C.marble,
      roof: col.roof,
      roofDark: shade(col.roof, 0.8),
      accent: col.accent,
      trim: C.marble,
      base: C.limestoneDark,
      column: C.marble,
      door: 0x3d3b34,
    };
  }
  return {
    wall: 0xefe6d2,
    wallDark: C.limestoneShade,
    wallLight: C.marble,
    roof: C.terracotta,
    roofDark: C.terracottaDark,
    accent: col.accent,
    trim: 0xe4d5b7,
    base: C.limestoneDark,
    column: 0xf2ecdc,
    door: 0x4a352a,
  };
}

/**
 * Painted cornice band + corner pilasters. Gives Egyptian mud-brick blocks
 * the horizontal banding and vertical reeding they need to read correctly.
 */
function egyptTrim(
  b: GeoBuilder,
  s: Style,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  pilasters = true,
): void {
  // Painted band just below the parapet.
  b.boxOn(x, y + h - 0.42, z, w + 0.05, 0.2, d + 0.05, s.accent);
  b.boxOn(x, y + h - 0.22, z, w + 0.06, 0.09, d + 0.06, s.trim);
  if (!pilasters) return;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.boxOn(x + (sx * w) / 2, y, z + (sz * d) / 2, 0.24, h - 0.42, 0.24, s.wallLight);
    }
  }
}

/** Simple pole; the cloth itself is a separate animated mesh. */
function pole(b: GeoBuilder, x: number, y: number, z: number, h: number): void {
  b.column(x, y, z, 0.055, 0.07, h, C.woodDark, 6);
  b.sphere(x, y + h + 0.06, z, 0.1, C.bronze, 6);
}

function crenellations(b: GeoBuilder, x: number, y: number, z: number, w: number, d: number, color: number, step = 0.6): void {
  const n = Math.max(2, Math.floor(w / step));
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue;
    const px = x - w / 2 + (i + 0.5) * (w / n);
    b.boxOn(px, y, z - d / 2 + 0.11, w / n - 0.06, 0.34, 0.22, color);
    b.boxOn(px, y, z + d / 2 - 0.11, w / n - 0.06, 0.34, 0.22, color);
  }
  const m = Math.max(2, Math.floor(d / step));
  for (let i = 0; i < m; i++) {
    if (i % 2 === 1) continue;
    const pz = z - d / 2 + (i + 0.5) * (d / m);
    b.boxOn(x - w / 2 + 0.11, y, pz, 0.22, 0.34, d / m - 0.06, color);
    b.boxOn(x + w / 2 - 0.11, y, pz, 0.22, 0.34, d / m - 0.06, color);
  }
}

function columnRow(
  b: GeoBuilder,
  x: number,
  y: number,
  z: number,
  count: number,
  spacing: number,
  h: number,
  r: number,
  color: number,
  alongZ = false,
): void {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spacing;
    const px = alongZ ? x : x + off;
    const pz = alongZ ? z + off : z;
    // Doric-ish: shaft, flared capital, square abacus.
    b.column(px, y, pz, r * 0.86, r, h - 0.24, color, 8);
    b.column(px, y + h - 0.24, pz, r * 1.25, r * 0.9, 0.12, color, 8);
    b.boxOn(px, y + h - 0.12, pz, r * 2.9, 0.12, r * 2.9, color);
  }
}

/** Arch built from wedge blocks - reads far better than a plain torus. */
function archBand(
  b: GeoBuilder,
  x: number,
  y: number,
  z: number,
  r: number,
  thickness: number,
  depth: number,
  color: number,
  keyColor: number,
  seg = 9,
): void {
  for (let i = 0; i < seg; i++) {
    const a = Math.PI * ((i + 0.5) / seg);
    const cx = x - Math.cos(a) * r;
    const cy = y + Math.sin(a) * r;
    const w = (Math.PI * r) / seg + 0.07;
    const isKey = i === (seg - 1) >> 1;
    b.box(cx, cy, z, w, thickness, depth, isKey ? keyColor : color, 0, 0, a - Math.PI / 2);
  }
}

/** Triangular gable face, stacked from thin slabs so it reads as masonry. */
function pediment(
  b: GeoBuilder,
  s: Style,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  thickness = 0.22,
): void {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const t2 = (i + 1) / steps;
    const width = w * (1 - t2) + w * 0.05;
    if (width < 0.12) continue;
    b.boxOn(x, y + t * h, z, width, h / steps + 0.015, thickness, i === 0 ? s.wallLight : s.wall);
  }
}

/**
 * Pitched tile roof: a base slab per side, overlapping tile courses running
 * down the pitch, a ridge cap, eave fascia and (optionally) gable pediments.
 */
function tiledRoof(
  b: GeoBuilder,
  s: Style,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  overhang = 0.32,
  ends = true,
): void {
  const W = w + overhang * 2;
  const D = d + overhang * 2;
  const slope = Math.atan2(h, W / 2);
  const len = Math.hypot(W / 2, h);
  const cs = Math.cos(slope);
  const sn = Math.sin(slope);
  const rows = Math.max(3, Math.round(len / 0.75));

  for (const side of [-1, 1]) {
    b.box(x + (side * W) / 4, y + h / 2, z, len, 0.14, D, s.roofDark, 0, 0, -side * slope);
    for (let i = 0; i < rows; i++) {
      const u = ((i + 0.5) / rows) * len;
      const px = x + side * cs * u + side * sn * 0.085;
      const py = y + h - sn * u + cs * 0.085;
      b.box(
        px,
        py,
        z,
        len / rows + 0.03,
        0.1,
        D - 0.04,
        i % 2 ? shade(s.roof, 1.06) : shade(s.roof, 0.84),
        0,
        0,
        -side * slope,
      );
    }
  }
  b.cylinder(x, y + h + 0.07, z, 0.14, 0.14, D + 0.08, s.roofDark, 6, Math.PI / 2);
  for (const sz of [-1, 1]) b.box(x, y - 0.05, z + (sz * D) / 2, W * 0.99, 0.14, 0.11, s.roofDark);
  if (ends) {
    for (const sz of [-1, 1]) pediment(b, s, x, y - 0.02, z + sz * (D / 2 - 0.16), W * 0.97, h);
  }
}

/** ---------------------------------------------------------------------------
 * Town Center
 * ------------------------------------------------------------------------- */
function townCenter(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.3, 0.3, w - 0.3, s.base);
  b.boxOn(0, 0.3, 0, w - 0.9, 0.12, w - 0.9, mixHex(s.base, C.sandLight, 0.5));

  if (f === 'egypt') {
    // Main hall with battered walls and a flat parapet roof.
    b.taper(0, 0.42, 0.6, w - 2.2, w - 3.0, 3.0, s.wall, 0.9);
    egyptTrim(b, s, 0, 0.42, 0.6, w - 2.55, w - 3.35, 3.0);
    b.parapet(0, 3.42, 0.6, w - 2.4, w - 3.2, s.wallDark, 0.34);
    // Pylon towers flanking the entrance.
    for (const sx of [-1, 1]) {
      b.taper(sx * (half - 1.15), 0.42, -half + 1.5, 2.0, 1.7, 3.9, s.wallLight, 0.82);
      b.parapet(sx * (half - 1.15), 4.32, -half + 1.5, 2.1, 1.8, s.accent, 0.24);
      b.boxOn(sx * (half - 1.15), 1.4, -half + 0.72, 1.5, 1.6, 0.12, s.accent);
      b.boxOn(sx * (half - 1.15), 1.4, -half + 0.66, 0.3, 1.6, 0.1, s.trim);
    }
    // Recessed doorway with a painted lintel.
    b.boxOn(0, 0.42, -half + 1.55, 1.9, 2.1, 0.5, s.door);
    b.boxOn(0, 2.5, -half + 1.5, 2.5, 0.36, 0.7, s.accent);
    b.boxOn(0, 2.86, -half + 1.5, 2.7, 0.16, 0.8, s.trim);
    // Cavetto cornice detail.
    b.boxOn(0, 3.2, 0.6, w - 2.0, 0.22, w - 2.8, s.trim);
    flags.push({ x: -half + 1.15, y: 4.9, z: -half + 1.5, scale: 1.1, color: s.accent });
    flags.push({ x: half - 1.15, y: 4.9, z: -half + 1.5, scale: 1.1, color: s.accent });
    pole(b, -half + 1.15, 4.56, -half + 1.5, 1.5);
    pole(b, half - 1.15, 4.56, -half + 1.5, 1.5);
    return 5.4;
  }

  if (f === 'greece') {
    b.steps(0, 0.42, -half + 0.6, w - 1.2, 3, 0.22, 0.5, s.base);
    b.boxOn(0, 0.42, 0.35, w - 2.0, 0.5, w - 2.2, s.wallDark);
    b.boxOn(0, 0.92, 0.35, w - 3.0, 2.4, w - 3.2, s.wall);
    // Peristyle.
    columnRow(b, 0, 0.92, -half + 1.25, 5, (w - 2.4) / 4, 2.9, 0.26, s.column);
    columnRow(b, 0, 0.92, half - 0.9, 5, (w - 2.4) / 4, 2.9, 0.26, s.column);
    columnRow(b, -half + 1.25, 0.92, 0.35, 3, (w - 3.4) / 2, 2.9, 0.26, s.column, true);
    columnRow(b, half - 1.25, 0.92, 0.35, 3, (w - 3.4) / 2, 2.9, 0.26, s.column, true);
    // Entablature + roof.
    b.boxOn(0, 3.82, 0.1, w - 0.4, 0.42, w - 0.6, s.wallLight);
    tiledRoof(b, s, 0, 4.24, 0.1, w - 1.0, w - 1.2, 2.0);
    b.boxOn(0, 1.0, -half + 1.9, 1.6, 2.0, 0.3, s.door);
    flags.push({ x: -half + 0.9, y: 4.5, z: -half + 1.0, scale: 1.0, color: s.accent });
    pole(b, -half + 0.9, 4.16, -half + 1.0, 1.4);
    return 5.6;
  }

  // Rome: two storeys, hipped terracotta roof, arched entry, roadside kerb.
  b.boxOn(0, 0.42, 0.2, w - 1.4, 2.2, w - 1.8, s.wall);
  b.boxOn(0, 2.62, 0.2, w - 2.2, 1.5, w - 2.6, s.wallLight);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.column(sx * (half - 0.85), 0.42, 0.2 + sz * (half - 1.1), 0.22, 0.24, 2.2, s.column, 8);
    }
  }
  tiledRoof(b, s, 0, 4.12, 0.2, w - 1.8, w - 2.2, 1.75);
  b.boxOn(0, 2.42, 0.2, w - 1.2, 0.24, w - 1.6, s.trim);
  // Arched entrance.
  b.arch(0, 1.7, -half + 0.75, 0.95, 0.22, s.trim, 10);
  b.boxOn(0, 0.42, -half + 0.78, 1.7, 1.3, 0.24, s.door);
  b.boxOn(0, 0.3, -half + 1.1, w - 1.0, 0.16, 0.9, C.sandDark);
  // Banners either side of the door.
  for (const sx of [-1, 1]) {
    b.boxOn(sx * 1.5, 1.5, -half + 0.62, 0.5, 1.5, 0.08, s.accent);
    b.boxOn(sx * 1.5, 1.5, -half + 0.56, 0.16, 1.2, 0.06, s.trim);
  }
  flags.push({ x: 0, y: 5.3, z: 0.2, scale: 1.15, color: s.accent });
  pole(b, 0, 4.96, 0.2, 1.5);
  return 5.9;
}

/** ---------------------------------------------------------------------------
 * House
 * ------------------------------------------------------------------------- */
function house(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.4, 0.16, w - 0.4, s.base);
  if (f === 'egypt') {
    b.taper(0, 0.16, 0, w - 1.1, w - 1.1, 1.7, s.wall, 0.92);
    egyptTrim(b, s, 0, 0.16, 0, w - 1.35, w - 1.35, 1.7);
    b.parapet(0, 1.86, 0, w - 1.0, w - 1.0, s.wallDark, 0.24);
    b.boxOn(0, 0.16, -half + 0.6, 0.75, 1.15, 0.16, s.door);
    b.boxOn(0, 1.31, -half + 0.58, 0.95, 0.18, 0.24, s.accent);
    // Small recessed window niches.
    for (const sx of [-1, 1]) b.boxOn(sx * 0.95, 1.0, -half + 0.62, 0.28, 0.36, 0.1, s.door);
    // External stair to the roof.
    for (let i = 0; i < 4; i++) {
      b.boxOn(half - 0.75, 0.16 + i * 0.36, half - 0.5 - i * 0.28, 0.7, 0.36, 0.3, s.wallLight);
    }
    // Reed awning.
    b.boxOn(0, 2.24, 0, w - 1.6, 0.08, w - 2.2, C.thatch);
    return 2.5;
  }
  if (f === 'greece') {
    b.boxOn(0, 0.16, 0, w - 1.0, 1.6, w - 1.2, s.wall);
    tiledRoof(b, s, 0, 1.76, 0, w - 1.0, w - 1.2, 1.05, 0.24);
    b.boxOn(0, 0.16, -half + 0.55, 0.72, 1.1, 0.16, s.door);
    b.boxOn(-0.85, 0.9, -half + 0.56, 0.42, 0.42, 0.1, s.accent);
    b.boxOn(0.85, 0.9, -half + 0.56, 0.42, 0.42, 0.1, s.accent);
    return 2.5;
  }
  b.boxOn(0, 0.16, 0, w - 1.0, 1.5, w - 1.2, s.wall);
  b.boxOn(0, 0.16, 0, w - 0.85, 0.4, w - 1.05, s.wallDark);
  tiledRoof(b, s, 0, 1.66, 0, w - 0.95, w - 1.15, 1.0, 0.24);
  b.boxOn(0, 0.16, -half + 0.55, 0.72, 1.05, 0.16, s.door);
  b.arch(0, 1.24, -half + 0.5, 0.42, 0.09, s.trim, 8);
  void flags;
  return 2.4;
}

/** ---------------------------------------------------------------------------
 * Farm
 * ------------------------------------------------------------------------- */
function farm(b: GeoBuilder, s: Style, f: FactionId, w: number): number {
  if (f === 'egypt') return farmEgypt(b, s, w);
  if (f === 'greece') return farmGreece(b, s, w);
  return farmRome(b, s, w);
}

/**
 * Every farm keeps the same footprint: a worked field at the front and a yard
 * strip across the back holding the outbuilding and its clutter, so nothing
 * ever grows through a wall.
 */
const YARD_DEPTH = 1.9;

/**
 * Egypt: flood basins. Irrigation channels cut the field into wet squares of
 * emmer, a shaduf sweep lifts water onto the beds, and reed baskets stack
 * beside a mudbrick store.
 */
function farmEgypt(b: GeoBuilder, s: Style, w: number): number {
  const half = w / 2;
  const fieldBack = half - YARD_DEPTH;
  const fieldDepth = fieldBack - (-half + 0.3);
  const fieldZ = (-half + 0.3 + fieldBack) / 2;
  b.boxOn(0, 0, 0, w - 0.3, 0.12, w - 0.3, shade(C.sandstone, 0.94));

  // A channel down the middle of the field and one across it.
  b.boxOn(0, 0.02, fieldZ, 0.36, 0.11, fieldDepth, C.waterShallow);
  b.boxOn(0, 0.02, fieldZ, w - 0.7, 0.11, 0.36, C.waterShallow);

  // Four flood basins between the channels, each bunded with mud.
  const bw = (w - 1.1) / 2 - 0.12;
  const bd = fieldDepth / 2 - 0.12;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (bw / 2 + 0.26);
      const cz = fieldZ + sz * (bd / 2 + 0.26);
      b.boxOn(cx, 0.12, cz, bw, 0.09, bd, C.mudbrickDark);
      b.boxOn(cx, 0.21, cz, bw - 0.22, 0.06, bd - 0.22, shade(C.dirt, 0.8));
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const x = cx + (i - 1) * (bw * 0.27);
          const z = cz + (j - 1) * (bd * 0.27);
          b.boxOn(x, 0.27, z, 0.18, 0.42, 0.18, (i + j) % 2 ? C.crop : C.cropDark);
          b.boxOn(x, 0.69, z, 0.1, 0.18, 0.1, C.wheat);
        }
      }
    }
  }

  // Yard: shaduf on the left, store on the right, baskets between.
  const yz = half - YARD_DEPTH / 2 - 0.2;
  const px = -half + 1.1;
  b.column(px, 0.12, yz, 0.1, 0.13, 1.5, C.woodDark, 6);
  b.box(px + 0.6, 1.52, yz, 1.9, 0.1, 0.1, C.wood, 0, 0, -0.34);
  b.sphere(px + 1.4, 1.2, yz, 0.2, C.mudbrickDark, 7);
  b.boxOn(half - 1.15, 0.12, yz, 1.5, 0.9, 1.3, s.wall);
  b.parapet(half - 1.15, 1.02, yz, 1.55, 1.35, s.wallDark, 0.16);
  b.boxOn(half - 1.15, 1.12, yz, 1.3, 0.06, 1.1, C.thatch);
  b.column(half - 2.25, 0.12, yz - 0.1, 0.2, 0.22, 0.32, C.thatch, 7);
  b.column(half - 2.25, 0.44, yz - 0.1, 0.17, 0.2, 0.24, C.thatch, 7);
  return 1.9;
}

/**
 * Greece: a terraced hillside — dry-stone retaining walls holding narrow beds
 * of staked vines, an olive tree in the yard and amphorae for the pressing.
 */
function farmGreece(b: GeoBuilder, s: Style, w: number): number {
  const half = w / 2;
  const fieldFront = -half + 0.3;
  const fieldBack = half - YARD_DEPTH;
  b.boxOn(0, 0, 0, w - 0.3, 0.12, w - 0.3, shade(C.dirt, 0.9));

  // Terraces stepping up towards the back of the plot.
  const terraces = 3;
  const step = (fieldBack - fieldFront) / terraces;
  for (let t = 0; t < terraces; t++) {
    const z0 = fieldFront + t * step;
    const lift = 0.12 + t * 0.2;
    b.boxOn(0, lift, z0 + step / 2, w - 0.9, 0.12, step - 0.1, shade(C.dirt, 0.84));
    // Rubble wall holding the bed back.
    for (let i = 0; i < 7; i++) {
      const x = -half + 0.55 + i * ((w - 1.1) / 6);
      b.rock(x, lift + 0.02, z0 + 0.04, 0.2, C.rockLight, i * 3 + t, 0);
    }
    // Staked vines tied along a running cord.
    for (let i = 0; i < 4; i++) {
      const x = -half + 0.9 + i * ((w - 1.8) / 3);
      const vz = z0 + step * 0.62;
      b.column(x, lift + 0.12, vz, 0.05, 0.06, 0.5, C.woodDark, 5);
      b.sphere(x, lift + 0.72, vz, 0.24, C.oliveLeaf, 6, 0.7);
      b.sphere(x + 0.09, lift + 0.58, vz, 0.14, C.cypressDark, 6, 0.8);
    }
    b.boxOn(0, lift + 0.66, z0 + step * 0.62, w - 1.7, 0.03, 0.03, C.woodLight);
  }

  // Yard: olive tree, store, amphorae.
  const yz = half - YARD_DEPTH / 2 - 0.2;
  b.column(-half + 1.15, 0.12, yz, 0.13, 0.19, 0.8, C.oliveTrunk, 6);
  b.sphere(-half + 1.15, 1.08, yz, 0.6, C.oliveLeaf, 7, 0.72);
  b.sphere(-half + 0.85, 0.95, yz + 0.3, 0.35, shade(C.oliveLeaf, 0.86), 6, 0.8);
  b.boxOn(half - 1.15, 0.12, yz, 1.4, 1.0, 1.25, s.wall);
  tiledRoof(b, s, half - 1.15, 1.12, yz, 1.4, 1.25, 0.5, 0.1, true);
  b.boxOn(half - 1.15, 0.12, yz - 0.66, 0.5, 0.7, 0.1, s.door);
  for (let i = 0; i < 3; i++) {
    b.column(half - 2.15, 0.12, yz - 0.5 + i * 0.45, 0.1, 0.16, 0.4, C.terracotta, 7);
    b.sphere(half - 2.15, 0.54, yz - 0.5 + i * 0.45, 0.1, C.terracottaDark, 6, 0.6);
  }
  return 2.0;
}

/**
 * Rome: a surveyed plot. Ruler-straight furrows inside a dressed-stone
 * boundary, a cart track down the middle and a tiled villa rustica in the yard.
 */
function farmRome(b: GeoBuilder, s: Style, w: number): number {
  const half = w / 2;
  const fieldFront = -half + 0.45;
  const fieldBack = half - YARD_DEPTH;
  b.boxOn(0, 0, 0, w - 0.3, 0.12, w - 0.3, C.dirt);

  // The track the surveyors ran through the middle.
  const trackDepth = fieldBack - fieldFront;
  b.boxOn(0, 0.12, (fieldFront + fieldBack) / 2, 0.5, 0.05, trackDepth, C.path);

  const rows = 6;
  const bw = (w - 1.5) / 2;
  for (let i = 0; i < rows; i++) {
    const z = fieldFront + 0.22 + i * ((trackDepth - 0.44) / (rows - 1));
    for (const sx of [-1, 1]) {
      const cx = sx * (bw / 2 + 0.35);
      b.boxOn(cx, 0.12, z, bw, 0.08, 0.22, shade(C.dirt, 0.84));
      for (let j = 0; j < 3; j++) {
        const x = cx + (j - 1) * (bw * 0.3);
        const t = ((i * 3 + j) % 4) / 4;
        b.boxOn(x, 0.2, z, 0.17, 0.4 + t * 0.12, 0.17, C.crop);
        b.boxOn(x, 0.6 + t * 0.12, z, 0.09, 0.2, 0.09, C.wheat);
      }
    }
  }

  // Dressed-stone boundary rather than a fence.
  for (const sz of [-1, 1]) {
    b.boxOn(0, 0.12, sz * (half - 0.18), w - 0.3, 0.3, 0.18, C.limestoneDark);
    b.boxOn(0, 0.42, sz * (half - 0.18), w - 0.3, 0.06, 0.24, C.limestone);
    b.boxOn(sz * (half - 0.18), 0.12, 0, 0.18, 0.3, w - 0.3, C.limestoneDark);
    b.boxOn(sz * (half - 0.18), 0.42, 0, 0.24, 0.06, w - 0.3, C.limestone);
  }

  // Yard: villa rustica and a parked cart.
  const yz = half - YARD_DEPTH / 2 - 0.2;
  b.boxOn(half - 1.2, 0.12, yz, 1.5, 1.05, 1.3, s.wall);
  b.boxOn(half - 1.2, 0.12, yz, 1.6, 0.28, 1.4, s.wallDark);
  tiledRoof(b, s, half - 1.2, 1.17, yz, 1.5, 1.3, 0.55, 0.12, true);
  b.arch(half - 1.2, 0.5, yz - 0.68, 0.28, 0.06, s.trim, 8);
  b.boxOn(-half + 1.2, 0.34, yz, 1.1, 0.22, 0.6, C.wood);
  for (const sx of [-1, 1]) {
    b.cylinder(-half + 1.2 + sx * 0.45, 0.3, yz, 0.3, 0.3, 0.09, C.woodDark, 9, 0, 0, Math.PI / 2);
  }
  b.column(-half + 1.2, 0.56, yz, 0.05, 0.05, 0.5, C.woodDark, 5);
  return 2.1;
}

/** ---------------------------------------------------------------------------
 * Storehouse
 * ------------------------------------------------------------------------- */
function storehouse(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.3, 0.2, w - 0.3, C.sandDark);
  // Back and side walls, open front.
  b.boxOn(0, 0.2, half - 0.35, w - 0.7, 1.5, 0.3, s.wall);
  b.boxOn(-half + 0.35, 0.2, 0, 0.3, 1.5, w - 0.9, s.wall);
  b.boxOn(half - 0.35, 0.2, 0, 0.3, 1.5, w - 0.9, s.wall);
  // Posts + awning.
  for (const sx of [-1, 1]) b.column(sx * (half - 0.4), 0.2, -half + 0.4, 0.09, 0.1, 1.5, C.woodDark, 6);
  if (f === 'egypt') {
    for (let i = 0; i < 5; i++) {
      b.boxOn(0, 1.62, -w / 2 + 0.4 + i * ((w - 0.8) / 4), w - 0.35, 0.09, 0.12, C.woodDark);
    }
    b.boxOn(0, 1.7, 0, w - 0.4, 0.12, w - 0.4, C.thatch);
    b.boxOn(0, 1.82, 0, w - 0.6, 0.1, w - 0.6, shade(C.thatch, 0.9));
    b.boxOn(0, 1.42, half - 0.35, w - 0.75, 0.16, 0.34, s.accent);
  } else {
    tiledRoof(b, s, 0, 1.7, 0, w - 0.35, w - 0.35, 0.85, 0.3, false);
  }
  // Goods: amphorae, sacks, timber, ore.
  b.column(-1.05, 0.2, 0.5, 0.18, 0.22, 0.55, C.terracottaDark, 7);
  b.column(-0.6, 0.2, 0.75, 0.15, 0.19, 0.45, C.terracotta, 7);
  b.boxOn(0.75, 0.2, 0.55, 0.7, 0.45, 0.55, C.thatch);
  b.boxOn(0.75, 0.65, 0.55, 0.55, 0.3, 0.42, shade(C.thatch, 0.92));
  b.box(0.1, 0.42, -0.55, 1.5, 0.22, 0.22, C.wood, 0.1);
  b.box(0.1, 0.64, -0.55, 1.4, 0.22, 0.22, C.woodLight, -0.08);
  b.rock(-0.9, 0.42, -0.5, 0.28, C.stoneOre, 2);
  b.rock(-1.25, 0.36, -0.75, 0.22, C.goldOre, 5);
  flags.push({ x: -half + 0.4, y: 2.0, z: -half + 0.4, scale: 0.7, color: s.accent });
  pole(b, -half + 0.4, 1.7, -half + 0.4, 1.0);
  return 2.4;
}

/** ---------------------------------------------------------------------------
 * Barracks
 * ------------------------------------------------------------------------- */
function barracks(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.2, 0.22, w - 0.2, C.sandDark);
  // Main hall at the back.
  const hallD = w * 0.5;
  if (f === 'egypt') {
    b.taper(0, 0.22, half - hallD / 2 - 0.2, w - 1.2, hallD, 2.3, s.wall, 0.9);
    egyptTrim(b, s, 0, 0.22, half - hallD / 2 - 0.2, w - 1.55, hallD - 0.32, 2.3);
    b.parapet(0, 2.52, half - hallD / 2 - 0.2, w - 1.1, hallD + 0.15, s.wallDark, 0.3);
    b.boxOn(0, 0.22, half - hallD - 0.14, 1.3, 1.6, 0.18, s.door);
    b.boxOn(0, 1.82, half - hallD - 0.18, 1.7, 0.26, 0.3, s.accent);
  } else {
    b.boxOn(0, 0.22, half - hallD / 2 - 0.2, w - 1.2, 2.0, hallD, s.wall);
    tiledRoof(b, s, 0, 2.22, half - hallD / 2 - 0.2, w - 1.2, hallD, 1.35, 0.28);
    b.boxOn(0, 0.22, half - hallD - 0.14, 1.3, 1.5, 0.18, s.door);
    if (f === 'rome') b.arch(0, 1.72, half - hallD - 0.2, 0.72, 0.14, s.trim, 8);
    else columnRow(b, 0, 0.22, half - hallD - 0.35, 2, 2.2, 2.0, 0.18, s.column);
  }
  // Yard wall with a gate opening at the front.
  const wallH = 0.95;
  b.boxOn(-half + 0.2, 0.22, -0.4, 0.3, wallH, w - 1.6, s.wallDark);
  b.boxOn(half - 0.2, 0.22, -0.4, 0.3, wallH, w - 1.6, s.wallDark);
  for (const sx of [-1, 1]) b.boxOn(sx * (half - 1.0), 0.22, -half + 0.2, 1.6, wallH, 0.3, s.wallDark);
  // Training gear.
  b.column(-1.2, 0.22, -1.4, 0.12, 0.14, 1.3, C.woodDark, 6);
  b.boxOn(-1.2, 1.15, -1.4, 0.9, 0.16, 0.16, C.woodDark);
  b.boxOn(-1.2, 0.9, -1.4, 0.42, 0.5, 0.3, C.thatch);
  // Weapon rack with spears.
  b.boxOn(1.35, 0.22, -1.3, 1.5, 0.14, 0.2, C.wood);
  b.boxOn(1.35, 0.9, -1.3, 1.5, 0.12, 0.16, C.wood);
  for (let i = 0; i < 4; i++) {
    b.column(0.85 + i * 0.34, 0.22, -1.3, 0.045, 0.05, 1.7, C.woodLight, 5);
    b.cone(0.85 + i * 0.34, 1.92, -1.3, 0.075, 0.28, C.iron, 6);
  }
  // Shields on the wall.
  for (let i = 0; i < 3; i++) {
    const x = -1.4 + i * 1.4;
    if (f === 'rome') b.box(x, 1.0, half - 0.55, 0.62, 0.85, 0.1, s.accent);
    else b.cylinder(x, 1.0, half - 0.55, 0.36, 0.36, 0.1, s.accent, 10, Math.PI / 2);
  }
  flags.push({ x: -half + 0.45, y: 2.3, z: -half + 0.45, scale: 0.95, color: s.accent });
  flags.push({ x: half - 0.45, y: 2.3, z: -half + 0.45, scale: 0.95, color: s.accent });
  pole(b, -half + 0.45, 0.22, -half + 0.45, 2.1);
  pole(b, half - 0.45, 0.22, -half + 0.45, 2.1);
  return 3.4;
}

/** ---------------------------------------------------------------------------
 * Archery range
 * ------------------------------------------------------------------------- */
function range(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.2, 0.2, w - 0.2, C.sandDark);
  // Open-fronted shed at the back.
  b.boxOn(0, 0.2, half - 0.9, w - 1.0, 1.7, 1.5, s.wall);
  for (const sx of [-1, 1]) b.column(sx * (w / 2 - 0.9), 0.2, half - 2.0, 0.1, 0.11, 1.7, C.woodDark, 6);
  if (f === 'egypt') {
    b.boxOn(0, 1.9, half - 1.4, w - 0.6, 0.14, 2.6, C.thatch);
    b.boxOn(0, 1.5, half - 1.55, w - 0.8, 0.1, 0.1, C.woodDark);
  } else {
    tiledRoof(b, s, 0, 1.9, half - 1.4, w - 0.9, 2.5, 0.95, 0.26);
  }
  // Target butts.
  for (let i = 0; i < 3; i++) {
    const x = -1.9 + i * 1.9;
    b.column(x, 0.2, -half + 0.9, 0.09, 0.1, 0.85, C.woodDark, 6);
    b.cylinder(x, 1.35, -half + 0.9, 0.44, 0.44, 0.18, C.thatch, 10, Math.PI / 2);
    b.cylinder(x, 1.35, -half + 0.8, 0.3, 0.3, 0.04, C.cloth, 10, Math.PI / 2);
    b.cylinder(x, 1.35, -half + 0.77, 0.14, 0.14, 0.03, s.accent, 8, Math.PI / 2);
    // A couple of spent arrows.
    b.column(x + 0.1, 1.35, -half + 0.7, 0.02, 0.02, 0.5, C.woodLight, 4);
  }
  // Bundled arrows and a bow leaning on the shed.
  for (let i = 0; i < 5; i++) {
    b.cylinder(1.6 + (i % 3) * 0.09, 0.75, half - 2.1 + Math.floor(i / 3) * 0.12, 0.025, 0.03, 1.1, C.woodLight, 4, 0.12, 0, 0.1);
  }
  b.ring(-1.7, 0.9, half - 2.0, 0.42, 0.045, C.wood, 10, Math.PI);
  flags.push({ x: half - 0.5, y: 2.2, z: -half + 0.5, scale: 0.9, color: s.accent });
  pole(b, half - 0.5, 0.2, -half + 0.5, 2.0);
  return 3.0;
}

/** ---------------------------------------------------------------------------
 * Watch tower
 * ------------------------------------------------------------------------- */
function tower(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  b.boxOn(0, 0, 0, w - 0.5, 0.35, w - 0.5, s.base);
  if (f === 'egypt') {
    b.taper(0, 0.35, 0, w - 1.2, w - 1.2, 4.2, s.wall, 0.72);
    b.parapet(0, 4.55, 0, w - 1.5, w - 1.5, s.wallLight, 0.42);
    b.boxOn(0, 3.2, 0, w - 1.3, 0.2, w - 1.3, s.accent);
    crenellations(b, 0, 4.71, 0, w - 1.5, w - 1.5, s.wallLight, 0.66);
  } else if (f === 'greece') {
    b.column(0, 0.35, 0, (w - 1.5) / 2, (w - 1.1) / 2, 3.9, s.wall, 8);
    b.cylinder(0, 4.42, 0, (w - 0.7) / 2, (w - 1.3) / 2, 0.35, s.wallLight, 8);
    b.cylinder(0, 4.8, 0, (w - 0.9) / 2, (w - 0.9) / 2, 0.42, s.wallLight, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.boxOn(Math.cos(a) * (w - 1.0) * 0.5, 5.01, Math.sin(a) * (w - 1.0) * 0.5, 0.3, 0.3, 0.3, s.wallLight, a);
    }
    b.cone(0, 5.35, 0, (w - 1.0) / 2, 0.9, s.roof, 8);
  } else {
    b.boxOn(0, 0.35, 0, w - 1.3, 3.6, w - 1.3, s.wall);
    b.boxOn(0, 2.2, 0, w - 1.05, 0.22, w - 1.05, s.trim);
    b.boxOn(0, 3.95, 0, w - 0.7, 0.5, w - 0.7, s.wallLight);
    crenellations(b, 0, 4.45, 0, w - 0.7, w - 0.7, s.wallLight, 0.62);
    tiledRoof(b, s, 0, 4.62, 0, w - 1.5, w - 1.5, 0.9, 0.22, false);
    for (const sz of [-1, 1]) b.arch(0, 3.1, sz * (w / 2 - 0.62), 0.3, 0.08, s.trim, 8);
  }
  // Arrow slits.
  for (const sz of [-1, 1]) b.boxOn(0, 1.6, sz * (w / 2 - 0.62), 0.22, 0.7, 0.12, s.door);
  flags.push({ x: 0, y: 5.9, z: 0, scale: 0.85, color: s.accent });
  pole(b, 0, 5.5, 0, 1.1);
  return 6.4;
}

/** ---------------------------------------------------------------------------
 * Faction monument
 * ------------------------------------------------------------------------- */
function monument(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  b.boxOn(0, 0, 0, w - 0.2, 0.4, w - 0.2, s.base);
  b.boxOn(0, 0.4, 0, w - 1.0, 0.3, w - 1.0, mixHex(s.base, C.sandLight, 0.4));

  if (f === 'egypt') {
    // Twin obelisks on a pylon terrace.
    for (const sx of [-1, 1]) {
      b.boxOn(sx * 1.5, 0.7, 0, 1.0, 0.4, 1.0, C.sandstone);
      b.taper(sx * 1.5, 1.1, 0, 0.72, 0.72, 5.2, C.sandstone, 0.55);
      b.cone(sx * 1.5, 6.3, 0, 0.3, 0.62, C.gold, 4, Math.PI / 4);
      // Painted hieroglyph bands.
      for (let i = 0; i < 4; i++) {
        b.boxOn(sx * 1.5, 1.7 + i * 1.0, 0, 0.58 - i * 0.06, 0.1, 0.58 - i * 0.06, s.accent);
      }
    }
    // Central gateway.
    b.boxOn(0, 0.7, half - 0.9, 2.0, 1.9, 0.5, s.wall);
    b.boxOn(0, 0.7, half - 0.9, 0.9, 1.4, 0.62, s.door);
    b.boxOn(0, 2.6, half - 0.9, 2.4, 0.3, 0.7, s.trim);
    // Ram-headed statues.
    for (const sx of [-1, 1]) {
      b.boxOn(sx * 2.1, 0.7, -half + 0.9, 0.7, 0.45, 1.3, C.sandstone);
      b.boxOn(sx * 2.1, 1.15, -half + 1.15, 0.5, 0.5, 0.5, C.sandstone);
    }
    flags.push({ x: 0, y: 3.4, z: half - 0.9, scale: 0.9, color: s.accent });
    pole(b, 0, 3.0, half - 0.9, 1.1);
    return 7.0;
  }

  if (f === 'greece') {
    // Peripteral temple.
    b.steps(0, 0.7, -half + 0.4, w - 0.6, 3, 0.22, 0.42, s.base);
    b.boxOn(0, 0.7, 0.2, w - 1.6, 0.28, w - 1.6, s.wallDark);
    b.boxOn(0, 0.98, 0.5, w - 3.0, 2.6, w - 3.0, s.wall);
    columnRow(b, 0, 0.98, -half + 0.85, 4, (w - 2.0) / 3, 3.0, 0.24, s.column);
    columnRow(b, 0, 0.98, half - 0.85, 4, (w - 2.0) / 3, 3.0, 0.24, s.column);
    columnRow(b, -half + 0.85, 0.98, 0.2, 3, (w - 2.6) / 2, 3.0, 0.24, s.column, true);
    columnRow(b, half - 0.85, 0.98, 0.2, 3, (w - 2.6) / 2, 3.0, 0.24, s.column, true);
    b.boxOn(0, 3.98, 0.2, w - 0.3, 0.42, w - 0.3, s.wallLight);
    tiledRoof(b, s, 0, 4.4, 0.2, w - 0.9, w - 0.9, 1.85);
    // Athena statue glimpsed in the cella.
    b.column(0, 0.98, 0.5, 0.3, 0.34, 0.4, C.marble, 8);
    b.column(0, 1.38, 0.5, 0.22, 0.26, 1.4, C.gold, 8);
    b.sphere(0, 2.95, 0.5, 0.24, C.gold, 8);
    flags.push({ x: -half + 0.55, y: 4.6, z: -half + 0.55, scale: 0.95, color: s.accent });
    pole(b, -half + 0.55, 4.2, -half + 0.55, 1.2);
    return 6.6;
  }

  // Rome: triumphal arch astride a paved road.
  b.boxOn(0, 0.7, 0, w - 1.2, 0.3, w - 2.4, C.sandDark);
  for (const sx of [-1, 1]) {
    b.boxOn(sx * 1.85, 0.7, 0, 1.5, 3.6, w - 2.6, s.wall);
    for (const sz of [-1, 1]) {
      b.column(sx * 1.85, 0.7, sz * (w / 2 - 1.5), 0.24, 0.26, 3.2, s.column, 8);
      b.boxOn(sx * 1.85, 3.9, sz * (w / 2 - 1.5), 0.7, 0.2, 0.7, s.trim);
    }
  }
  // Barrel vault over the roadway, built from wedge blocks.
  archBand(b, 0, 3.05, 0, 1.12, 0.46, w - 2.6, s.wallLight, s.trim, 11);
  for (const sz of [-1, 1]) {
    archBand(b, 0, 3.05, (sz * (w - 2.6)) / 2, 1.12, 0.5, 0.24, s.trim, C.gold, 11);
  }
  b.boxOn(0, 4.15, 0, 3.2, 0.4, w - 2.55, s.wallLight);
  b.boxOn(0, 4.3, 0, w - 0.8, 0.35, w - 2.2, s.trim);
  b.boxOn(0, 4.65, 0, w - 1.6, 1.2, w - 2.8, s.wall);
  b.boxOn(0, 5.0, -w / 2 + 1.0, 3.2, 0.7, 0.12, s.accent);
  // Quadriga silhouette on the attic.
  for (let i = 0; i < 4; i++) {
    b.boxOn(-1.1 + i * 0.72, 5.85, 0, 0.34, 0.62, 0.9, C.bronze);
    b.boxOn(-1.1 + i * 0.72, 6.47, 0.3, 0.28, 0.3, 0.34, C.bronze);
  }
  b.boxOn(1.7, 5.85, 0, 0.7, 0.75, 0.7, C.bronzeDark);
  flags.push({ x: -w / 2 + 0.6, y: 5.0, z: -w / 2 + 0.7, scale: 0.9, color: s.accent });
  flags.push({ x: w / 2 - 0.6, y: 5.0, z: -w / 2 + 0.7, scale: 0.9, color: s.accent });
  pole(b, -w / 2 + 0.6, 4.65, -w / 2 + 0.7, 1.2);
  pole(b, w / 2 - 0.6, 4.65, -w / 2 + 0.7, 1.2);
  return 7.2;
}

/** ---------------------------------------------------------------------------
 * Wall
 * ------------------------------------------------------------------------- */
function wall(b: GeoBuilder, s: Style, f: FactionId, w: number): number {
  b.boxOn(0, 0, 0, w, 0.25, w, s.base);
  if (f === 'egypt') {
    b.taper(0, 0.25, 0, w - 0.35, w - 0.35, 1.9, s.wall, 0.82);
    b.boxOn(0, 2.15, 0, w - 0.5, 0.2, w - 0.5, s.wallDark);
    b.boxOn(0, 2.35, 0, w - 0.65, 0.3, w - 0.65, s.wallLight);
  } else {
    b.boxOn(0, 0.25, 0, w - 0.25, 1.95, w - 0.25, s.wall);
    // Block courses.
    for (let i = 0; i < 3; i++) {
      b.boxOn(0, 0.35 + i * 0.6, 0, w - 0.12, 0.08, w - 0.12, s.wallDark);
    }
    b.boxOn(0, 2.2, 0, w, 0.22, w, s.wallLight);
    crenellations(b, 0, 2.42, 0, w, w, s.wallLight, 0.55);
  }
  return 2.7;
}

/** ---------------------------------------------------------------------------
 * Dock
 * ------------------------------------------------------------------------- */
function dock(b: GeoBuilder, s: Style, f: FactionId, w: number, flags: FlagAnchor[]): number {
  const half = w / 2;
  // Plank deck.
  for (let i = 0; i < 9; i++) {
    const z = -half + 0.35 + i * ((w - 0.7) / 8);
    b.boxOn(0, 0.42, z, w - 0.3, 0.14, (w - 0.7) / 8 - 0.06, i % 2 ? C.wood : C.woodLight);
  }
  // Pilings.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -half + 0.8 + i * ((w - 1.6) / 2);
      b.column(sx * (half - 0.4), -1.4, z, 0.13, 0.15, 2.0, C.woodDark, 6);
    }
  }
  // Boathouse.
  b.boxOn(-half + 1.2, 0.56, half - 1.1, 2.0, 1.3, 1.7, s.wall);
  if (f === 'egypt') b.boxOn(-half + 1.2, 1.86, half - 1.1, 2.3, 0.14, 2.0, C.thatch);
  else tiledRoof(b, s, -half + 1.2, 1.86, half - 1.1, 2.0, 1.7, 0.8, 0.2, false);
  b.boxOn(-half + 1.2, 0.56, half - 1.98, 0.9, 1.0, 0.14, s.door);
  // Moored skiff.
  b.cylinder(half - 1.0, 0.15, -0.5, 0.45, 0.3, 2.4, C.woodLight, 6, 0, 0, Math.PI / 2);
  b.boxOn(half - 1.0, 0.3, -0.5, 0.16, 0.9, 0.16, C.woodDark);
  // Nets, crates, rope.
  b.boxOn(half - 1.1, 0.49, half - 1.0, 0.62, 0.5, 0.62, C.wood);
  b.boxOn(half - 1.1, 0.99, half - 1.0, 0.5, 0.36, 0.5, C.woodLight);
  b.ring(0.4, 0.52, half - 1.8, 0.35, 0.07, C.thatch, 10);
  flags.push({ x: -half + 1.2, y: 2.35, z: half - 1.1, scale: 0.8, color: s.accent });
  pole(b, -half + 1.2, 1.96, half - 1.1, 1.1);
  return 2.6;
}

/** ---------------------------------------------------------------------------
 * Public factory
 * ------------------------------------------------------------------------- */
const cache = new Map<string, BuildingModel>();

export function buildingModel(type: BuildingTypeId, faction: FactionId, sizeTiles: number): BuildingModel {
  const key = `${type}|${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s = styleFor(faction);
  const b = new GeoBuilder();
  const flags: FlagAnchor[] = [];
  const w = sizeTiles * TILE;
  let height: number;

  switch (type) {
    case 'towncenter':
      height = townCenter(b, s, faction, w, flags);
      break;
    case 'house':
      height = house(b, s, faction, w, flags);
      break;
    case 'farm':
      height = farm(b, s, faction, w);
      break;
    case 'storehouse':
      height = storehouse(b, s, faction, w, flags);
      break;
    case 'barracks':
      height = barracks(b, s, faction, w, flags);
      break;
    case 'range':
      height = range(b, s, faction, w, flags);
      break;
    case 'tower':
      height = tower(b, s, faction, w, flags);
      break;
    case 'monument':
      height = monument(b, s, faction, w, flags);
      break;
    case 'wall':
      height = wall(b, s, faction, w);
      break;
    case 'dock':
      height = dock(b, s, faction, w, flags);
      break;
  }

  const model: BuildingModel = { geo: b.build(), height, flags, footprint: w / 2 };
  cache.set(key, model);
  return model;
}

export function clearBuildingCache(): void {
  for (const m of cache.values()) m.geo.dispose();
  cache.clear();
}
