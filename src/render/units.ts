import type { BufferGeometry } from 'three';
import { GeoBuilder, shade } from './geo';
import { C } from './palette';
import { FACTIONS } from '../sim/data';
import type { FactionId, UnitTypeId } from '../sim/types';

export interface UnitModel {
  geo: BufferGeometry;
  /** Height of the top of the model, for health bars. */
  height: number;
}

interface Kit {
  cloth: number;
  clothDark: number;
  skin: number;
  helmet: number;
  crest: number;
  shield: number;
  shieldRim: number;
  metal: number;
}

function kitFor(f: FactionId): Kit {
  const col = FACTIONS[f].colors;
  if (f === 'egypt') {
    return {
      cloth: 0xf0ece0,
      clothDark: 0xd9d3c2,
      skin: 0xc08b58,
      helmet: col.accent,
      crest: C.gold,
      shield: 0xd9c39b,
      shieldRim: col.accent,
      metal: C.bronze,
    };
  }
  if (f === 'greece') {
    return {
      cloth: col.cloth,
      clothDark: shade(col.cloth, 0.78),
      skin: C.skin,
      helmet: C.bronze,
      crest: 0xe0dccf,
      shield: 0xc9a227,
      shieldRim: C.bronzeDark,
      metal: C.bronze,
    };
  }
  return {
    cloth: col.cloth,
    clothDark: shade(col.cloth, 0.76),
    skin: C.skin,
    helmet: C.iron,
    crest: 0xc0392b,
    shield: 0xa8402f,
    shieldRim: C.gold,
    metal: C.iron,
  };
}

interface HumanOpts {
  kit: Kit;
  faction: FactionId;
  /** Torso/tunic colour override. */
  tunic?: number;
  scale?: number;
  armour?: 'none' | 'light' | 'heavy';
  helmet?: 'none' | 'cap' | 'crested' | 'nemes';
  /** Stance offset for the legs, gives units a little variety. */
  stride?: number;
}

/**
 * Shared humanoid. Model faces +Z, sits on y = 0, roughly 1.2 units tall.
 */
