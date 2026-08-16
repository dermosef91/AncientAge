import { GRID_SIZE, TILE, WORLD_HALF } from '../sim/grid';
import type { Game } from '../sim/game';
import { TEAM_COLORS } from './scene';

/** Terrain colours per region biome (egypt / greece / rome), RGB triples. */
const BIOME_TERRAIN_RGB: [number, number, number][][] = [
  // egypt — bleached desert
  [
    [29, 109, 146], [63, 159, 168], [230, 207, 156], [169, 168, 98], [216, 192, 132], [194, 171, 139],
  ],
  // greece — warm mediterranean
  [
    [29, 109, 146], [63, 159, 168], [220, 197, 150], [143, 168, 96], [188, 180, 116], [143, 136, 124],
  ],
  // rome — green lowland
  [
    [29, 109, 146], [63, 159, 168], [214, 201, 162], [118, 145, 74], [168, 172, 102], [156, 150, 137],
  ],
];

/** Compact 2D minimap: static terrain layer + fog overlay + live entities. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private fogFrame = 0;
  private size = 0;
  private game: Game | null = null;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap: 2D context unavailable');
    this.ctx = ctx;
    this.base = document.createElement('canvas');
    this.fog = document.createElement('canvas');
  }

  setGame(game: Game): void {
    this.game = game;
    this.renderBase();
    this.fogFrame = 0;
    this.renderFog();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.max(60, Math.round(rect.width));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = px;
    this.canvas.width = Math.round(px * this.dpr);
    this.canvas.height = Math.round(px * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private renderBase(): void {
    const game = this.game;
    if (!game) return;
    const n = GRID_SIZE;
    this.base.width = n;
    this.base.height = n;
    const bctx = this.base.getContext('2d');
    if (!bctx) return;
    const img = bctx.createImageData(n, n);
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const idx = game.grid.idx(gx, gz);
        const t = game.grid.terrain[idx];
        const bio = game.biomes ? game.biomes[idx] : 1;
        const [r, g, b] = BIOME_TERRAIN_RGB[bio]?.[t] ?? [220, 197, 150];
        // Fake relief with the height field.
        const h = game.grid.height[idx];
        const hn = game.grid.height[game.grid.idx(gx, Math.max(0, gz - 1))];
        const shade = 1 + Math.max(-0.25, Math.min(0.25, (h - hn) * 0.35));
        const i = (gz * n + gx) * 4;
        img.data[i] = Math.min(255, r * shade);
        img.data[i + 1] = Math.min(255, g * shade);
        img.data[i + 2] = Math.min(255, b * shade);
        img.data[i + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  private renderFog(): void {
    const game = this.game;
    if (!game) return;
    const n = GRID_SIZE;
    this.fog.width = n;
    this.fog.height = n;
    const fctx = this.fog.getContext('2d');
    if (!fctx) return;
    const img = fctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const o = i * 4;
      img.data[o] = 6;
      img.data[o + 1] = 9;
      img.data[o + 2] = 14;
      img.data[o + 3] = game.explored[i] ? 0 : 235;
    }
    fctx.putImageData(img, 0, 0);
  }

  private worldToMap(x: number, z: number): [number, number] {
    const s = this.size;
    return [((x + WORLD_HALF) / (GRID_SIZE * TILE)) * s, ((z + WORLD_HALF) / (GRID_SIZE * TILE)) * s];
  }

  /** Map-local pixel coordinates -> world position. */
  mapToWorld(px: number, py: number): { x: number; z: number } {
    const s = this.size || 1;
    return {
      x: (px / s) * (GRID_SIZE * TILE) - WORLD_HALF,
      z: (py / s) * (GRID_SIZE * TILE) - WORLD_HALF,
    };
  }

  draw(cameraTarget: { x: number; z: number }, viewRadius: number): void {
    const game = this.game;
    if (!game || this.size === 0) return;
    const ctx = this.ctx;
    const s = this.size;
    ctx.clearRect(0, 0, s, s);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, s, s);

    // Resource nodes show on explored ground only.
    for (const n of game.nodes) {
      if (n.depleted || n.type === 'farm') continue;
      if (!game.isExploredAt(n.x, n.z)) continue;
      const [x, y] = this.worldToMap(n.x, n.z);
      ctx.fillStyle =
        n.resource === 'wood' ? '#4a7a3a' : n.resource === 'gold' ? '#e6b422' : n.resource === 'stone' ? '#b9b3a6' : '#c8503f';
      ctx.fillRect(x - 0.7, y - 0.7, 1.6, 1.6);
    }

    // Treasures the player has laid eyes on and not yet claimed.
    for (const t of game.treasures) {
      if (t.taken || !t.spotted) continue;
      const [x, y] = this.worldToMap(t.x, t.z);
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }

    // Buildings: yours always, others once discovered.
    for (const b of game.buildings) {
      if (b.dead) continue;
      if (b.owner !== 0 && !game.isEntityVisible(b)) continue;
      const [x, y] = this.worldToMap(b.x, b.z);
      const w = Math.max(3, (b.size * TILE * s) / (GRID_SIZE * TILE));
      ctx.fillStyle = b.owner === 0 ? '#3fb8e8' : '#e8563f';
      ctx.globalAlpha = b.complete ? 1 : 0.55;
      ctx.fillRect(x - w / 2, y - w / 2, w, w);
      ctx.globalAlpha = 1;
      if (b.def.main) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2 - 1, y - w / 2 - 1, w + 2, w + 2);
      }
    }

    // Units: yours always; others only while watched. The wilds show pale.
    for (const u of game.units) {
      if (u.state === 'dead') continue;
      if (u.owner !== 0 && !game.isVisibleAt(u.x, u.z)) continue;
      const [x, y] = this.worldToMap(u.x, u.z);
      ctx.fillStyle = u.owner === 0 ? '#7fe0ff' : u.owner === 1 ? '#ff8a72' : '#d9c8a2';
      const r = u.type === 'villager' ? 1.1 : 1.6;
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }

    // Fog overlay, refreshed a couple of times a second.
    if (++this.fogFrame % 30 === 0) this.renderFog();
    ctx.drawImage(this.fog, 0, 0, s, s);

    // Camera viewport indicator.
    const [cx, cy] = this.worldToMap(cameraTarget.x, cameraTarget.z);
    const rw = (viewRadius / (GRID_SIZE * TILE)) * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cx - rw, cy - rw * 0.62, rw * 2, rw * 1.24);
    void TEAM_COLORS;
  }
}
