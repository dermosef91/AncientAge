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
 * Ground colours per region biome. Egypt bleaches towards desert, Greece keeps
 * the warm Mediterranean base, Rome greens up. The map carries all three side
 * by side now, so the palette is resolved per tile rather than per match —
 * corner-vertex averaging blends the seams automatically.
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

/** Terrain-type -> colour tables, one per biome index (see BIOME_INDEX). */
const BIOME_TABLES: Record<number, number>[] = (['egypt', 'greece', 'rome'] as Biome[]).map(
  (b) => ({ ...TERRAIN_COLOR, ...BIOME_GROUND[b] }) as Record<number, number>,
);

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

export function buildTerrain(grid: Grid, paths: Polyline[], biomes?: Uint8Array): TerrainBuild {
  // The mottling tints follow the ground they sit on, per region.
  const MOTTLE_LIGHT = [C.sandLight, C.sandLight, C.grassDry];
  const MOTTLE_DARK = [C.sandDark, C.sandDark, C.grassDark];
  const biomeAt = (gx: number, gz: number): number =>
    biomes ? biomes[clamp(gz, 0, GRID_SIZE - 1) * GRID_SIZE + clamp(gx, 0, GRID_SIZE - 1)] : 1;
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
    // Blend the colours of the surrounding tiles, each in its own biome's hue.
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
        const c = BIOME_TABLES[biomeAt(gx, gz)][t] ?? C.sand;
        r += (c >> 16) & 255;
        g += (c >> 8) & 255;
        b += c & 255;
        if (t === T_ROCK) rockish++;
        count++;
      }
    }
    let hex = (Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count);

    const wx = cx * TILE - WORLD_HALF;
    const wz = cz * TILE - WORLD_HALF;

    // Mottling, tinted for whichever region this corner sits in. Strong
    // enough that neighbouring facets visibly differ, as in the reference.
    const bio = biomeAt(cx, cz);
    const noise = smoothHash(cx * 0.22, cz * 0.22) * 0.5 + smoothHash(cx * 0.9, cz * 0.9) * 0.5;
    hex = mixHex(hex, noise > 0.5 ? MOTTLE_LIGHT[bio] : MOTTLE_DARK[bio], (noise - 0.5) * 0.44 + 0.12);

    // Dry grass patches on the greens.
    if (h > 0.1 && rockish === 0) {
      const patch = smoothHash(cx * 0.11 + 31, cz * 0.11 + 17);
      if (patch > 0.62) hex = mixHex(hex, C.grassDry, (patch - 0.62) * 1.6);
      if (patch < 0.3) hex = mixHex(hex, C.grassDark, (0.3 - patch) * 0.9);
    }

    // Wet sand right at the waterline: darker and warmer, not washed out —
    // the bright dry beach sits just above it.
    if (h > -0.35 && h < 0.6) {
      const wet = smoothstep(0.34, 0.05, h);
      hex = mixHex(hex, 0xd2b070, wet * 0.7);
      const dryline = smoothstep(0.6, 0.34, h) * (1 - wet);
      hex = mixHex(hex, C.sandLight, dryline * 0.35);
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
      let h = cornerHeight(cx, cz);
      // A little vertex jitter breaks flat plains into visible facets — the
      // low-poly look lives or dies on this once the material is flat-shaded.
      // Land only, and small enough that units never visibly float.
      if (h > 0.1) {
        // Never jitter land below the waterline + wave crest.
        h = Math.max(0.26, h + (smoothHash(cx * 3.1 + 13, cz * 3.1 + 7) - 0.5) * 0.22);
        positions[i * 3] = cx * TILE - WORLD_HALF + (smoothHash(cx * 2.3, cz * 2.3) - 0.5) * 0.7;
        positions[i * 3 + 2] = cz * TILE - WORLD_HALF + (smoothHash(cx * 2.7 + 41, cz * 2.7) - 0.5) * 0.7;
      } else {
        positions[i * 3] = cx * TILE - WORLD_HALF;
        positions[i * 3 + 2] = cz * TILE - WORLD_HALF;
      }
      positions[i * 3 + 1] = h;
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

  // Flat shading gives every triangle its own light — the faceted low-poly
  // ground of the reference art rather than a smooth blanket.
  const groundMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ground = new Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();

  // --- Water ---------------------------------------------------------------
  // One vertex per tile: the surf line needs this resolution to stay a line.
  const waterSeg = GRID_SIZE;
  const waterGeo = new PlaneGeometry(GRID_SIZE * TILE + 24, GRID_SIZE * TILE + 24, waterSeg, waterSeg);
  waterGeo.rotateX(-Math.PI / 2);
  // Tint the surface by the depth beneath it.
  const wpos = waterGeo.attributes.position as BufferAttribute;
  const wcol = new Float32Array(wpos.count * 3);
  const wbed = new Float32Array(wpos.count);
  for (let i = 0; i < wpos.count; i++) {
    const x = wpos.getX(i);
    const z = wpos.getZ(i);
    const h = grid.heightAt(x, z);
    wbed[i] = h;
    const depth = clamp(-h / 2.0, 0, 1);
    // Steep curve so even a shallow inland lake picks up some deep tone. The
    // foam itself is painted per-fragment in the shader, where it can stay a
    // crisp line instead of triangle-sized blobs.
    const hex = mixHex(C.waterShallow, C.waterDeep, smoothstep(0.0, 0.55, depth));
    col.set(hex);
    wcol[i * 3] = col.r;
    wcol[i * 3 + 1] = col.g;
    wcol[i * 3 + 2] = col.b;
  }
  waterGeo.setAttribute('color', new BufferAttribute(wcol, 3));
  waterGeo.setAttribute('bedh', new BufferAttribute(wbed, 1));

  const waterMat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    flatShading: true,
  });
  const timeUniform = { value: 0 };
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         attribute float bedh;
         varying float vBedH;
         varying vec2 vXZ;
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
         transformed.y += hC;
         vBedH = bedh;
         vXZ = position.xz;`,
      );
    // Surf, painted per fragment: a crisp broken white line where the seabed
    // rises to the land, gently breathing with the waves.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         varying float vBedH;
         varying vec2 vXZ;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float breathe = sin(uTime * 0.9 + vXZ.x * 0.07 + vXZ.y * 0.05) * 0.03;
           float line = smoothstep(-0.24 + breathe, -0.09 + breathe, vBedH)
                      * (1.0 - smoothstep(0.0, 0.09, vBedH));
           // Two interfering sines chop the ribbon into separate breakers.
           float streak = sin(vXZ.x * 0.62 + sin(vXZ.y * 0.5 + uTime * 0.55) * 2.4)
                        * sin(vXZ.y * 0.44 - uTime * 0.3 + vXZ.x * 0.21);
           float wisp = 0.35 + 0.65 * smoothstep(-0.3, 0.65, streak);
           float swash = smoothstep(-0.75, -0.26, vBedH) * (1.0 - line);
           float foam = clamp(pow(line, 2.1) * wisp * 1.35, 0.0, 1.0);
           // A soft moving ripple keeps broad shallows from reading flat.
           float ripple = sin(vXZ.x * 0.16 + uTime * 0.35) * sin(vXZ.y * 0.13 - uTime * 0.28)
                        + 0.5 * sin((vXZ.x + vXZ.y) * 0.31 + uTime * 0.5);
           diffuseColor.rgb *= 0.975 + 0.025 * ripple;
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.96, 0.94), swash * 0.1);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam * 0.93);
         }`,
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
