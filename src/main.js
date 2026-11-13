import * as THREE from 'three';
import './style.css';
import { pickQuality } from './config.js';
import { loadAssets } from './assets.js';
import { patchFogChunks, createAtmosphere } from './world/atmosphere.js';
import { createTerrain } from './world/terrain.js';
import { createWater } from './world/water.js';
import { createForest } from './world/trees.js';
import { createScatter } from './world/scatter.js';
import { createGrass } from './world/grass.js';
import { createPost } from './fx/post.js';
import { Player, ColliderGrid } from './player/controls.js';
import { riverX, riverHalfWidth, heightAt } from './world/layout.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const quality = pickQuality(params);
const canvas = document.getElementById('view');

const shared = {
  time: { value: 0 },
  heightTex: { value: null },
  spawn: { x: riverX(14) + riverHalfWidth(14) + 3.2, z: 14 },
};

async function boot() {
  patchFogChunks();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.12, 900);
  camera.layers.enable(1);
  scene.add(camera);

  const world = { colliders: new ColliderGrid(), scene, camera, shared, quality };

  const { tex, models } = await loadAssets(quality, (p) => progress('assets', p));
  const atmos = createAtmosphere(scene, renderer, shared, quality);
  const terrain = createTerrain(tex, shared, quality);
  scene.add(terrain.mesh);
  const water = createWater(tex, shared, quality);
  scene.add(water.mesh);
  const forest = await createForest(shared, quality, (p) => progress('forest', p));
  scene.add(forest.group);
  for (const t of forest.trees) world.colliders.add(t);
  world.trees = forest.trees;

  const scatter = await createScatter(models, shared, quality, world);
  scene.add(scatter.group);
  const grass = createGrass(shared, quality);
  scene.add(grass.mesh);

  const post = createPost(renderer, scene, camera, atmos.sun, quality);
  const player = new Player(camera, canvas, world);
  player.place(shared.spawn.x, shared.spawn.z, 0.5, -0.05);

  let pixelRatio = Math.min(devicePixelRatio || 1, quality.maxPixelRatio);
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  if (SHOT) {
    const c = (params.get('cam') || '').split(',').map(Number);
    if (c.length >= 4) {
      player.place(c[0], c[1], c[2], c[3]);
      if (c[4]) { player.eye = c[4]; player.smoothY = null; player.apply(0); }
    }
    shared.time.value = Number(params.get('t') || 20);
  } else {
    player.enabled = true;
    canvas.addEventListener('click', () => canvas.requestPointerLock && canvas.requestPointerLock());
  }

  const clock = new THREE.Clock();
  let frames = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!SHOT) shared.time.value += dt;
    player.update(SHOT ? 0 : dt);
    camera.updateMatrixWorld();
    atmos.update(camera);
    forest.update(camera.position);
    scatter.update(camera.position);
    renderer.info.reset();
    water.renderReflection(renderer, scene, camera);
    post.render(dt, shared.time.value);
    frames++;
    if (frames === (SHOT ? Number(params.get('frames') || 3) : 3)) {
      window.__ready = true; window.__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, scatter: scatter.sets.map((s) => [s.name, s.stats.n, ...s.stats.tris, '|', ...s.levels.map((l) => l.meshes[0].count)].join(' ')), forest: forest.sets.map((s) => [s.name, s.stats.n, ...s.stats.tris, '|', ...s.levels.map((l) => l.meshes[0].count)].join(' ')) };
      if (SHOT) return; // freeze on this frame so a screenshot can be taken
    }
    requestAnimationFrame(frame);
  }
  frame();
  window.__app = { renderer, scene, camera, player, world, post, quality };
}

function progress(stage, p) { window.__progress = `${stage} ${(p * 100) | 0}%`; }

boot().catch((e) => { console.error(e); window.__error = String(e && e.stack || e); });
