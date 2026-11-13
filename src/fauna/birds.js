// Small birds (wagtails on the river stones, tits in the trees) and a kite soaring over the valley.
// One instanced mesh; wings are folded / flapped in the vertex shader from a per-instance attribute.
import * as THREE from 'three';
import { MeshBuilder, ring, subdivide } from './meshbuilder.js';
import { heightAt, riverX, riverHalfWidth, WATER_Y } from '../world/layout.js';
import { mulberry32, clamp, damp, dampAngle, lerp } from '../util/noise.js';

function birdGeometry() {
  const mb = new MeshBuilder();
  const back = [0.3, 0.31, 0.32], belly = [0.92, 0.9, 0.84], cap = [0.07, 0.07, 0.08];
  const prof = [ // z, y, rx, ry, colour mix (0 body, 1 head)
    [-0.055, 0.0, 0.006, 0.006, 0], [-0.04, 0.002, 0.017, 0.016, 0], [-0.015, 0.004, 0.026, 0.025, 0], [0.012, 0.008, 0.027, 0.026, 0],
    [0.034, 0.018, 0.021, 0.021, 0], [0.05, 0.03, 0.0185, 0.0185, 1], [0.064, 0.034, 0.015, 0.015, 1], [0.074, 0.033, 0.007, 0.007, 1], [0.089, 0.031, 0.001, 0.001, 2],
  ];
  const rings = subdivide(prof.map(([z, y, rx, ry, h]) => ring(0, y, z, rx, ry, [[0, 1]], { h })), 2);
  mb.tube(rings, { seg: 10, capStart: true, capEnd: true });
  const g = mb.build();
  const pos = Array.from(g.attributes.position.array), idx = Array.from(g.index.array);
  const col = [], wing = new Array(pos.length / 3).fill(0);
  // colour body by height (belly pale, back dark, black cap + bib on the head)
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const up = clamp((y - 0.006) / 0.012 + 0.5, 0, 1);
    let c = back.map((b, k) => lerp(belly[k], b, up));
    if (z > 0.04) { const head = clamp((y - 0.022) / 0.012, 0, 1); c = c.map((v, k) => lerp(lerp(belly[k], cap[k], z > 0.06 ? 0.6 : 0.0), cap[k], head)); }
    if (z > 0.073) c = [0.12, 0.1, 0.08];
    col.push(...c);
  }
  const quad = (pts, cols, w) => { const k = pos.length / 3; for (let i = 0; i < pts.length; i++) { pos.push(...pts[i]); col.push(...cols[i]); wing.push(w[i]); } for (let i = 1; i < pts.length - 1; i++) idx.push(k, k + i, k + i + 1); };
  const dark = [0.13, 0.13, 0.14], mid = [0.34, 0.35, 0.36], white = [0.9, 0.9, 0.88];
  for (const s of [1, -1]) {
    // wing: root chord on the shoulder, tip out to the side (wing attribute = signed span 0..1)
    quad([[0.018 * s, 0.022, 0.03], [0.018 * s, 0.02, -0.03], [0.07 * s, 0.02, -0.045], [0.125 * s, 0.02, -0.03], [0.1 * s, 0.021, 0.012], [0.055 * s, 0.022, 0.03]],
      [mid, mid, dark, dark, dark, white], [0.02 * s, 0.02 * s, 0.5 * s, 1 * s, 0.8 * s, 0.4 * s]);
  }
  // tail
  quad([[-0.012, 0.004, -0.045], [0.012, 0.004, -0.045], [0.014, 0.008, -0.125], [-0.014, 0.008, -0.125]], [dark, dark, dark, dark], [0, 0, 0, 0]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

export function createBirds(world, shared, scatter) {
  const rand = mulberry32(404);
  const N_SMALL = 14, N_KITE = 2, N = N_SMALL + N_KITE;
  const geo = birdGeometry();
  const flap = new Float32Array(N * 2); // phase (radians), mode: 0 folded, 1 flapping, 2 gliding
  geo.setAttribute('flap', new THREE.InstancedBufferAttribute(flap, 2));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float wing; attribute vec2 flap;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float aw = abs(wing), sgn = sign(wing);
          if (aw > 0.0) {
            float fold = 1.0 - clamp(flap.y, 0.0, 1.0);
            float glide = clamp(flap.y - 1.0, 0.0, 1.0);
            float ang = mix(sin(flap.x) * 1.05 + 0.15, 0.16 + sin(flap.x * 0.1) * 0.04, glide);
            float span = abs(transformed.x) - 0.018;
            // flap: swing the wing about the body axis
            vec2 fl = vec2(cos(ang), sin(ang)) * span;
            vec3 open = vec3(sgn * (0.018 + fl.x), transformed.y + fl.y, transformed.z - glide * aw * 0.0);
            // folded: wing tucked along the flank, pointing back
            vec3 shut = vec3(sgn * (0.02 + span * 0.08), transformed.y - 0.004 - span * 0.05, transformed.z - span * 0.75);
            transformed = mix(open, shut, fold);
          }
        }`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.castShadow = true; mesh.frustumCulled = false; mesh.name = 'birds';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);

  // perches: river stones, the banks, and spots hidden inside tree crowns
  const perches = [];
  for (const r of scatter.rocksInWater) if (r.radius > 0.45 && Math.abs(r.z) < 120 && r.y + r.height * 0.7 > WATER_Y + 0.12) perches.push({ x: r.x, y: r.y + r.height * 0.7, z: r.z, kind: 'rock' });
  for (let z = -110; z <= 110; z += 9) for (const side of [-1, 1]) {
    const x = riverX(z) + side * (riverHalfWidth(z) + 1.2 + rand() * 3), zz = z + rand() * 6;
    perches.push({ x, y: heightAt(x, zz) + 0.012, z: zz, kind: 'ground' });
  }
  for (const t of world.trees) if (rand() < 0.12 && Math.abs(t.z) < 120) perches.push({ x: t.x + (rand() - 0.5) * 2, y: t.y + t.h * (0.45 + rand() * 0.25), z: t.z + (rand() - 0.5) * 2, kind: 'tree' });

  const birds = [];
  const near = (p, z0, range) => Math.abs(p.z - z0) < range;
  for (let i = 0; i < N_SMALL; i++) {
    const z0 = i < 4 ? shared.spawn.z + (rand() - 0.5) * 50 : (rand() - 0.5) * 200;
    let mine = perches.filter((p) => near(p, z0, 34));
    if (mine.length < 4) mine = perches;
    const wagtail = i % 2 === 0;
    const b = { home: mine, wagtail, scale: wagtail ? 1.15 : 1.0, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: null, ctrl: new THREE.Vector3(), u: 0, dur: 1, state: 'perch', timer: 1 + rand() * 6, heading: rand() * 6.28, pitch: 0, phase: rand() * 6, mode: 0, hop: 0, bank: 0 };
    const pool = wagtail ? mine.filter((p) => p.kind !== 'tree') : mine;
    b.pool = pool.length > 2 ? pool : mine;
    b.perch = b.pool[Math.floor(rand() * b.pool.length)];
    b.pos.set(b.perch.x, b.perch.y, b.perch.z);
    birds.push(b);
    const c = wagtail ? (i % 4 === 0 ? [1.0, 0.95, 0.45] : [1, 1, 1]) : [0.85, 0.9, 0.7];
    mesh.instanceColor.setXYZ(i, ...c);
  }
  for (let i = 0; i < N_KITE; i++) {
    birds.push({ kite: true, scale: 6.5, pos: new THREE.Vector3(), a: rand() * 6.28, r: 55 + i * 30, h: 62 + i * 18, cz: -20 + i * 50, speed: 0.11 - i * 0.03, phase: 0, mode: 2, heading: 0, pitch: 0, bank: 0.3 });
    mesh.instanceColor.setXYZ(N_SMALL + i, 0.45, 0.33, 0.24);
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), tmp = new THREE.Vector3();
  function takeOff(b) {
    let next = b.perch;
    for (let k = 0; k < 6 && next === b.perch; k++) next = b.pool[Math.floor(rand() * b.pool.length)];
    b.from.copy(b.pos); b.to = next;
    const d = Math.hypot(next.x - b.pos.x, next.z - b.pos.z);
    b.ctrl.set((b.pos.x + next.x) / 2 + (rand() - 0.5) * d * 0.4, Math.max(b.pos.y, next.y) + 0.8 + d * 0.12 + rand() * 1.5, (b.pos.z + next.z) / 2 + (rand() - 0.5) * d * 0.4);
    b.dur = Math.max(0.5, d / 7.5); b.u = 0; b.state = 'fly';
  }
  function update(dt, player) {
    const t = shared.time.value;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (b.kite) {
        b.a += b.speed * dt;
        b.pos.set(Math.cos(b.a) * b.r + riverX(b.cz), b.h + Math.sin(b.a * 0.7) * 6, b.cz + Math.sin(b.a) * b.r);
        b.heading = Math.atan2(-Math.sin(b.a), Math.cos(b.a)); b.phase += dt * 3;
        e.set(0.02, b.heading, -0.32, 'YXZ');
      } else {
        b.timer -= dt;
        if (b.state === 'perch') {
          b.mode = damp(b.mode, 0, 10, dt);
          // little hops / turns, wagtails bob their tails
          if (b.timer < 0 || player.pos.distanceTo(b.pos) < 4.5) { takeOff(b); }
          else if (rand() < dt * 0.6) { b.heading += (rand() - 0.5) * 1.6; b.hop = 0.18; }
          b.hop = Math.max(0, b.hop - dt);
          const hopY = Math.sin((b.hop / 0.18) * Math.PI) * 0.03;
          b.pos.set(b.perch.x, b.perch.y + hopY, b.perch.z);
          b.pitch = b.wagtail ? Math.sin(t * 9 + i) * 0.18 * (Math.sin(t * 0.8 + i * 2) > 0 ? 1 : 0.1) : Math.sin(t * 2 + i) * 0.05;
          b.bank = 0;
        } else {
          b.u += dt / b.dur;
          const u = clamp(b.u, 0, 1), k = 1 - u;
          tmp.copy(b.pos);
          b.pos.set(k * k * b.from.x + 2 * k * u * b.ctrl.x + u * u * b.to.x, k * k * b.from.y + 2 * k * u * b.ctrl.y + u * u * b.to.y, k * k * b.from.z + 2 * k * u * b.ctrl.z + u * u * b.to.z);
          // bounding flight: bursts of flapping with short closed-wing glides
          const burst = Math.sin(t * 7 + i * 3) > -0.25 ? 1 : 0.25;
          b.mode = damp(b.mode, u > 0.93 ? 0.5 : burst, 14, dt);
          b.phase += dt * 62;
          const dx = b.pos.x - tmp.x, dy = b.pos.y - tmp.y, dz = b.pos.z - tmp.z;
          if (dx * dx + dz * dz > 1e-8) {
            const h = Math.atan2(dx, dz);
            b.bank = damp(b.bank, clamp(((h - b.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 6, -0.8, 0.8), 6, dt);
            b.heading = h; b.pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
          }
          if (b.u >= 1) { b.state = 'perch'; b.perch = b.to; b.timer = 3 + rand() * 12; b.heading += (rand() - 0.5); }
        }
        e.set(b.pitch, b.heading, -b.bank, 'YXZ');
      }
      q.setFromEuler(e);
      m4.compose(b.pos, q, s.setScalar(b.scale));
      mesh.setMatrixAt(i, m4);
      flap[i * 2] = b.phase; flap[i * 2 + 1] = b.mode;
    }
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.flap.needsUpdate = true;
  }
  update(0, { pos: new THREE.Vector3(1e4, 0, 1e4) });
  return { group: mesh, birds, update };
}
