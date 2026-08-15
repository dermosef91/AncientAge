import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Color,
} from 'three';
import { GRID_SIZE, Grid, TILE, T_DEEP, T_DRY, T_GRASS, T_ROCK, T_SAND, T_SHALLOW, WORLD_HALF } from '../sim/grid';
import { C } from './palette';
import { mixHex } from './geo';
import { clamp, smoothstep } from '../core/math';

import type { Biome } from '../sim/mapgen';

export interface TerrainBuild {
  ground: Mesh;
  water: Mesh;
  /** Called every frame with elapsed seconds. */
  update: (t: number) => void;
  dispose: () => void;
}

const TERRAIN_COLOR: Record<number, number> = {
  [T_DEEP]: 0x2c6b7a,
  [T_SHALLOW]: 0x74a88f,
  [T_SAND]: C.sand,
  [T_GRASS]: C.grass,
  [T_DRY]: C.grassDry,
  [T_ROCK]: C.cliff,
};

/**
 * Ground colours per homeland. Egypt bleaches towards desert, Greece keeps the
 * warm Mediterranean base, Rome greens up. Only the land entries change — the
 * sea is the same sea whoever is fighting over it.
 */
const BIOME_GROUND: Record<Biome, Partial<Record<number, number>>> = {
  egypt: {
    [T_SAND]: 0xe6cf9c,
    [T_GRASS]: 0xa9a862,
    [T_DRY]: 0xd8c084,
    [T_ROCK]: 0xc2ab8b,
  },
  greece: {},
  rome: {
    [T_SAND]: 0xd6c9a2,
    [T_GRASS]: 0x76914a,
    [T_DRY]: 0xa8ac66,
    [T_ROCK]: 0x9c9689,
  },
};

