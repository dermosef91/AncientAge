/**
 * Navigation grid + A* pathfinding.
 *
 * The world is a square tile grid centred on the origin. Terrain and building
 * footprints mark tiles impassable; units are *not* written into the grid
 * (that causes deadlock) - unit-unit avoidance is handled by steering.
 */

export const TILE = 2;
/**
 * 228 tiles per side is ten times the area of the original 72-tile map. The
 * world is one continent with outlying islands now, so most of a match is
 * played on a small explored corner of this.
 */
export const GRID_SIZE = 228;
export const WORLD_HALF = (GRID_SIZE * TILE) / 2;

export const T_DEEP = 0;
export const T_SHALLOW = 1;
export const T_SAND = 2;
export const T_GRASS = 3;
export const T_DRY = 4;
export const T_ROCK = 5;

export type Domain = 'land' | 'water';

export class Grid {
  readonly size = GRID_SIZE;
  readonly terrain = new Uint8Array(GRID_SIZE * GRID_SIZE);
  readonly height = new Float32Array(GRID_SIZE * GRID_SIZE);
  /** Building id occupying the tile, 0 when free. */
  readonly occupied = new Int32Array(GRID_SIZE * GRID_SIZE);
  /** Static blockers not tied to a building (rock outcrops, trees). */
  readonly blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);

  idx(gx: number, gz: number): number {
    return gz * GRID_SIZE + gx;
  }

  inBounds(gx: number, gz: number): boolean {
    return gx >= 0 && gz >= 0 && gx < GRID_SIZE && gz < GRID_SIZE;
  }

  /** World X/Z -> tile index (floored, may be out of bounds). */
  tileX(x: number): number {
    return Math.floor((x + WORLD_HALF) / TILE);
  }

  tileZ(z: number): number {
    return Math.floor((z + WORLD_HALF) / TILE);
  }

  /** Tile index -> world centre coordinate. */
  worldX(gx: number): number {
    return (gx + 0.5) * TILE - WORLD_HALF;
  }

  worldZ(gz: number): number {
    return (gz + 0.5) * TILE - WORLD_HALF;
  }

  terrainAt(x: number, z: number): number {
    const gx = this.tileX(x);
    const gz = this.tileZ(z);
    if (!this.inBounds(gx, gz)) return T_DEEP;
    return this.terrain[this.idx(gx, gz)];
  }

  /** Bilinear-ish sampled ground height, used to sit meshes on the terrain. */
  heightAt(x: number, z: number): number {
    const fx = (x + WORLD_HALF) / TILE - 0.5;
    const fz = (z + WORLD_HALF) / TILE - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h = (gx: number, gz: number): number => {
      const cx = gx < 0 ? 0 : gx >= GRID_SIZE ? GRID_SIZE - 1 : gx;
      const cz = gz < 0 ? 0 : gz >= GRID_SIZE ? GRID_SIZE - 1 : gz;
      return this.height[this.idx(cx, cz)];
    };
    const a = h(x0, z0);
    const b = h(x0 + 1, z0);
    const c = h(x0, z0 + 1);
    const d = h(x0 + 1, z0 + 1);
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
  }

  isWaterTile(gx: number, gz: number): boolean {
    const t = this.terrain[this.idx(gx, gz)];
    return t === T_DEEP || t === T_SHALLOW;
  }

  /** Can a unit of the given movement domain stand on this tile? */
  passable(gx: number, gz: number, domain: Domain): boolean {
    if (!this.inBounds(gx, gz)) return false;
    const i = this.idx(gx, gz);
    if (this.occupied[i] !== 0) return false;
    if (this.blocked[i] !== 0) return false;
    const t = this.terrain[i];
    if (domain === 'water') return t === T_DEEP || t === T_SHALLOW;
    return t !== T_DEEP && t !== T_ROCK;
  }

  passableWorld(x: number, z: number, domain: Domain): boolean {
    return this.passable(this.tileX(x), this.tileZ(z), domain);
  }

  /** True when a building of `size` tiles can be placed with corner (gx,gz). */
  canPlace(gx: number, gz: number, size: number, water: boolean): boolean {
    let touchesWater = false;
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = gx + dx;
        const tz = gz + dz;
        if (!this.inBounds(tx, tz)) return false;
        const i = this.idx(tx, tz);
        if (this.occupied[i] !== 0 || this.blocked[i] !== 0) return false;
        const t = this.terrain[i];
        if (t === T_ROCK || t === T_DEEP) return false;
        if (t === T_SHALLOW) {
          if (!water) return false;
          touchesWater = true;
        }
      }
    }
    if (water) {
      // Docks must straddle the shoreline: some shallow water in the footprint
      // or immediately adjacent to it.
      if (!touchesWater) {
        outer: for (let dz = -1; dz <= size; dz++) {
          for (let dx = -1; dx <= size; dx++) {
            const tx = gx + dx;
            const tz = gz + dz;
            if (!this.inBounds(tx, tz)) continue;
            const t = this.terrain[this.idx(tx, tz)];
            if (t === T_SHALLOW || t === T_DEEP) {
              touchesWater = true;
              break outer;
            }
          }
        }
      }
      return touchesWater;
    }
    return true;
  }

  setOccupied(gx: number, gz: number, size: number, id: number): void {
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        if (!this.inBounds(gx + dx, gz + dz)) continue;
        this.occupied[this.idx(gx + dx, gz + dz)] = id;
      }
    }
  }

  /** Nearest passable tile to (gx,gz) within `maxRing` rings, or null. */
  nearestPassable(gx: number, gz: number, domain: Domain, maxRing = 14): { gx: number; gz: number } | null {
    if (this.passable(gx, gz, domain)) return { gx, gz };
    for (let r = 1; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = gx + dx;
          const tz = gz + dz;
          if (this.passable(tx, tz, domain)) return { gx: tx, gz: tz };
        }
      }
    }
    return null;
  }

  /**
   * Straight-line walkability test used to shorten paths. Samples the segment
   * and a pair of perpendicular offsets so units keep clear of wall corners.
   */
  lineOfSight(x0: number, z0: number, x1: number, z1: number, domain: Domain, clearance = 0.55): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return this.passableWorld(x0, z0, domain);
    const steps = Math.max(2, Math.ceil(len / (TILE * 0.4)));
    const nx = -dz / len;
    const nz = dx / len;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      if (!this.passableWorld(px, pz, domain)) return false;
      if (!this.passableWorld(px + nx * clearance, pz + nz * clearance, domain)) return false;
      if (!this.passableWorld(px - nx * clearance, pz - nz * clearance, domain)) return false;
    }
    return true;
  }
}

