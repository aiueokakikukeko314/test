// Asset loading (textures + CC0 scanned models from Poly Haven, see CREDITS.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

const TEXTURES = {
  leavesD: ['textures/forest_leaves_02_diff.webp', true], leavesN: ['textures/forest_leaves_02_nor.webp', false],
  mossD: ['textures/forrest_ground_01_diff.webp', true], mossN: ['textures/forrest_ground_01_nor.webp', false],
  pebD: ['textures/river_small_rocks_diff.webp', true], pebN: ['textures/river_small_rocks_nor.webp', false],
  mudD: ['textures/brown_mud_leaves_01_diff.webp', true], mudN: ['textures/brown_mud_leaves_01_nor.webp', false],
  rockD: ['textures/mossy_rock_diff.webp', true], rockN: ['textures/mossy_rock_nor.webp', false],
  waterN: ['textures/waternormals.jpg', false],
};

export const MODELS = [
  'fern_02', 'rock_moss_set_01', 'rock_moss_set_02', 'rock_07', 'rock_09', 'stone_01', 'tree_stump_01', 'tree_stump_02',
  'dead_tree_trunk', 'dry_branches_medium_01', 'shrub_02', 'shrub_03', 'nettle_plant', 'weed_plant_02',
  'dandelion_01', 'periwinkle_plant', 'root_cluster_01', 'Fox',
];

export async function loadAssets(quality, onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  let done = 0;
  const total = Object.keys(TEXTURES).length + MODELS.length;
  const tick = () => onProgress(++done / total);
  const tl = new THREE.TextureLoader(manager);
  const tex = {};
  const texJobs = Object.entries(TEXTURES).map(([key, [url, srgb]]) => tl.loadAsync(BASE + url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = quality.anisotropy;
    tex[key] = t; tick();
  }));
  const gl = new GLTFLoader(manager);
  gl.setMeshoptDecoder(MeshoptDecoder);
  const models = {};
  const modelJobs = MODELS.map((id) => gl.loadAsync(`${BASE}models/${id}.glb`).then((g) => { models[id] = g; tick(); }).catch((e) => { console.warn('model failed', id, e); tick(); }));
  await Promise.all([...texJobs, ...modelJobs]);
  return { tex, models };
}
