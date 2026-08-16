/// <reference types="vite/client" />
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  BufferGeometry,
  Color,
  Group,
  LoopOnce,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FactionId } from '../sim/types';

/**
 * Skinned villager characters loaded from GLB, one model per civilisation,
 * all sharing one skeleton so a single animation set drives the lot. This is
 * the game's first departure from purely procedural art: real rigs, real
 * clips, textures shrunk to 512px so the whole cast costs under a megabyte.
 */

const TARGET_HEIGHT = 1.5;

/** Clip names as authored in the merged-animations GLB. */
export type ClipName =
  | 'Attack'
  | 'Collect_Object'
  | 'Heavy_Hammer_Swing'
  | 'Idle_02'
  | 'Idle_03'
  | 'Left_Slash'
  | 'Running'
  | 'Walking'
  | 'dying_backwards';

export interface CharacterHandle {
  root: Group;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  materials: MeshStandardMaterial[];
  current: string;
  /** Base emissive so the hurt flash can restore it. */
  flashT: number;
}

/** Approximate rig height from bone world positions — robust across scales. */
function rigHeight(root: Object3D): number {
  let lo = Infinity;
  let hi = -Infinity;
  const p = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if ((o as Bone).isBone) {
      o.getWorldPosition(p);
      if (p.y < lo) lo = p.y;
      if (p.y > hi) hi = p.y;
    }
  });
  if (!isFinite(lo) || hi - lo < 1e-4) return 1;
  // Bones span roughly hips-to-head; the mesh adds a little above and below.
  return (hi - lo) * 1.15;
}

export class CharacterSystem {
  private templates = new Map<FactionId, Object3D>();
  private scales = new Map<FactionId, number>();
  private clips: AnimationClip[] = [];
  private handles = new Map<number, CharacterHandle>();
  private loadPromise: Promise<void> | null = null;
  ready = false;

