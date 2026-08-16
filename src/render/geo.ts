import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

/**
 * Accumulates transformed primitives into a single vertex-coloured geometry.
 * Every unit and building in the game is one merged mesh, which keeps the
 * draw-call count low enough for instancing on mobile.
 */

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const cylCache = new Map<string, CylinderGeometry>();
const coneCache = new Map<string, ConeGeometry>();
const sphereCache = new Map<string, SphereGeometry>();
const torusCache = new Map<string, TorusGeometry>();
const icoCache = new Map<string, IcosahedronGeometry>();

function cyl(rt: number, rb: number, seg: number, open = false): CylinderGeometry {
  const key = `${rt}|${rb}|${seg}|${open}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new CylinderGeometry(rt, rb, 1, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}

function cone(seg: number): ConeGeometry {
  const key = String(seg);
  let g = coneCache.get(key);
  if (!g) {
    g = new ConeGeometry(1, 1, seg);
    coneCache.set(key, g);
  }
  return g;
}

function sphere(seg: number): SphereGeometry {
  const key = String(seg);
  let g = sphereCache.get(key);
  if (!g) {
    g = new SphereGeometry(1, seg, Math.max(3, Math.round(seg / 2)));
    sphereCache.set(key, g);
  }
  return g;
}

function torus(tube: number, seg: number, arc: number): TorusGeometry {
  const key = `${tube}|${seg}|${arc}`;
  let g = torusCache.get(key);
  if (!g) {
    g = new TorusGeometry(1, tube, 4, seg, arc);
    torusCache.set(key, g);
  }
  return g;
}

function ico(detail: number): IcosahedronGeometry {
  const key = String(detail);
  let g = icoCache.get(key);
  if (!g) {
    g = new IcosahedronGeometry(1, detail);
    icoCache.set(key, g);
  }
  return g;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _pos = new Vector3();
const _scale = new Vector3();
const _color = new Color();

export class GeoBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  /** Uniform offset applied to every subsequent primitive. */
  private ox = 0;
  private oy = 0;
  private oz = 0;

  origin(x: number, y: number, z: number): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    return this;
  }

  add(geo: BufferGeometry, matrix: Matrix4, color: number): this {
    const g = geo.clone().applyMatrix4(matrix);
    const pos = g.attributes.position as BufferAttribute;
    const nor = g.attributes.normal as BufferAttribute;
    const base = this.positions.length / 3;
    _color.set(color);
    // Slight per-primitive shade jitter keeps large flat areas from banding.
    for (let i = 0; i < pos.count; i++) {
      this.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      this.colors.push(_color.r, _color.g, _color.b);
    }
    const idx = g.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) this.indices.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
    }
    g.dispose();
    return this;
  }

  private mat(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): Matrix4 {
    _pos.set(x + this.ox, y + this.oy, z + this.oz);
    _scale.set(sx, sy, sz);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    return _m.compose(_pos, _q, _scale);
  }

  /** Axis-aligned (or Y-rotated) box, positioned by its centre. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    ry = 0,
    rx = 0,
    rz = 0,
  ): this {
    return this.add(UNIT_BOX, this.mat(x, y, z, w, h, d, rx, ry, rz), color);
  }

  /** Box sitting on the ground plane (y is the base). */
  boxOn(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    ry = 0,
  ): this {
    return this.box(x, y + h / 2, z, w, h, d, color, ry);
  }

  cylinder(
    x: number,
    y: number,
    z: number,
    rTop: number,
    rBottom: number,
    h: number,
    color: number,
    seg = 8,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    const maxR = Math.max(rTop, rBottom) || 1;
    const g = cyl(rTop / maxR, rBottom / maxR, seg);
    return this.add(g, this.mat(x, y, z, maxR, h, maxR, rx, ry, rz), color);
  }

  /** Cylinder standing on the ground plane. */
  column(x: number, y: number, z: number, rTop: number, rBottom: number, h: number, color: number, seg = 8): this {
    return this.cylinder(x, y + h / 2, z, rTop, rBottom, h, color, seg);
  }

  /**
   * Battered (inward-sloping) rectangular block - the signature Egyptian wall.
   * Built from a four-sided cylinder so the taper is a single primitive.
   */
  taper(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: number,
    ratio = 0.86,
    ry = 0,
  ): this {
    const g = cyl(ratio, 1, 4);
    const k = Math.SQRT1_2;
    return this.add(
      g,
      this.mat(x, y + h / 2, z, (w / 2) / k, h, (d / 2) / k, 0, ry + Math.PI / 4, 0),
      color,
    );
  }

  /** Half-torus standing in the XZ-facing vertical plane - Roman arches. */
  arch(x: number, y: number, z: number, r: number, tube: number, color: number, seg = 10, ry = 0): this {
    const g = torus(tube / r, seg, Math.PI);
    return this.add(g, this.mat(x, y, z, r, r, r, 0, ry, 0), color);
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, ry = 0): this {
    return this.add(cone(seg), this.mat(x, y + h / 2, z, r, h, r, 0, ry, 0), color);
  }

  sphere(x: number, y: number, z: number, r: number, color: number, seg = 8, sy = 1): this {
    return this.add(sphere(seg), this.mat(x, y, z, r, r * sy, r), color);
  }

  rock(x: number, y: number, z: number, r: number, color: number, seed = 0, detail = 0): this {
    const ry = (seed % 7) * 0.44;
    return this.add(ico(detail), this.mat(x, y, z, r, r * (0.7 + (seed % 3) * 0.14), r * 0.92, 0.3, ry, 0.2), color);
  }

  ring(x: number, y: number, z: number, r: number, tube: number, color: number, seg = 12, arc = Math.PI * 2): this {
    return this.add(torus(tube / r, seg, arc), this.mat(x, y, z, r, r, r, Math.PI / 2, 0, 0), color);
  }

  /** Wedge / gabled roof made from two sloped slabs. */
  gable(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    ry = 0,
    thickness = 0.16,
  ): this {
    const slope = Math.atan2(h, w / 2);
    const len = Math.hypot(w / 2, h) + 0.06;
    const cx = Math.cos(ry);
    const cz = -Math.sin(ry);
    for (const s of [-1, 1]) {
      const px = (s * w) / 4;
      const py = h / 2;
      // Rotate the offset into the roof's own frame.
      const ox = px * cx;
      const oz = px * cz;
      this.box(x + ox, y + py, z + oz, len, thickness, d, color, ry, 0, -s * slope);
    }
    return this;
  }

  /** Flat roof slab with a raised parapet lip (Egyptian style). */
  parapet(x: number, y: number, z: number, w: number, d: number, color: number, lip = 0.28): this {
    this.boxOn(x, y, z, w, 0.16, d, color);
    this.boxOn(x, y + 0.16, z - d / 2 + 0.09, w, lip, 0.18, color);
    this.boxOn(x, y + 0.16, z + d / 2 - 0.09, w, lip, 0.18, color);
    this.boxOn(x - w / 2 + 0.09, y + 0.16, z, 0.18, lip, d, color);
    this.boxOn(x + w / 2 - 0.09, y + 0.16, z, 0.18, lip, d, color);
    return this;
  }

  /** Row of steps along the -Z face. */
  steps(x: number, y: number, z: number, w: number, count: number, rise: number, run: number, color: number): this {
    for (let i = 0; i < count; i++) {
      this.boxOn(x, y + i * rise, z - i * run * 0.5, w - i * 0.001, rise, run * (count - i), color);
    }
    return this;
  }

  build(flat = true): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    g.setIndex(this.indices.length > 65535
      ? new BufferAttribute(new Uint32Array(this.indices), 1)
      : new BufferAttribute(new Uint16Array(this.indices), 1));
    if (!flat) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }
}

/** Shade a hex colour by a multiplier (helper for quick tonal variation). */
export function shade(hex: number, factor: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((hex & 255) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Blend two hex colours. */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
