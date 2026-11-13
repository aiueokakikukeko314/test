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
import { createAudio } from './audio.js';
import { createCinematic } from './cinematic.js';
import { createUI } from './ui.js';
import { lodState } from './world/instancing.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const quality = pickQuality(params);
const canvas = document.getElementById('view');
const TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const ui = createUI(document.getElementById('ui'), { qualityName: quality.name, touch: TOUCH });
const STAGES = { assets: [0, 0.35, '素材を読み込み中…'], forest: [0.35, 0.9, '森を育てています…'], world: [0.9, 1, '動物たちを起こしています…'] };

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

  progress('world', 0.1);
  await new Promise((r) => setTimeout(r, 0));
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
  }

  // ---------- modes: 'menu' (film plays behind the menu), 'explore', 'film'
  const audio = createAudio();
  const app = { renderer, scene, camera, player, world, post, quality, deer, fish, birds, fox, shared };
  const cinematic = createCinematic(app);
  const farAway = { pos: new THREE.Vector3(1e4, 0, 1e4), speed: 0 };
  let mode = 'menu', paused = false, everExplored = false;
  const savedView = { x: shared.spawn.x, z: shared.spawn.z, yaw: 0.5, pitch: -0.05 };

  function lockPointer() {
    try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* not available */ }
  }
  function setMode(next) {
    if (mode === 'explore') { savedView.x = player.pos.x; savedView.z = player.pos.z; savedView.yaw = player.yaw; savedView.pitch = player.pitch; }
    mode = next;
    if (next === 'explore') {
      cinematic.stop(); post.setDof(false);
      camera.fov = 62; camera.updateProjectionMatrix();
      player.place(savedView.x, savedView.z, savedView.yaw, savedView.pitch);
      player.enabled = true; everExplored = true;
      ui.setFade(0); ui.showMenu(false); ui.setMode('explore');
      if (!TOUCH) lockPointer();
    } else {
      player.enabled = false;
      if (!cinematic.state.active) cinematic.start(0);
      if (document.pointerLockElement) document.exitPointerLock();
      if (next === 'film') { ui.showMenu(false); ui.setMode('film'); } else { ui.showMenu(true, everExplored); ui.setMode('menu'); }
    }
    forest.update(camera.position, true); scatter.update(camera.position, true);
  }
  ui.on('explore', () => { audio.start(); setMode('explore'); });
  ui.on('film', () => { audio.start(); setMode('film'); });
  ui.on('menu', () => setMode('menu'));
  ui.on('toggleMode', () => setMode(mode === 'film' ? 'explore' : 'film'));
  ui.on('nextShot', () => cinematic.next());
  ui.on('toggleSound', () => { audio.start(); audio.setMuted(!audio.muted); ui.setSound(!audio.muted); });
  ui.on('quality', (q) => { try { localStorage.setItem('forest-quality', q); } catch { /* private mode */ } const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); });
  player.onStep = (kind, running) => audio.step(kind, running);
  player.onStick = (x, y, dx, dy) => ui.stick(x, y, dx, dy);

  addEventListener('keydown', (e) => {
    if (e.repeat || mode === 'menu') return;
    if (e.code === 'KeyC') setMode(mode === 'film' ? 'explore' : 'film');
    else if (e.code === 'KeyM') { audio.setMuted(!audio.muted); ui.setSound(!audio.muted); }
    else if (e.code === 'KeyH') ui.toggleHud();
    else if (e.code === 'KeyN' && mode === 'film') cinematic.next();
    else if (e.code === 'Escape' && mode === 'film') setMode('menu');
  });
  canvas.addEventListener('click', () => { if (mode === 'explore' && !TOUCH && document.pointerLockElement !== canvas) lockPointer(); });
  document.addEventListener('pointerlockchange', () => {
    // leaving pointer lock while exploring (Esc) opens the menu
    if (!TOUCH && mode === 'explore' && document.pointerLockElement !== canvas) setMode('menu');
  });
  document.addEventListener('visibilitychange', () => { paused = document.hidden; if (paused) audio.suspend(); else audio.resume(); });

  // gentle wildlife notices while exploring
  const seen = new Set();
  function notices() {
    const p = player.pos;
    const near = (name, pos, dist, text) => { if (!seen.has(name) && pos.distanceTo(p) < dist) { seen.add(name); ui.toast(text); } };
    near('deer', deer.list[0].pos, 30, 'ニホンジカの群れが草を食べています');
    near('deer2', deer.list[4].pos, 28, '親子のシカがいます — 静かに近づいて');
    if (fox) near('fox', fox.state.pos, 26, 'キツネが岸辺を歩いています');
    if (!seen.has('fish') && player.inWater > 0.1) { seen.add('fish'); ui.toast('足もとをヤマメが泳いでいます'); }
  }

  if (SHOT) {
    ui.showMenu(false); document.getElementById('ui').style.display = params.has('ui') ? '' : 'none';
    if (params.has('ui')) { ui.showMenu(params.get('ui') === 'menu'); ui.setMode(params.get('ui')); }
    if (params.has('cine')) { cinematic.start(Number(params.get('cine'))); for (let i = 0, n = Number(params.get('u') || 0.4) * cinematic.shots[Number(params.get('cine'))].dur * 30; i < n; i++) cinematic.update(1 / 30, post); }
  } else {
    setMode('menu');
  }

  // ---------- main loop
  const timer = new THREE.Timer();
  let frames = 0, acc = 0, accN = 0, lastNotice = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) return;
    timer.update(now);
    const dt = SHOT ? 0 : Math.min(Math.max(timer.getDelta(), 0), 0.05);
    shared.time.value += dt;
    if (mode === 'explore') {
      player.update(dt);
      for (const f of fauna) f.update(dt, player);
      if ((lastNotice += dt) > 0.5) { lastNotice = 0; notices(); }
    } else if (!SHOT) {
      for (const f of fauna) f.update(dt, farAway);
      cinematic.update(dt, post);
      ui.setFade(cinematic.state.fade * (mode === 'menu' ? 0.6 : 1));
    } else if (!params.has('view') && !params.has('cine')) player.update(0);
    camera.updateMatrixWorld();
    lodState.scale = Math.round(Math.min(1.9, Math.max(1, 0.6 / Math.tan((camera.fov * Math.PI) / 360))) * 4) / 4;
    atmos.update(camera);
    forest.update(camera.position);
    scatter.update(camera.position);
    audio.update(dt, camera.position, player.yaw, shared.time.value);
    renderer.info.reset();
    water.renderReflection(renderer, scene, camera);
    post.render(dt, shared.time.value);
    frames++;
    if (frames === (SHOT ? Number(params.get('frames') || 3) : 3)) {
      window.__ready = true;
      window.__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
      if (SHOT) paused = true; // freeze on this frame so a screenshot can be taken
    }
    // adaptive resolution: trade pixels for frame rate
    if (!SHOT) {
      acc += dt; accN++;
      if (acc > 1.5) {
        const avg = acc / accN; acc = 0; accN = 0;
        const max = Math.min(devicePixelRatio || 1, quality.maxPixelRatio);
        let pr = pixelRatio;
        if (avg > 1 / 27 && pr > 0.5) pr = Math.max(0.5, pr * 0.86);
        else if (avg < 1 / 52 && pr < max) pr = Math.min(max, pr * 1.08);
        if (pr !== pixelRatio) { pixelRatio = pr; resize(); }
      }
    }
  }
  requestAnimationFrame(frame);
  window.__app = app;
}

function progress(stage, p) {
  window.__progress = `${stage} ${(p * 100) | 0}%`;
  const [a, b, text] = STAGES[stage];
  ui.setProgress(a + (b - a) * p, text);
}

boot().catch((e) => {
  console.error(e); window.__error = String((e && e.stack) || e);
  ui.error('読み込みに失敗しました。WebGL2 に対応したブラウザで開いてください。');
});
