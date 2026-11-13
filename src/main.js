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
import { riverX, riverHalfWidth, heightAt, CLEARINGS } from './world/layout.js';
import { createDeer } from './fauna/deer.js';
import { createFish } from './fauna/fish.js';
import { createBirds } from './fauna/birds.js';
import { createButterflies } from './fauna/butterflies.js';
import { createFox } from './fauna/fox.js';
import { createParticles } from './world/particles.js';

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

  const deer = createDeer(world, CLEARINGS);
  scene.add(deer.group);
  const fish = createFish(world, shared, quality.name === 'low' ? 45 : 80);
  scene.add(fish.group);
  const birds = createBirds(world, shared, scatter);
  scene.add(birds.group);
  const butterflies = createButterflies(world, shared, CLEARINGS);
  scene.add(butterflies.group);
  const fox = createFox(world, models.Fox, { x: CLEARINGS[2].x - 4, z: CLEARINGS[2].z + 3 });
  if (fox) scene.add(fox.group);
  const fauna = [deer, fish, birds, butterflies, fox].filter(Boolean);
  const particles = createParticles(shared, quality);
  scene.add(particles.group);

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
    particles.setSize(h * pixelRatio);
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
    // debug helpers for still frames: ?pose=deer,<index>,<state>&sim=<seconds>&view=deer,<index>,<dist>,<azimuth>,<height>
    const pose = (params.get('pose') || '').split(',');
    if (pose[0] === 'deer') { const d = deer.list[+pose[1]]; d.state = pose[2]; d.timer = 999; if (pose[2] === 'flee' || pose[2] === 'walk') d.target = new THREE.Vector3(d.pos.x + 60, 0, d.pos.z + 20); }
    const sim = Number(params.get('sim') || 0);
    for (let i = 0; i < sim * 30; i++) for (const f of fauna) f.update(1 / 30, { pos: new THREE.Vector3(1e4, 0, 1e4), speed: 0 });
    const view = (params.get('view') || '').split(',');
    const subjects = { deer: () => deer.list[+view[1]], fox: () => ({ pos: fox.state.pos, heading: fox.state.heading, scale: 0.5 }),
      bird: () => ({ pos: birds.birds[+view[1]].pos.clone().setY(birds.birds[+view[1]].pos.y - 0.7), heading: birds.birds[+view[1]].heading, scale: 1 }),
      fish: () => ({ pos: new THREE.Vector3(fish.fish[+view[1]].x, 0.2, fish.fish[+view[1]].z), heading: 0, scale: 0 }) };
    if (subjects[view[0]]) {
      const d = subjects[view[0]](), dist = +view[2] || 4, az = +view[3] || 0, hgt = +view[4] || 1.1;
      const a = d.heading + az;
      const cx = d.pos.x + Math.sin(a) * dist, cz = d.pos.z + Math.cos(a) * dist;
      camera.position.set(cx, d.pos.y + hgt, cz);
      camera.lookAt(d.pos.x, d.pos.y + 0.75 * d.scale, d.pos.z);
      player.update = () => {}; player.pos.set(cx, 0, cz);
    }
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
    if (!SHOT) for (const f of fauna) f.update(dt, player);
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
  window.__app = { renderer, scene, camera, player, world, post, quality, deer, fish, birds, fox };
}

function progress(stage, p) { window.__progress = `${stage} ${(p * 100) | 0}%`; }

boot().catch((e) => { console.error(e); window.__error = String(e && e.stack || e); });
