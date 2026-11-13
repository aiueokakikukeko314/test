// Butterflies fluttering over the meadows and along the banks.
import * as THREE from 'three';
import { heightAt, riverX, riverHalfWidth } from '../world/layout.js';
import { mulberry32 } from '../util/noise.js';

function wingTexture() {
  const S = 128; const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  // right wing pair (mirrored in the geometry): forewing + hindwing lobes
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(6, 64); c.bezierCurveTo(30, 6, 104, 0, 122, 28); c.bezierCurveTo(118, 56, 70, 66, 6, 64); c.fill();
  c.beginPath(); c.moveTo(6, 64); c.bezierCurveTo(60, 62, 104, 72, 96, 104); c.bezierCurveTo(70, 126, 28, 108, 6, 64); c.fill();
  c.globalCompositeOperation = 'source-atop';
  const g = c.createRadialGradient(10, 64, 4, 10, 64, 120); g.addColorStop(0, 'rgba(120,120,110,0.55)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(30,30,34,0.9)'; c.beginPath(); c.moveTo(122, 28); c.lineTo(96, 8); c.lineTo(84, 14); c.lineTo(112, 40); c.fill();
  c.beginPath(); c.arc(78, 34, 6, 0, 7); c.fill(); c.beginPath(); c.arc(70, 88, 4, 0, 7); c.fill();
  c.strokeStyle = 'rgba(60,60,60,0.25)'; c.lineWidth = 1;
  for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(6, 64); c.lineTo(126, 4 + i * 14); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createButterflies(world, shared, clearings) {
  const rand = mulberry32(88);
  const N = 22;
  const geo = new THREE.BufferGeometry();
  const W = 0.034;
  // two quads hinged on the body (x = 0); 'side' tells the shader which wing a vertex belongs to
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -W, W * 2, 0, -W, W * 2, 0, W, 0, 0, W, 0, 0, -W, -W * 2, 0, -W, -W * 2, 0, W, 0, 0, W], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0.05, 0, 1, 0, 1, 1, 0.05, 1, 0.05, 0, 1, 0, 1, 1, 0.05, 1], 2));
  geo.setAttribute('side', new THREE.Float32BufferAttribute([1, 1, 1, 1, -1, -1, -1, -1], 1));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
  geo.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
  const ph = new Float32Array(N);
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(ph, 1));
  const mat = new THREE.MeshStandardMaterial({ map: wingTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float side; attribute float phase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float a = 0.15 + abs(sin(phase)) * 1.25; float r = abs(transformed.x);
          transformed.x = side * r * cos(a); transformed.y = r * sin(a); }`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.name = 'butterflies'; mesh.layers.set(1);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const palette = [[1, 1, 0.96], [1, 0.92, 0.4], [1, 1, 0.96], [0.75, 0.85, 1.0], [1, 0.72, 0.35]];
  const list = [];
  for (let i = 0; i < N; i++) {
    let ax, az;
    if (i < 14) { const c = clearings[i % clearings.length]; const a = rand() * 6.28, r = Math.sqrt(rand()) * c.r * 0.8; ax = c.x + Math.cos(a) * r; az = c.z + Math.sin(a) * r; }
    else { az = shared.spawn.z + (rand() - 0.5) * 90; ax = riverX(az) + (rand() < 0.5 ? -1 : 1) * (riverHalfWidth(az) + 1.5 + rand() * 5); }
    list.push({ ax, az, r: 1.5 + rand() * 3.5, f1: 0.25 + rand() * 0.3, f2: 0.17 + rand() * 0.3, f3: 0.9 + rand() * 1.2, o: rand() * 100, flap: rand() * 6, x: ax, y: 0, z: az, heading: 0 });
    mesh.instanceColor.setXYZ(i, ...palette[i % palette.length]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  function update(dt) {
    const t = shared.time.value;
    for (let i = 0; i < N; i++) {
      const b = list[i], tt = t + b.o;
      const nx = b.ax + Math.sin(tt * b.f1) * b.r + Math.sin(tt * 1.9 + b.o) * 0.35;
      const nz = b.az + Math.cos(tt * b.f2 + 1.3) * b.r + Math.cos(tt * 2.3 + b.o) * 0.35;
      const ny = heightAt(nx, nz) + 0.55 + Math.sin(tt * b.f3) * 0.3 + Math.sin(tt * 3.7) * 0.12 + Math.abs(Math.sin(tt * 0.21)) * 0.6;
      if (dt > 0) b.heading = Math.atan2(nx - b.x, nz - b.z);
      b.x = nx; b.y = ny; b.z = nz;
      b.flap += dt * (16 + Math.sin(tt * 1.3) * 5);
      ph[i] = b.flap;
      e.set(-0.25, b.heading, Math.sin(tt * 2.1) * 0.25, 'YXZ'); q.setFromEuler(e);
      m4.compose(p.set(nx, ny, nz), q, s); mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true; geo.attributes.phase.needsUpdate = true;
  }
  update(0);
  return { group: mesh, update };
}