function human(b: GeoBuilder, o: HumanOpts): number {
  const k = o.kit;
  const tunic = o.tunic ?? k.cloth;
  const s = o.scale ?? 1;
  const stride = o.stride ?? 0;

  const legH = 0.4 * s;
  const torsoY = legH;
  const torsoH = 0.42 * s;
  const headY = torsoY + torsoH + 0.09 * s;

  // Legs (slightly split so the walk bob reads).
  b.boxOn(-0.1 * s, 0, stride * 0.06, 0.15 * s, legH, 0.16 * s, k.skin);
  b.boxOn(0.1 * s, 0, -stride * 0.06, 0.15 * s, legH, 0.16 * s, k.skin);
  b.boxOn(-0.1 * s, 0, stride * 0.06, 0.16 * s, 0.08 * s, 0.2 * s, C.leather);
  b.boxOn(0.1 * s, 0, -stride * 0.06, 0.16 * s, 0.08 * s, 0.2 * s, C.leather);

  // Tunic / torso.
  b.boxOn(0, torsoY - 0.04 * s, 0, 0.38 * s, 0.2 * s, 0.26 * s, tunic);
  b.boxOn(0, torsoY + 0.16 * s, 0, 0.36 * s, torsoH - 0.16 * s, 0.24 * s, tunic);
  b.boxOn(0, torsoY + 0.14 * s, 0, 0.39 * s, 0.07 * s, 0.27 * s, C.leather);

  if (o.armour === 'heavy') {
    b.boxOn(0, torsoY + 0.2 * s, 0, 0.4 * s, 0.3 * s, 0.28 * s, k.metal);
    b.boxOn(0, torsoY + 0.18 * s, -0.15 * s, 0.34 * s, 0.26 * s, 0.04 * s, shade(k.metal, 1.12));
  } else if (o.armour === 'light') {
    b.boxOn(0, torsoY + 0.22 * s, 0, 0.38 * s, 0.24 * s, 0.26 * s, C.leather);
  }

  // Arms.
  b.boxOn(-0.24 * s, torsoY + 0.05 * s, 0, 0.11 * s, 0.36 * s, 0.12 * s, k.skin);
  b.boxOn(0.24 * s, torsoY + 0.05 * s, 0, 0.11 * s, 0.36 * s, 0.12 * s, k.skin);
  b.boxOn(-0.24 * s, torsoY + 0.33 * s, 0, 0.14 * s, 0.1 * s, 0.15 * s, tunic);
  b.boxOn(0.24 * s, torsoY + 0.33 * s, 0, 0.14 * s, 0.1 * s, 0.15 * s, tunic);

  // Head.
  b.boxOn(0, headY - 0.05 * s, 0, 0.1 * s, 0.07 * s, 0.1 * s, k.skin);
  b.box(0, headY + 0.09 * s, 0, 0.2 * s, 0.21 * s, 0.2 * s, k.skin);

  switch (o.helmet) {
    case 'nemes':
      // Striped Egyptian headcloth.
      b.box(0, headY + 0.16 * s, -0.01 * s, 0.24 * s, 0.14 * s, 0.24 * s, k.helmet);
      b.box(0, headY + 0.05 * s, -0.11 * s, 0.26 * s, 0.24 * s, 0.06 * s, k.helmet);
      b.box(0, headY + 0.23 * s, 0, 0.16 * s, 0.06 * s, 0.16 * s, k.crest);
      break;
    case 'cap':
      b.box(0, headY + 0.15 * s, 0, 0.23 * s, 0.15 * s, 0.23 * s, k.helmet);
      b.box(0, headY + 0.08 * s, 0.11 * s, 0.16 * s, 0.12 * s, 0.05 * s, shade(k.helmet, 0.85));
      break;
    case 'crested':
      b.box(0, headY + 0.15 * s, 0, 0.24 * s, 0.17 * s, 0.24 * s, k.helmet);
      b.box(0, headY + 0.06 * s, 0.12 * s, 0.06 * s, 0.16 * s, 0.05 * s, shade(k.helmet, 0.8));
      b.box(0, headY + 0.3 * s, -0.02 * s, 0.07 * s, 0.13 * s, 0.3 * s, k.crest);
      b.box(0, headY + 0.36 * s, -0.14 * s, 0.06 * s, 0.09 * s, 0.14 * s, k.crest);
      break;
    default:
      b.box(0, headY + 0.16 * s, -0.02 * s, 0.21 * s, 0.11 * s, 0.21 * s, C.hair);
  }
  return headY + 0.42 * s;
}

function spear(b: GeoBuilder, x: number, y: number, z: number, len: number, metal: number, lean = 0.12): void {
  b.column(x, y, z, 0.026, 0.03, len, C.woodLight, 5);
  b.cone(x + Math.sin(lean) * 0, y + len, z, 0.055, 0.22, metal, 6);
}

function roundShield(b: GeoBuilder, x: number, y: number, z: number, r: number, face: number, rim: number): void {
  b.cylinder(x, y, z, r, r, 0.07, face, 12, 0, 0, Math.PI / 2);
  b.cylinder(x, y, z + 0.005, r * 1.06, r * 1.06, 0.045, rim, 12, 0, 0, Math.PI / 2);
  b.sphere(x - 0.03, y, z, r * 0.24, rim, 6, 0.6);
}

/** ---------------------------------------------------------------------------
 * Individual unit models
 * ------------------------------------------------------------------------- */
function villager(b: GeoBuilder, f: FactionId, k: Kit): number {
  const h = human(b, {
    kit: k,
    faction: f,
    tunic: f === 'egypt' ? 0xf2eee2 : f === 'greece' ? 0xdcd7c4 : 0xd8c9a8,
    helmet: f === 'egypt' ? 'nemes' : 'none',
    armour: 'none',
    stride: 1,
  });
  // Tool: a simple pick / hoe over the shoulder.
  b.cylinder(0.3, 0.88, 0.04, 0.03, 0.035, 0.8, C.woodLight, 5, -0.3, 0, 0.25);
  b.box(0.42, 1.28, -0.06, 0.28, 0.08, 0.09, C.iron, 0, 0, 0.35);
  return h;
}