/** Cheap hash noise for per-vertex colour variation. */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothHash(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export type Polyline = { x: number; z: number }[];

/** Squared distance from a point to a segment. */
function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-6 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export function buildTerrain(grid: Grid, paths: Polyline[], biome: Biome = 'greece'): TerrainBuild {
  const groundColor = { ...TERRAIN_COLOR, ...BIOME_GROUND[biome] };
  // The mottling and dry-patch tints follow the ground they sit on.
  const mottleLight = biome === 'rome' ? C.grassDry : C.sandLight;
  const mottleDark = biome === 'rome' ? C.grassDark : C.sandDark;
  const n = GRID_SIZE + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const indices: number[] = [];
  const col = new Color();

  // Flatten path polylines into segments for the road painting pass.
  const segs: number[] = [];
  for (const p of paths) {
    for (let i = 0; i < p.length - 1; i++) {
      segs.push(p[i].x, p[i].z, p[i + 1].x, p[i + 1].z);
    }
  }

  const cornerHeight = (cx: number, cz: number): number => {
    let sum = 0;
    let count = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) continue;
        sum += grid.height[grid.idx(gx, gz)];
        count++;
      }
    }
    return count ? sum / count : 0;
  };

  const cornerColor = (cx: number, cz: number, h: number): number => {
    // Blend the colours of the surrounding tiles.
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    let rockish = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const gx = clamp(cx + dx, 0, GRID_SIZE - 1);
        const gz = clamp(cz + dz, 0, GRID_SIZE - 1);
        const t = grid.terrain[grid.idx(gx, gz)];
        const c = groundColor[t] ?? C.sand;
        r += (c >> 16) & 255;
        g += (c >> 8) & 255;
        b += c & 255;
        if (t === T_ROCK) rockish++;
        count++;
      }
    }
    let hex = ((r / count) << 16) | ((g / count) << 8) | (b / count | 0);
    hex = (Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count);

    const wx = cx * TILE - WORLD_HALF;
    const wz = cz * TILE - WORLD_HALF;

    // Mottling.
    const noise = smoothHash(cx * 0.22, cz * 0.22) * 0.5 + smoothHash(cx * 0.9, cz * 0.9) * 0.5;
    hex = mixHex(hex, noise > 0.5 ? mottleLight : mottleDark, (noise - 0.5) * 0.34 + 0.09);

    // Dry grass patches on the greens.
    if (h > 0.1 && rockish === 0) {
      const patch = smoothHash(cx * 0.11 + 31, cz * 0.11 + 17);
      if (patch > 0.62) hex = mixHex(hex, C.grassDry, (patch - 0.62) * 1.6);
      if (patch < 0.3) hex = mixHex(hex, C.grassDark, (0.3 - patch) * 0.9);
    }

    // Beach lightening right at the waterline.
    if (h > -0.35 && h < 0.55) {
      hex = mixHex(hex, C.sandLight, smoothstep(0.55, -0.1, h) * 0.55);
    }

    // Trodden sandy paths.
    if (segs.length && h > 0.05) {
      let best = 999;
      for (let i = 0; i < segs.length; i += 4) {
        const d = distToSeg(wx, wz, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
        if (d < best) best = d;
        if (best < 0.4) break;
      }
      const wobble = smoothHash(cx * 0.6, cz * 0.6) * 0.9;
      const k = 1 - smoothstep(1.3 + wobble, 3.0 + wobble, best);
      if (k > 0) hex = mixHex(hex, C.path, k * 0.9);
    }
    return hex;
  };

  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cz * n + cx;
      const h = cornerHeight(cx, cz);
      positions[i * 3] = cx * TILE - WORLD_HALF;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = cz * TILE - WORLD_HALF;
      col.set(cornerColor(cx, cz, h));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
  }

  for (let cz = 0; cz < GRID_SIZE; cz++) {
    for (let cx = 0; cx < GRID_SIZE; cx++) {
      const a = cz * n + cx;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setIndex(indices.length > 65535 ? new BufferAttribute(new Uint32Array(indices), 1) : new BufferAttribute(new Uint16Array(indices), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const groundMat = new MeshLambertMaterial({ vertexColors: true });
  const ground = new Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();

  // --- Water ---------------------------------------------------------------
  const waterSeg = 72;
  const waterGeo = new PlaneGeometry(GRID_SIZE * TILE + 24, GRID_SIZE * TILE + 24, waterSeg, waterSeg);
  waterGeo.rotateX(-Math.PI / 2);
  // Tint the surface by the depth beneath it.
  const wpos = waterGeo.attributes.position as BufferAttribute;
  const wcol = new Float32Array(wpos.count * 3);
  for (let i = 0; i < wpos.count; i++) {
    const x = wpos.getX(i);
    const z = wpos.getZ(i);
    const h = grid.heightAt(x, z);
    const depth = clamp(-h / 2.0, 0, 1);
    col.set(mixHex(C.waterShallow, C.waterDeep, smoothstep(0.05, 0.85, depth)));
    wcol[i * 3] = col.r;
    wcol[i * 3 + 1] = col.g;
    wcol[i * 3 + 2] = col.b;
  }
  waterGeo.setAttribute('color', new BufferAttribute(wcol, 3));

  const waterMat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  const timeUniform = { value: 0 };
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         float waveH(vec2 p){
           return sin(p.x * 0.33 + uTime * 1.15) * 0.075
                + sin(p.y * 0.27 - uTime * 0.95) * 0.075
                + sin((p.x + p.y) * 0.17 + uTime * 0.6) * 0.05;
         }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vec2 wp = position.xz;
         float e = 0.75;
         float hC = waveH(wp);
         float hX = waveH(wp + vec2(e, 0.0));
         float hZ = waveH(wp + vec2(0.0, e));
         objectNormal = normalize(vec3(-(hX - hC) / e, 1.0, -(hZ - hC) / e));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += hC;`,
      );
  };

  const water = new Mesh(waterGeo, waterMat);
  water.position.y = 0.02;
  water.name = 'water';
  water.renderOrder = 1;

  return {
    ground,
    water,
    update: (t: number) => {
      timeUniform.value = t;
    },
    dispose: () => {
      geo.dispose();
      groundMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
    },
  };
}
