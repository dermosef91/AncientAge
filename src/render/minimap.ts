import { GRID_SIZE, T_DEEP, T_DRY, T_GRASS, T_ROCK, T_SAND, T_SHALLOW, TILE, WORLD_HALF } from '../sim/grid';
import type { Game } from '../sim/game';
import { TEAM_COLORS } from './scene';

const TERRAIN_HEX: Record<number, string> = {
  [T_DEEP]: '#1d6d92',
  [T_SHALLOW]: '#3f9fa8',
  [T_SAND]: '#dcc596',
  [T_GRASS]: '#8fa860',
  [T_DRY]: '#bcb474',
  [T_ROCK]: '#8f887c',
};

/** Compact 2D minimap: static terrain layer + live entity overlay. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private size = 0;
  private game: Game | null = null;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap: 2D context unavailable');
    this.ctx = ctx;
    this.base = document.createElement('canvas');
  }

  setGame(game: Game): void {
    this.game = game;
    this.renderBase();
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
        const t = game.grid.terrain[game.grid.idx(gx, gz)];
        const hex = TERRAIN_HEX[t] ?? '#dcc596';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        // Fake relief with the height field.
        const h = game.grid.height[game.grid.idx(gx, gz)];
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

    // Resource nodes.
    for (const n of game.nodes) {
      if (n.depleted || n.type === 'farm') continue;
      const [x, y] = this.worldToMap(n.x, n.z);
      ctx.fillStyle =
        n.resource === 'wood' ? '#4a7a3a' : n.resource === 'gold' ? '#e6b422' : n.resource === 'stone' ? '#b9b3a6' : '#c8503f';
      ctx.fillRect(x - 0.7, y - 0.7, 1.6, 1.6);
    }

    // Buildings.
    for (const b of game.buildings) {
      if (b.dead) continue;
      const [x, y] = this.worldToMap(b.x, b.z);
      const w = Math.max(3, (b.size * TILE * s) / (GRID_SIZE * TILE));
      ctx.fillStyle = b.owner === 0 ? '#3fb8e8' : '#e8563f';
      ctx.globalAlpha = b.complete ? 1 : 0.55;
      ctx.fillRect(x - w / 2, y - w / 2, w, w);
      ctx.globalAlpha = 1;
      if (b.type === 'towncenter') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2 - 1, y - w / 2 - 1, w + 2, w + 2);
      }
    }

    // Units.
    for (const u of game.units) {
      if (u.state === 'dead') continue;
      const [x, y] = this.worldToMap(u.x, u.z);
      ctx.fillStyle = u.owner === 0 ? '#7fe0ff' : '#ff8a72';
      const r = u.type === 'villager' ? 1.1 : 1.6;
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }

    // Camera viewport indicator.
    const [cx, cy] = this.worldToMap(cameraTarget.x, cameraTarget.z);
    const rw = (viewRadius / (GRID_SIZE * TILE)) * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cx - rw, cy - rw * 0.62, rw * 2, rw * 1.24);
    void TEAM_COLORS;
  }
}