function spearman(b: GeoBuilder, f: FactionId, k: Kit): number {
  const h = human(b, {
    kit: k,
    faction: f,
    helmet: f === 'egypt' ? 'nemes' : 'cap',
    armour: 'light',
    stride: 1,
  });
  spear(b, 0.3, 0.5, 0.06, 1.15, k.metal, 0);
  if (f === 'rome') b.box(-0.31, 0.72, 0.02, 0.1, 0.5, 0.36, k.shield);
  else roundShield(b, -0.31, 0.72, 0.02, 0.28, k.shield, k.shieldRim);
  return h;
}

function archer(b: GeoBuilder, f: FactionId, k: Kit): number {
  const h = human(b, {
    kit: k,
    faction: f,
    tunic: shade(k.cloth, 0.9),
    helmet: f === 'egypt' ? 'nemes' : 'none',
    armour: 'none',
    stride: 1,
  });
  // Bow held out in front, quiver on the back.
  b.ring(0.3, 0.78, 0.14, 0.3, 0.032, C.wood, 10, Math.PI * 1.1);
  b.box(0.3, 0.78, 0.13, 0.02, 0.58, 0.02, C.cloth);
  b.cylinder(-0.16, 0.87, -0.19, 0.075, 0.085, 0.42, C.leather, 6, 0.3);
  for (let i = 0; i < 3; i++) {
    b.cylinder(-0.16 + i * 0.045, 1.12, -0.24, 0.014, 0.014, 0.22, C.woodLight, 4, 0.3);
  }
  return h;
}

function chariot(b: GeoBuilder, f: FactionId, k: Kit): number {
  // Two horses, a yoke pole, a light wicker car and an archer.
  for (const sx of [-1, 1]) {
    const x = sx * 0.34;
    b.boxOn(x, 0.42, 0.72, 0.3, 0.34, 1.0, 0xa9784b);
    b.boxOn(x, 0.0, 0.42, 0.11, 0.44, 0.13, 0x8c6540);
    b.boxOn(x, 0.0, 1.02, 0.11, 0.44, 0.13, 0x8c6540);
    b.boxOn(x, 0.6, 1.26, 0.22, 0.3, 0.3, 0xa9784b);
    b.box(x, 0.96, 1.34, 0.18, 0.2, 0.22, 0x8c6540);
    b.box(x, 0.86, 1.0, 0.1, 0.26, 0.42, C.hair);
    b.box(x, 0.78, 0.86, 0.34, 0.1, 0.22, k.helmet);
  }
  // Draught pole and yoke.
  b.box(0, 0.6, 0.52, 0.09, 0.09, 1.5, C.wood);
  b.box(0, 0.68, 1.2, 0.8, 0.08, 0.1, C.wood);
  // Car.
  b.boxOn(0, 0.34, -0.26, 0.86, 0.1, 0.7, C.wood);
  b.boxOn(0, 0.44, -0.58, 0.9, 0.42, 0.1, k.shield);
  b.boxOn(-0.44, 0.44, -0.26, 0.1, 0.42, 0.7, k.shield);
  b.boxOn(0.44, 0.44, -0.26, 0.1, 0.42, 0.7, k.shield);
  b.boxOn(0, 0.86, -0.58, 0.94, 0.06, 0.14, k.shieldRim);
  // Wheels.
  for (const sx of [-1, 1]) {
    b.cylinder(sx * 0.5, 0.36, -0.3, 0.36, 0.36, 0.09, C.woodDark, 10, 0, 0, Math.PI / 2);
    b.cylinder(sx * 0.53, 0.36, -0.3, 0.1, 0.1, 0.06, C.bronze, 8, 0, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      b.box(sx * 0.5, 0.36, -0.3, 0.05, 0.66, 0.05, C.woodLight, 0, 0, a);
    }
  }
  b.box(0, 0.36, -0.3, 1.04, 0.07, 0.07, C.woodDark);
  // Crew.
  const bb = new GeoBuilder();
  void bb;
  b.origin(0, 0.44, -0.24);
  const h = human(b, { kit: k, faction: f, helmet: 'nemes', armour: 'light', scale: 0.92 });
  b.ring(0.3, 0.75, 0.16, 0.28, 0.03, C.wood, 10, Math.PI * 1.1);
  b.origin(0, 0, 0);
  return h + 0.44;
}