/** ---------------------------------------------------------------------------
 * A* with reusable buffers and a binary heap.
 * ------------------------------------------------------------------------- */
const N = GRID_SIZE * GRID_SIZE;

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export class PathFinder {
  private g = new Float32Array(N);
  private f = new Float32Array(N);
  private came = new Int32Array(N);
  private state = new Uint8Array(N); // 0 unseen, 1 open, 2 closed
  private stamp = new Int32Array(N);
  private run = 0;
  private heap = new Int32Array(N + 1);
  private heapLen = 0;

  constructor(private grid: Grid) {}

  private push(node: number): void {
    let i = ++this.heapLen;
    this.heap[i] = node;
    while (i > 1) {
      const p = i >> 1;
      if (this.f[this.heap[p]] <= this.f[this.heap[i]]) break;
      const t = this.heap[p];
      this.heap[p] = this.heap[i];
      this.heap[i] = t;
      i = p;
    }
  }

  private pop(): number {
    const top = this.heap[1];
    this.heap[1] = this.heap[this.heapLen--];
    let i = 1;
    for (;;) {
      const l = i << 1;
      const r = l + 1;
      let m = i;
      if (l <= this.heapLen && this.f[this.heap[l]] < this.f[this.heap[m]]) m = l;
      if (r <= this.heapLen && this.f[this.heap[r]] < this.f[this.heap[m]]) m = r;
      if (m === i) break;
      const t = this.heap[m];
      this.heap[m] = this.heap[i];
      this.heap[i] = t;
      i = m;
    }
    return top;
  }

  /**
   * Returns a flat list of world-space waypoints [x0,z0,x1,z1,...] or null.
   * The start position is not included; the final waypoint is the goal.
   */
  find(
    sx: number,
    sz: number,
    tx: number,
    tz: number,
    domain: Domain,
    maxNodes = 7000,
  ): number[] | null {
    const grid = this.grid;
    let sgx = grid.tileX(sx);
    let sgz = grid.tileZ(sz);
    let tgx = grid.tileX(tx);
    let tgz = grid.tileZ(tz);

    if (!grid.inBounds(sgx, sgz) || !grid.inBounds(tgx, tgz)) return null;

    if (!grid.passable(sgx, sgz, domain)) {
      const near = grid.nearestPassable(sgx, sgz, domain, 6);
      if (!near) return null;
      sgx = near.gx;
      sgz = near.gz;
    }
    if (!grid.passable(tgx, tgz, domain)) {
      const near = grid.nearestPassable(tgx, tgz, domain, 10);
      if (!near) return null;
      tgx = near.gx;
      tgz = near.gz;
      tx = grid.worldX(tgx);
      tz = grid.worldZ(tgz);
    }

    const start = grid.idx(sgx, sgz);
    const goal = grid.idx(tgx, tgz);
    if (start === goal) return [tx, tz];

    // Fast path: clear straight shot.
    if (grid.lineOfSight(sx, sz, tx, tz, domain)) return [tx, tz];

    this.run++;
    const run = this.run;
    this.heapLen = 0;

    const h = (i: number): number => {
      const ax = i % GRID_SIZE;
      const az = (i / GRID_SIZE) | 0;
      const dx = Math.abs(ax - tgx);
      const dz = Math.abs(az - tgz);
      const lo = Math.min(dx, dz);
      const hi = Math.max(dx, dz);
      return (hi - lo) + lo * Math.SQRT2;
    };

    this.g[start] = 0;
    this.f[start] = h(start);
    this.came[start] = -1;
    this.state[start] = 1;
    this.stamp[start] = run;
    this.push(start);

    let expanded = 0;
    let found = false;
    let best = start;
    let bestH = h(start);

    while (this.heapLen > 0) {
      const cur = this.pop();
      if (this.stamp[cur] !== run || this.state[cur] === 2) continue;
      this.state[cur] = 2;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;

      const cx = cur % GRID_SIZE;
      const cz = (cur / GRID_SIZE) | 0;
      const ch = h(cur);
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }

      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dz = DIRS[d][1];
        const nx = cx + dx;
        const nz = cz + dz;
        if (!grid.passable(nx, nz, domain)) continue;
        // Prevent cutting diagonally through blocked corners.
        if (dx !== 0 && dz !== 0) {
          if (!grid.passable(cx + dx, cz, domain) || !grid.passable(cx, cz + dz, domain)) continue;
        }
        const ni = grid.idx(nx, nz);
        if (this.stamp[ni] !== run) {
          this.stamp[ni] = run;
          this.state[ni] = 0;
          this.g[ni] = Infinity;
        }
        if (this.state[ni] === 2) continue;
        const tentative = this.g[cur] + DIRS[d][2];
        if (tentative < this.g[ni]) {
          this.g[ni] = tentative;
          this.came[ni] = cur;
          this.f[ni] = tentative + h(ni) * 1.05; // slight weight: faster, near-optimal
          this.state[ni] = 1;
          this.push(ni);
        }
      }
    }

    const endNode = found ? goal : best;
    if (!found && bestH >= h(start)) return null;

    // Reconstruct.
    const rev: number[] = [];
    let n = endNode;
    let guard = 0;
    while (n !== -1 && guard++ < N) {
      rev.push(n);
      if (n === start) break;
      n = this.came[n];
    }
    rev.reverse();

    const pts: number[] = [];
    for (let i = 1; i < rev.length; i++) {
      pts.push(grid.worldX(rev[i] % GRID_SIZE), grid.worldZ((rev[i] / GRID_SIZE) | 0));
    }
    if (found) {
      // Replace the last tile centre with the true goal when reachable.
      if (pts.length >= 2) {
        pts[pts.length - 2] = tx;
        pts[pts.length - 1] = tz;
      } else {
        pts.push(tx, tz);
      }
    }
    if (pts.length === 0) return null;

    return this.smooth(sx, sz, pts, domain);
  }

  /** String-pull: drop waypoints that are already visible from the anchor. */
  private smooth(sx: number, sz: number, pts: number[], domain: Domain): number[] {
    const out: number[] = [];
    let ax = sx;
    let az = sz;
    let i = 0;
    const count = pts.length / 2;
    while (i < count) {
      // Find the furthest visible waypoint from the current anchor.
      let best = i;
      for (let j = count - 1; j > i; j--) {
        if (this.grid.lineOfSight(ax, az, pts[j * 2], pts[j * 2 + 1], domain)) {
          best = j;
          break;
        }
      }
      out.push(pts[best * 2], pts[best * 2 + 1]);
      ax = pts[best * 2];
      az = pts[best * 2 + 1];
      i = best + 1;
    }
    return out;
  }
}