  /** Kicks off the downloads; safe to call more than once. */
  preload(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    // `?noassets` keeps the procedural models — the browser test suites run
    // on a software rasteriser where skinned meshes starve the frame budget.
    if (new URLSearchParams(location.search).has('noassets')) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/`;
    const load = (file: string) =>
      new Promise<{ scene: Object3D; animations: AnimationClip[] }>((resolve, reject) =>
        loader.load(base + file, (g) => resolve(g as never), undefined, reject),
      );

    this.loadPromise = Promise.all([
      load('villager-egypt.glb'),
      load('villager-greece.glb'),
      load('villager-rome.glb'),
      load('villager-anims.glb'),
    ])
      .then(([egypt, greece, rome, anims]) => {
        const factions: [FactionId, Object3D][] = [
          ['egypt', egypt.scene],
          ['greece', greece.scene],
          ['rome', rome.scene],
        ];
        for (const [id, scene] of factions) {
          scene.traverse((o) => {
            if ((o as Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = false;
              o.frustumCulled = false;
              const m = (o as Mesh).material as MeshStandardMaterial;
              // The flat diorama light reads better without PBR gloss.
              if (m) {
                m.roughness = 0.95;
                m.metalness = 0;
              }
            }
          });
          this.templates.set(id, scene);
          this.scales.set(id, TARGET_HEIGHT / rigHeight(scene));
        }
        // All four rigs share bone names, so the animated GLB's clips drive
        // every civilisation's villager directly.
        this.clips = anims.animations;
        this.ready = this.clips.length > 0 && this.templates.size === 3;
      })
      .catch((err) => {
        // Missing assets are not fatal — the procedural models take over.
        console.warn('characters: falling back to procedural models', err);
        this.ready = false;
      });
    return this.loadPromise;
  }

  /** The scene node for a unit, created on first sight. */
  obtain(unitId: number, faction: FactionId, parent: Object3D): CharacterHandle | null {
    let h = this.handles.get(unitId);
    if (h) return h;
    const template = this.templates.get(faction);
    if (!template) return null;
    const clone = SkeletonUtils.clone(template);
    const s = this.scales.get(faction) ?? 1;
    const root = new Group();
    clone.scale.multiplyScalar(s);
    root.add(clone);

    // Every instance gets its own material so the hurt flash stays personal.
    const materials: MeshStandardMaterial[] = [];
    clone.traverse((o) => {
      if ((o as Mesh).isMesh) {
        const src = (o as Mesh).material as MeshStandardMaterial;
        const own = src.clone();
        (o as Mesh).material = own;
        materials.push(own);
      }
    });

    const mixer = new AnimationMixer(clone);
    const actions = new Map<string, AnimationAction>();
    for (const clip of this.clips) actions.set(clip.name, mixer.clipAction(clip));

    h = { root, mixer, actions, materials, current: '', flashT: 0 };
    this.handles.set(unitId, h);
    parent.add(root);
    return h;
  }

  /** Crossfades to a clip; `once` clips clamp on their final frame. */
  play(h: CharacterHandle, name: ClipName, timeScale = 1, once = false): void {
    const action = h.actions.get(name);
    if (!action) return;
    action.timeScale = timeScale;
    if (h.current === name) return;
    const prev = h.actions.get(h.current);
    if (once) {
      action.reset();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.reset();
    }
    action.fadeIn(0.14).play();
    if (prev) prev.fadeOut(0.14);
    h.current = name;
  }

  flash(h: CharacterHandle, k: number): void {
    for (const m of h.materials) {
      m.emissive.setRGB(k * 0.9, k * 0.12, k * 0.08);
    }
  }

  update(dt: number): void {
    for (const h of this.handles.values()) h.mixer.update(dt);
  }

  /** The handle if one exists, without creating anything. */
  peek(unitId: number): CharacterHandle | undefined {
    return this.handles.get(unitId);
  }

  release(unitId: number): void {
    const h = this.handles.get(unitId);
    if (!h) return;
    h.root.parent?.remove(h.root);
    for (const m of h.materials) m.dispose();
    this.handles.delete(unitId);
  }

  releaseAll(): void {
    for (const id of [...this.handles.keys()]) this.release(id);
  }

  get count(): number {
    return this.handles.size;
  }
}

/** ---------------------------------------------------------------------------
 * The palm, as a plain textured mesh for the instanced pipelines.
 * ------------------------------------------------------------------------- */
export interface PalmAsset {
  geo: BufferGeometry;
  mat: Material;
}

let palmAsset: PalmAsset | null = null;
let palmPromise: Promise<void> | null = null;

export function preloadPalm(): Promise<void> {
  if (palmPromise) return palmPromise;
  if (new URLSearchParams(location.search).has('noassets')) {
    palmPromise = Promise.resolve();
    return palmPromise;
  }
  const loader = new GLTFLoader();
  palmPromise = new Promise<void>((resolve) => {
    loader.load(
      `${import.meta.env.BASE_URL}models/palm.glb`,
      (g) => {
        let found: Mesh | null = null;
        g.scene.traverse((o) => {
          if (!found && (o as Mesh).isMesh) found = o as Mesh;
        });
        if (found) {
          const mesh = found as Mesh;
          const geo = mesh.geometry.clone();
          // Normalise: feet on the ground, ~5 world units tall.
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const h = Math.max(1e-5, bb.max.y - bb.min.y);
          // This asset carries a wide crown, so a modest height keeps its
          // footprint near the old procedural palm's.
          const s = 3.9 / h;
          geo.translate(0, -bb.min.y, 0);
          geo.scale(s, s, s);
          const mat = mesh.material as MeshStandardMaterial;
          mat.roughness = 1;
          mat.metalness = 0;
          // Instanced hurt-free foliage never needs per-instance colour depth.
          mat.color = mat.color ?? new Color(0xffffff);
          palmAsset = { geo, mat };
        }
        resolve();
      },
      undefined,
      () => {
        console.warn('palm.glb missing — keeping the procedural palm');
        resolve();
      },
    );
  });
  return palmPromise;
}

export function getPalmAsset(): PalmAsset | null {
  return palmAsset;
}