function hoplite(b: GeoBuilder, f: FactionId, k: Kit): number {
  const h = human(b, { kit: k, faction: f, helmet: 'crested', armour: 'heavy', scale: 1.04 });
  // Greaves.
  b.boxOn(-0.1, 0.05, 0.01, 0.17, 0.3, 0.18, k.metal);
  b.boxOn(0.1, 0.05, 0.01, 0.17, 0.3, 0.18, k.metal);
  spear(b, 0.32, 0.52, 0.05, 1.35, k.metal);
  // Big aspis.
  roundShield(b, -0.35, 0.76, 0.06, 0.42, k.shield, k.shieldRim);
  b.box(-0.4, 0.76, 0.08, 0.06, 0.3, 0.3, k.shieldRim, 0.6);
  return h;
}

function legionary(b: GeoBuilder, f: FactionId, k: Kit): number {
  const h = human(b, { kit: k, faction: f, helmet: 'crested', armour: 'heavy' });
  // Lorica banding.
  for (let i = 0; i < 3; i++) {
    b.box(0, 0.5 + i * 0.1, 0, 0.42, 0.05, 0.3, shade(k.metal, 1.15));
  }
  // Scutum: curved rectangular shield.
  b.box(-0.33, 0.74, 0.02, 0.11, 0.62, 0.42, k.shield);
  b.box(-0.36, 0.74, 0.02, 0.05, 0.66, 0.46, k.shieldRim);
  b.sphere(-0.4, 0.74, 0.02, 0.09, C.gold, 6);
  b.box(-0.3, 0.74, 0.02, 0.02, 0.24, 0.24, C.gold, 0.78);
  // Gladius and pilum.
  b.box(0.29, 0.55, 0.1, 0.06, 0.42, 0.05, k.metal);
  b.box(0.29, 0.34, 0.1, 0.09, 0.1, 0.09, C.woodDark);
  spear(b, 0.34, 0.5, -0.12, 1.2, k.metal);
  return h;
}

function fishingBoat(b: GeoBuilder, f: FactionId, k: Kit): number {
  // Hull: tapered six-sided prism lying on its side.
  b.cylinder(0, 0.16, 0, 0.5, 0.34, 2.1, C.woodLight, 6, Math.PI / 2, 0, 0);
  b.box(0, 0.3, 0, 0.86, 0.16, 1.6, C.wood);
  b.box(0, 0.42, -0.9, 0.5, 0.3, 0.4, C.woodDark, 0, 0.3);
  b.box(0, 0.42, 0.92, 0.44, 0.3, 0.36, C.woodDark, 0, -0.3);
  // Net frame.
  b.cylinder(0.34, 0.83, 0.35, 0.04, 0.045, 0.95, C.woodDark, 5, 0, 0, -0.35);
  b.box(0.62, 1.2, 0.35, 0.5, 0.04, 0.5, C.thatch, 0, 0, -0.25);
  // Fisher.
  b.origin(0, 0.36, -0.2);
  const h = human(b, { kit: k, faction: f, tunic: 0xd9cdb0, helmet: 'none', scale: 0.85 });
  b.origin(0, 0, 0);
  void k;
  return h + 0.36;
}

function warship(b: GeoBuilder, f: FactionId, k: Kit): number {
  const accent = FACTIONS[f].colors.accent;
  // Hull.
  b.cylinder(0, 0.22, 0, 0.62, 0.44, 3.2, C.wood, 6, Math.PI / 2, 0, 0);
  b.box(0, 0.46, 0, 1.1, 0.14, 2.7, C.woodLight);
  b.box(0, 0.58, 0, 1.16, 0.14, 2.4, C.woodDark);
  // Ram and stern post.
  b.cone(0, 0.24, 1.85, 0.22, 0.7, C.bronze, 6, 0);
  b.box(0, 0.24, 1.9, 0.3, 0.2, 0.8, C.bronze, 0, Math.PI / 2);
  b.box(0, 0.9, -1.6, 0.18, 0.9, 0.3, C.woodDark, 0, 0.5);
  b.sphere(0, 1.4, -1.72, 0.13, C.bronze, 6);
  // Oars.
  for (let i = 0; i < 5; i++) {
    const z = -1.1 + i * 0.55;
    for (const sx of [-1, 1]) {
      b.box(sx * 0.85, 0.28, z, 0.9, 0.05, 0.05, C.woodLight, 0, 0, sx * 0.35);
      b.box(sx * 1.24, 0.06, z, 0.26, 0.04, 0.14, C.woodDark);
    }
  }
  // Shields on the gunwale.
  for (let i = 0; i < 4; i++) {
    const z = -0.9 + i * 0.6;
    for (const sx of [-1, 1]) {
      b.cylinder(sx * 0.6, 0.72, z, 0.2, 0.2, 0.05, i % 2 ? k.shield : accent, 8, 0, 0, Math.PI / 2);
    }
  }
  // Mast and sail.
  b.column(0, 0.58, 0.1, 0.07, 0.08, 1.9, C.woodDark, 6);
  b.box(0, 2.15, 0.1, 1.5, 0.07, 0.07, C.woodDark);
  b.box(0, 1.72, 0.12, 1.4, 0.82, 0.06, C.cloth);
  b.box(0, 1.72, 0.1, 0.34, 0.7, 0.05, accent);
  b.box(0, 2.42, 0.1, 0.35, 0.28, 0.03, accent);
  // Archer amidships.
  b.origin(0, 0.65, -0.55);
  const h = human(b, { kit: k, faction: f, helmet: 'cap', armour: 'light', scale: 0.85 });
  b.origin(0, 0, 0);
  return Math.max(h + 0.65, 2.6);
}

