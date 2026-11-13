// River fish (yamame-like trout): instanced bodies that hold station against the current,
// drift between spots in their pool and dart away when the visitor wades close.
import * as THREE from 'three';
import { MeshBuilder, ring, subdivide } from './meshbuilder.js';
import { heightAt, riverX, riverHalfWidth, riverDX, WATER_Y } from '../world/layout.js';
import { mulberry32, clamp, damp, dampAngle } from '../util/noise.js';

function fishGeometry() {
  const mb = new MeshBuilder();
  // body along +Z (head at +z), length 1 (scaled per instance)
  const prof = [[-0.5, 0.004, 0.05], [-0.44, 0.012, 0.045], [-0.34, 0.03, 0.062], [-0.18, 0.055, 0.1], [0.0, 0.072, 0.125], [0.16, 0.076, 0.128], [0.3, 0.066, 0.108], [0.4, 0.05, 0.08], [0.47, 0.03, 0.05], [0.5, 0.008, 0.015]];
  const rings = subdivide(prof.map(([z, rx, ry]) => ring(0, 0, z, rx, ry, [[0, 1]])), 2);
  mb.tube(rings, { seg: 10, uRect: [0, 0.8], capStart: true, capEnd: true });
  const g = mb.build();
  // fins: thin triangles appended (tail, dorsal, pectorals)
  const pos = Array.from(g.attributes.position.array), uv = Array.from(g.attributes.uv.array), idx = Array.from(g.index.array);
  const tri = (a, b, c, u) => { const k = pos.length / 3; pos.push(...a, ...b, ...c); uv.push(u, 0.1, u, 0.5, u, 0.9); idx.push(k, k + 1, k + 2); };
  tri([0, 0, -0.44], [0, 0.13, -0.62], [0, 0.0, -0.55], 0.9); tri([0, 0, -0.44], [0, 0.0, -0.55], [0, -0.13, -0.62], 0.9); // tail
  tri([0, 0.118, 0.08], [0, 0.2, -0.04], [0, 0.11, -0.12], 0.9);     // dorsal
  tri([0.06, -0.06, 0.26], [0.16, -0.1, 0.16], [0.07, -0.08, 0.16], 0.9); tri([-0.06, -0.06, 0.26], [-0.07, -0.08, 0.16], [-0.16, -0.1, 0.16], 0.9);
  tri([0, -0.11, -0.12], [0, -0.17, -0.2], [0, -0.09, -0.24], 0.9);  // anal
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

function fishTexture() {
  const W = 256, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data; const rand = mulberry32(5);
  const marks = []; for (let i = 0; i < 9; i++) marks.push(0.16 + i * 0.085 + (rand() - 0.5) * 0.02);
  const spots = []; for (let i = 0; i < 70; i++) spots.push([rand(), 0.3 + rand() * 0.2, 0.004 + rand() * 0.004]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const U = (x + 0.5) / W, V = 1 - (y + 0.5) / H; // V: 0 tail .. 1 head
    let c;
    if (U < 0.81) {
      const u = U / 0.8, sn = -Math.cos(u * Math.PI * 2); // -1 belly .. 1 back
      const back = [0.2, 0.24, 0.13], side = [0.56, 0.56, 0.42], belly = [0.86, 0.84, 0.76];
      const t1 = Math.min(1, Math.max(0, (sn + 0.85) / 0.7)), t2 = Math.min(1, Math.max(0, (sn - 0.1) / 0.6));
      c = [0, 1, 2].map((k) => { const a = belly[k] + (side[k] - belly[k]) * t1; return a + (back[k] - a) * t2; });
      // parr marks: dark blue-grey ovals along the lateral line, pink flush between them
      let m = 0; for (const mv of marks) { const dv = (V - mv) / 0.026, ds = (sn - 0.02) / 0.42; m = Math.max(m, 1 - Math.min(1, dv * dv + ds * ds)); }
      c = c.map((v, k) => v + ([0.2, 0.25, 0.32][k] - v) * m * 0.62);
      const flush = Math.max(0, 1 - Math.abs(sn - 0.0) / 0.25) * (1 - m) * 0.2; c[0] += flush * 0.5; c[2] -= flush * 0.1;
      let sp = 0; for (const [sv, su, sr] of spots) { const dv = V - sv, du = (sn * 0.25 + 0.5) - (su + 0.25); if (dv * dv + du * du < sr * sr * 6) sp = 1; }
      if (sn > 0.25) c = c.map((v) => v * (1 - sp * 0.55));
      if (V > 0.93) c = c.map((v) => v * 0.75);
    } else c = [0.42, 0.4, 0.28];
    const n = 0.9 + rand() * 0.2; const k = (y * W + x) * 4;
    d[k] = clamp(c[0] * n, 0, 1) * 255; d[k + 1] = clamp(c[1] * n, 0, 1) * 255; d[k + 2] = clamp(c[2] * n, 0, 1) * 255; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createFish(world, shared, count = 70) {
  const rand = mulberry32(31);
  const geo = fishGeometry();
  const swim = new Float32Array(count * 2); // phase, tail-beat speed
  geo.setAttribute('swim', new THREE.InstancedBufferAttribute(swim, 2));
  const mat = new THREE.MeshStandardMaterial({ map: fishTexture(), roughness: 0.32, metalness: 0.0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; attribute vec2 swim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float tailW = smoothstep(0.35, -0.6, position.z);
          float wave = sin(swim.x - position.z * 5.5);
          transformed.x += wave * (0.012 + 0.11 * tailW * tailW);
        }`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'fish';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // pools: deeper, slower stretches of the river
  const pools = [];
  for (let z = -120; z <= 120; z += 6) pools.push({ z, depth: -heightAt(riverX(z), z) });
  pools.sort((a, b) => b.depth - a.depth);
  const chosen = [];
  for (const p of pools) { if (chosen.every((c) => Math.abs(c.z - p.z) > 16)) chosen.push(p); if (chosen.length >= 9) break; }
  // always put one school right by the starting point
  chosen[0] = { z: shared.spawn.z - 6, depth: 1 };

  const fish = [];
  for (let i = 0; i < count; i++) {
    const pool = chosen[i % chosen.length];
    const f = {
      pool, len: 0.17 + rand() * 0.16, x: 0, y: 0, z: 0, heading: Math.PI, speed: 0, tx: 0, tz: 0, ty: 0, timer: 0, dart: 0, phase: rand(), beat: 0,
    };
    f.z = pool.z + (rand() - 0.5) * 10; f.x = riverX(f.z) + (rand() - 0.5) * riverHalfWidth(f.z); f.y = -0.3;
    fish.push(f);
    swim[i * 2] = rand(); swim[i * 2 + 1] = 9;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const pickTarget = (f) => {
    const z = f.pool.z + (rand() - 0.5) * 12;
    const hw = riverHalfWidth(z) * 0.72;
    f.tx = riverX(z) + (rand() * 2 - 1) * hw; f.tz = z;
    f.timer = 2.5 + rand() * 6;
  };
  for (const f of fish) pickTarget(f);

  function update(dt, player) {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      f.timer -= dt; f.dart = Math.max(0, f.dart - dt);
      const dxp = f.x - player.pos.x, dzp = f.z - player.pos.z, dp = Math.hypot(dxp, dzp);
      if (dp < 3.2 && f.dart <= 0 && player.pos.y < 0.5) {
        // dart away along the river
        const dir = Math.sign(dzp) || 1;
        const z = f.z + dir * (5 + rand() * 5);
        f.tx = riverX(z) + (rand() * 2 - 1) * riverHalfWidth(z) * 0.6; f.tz = z; f.dart = 1.4; f.timer = 3 + rand() * 3;
      } else if (f.timer <= 0) pickTarget(f);
      const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
      // holding station: face upstream (-z flow comes from -z, so fish look towards -z) when idle
      const k = riverDX(f.z);
      const upstream = Math.atan2(-k, -1);
      const want = d > 0.35 ? Math.atan2(dx, dz) : upstream;
      const wantSpeed = f.dart > 0 ? 3.2 : d > 0.35 ? 0.32 : 0.0;
      f.heading = dampAngle(f.heading, f.dart > 0 || d > 1.2 ? want : upstream + clamp((want - upstream), -0.9, 0.9) * 0.5, f.dart > 0 ? 9 : 2.5, dt);
      f.speed = damp(f.speed, wantSpeed, f.dart > 0 ? 8 : 2, dt);
      if (d > 0.05) { f.x += (dx / d) * f.speed * dt; f.z += (dz / d) * f.speed * dt; }
      const bed = heightAt(f.x, f.z);
      const depth = WATER_Y - bed;
      const yT = depth > 0.25 ? bed + Math.min(0.18 + depth * 0.3, depth - 0.1) : bed + 0.06;
      f.y = damp(f.y, Math.min(yT, WATER_Y - 0.07), 3, dt);
      const beat = 5 + f.speed * 9;
      f.phase = (f.phase + beat * dt) % 6283.1853; swim[i * 2] = f.phase;
      e.set(0, f.heading + Math.sin(shared.time.value * 0.9 + f.phase * 20) * 0.08, 0);
      q.setFromEuler(e);
      m4.compose(p.set(f.x, f.y, f.z), q, s.setScalar(f.len));
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.swim.needsUpdate = true;
  }
  update(0, { pos: new THREE.Vector3(1e4, 10, 1e4) });
  return { group: mesh, fish, update };
}