/** ---------------------------------------------------------------------------
 * The wilds
 * ------------------------------------------------------------------------- */

/** Shared four-legged chassis; the caller dresses the head end (+z). */
function quadruped(
  b: GeoBuilder,
  o: { len: number; ht: number; wd: number; legH: number; body: number; belly: number },
): number {
  const bodyY = o.legH;
  // Legs at the corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.boxOn(sx * (o.wd / 2 - 0.05), 0, sz * (o.len / 2 - 0.09), 0.1, o.legH, 0.1, o.belly);
    }
  }
  b.boxOn(0, bodyY, 0, o.wd, o.ht, o.len, o.body);
  b.boxOn(0, bodyY - 0.03, 0, o.wd * 0.82, o.ht * 0.4, o.len * 0.9, o.belly);
  return bodyY + o.ht;
}

function wolf(b: GeoBuilder): number {
  const fur = 0x8b8b90;
  const dark = 0x5e5e64;
  const top = quadruped(b, { len: 0.78, ht: 0.3, wd: 0.3, legH: 0.26, body: fur, belly: dark });
  // Head, snout, ears — all shades of the same grey.
  b.boxOn(0, top - 0.06, 0.42, 0.24, 0.22, 0.26, fur);
  b.boxOn(0, top - 0.04, 0.58, 0.13, 0.12, 0.16, dark);
  b.boxOn(-0.08, top + 0.14, 0.4, 0.06, 0.1, 0.05, dark);
  b.boxOn(0.08, top + 0.14, 0.4, 0.06, 0.1, 0.05, dark);
  // Raised hackles and a low tail.
  b.boxOn(0, top, -0.05, 0.16, 0.1, 0.42, dark);
  b.box(0, top - 0.12, -0.5, 0.1, 0.1, 0.34, dark, 0, -0.5, 0);
  return top + 0.28;
}

function boar(b: GeoBuilder): number {
  const hide = 0x6b4f38;
  const dark = 0x4c3826;
  const top = quadruped(b, { len: 0.86, ht: 0.44, wd: 0.42, legH: 0.22, body: hide, belly: dark });
  // Big wedge head with pale tusks.
  b.boxOn(0, top - 0.28, 0.5, 0.3, 0.3, 0.28, hide);
  b.boxOn(0, top - 0.26, 0.66, 0.16, 0.14, 0.12, dark);
  b.boxOn(-0.1, top - 0.3, 0.62, 0.04, 0.1, 0.05, 0xe9e2d2);
  b.boxOn(0.1, top - 0.3, 0.62, 0.04, 0.1, 0.05, 0xe9e2d2);
  // Bristled ridge.
  b.boxOn(0, top, 0, 0.14, 0.09, 0.6, dark);
  return top + 0.12;
}

function deer(b: GeoBuilder): number {
  const coat = 0xb08c5e;
  const pale = 0xd9c4a4;
  const top = quadruped(b, { len: 0.72, ht: 0.28, wd: 0.26, legH: 0.4, body: coat, belly: pale });
  // Upright neck and head.
  b.boxOn(0, top - 0.02, 0.28, 0.13, 0.3, 0.14, coat);
  b.boxOn(0, top + 0.26, 0.34, 0.16, 0.16, 0.2, coat);
  b.boxOn(0, top + 0.27, 0.46, 0.09, 0.09, 0.1, pale);
  // Antlers.
  for (const sx of [-1, 1]) {
    b.box(sx * 0.08, top + 0.44, 0.3, 0.03, 0.18, 0.03, pale, 0, 0, sx * 0.35);
    b.box(sx * 0.14, top + 0.52, 0.3, 0.12, 0.03, 0.03, pale);
  }
  b.boxOn(0, top - 0.08, -0.38, 0.09, 0.12, 0.08, pale);
  return top + 0.55;
}

/** Outlaws wear no faction's colours — leather, soot and a red rag. */
const BANDIT_KIT: Kit = {
  cloth: 0x4f463c,
  clothDark: 0x3a332c,
  skin: 0xb98a5c,
  helmet: 0x3a332c,
  crest: 0x8a2f2f,
  shield: 0x6b5b45,
  shieldRim: 0x3a332c,
  metal: 0x8f8f8f,
};

function bandit(b: GeoBuilder, k: Kit): number {
  const h = human(b, { kit: k, faction: 'greece', armour: 'light', tunic: k.cloth });
  // Hood and a crude blade.
  b.box(0, h - 0.06, -0.03, 0.24, 0.18, 0.24, k.clothDark);
  b.box(0.3, 0.62, 0.12, 0.05, 0.42, 0.05, k.metal, 0, 0, 0.5);
  b.box(-0.28, 0.58, 0, 0.16, 0.22, 0.05, k.shield);
  return h;
}

function banditArcher(b: GeoBuilder, k: Kit): number {
  const h = human(b, { kit: k, faction: 'greece', tunic: k.cloth });
  b.box(0, h - 0.06, -0.03, 0.24, 0.18, 0.24, k.clothDark);
  // Bow held at the side.
  b.box(0.3, 0.7, 0.05, 0.05, 0.8, 0.05, C.woodDark, 0, 0, 0.12);
  b.box(-0.2, 0.85, -0.14, 0.1, 0.34, 0.1, C.leather);
  return h;
}

function wanderer(b: GeoBuilder, k: Kit): number {
  const h = human(b, { kit: k, faction: 'greece', tunic: 0x7a6a4f });
  // Walking staff and a shoulder bundle.
  b.box(0.3, 0.55, 0.1, 0.05, 1.15, 0.05, C.woodLight);
  b.box(-0.22, 0.95, -0.1, 0.24, 0.2, 0.2, 0x9c7f52, 0.5);
  return h;
}

/** ---------------------------------------------------------------------------
 * Factory
 * ------------------------------------------------------------------------- */
const cache = new Map<string, UnitModel>();

export function unitModel(type: UnitTypeId, faction: FactionId): UnitModel {
  const key = `${type}|${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const k = kitFor(faction);
  const b = new GeoBuilder();
  let height = 1.3;
  switch (type) {
    case 'villager':
      height = villager(b, faction, k);
      break;
    case 'spearman':
      height = spearman(b, faction, k);
      break;
    case 'archer':
      height = archer(b, faction, k);
      break;
    case 'chariot':
      height = chariot(b, faction, k);
      break;
    case 'hoplite':
      height = hoplite(b, faction, k);
      break;
    case 'legionary':
      height = legionary(b, faction, k);
      break;
    case 'fishingBoat':
      height = fishingBoat(b, faction, k);
      break;
    case 'warship':
      height = warship(b, faction, k);
      break;
    case 'wolf':
      height = wolf(b);
      break;
    case 'boar':
      height = boar(b);
      break;
    case 'deer':
      height = deer(b);
      break;
    case 'bandit':
      height = bandit(b, BANDIT_KIT);
      break;
    case 'banditArcher':
      height = banditArcher(b, BANDIT_KIT);
      break;
    case 'wanderer':
      height = wanderer(b, BANDIT_KIT);
      break;
  }
  const model: UnitModel = { geo: b.build(), height };
  cache.set(key, model);
  return model;
}

export function clearUnitCache(): void {
  for (const m of cache.values()) m.geo.dispose();
  cache.clear();
}
