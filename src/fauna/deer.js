// Sika deer: procedurally modelled, skinned and animated (no external model).
// Behaviour: graze / look around / wander / drink, become alert when the visitor comes close, bound away when too close.
import * as THREE from 'three';
import { MeshBuilder, ring, subdivide, makeSkeleton } from './meshbuilder.js';
import { heightAt, riverDist, riverHalfWidth, riverX, WATER_Y } from '../world/layout.js';
import { mulberry32, clamp, damp, dampAngle, smoothstep, lerp } from '../util/noise.js';

// ---- bone table (model space, metres, animal faces +Z)
const B = {
  root: 0, spine: 1, chest: 2, neck1: 3, neck2: 4, head: 5, earL: 6, earR: 7, tail: 8,
  FLu: 9, FLl: 10, FLc: 11, FLf: 12, FRu: 13, FRl: 14, FRc: 15, FRf: 16,
  HLu: 17, HLl: 18, HLc: 19, HLf: 20, HRu: 21, HRl: 22, HRc: 23, HRf: 24,
};
const BONE_DEFS = [
  ['root', null, [0, 0.78, -0.42]], ['spine', 'root', [0, 0.76, -0.06]], ['chest', 'spine', [0, 0.76, 0.28]],
  ['neck1', 'chest', [0, 0.84, 0.47]], ['neck2', 'neck1', [0, 1.05, 0.625]], ['head', 'neck2', [0, 1.255, 0.715]],
  ['earL', 'head', [0.06, 1.36, 0.745]], ['earR', 'head', [-0.06, 1.36, 0.745]], ['tail', 'root', [0, 0.8, -0.605]],
  ['FLu', 'chest', [0.1, 0.72, 0.36]], ['FLl', 'FLu', [0.1, 0.585, 0.35]], ['FLc', 'FLl', [0.1, 0.31, 0.385]], ['FLf', 'FLc', [0.1, 0.065, 0.38]],
  ['FRu', 'chest', [-0.1, 0.72, 0.36]], ['FRl', 'FRu', [-0.1, 0.585, 0.35]], ['FRc', 'FRl', [-0.1, 0.31, 0.385]], ['FRf', 'FRc', [-0.1, 0.065, 0.38]],
  ['HLu', 'root', [0.105, 0.74, -0.4]], ['HLl', 'HLu', [0.105, 0.5, -0.34]], ['HLc', 'HLl', [0.105, 0.33, -0.47]], ['HLf', 'HLc', [0.105, 0.065, -0.435]],
  ['HRu', 'root', [-0.105, 0.74, -0.4]], ['HRl', 'HRu', [-0.105, 0.5, -0.34]], ['HRc', 'HRl', [-0.105, 0.33, -0.47]], ['HRf', 'HRc', [-0.105, 0.065, -0.435]],
];

// atlas layout (u ranges)
const U_BODY = [0, 0.7], U_LEG = [0.72, 0.86], U_MISC = [0.88, 1.0];

function buildDeerGeometry(antlers) {
  const mb = new MeshBuilder();
  const { root, spine, chest, neck1, neck2, head } = B;
  // --- torso + neck + head as one continuous loft (rear -> nose)
  let body = [
    ring(0, 0.8, -0.625, 0.02, 0.03, [[root, 1]]),
    ring(0, 0.785, -0.595, 0.09, 0.11, [[root, 1]]),
    ring(0, 0.76, -0.52, 0.14, 0.165, [[root, 1]]),
    ring(0, 0.74, -0.4, 0.165, 0.19, [[root, 1]]),
    ring(0, 0.735, -0.24, 0.158, 0.175, [[root, 0.5], [spine, 0.5]]),
    ring(0, 0.715, -0.06, 0.165, 0.185, [[spine, 1]]),
    ring(0, 0.705, 0.12, 0.165, 0.2, [[spine, 0.5], [chest, 0.5]]),
    ring(0, 0.71, 0.28, 0.155, 0.205, [[chest, 1]]),
    ring(0, 0.735, 0.4, 0.13, 0.19, [[chest, 1]]),
    ring(0, 0.8, 0.475, 0.108, 0.165, [[chest, 0.6], [neck1, 0.4]]),
    ring(0, 0.9, 0.54, 0.088, 0.128, [[neck1, 1]]),
    ring(0, 1.01, 0.605, 0.074, 0.102, [[neck1, 0.5], [neck2, 0.5]]),
    ring(0, 1.12, 0.66, 0.064, 0.084, [[neck2, 1]]),
    ring(0, 1.215, 0.7, 0.06, 0.075, [[neck2, 0.5], [head, 0.5]]),
    ring(0, 1.29, 0.735, 0.07, 0.08, [[head, 1]]),
    ring(0, 1.312, 0.795, 0.073, 0.078, [[head, 1]]),
    ring(0, 1.3, 0.865, 0.056, 0.06, [[head, 1]]),
    ring(0, 1.277, 0.935, 0.04, 0.044, [[head, 1]]),
    ring(0, 1.262, 0.982, 0.031, 0.033, [[head, 1]]),
    ring(0, 1.257, 1.003, 0.014, 0.016, [[head, 1]]),
  ];
  body = subdivide(body, 3);
  const info = mb.tube(body, {
    seg: 18, uRect: U_BODY, capStart: true, capEnd: true,
    // narrower along the spine, fuller belly; flat-ish cheeks on the head
    shape: (cs, sn) => [1 - 0.22 * Math.max(sn, 0) ** 1.5, 1],
  });
  const vMarks = { torsoEnd: body.find((r) => r.c.z >= 0.47).v, headStart: body.find((r) => r.c.y >= 1.28 && r.c.z > 0.7).v };

  // --- legs
  const leg = (side, bones, pts) => {
    let rings = pts.map(([y, z, rx, ry, w]) => ring(0.1 * side + (y > 0.6 ? -0.012 * side : 0), y, z, rx, ry, w.map(([k, wt]) => [bones[k], wt])));
    rings = subdivide(rings, 2);
    mb.tube(rings, { seg: 9, uRect: U_LEG, capEnd: true });
  };
  for (const side of [1, -1]) {
    const F = side > 0 ? [B.FLu, B.FLl, B.FLc, B.FLf, chest] : [B.FRu, B.FRl, B.FRc, B.FRf, chest];
    leg(side, F, [
      [0.8, 0.36, 0.05, 0.09, [[4, 0.6], [0, 0.4]]],
      [0.7, 0.355, 0.058, 0.092, [[0, 1]]],
      [0.6, 0.35, 0.047, 0.066, [[0, 0.6], [1, 0.4]]],
      [0.5, 0.365, 0.033, 0.041, [[1, 1]]],
      [0.37, 0.38, 0.026, 0.03, [[1, 1]]],
      [0.315, 0.385, 0.029, 0.032, [[1, 0.5], [2, 0.5]]],
      [0.265, 0.38, 0.021, 0.024, [[2, 1]]],
      [0.11, 0.375, 0.019, 0.022, [[2, 1]]],
      [0.066, 0.38, 0.025, 0.027, [[2, 0.5], [3, 0.5]]],
      [0.032, 0.394, 0.023, 0.03, [[3, 1]]],
      [0.0, 0.404, 0.024, 0.033, [[3, 1]]],
    ]);
    const H = side > 0 ? [B.HLu, B.HLl, B.HLc, B.HLf, root] : [B.HRu, B.HRl, B.HRc, B.HRf, root];
    leg(side, H, [
      [0.82, -0.41, 0.06, 0.12, [[4, 0.6], [0, 0.4]]],
      [0.72, -0.4, 0.075, 0.13, [[0, 1]]],
      [0.6, -0.365, 0.062, 0.1, [[0, 1]]],
      [0.5, -0.345, 0.046, 0.07, [[0, 0.5], [1, 0.5]]],
      [0.41, -0.4, 0.03, 0.045, [[1, 1]]],
      [0.335, -0.468, 0.026, 0.034, [[1, 0.5], [2, 0.5]]],
      [0.27, -0.464, 0.021, 0.026, [[2, 1]]],
      [0.11, -0.44, 0.019, 0.022, [[2, 1]]],
      [0.066, -0.435, 0.025, 0.027, [[2, 0.5], [3, 0.5]]],
      [0.032, -0.42, 0.023, 0.03, [[3, 1]]],
      [0.0, -0.41, 0.023, 0.032, [[3, 1]]],
    ]);
  }

  // --- ears (flattened leaves)
  for (const side of [1, -1]) {
    const bone = side > 0 ? B.earL : B.earR;
    const pts = [[0.052, 1.352, 0.748, 0.012, 0.014], [0.078, 1.385, 0.742, 0.03, 0.009], [0.108, 1.42, 0.732, 0.036, 0.007], [0.135, 1.448, 0.72, 0.026, 0.006], [0.155, 1.468, 0.71, 0.006, 0.003]];
    const rings = subdivide(pts.map(([x, y, z, rx, ry]) => ring(x * side, y, z, rx, ry, [[bone, 1]])), 2);
    mb.tube(rings, { seg: 8, uRect: [U_MISC[0], U_MISC[0] + 0.05], vRect: [0, 0.3], capEnd: true, axis: new THREE.Vector3(0, 0.3, 1).normalize() });
  }
  // --- tail
  {
    const rings = subdivide([[0.8, -0.6, 0.03, 0.028], [0.77, -0.64, 0.034, 0.024], [0.72, -0.665, 0.03, 0.018], [0.67, -0.675, 0.012, 0.008]].map(([y, z, rx, ry]) => ring(0, y, z, rx, ry, [[B.tail, 1]])), 2);
    mb.tube(rings, { seg: 8, uRect: [U_MISC[0] + 0.06, U_MISC[1]], vRect: [0, 0.3], capEnd: true });
  }
  // --- antlers (stag)
  if (antlers) {
    const beam = (side) => {
      const P = (x, y, z, r) => ring(x * side, y, z, r, r, [[head, 1]], { color: [1, 1, 1] });
      const main = subdivide([P(0.035, 1.365, 0.765, 0.016), P(0.07, 1.45, 0.73, 0.013), P(0.13, 1.56, 0.66, 0.011), P(0.17, 1.68, 0.6, 0.009), P(0.16, 1.78, 0.6, 0.004)], 3);
      mb.tube(main, { seg: 6, uRect: [U_MISC[0], U_MISC[1]], vRect: [0.5, 1], capEnd: true });
      const tine = (pts) => mb.tube(subdivide(pts.map((p) => P(...p)), 2), { seg: 5, uRect: [U_MISC[0], U_MISC[1]], vRect: [0.5, 1], capEnd: true });
      tine([[0.055, 1.41, 0.75, 0.01], [0.07, 1.44, 0.82, 0.008], [0.085, 1.5, 0.86, 0.003]]);
      tine([[0.125, 1.55, 0.665, 0.009], [0.16, 1.6, 0.72, 0.007], [0.185, 1.67, 0.74, 0.003]]);
      tine([[0.165, 1.66, 0.605, 0.008], [0.205, 1.72, 0.57, 0.006], [0.23, 1.79, 0.56, 0.003]]);
    };
    beam(1); beam(-1);
  }
  return { geometry: mb.build(), vMarks };
}

// Coat texture: chestnut summer coat with white spots, pale belly, white rump, dark dorsal line.
function paintCoat(vMarks, seed, fawn) {
  const S = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S); const d = img.data;
  const rand = mulberry32(seed);
  const noise = new Float32Array(S * S);
  for (let i = 0; i < noise.length; i++) noise[i] = rand();
  const fur = (x, y) => { // streaky fur noise, stretched along the body
    const a = noise[((y >> 2) * S + x) % noise.length], b = noise[(y * S + x) % noise.length];
    return 0.86 + a * 0.2 + b * 0.08;
  };
  // spots: rows along both flanks
  const spots = [];
  const rows = fawn ? 6 : 5;
  for (let r = 0; r < rows; r++) {
    const s0 = 0.12 + (r / rows) * 0.78; // sin(theta): 0 flank -> 1 spine
    for (let v = 0.035; v < vMarks.torsoEnd * 0.98; v += 0.021 + rand() * 0.012) {
      if (rand() < 0.14) continue;
      spots.push({ s: s0 + (rand() - 0.5) * 0.07, v: v + (rand() - 0.5) * 0.008, r: (0.0055 + rand() * 0.0045) * (fawn ? 1.2 : 1) });
    }
  }
  const back = [0.5, 0.29, 0.14], flank = [0.62, 0.4, 0.21], belly = [0.84, 0.77, 0.64], dark = [0.17, 0.1, 0.06], white = [0.93, 0.91, 0.86];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const U = (x + 0.5) / S, V = 1 - (y + 0.5) / S; // uv.y = v (flipY)
      let c;
      if (U < U_BODY[1] + 0.01) {
        const u = clamp(U / U_BODY[1], 0, 1);
        const sn = -Math.cos(u * Math.PI * 2); // -1 belly, +1 spine
        c = mix(belly, flank, smoothstep(-0.75, -0.2, sn));
        c = mix(c, back, smoothstep(-0.1, 0.65, sn));
        if (V < vMarks.torsoEnd) {
          // dorsal stripe
          c = mix(c, dark, smoothstep(0.965, 0.995, sn) * 0.75);
          // spots (mirror both sides through sin)
          let sp = 0;
          for (const s of spots) {
            const ds = (sn - s.s) * 0.11, dv = V - s.v;
            const q = (ds * ds + dv * dv) / (s.r * s.r);
            if (q < 1.6) sp = Math.max(sp, 1 - smoothstep(0.5, 1.4, q));
          }
          c = mix(c, [0.88, 0.82, 0.7], sp * 0.78);
          // white rump patch with a dark rim
          const rump = smoothstep(0.075, 0.03, V) * smoothstep(-0.55, 0.0, sn);
          const rim = smoothstep(0.1, 0.07, V) * smoothstep(-0.6, -0.1, sn) * (1 - rump);
          c = mix(c, dark, rim * 0.55); c = mix(c, white, rump);
        } else if (V < vMarks.headStart) {
          // neck: greyer brown, pale throat
          c = mix(c, [0.5, 0.36, 0.24], 0.35);
          c = mix(c, belly, smoothstep(-0.5, -0.95, sn) * 0.8);
        } else {
          const hv = (V - vMarks.headStart) / (1 - vMarks.headStart); // 0 skull -> 1 nose
          c = mix([0.5, 0.33, 0.18], [0.42, 0.27, 0.15], smoothstep(0.2, 0.9, sn));
          c = mix(c, belly, smoothstep(-0.2, -0.9, sn) * 0.85);               // chin / jaw
          c = mix(c, [0.72, 0.64, 0.52], smoothstep(0.62, 0.86, hv) * 0.6);     // pale muzzle band
          c = mix(c, [0.05, 0.04, 0.04], smoothstep(0.9, 0.955, hv) * smoothstep(-0.35, 0.2, sn)); // nose pad
          // eye ring
          const ev = hv - 0.3, es = sn - 0.38;
          c = mix(c, [0.74, 0.64, 0.5], (1 - smoothstep(0.004, 0.02, ev * ev + es * es * 0.05)) * 0.5);
        }
      } else if (U < U_LEG[1] + 0.01) {
        // legs: v = 0 at the top, 1 at the hoof
        const t = V;
        const u = (U - U_LEG[0]) / (U_LEG[1] - U_LEG[0]);
        const sn = -Math.cos(u * Math.PI * 2);
        c = mix(flank, [0.5, 0.36, 0.22], smoothstep(0.2, 0.6, t));
        c = mix(c, belly, (1 - smoothstep(-0.2, 0.4, Math.abs(sn))) * 0.0 + smoothstep(0.1, -0.7, sn) * 0.45 * smoothstep(0.75, 0.3, t));
        c = mix(c, [0.2, 0.14, 0.1], smoothstep(0.8, 0.9, t) * 0.5);
        c = mix(c, [0.045, 0.04, 0.04], smoothstep(0.945, 0.965, t)); // hoof
      } else {
        if (V > 0.5) { // antler
          const t = (V - 0.5) * 2;
          c = mix([0.36, 0.27, 0.18], [0.78, 0.72, 0.6], smoothstep(0.55, 1, t));
        } else if (U < U_MISC[0] + 0.055) { // ear: dark rim, pale inside
          c = mix([0.42, 0.28, 0.16], [0.75, 0.66, 0.55], 0.35);
        } else { // tail: white with dark top line
          const u = (U - (U_MISC[0] + 0.06)) / (U_MISC[1] - U_MISC[0] - 0.06);
          const sn = -Math.cos(u * Math.PI * 2);
          c = mix(white, dark, smoothstep(0.5, 0.9, sn) * 0.8);
        }
      }
      const f = U < U_MISC[0] || V < 0.5 ? fur(x, y) : 0.9 + noise[(y * S + x) % noise.length] * 0.15;
      const k = (y * S + x) * 4;
      d[k] = clamp(c[0] * f, 0, 1) * 255; d[k + 1] = clamp(c[1] * f, 0, 1) * 255; d[k + 2] = clamp(c[2] * f, 0, 1) * 255; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

let _cache = null;
function assets() {
  if (_cache) return _cache;
  const doe = buildDeerGeometry(false), stag = buildDeerGeometry(true);
  const mk = (map) => new THREE.MeshPhysicalMaterial({ map, roughness: 0.82, metalness: 0, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.6, 0.45, 0.3) });
  _cache = {
    doe: doe.geometry, stag: stag.geometry,
    matAdult: mk(paintCoat(doe.vMarks, 11, false)), matFawn: mk(paintCoat(doe.vMarks, 23, true)),
    eyeGeo: new THREE.SphereGeometry(0.0155, 10, 8),
    eyeMat: new THREE.MeshStandardMaterial({ color: 0x070504, roughness: 0.08, metalness: 0 }),
  };
  return _cache;
}

const LEGS = [
  { u: 'FLu', l: 'FLl', c: 'FLc', f: 'FLf', front: true, walk: 0.25, run: 0.55 },
  { u: 'FRu', l: 'FRl', c: 'FRc', f: 'FRf', front: true, walk: 0.75, run: 0.45 },
  { u: 'HLu', l: 'HLl', c: 'HLc', f: 'HLf', front: false, walk: 0.0, run: 0.04 },
  { u: 'HRu', l: 'HRl', c: 'HRc', f: 'HRf', front: false, walk: 0.5, run: 0.0 },
];

export class Deer {
  constructor(world, opts) {
    const A = assets();
    this.world = world;
    this.rand = mulberry32(opts.seed || 1);
    this.kind = opts.kind || 'doe';
    this.scale = opts.scale || 0.92;
    this.home = opts.home; // { x, z, r }
    const { byName, skeleton, root } = makeSkeleton(BONE_DEFS);
    this.bones = byName;
    this.rest = Object.fromEntries(Object.entries(byName).map(([k, b]) => [k, b.position.clone()]));
    const mesh = new THREE.SkinnedMesh(this.kind === 'stag' ? A.stag : A.doe, this.kind === 'fawn' ? A.matFawn : A.matAdult);
    mesh.add(root); mesh.bind(skeleton);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(A.eyeGeo, A.eyeMat);
      eye.position.set(0.0605 * s, 1.326 - 1.255, 0.8 - 0.715);
      byName.head.add(eye);
    }
    this.group = new THREE.Group();
    this.group.add(mesh);
    this.group.scale.setScalar(this.scale);
    this.mesh = mesh;
    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.heading = this.rand() * Math.PI * 2;
    this.speed = 0; this.phase = this.rand(); this.gait = 0; // 0 walk .. 1 gallop
    this.state = 'graze'; this.timer = 2 + this.rand() * 8; this.target = null;
    this.headDown = 1; this.lookYaw = 0; this.lookPitch = 0; this.alert = 0; this.earT = 0; this.tailT = 0;
    this.pitch = 0; this.t = this.rand() * 100; this.chew = 0;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this._apply(0);
  }

  // ---------- behaviour
  _pickWander(far) {
    const h = this.home;
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2, r = (far ? 0.5 + this.rand() * 0.5 : Math.sqrt(this.rand())) * h.r;
      const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
      if (Math.abs(riverDist(x, z)) - riverHalfWidth(z) > 1.2) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(h.x, 0, h.z);
  }
  _pickDrink() {
    // nearest waterline on our side of the river
    const z = this.pos.z + (this.rand() - 0.5) * 16;
    const side = Math.sign(riverDist(this.pos.x, z)) || 1;
    const k = Math.sqrt(1 + 0.2);
    const x = riverX(z) + side * (riverHalfWidth(z) * k + 0.25);
    return new THREE.Vector3(x, 0, z);
  }
  _setState(s, time) { this.state = s; this.timer = time; }

  startle(from, strong) {
    if (this.state === 'flee') return;
    if (strong) {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z; const l = Math.hypot(dx, dz) || 1;
      const a = Math.atan2(dx / l, dz / l) + (this.rand() - 0.5) * 0.9;
      let tx = this.pos.x + Math.sin(a) * 42, tz = this.pos.z + Math.cos(a) * 42;
      // do not flee into the river: slide along it instead
      if (Math.abs(riverDist(tx, tz)) - riverHalfWidth(tz) < 3) { tx = this.pos.x + Math.sin(a + 1.2) * 38; tz = this.pos.z + Math.cos(a + 1.2) * 38; }
      this.target = new THREE.Vector3(clamp(tx, -150, 150), 0, clamp(tz, -150, 150));
      this._setState('flee', 9);
    } else if (this.state !== 'alert') {
      this._setState('alert', 4 + this.rand() * 3);
    }
  }

  update(dt, player, herd) {
    this.t += dt; this.timer -= dt;
    const dxp = player.pos.x - this.pos.x, dzp = player.pos.z - this.pos.z;
    const dp = Math.hypot(dxp, dzp);
    const noisy = player.speed > 3;
    // awareness
    if (this.state !== 'flee') {
      if (dp < (noisy ? 15 : 7.5)) { this.startle(player.pos, true); for (const o of herd) if (o !== this && o.pos.distanceTo(this.pos) < 18) o.startle(player.pos, true); }
      else if (dp < (noisy ? 30 : 19) && this.state !== 'alert') this.startle(player.pos, false);
    }
    let wantSpeed = 0, turnRate = 1.4, headDownT = 0, yawT = 0, pitchT = 0, alertT = 0;
    switch (this.state) {
      case 'graze':
        headDownT = 1; yawT = Math.sin(this.t * 0.35) * 0.25;
        // shuffle forward a little while feeding
        wantSpeed = Math.sin(this.t * 0.23 + this.phase * 9) > 0.82 ? 0.28 : 0;
        if (this.timer <= 0) {
          const r = this.rand();
          if (r < 0.45) this._setState('look', 2.5 + this.rand() * 4);
          else if (r < 0.85) { this.target = this._pickWander(false); this._setState('walk', 14); }
          else { this.target = this._pickDrink(); this._setState('toDrink', 30); }
        }
        break;
      case 'look':
        yawT = Math.sin(this.t * 0.5 + this.phase * 6) * 0.9; pitchT = 0.05;
        if (this.timer <= 0) this._setState('graze', 7 + this.rand() * 16);
        break;
      case 'alert': {
        alertT = 1;
        const want = Math.atan2(dxp, dzp);
        let rel = ((want - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        yawT = clamp(rel, -1.5, 1.5); pitchT = 0.12;
        if (this.timer <= 0) this._setState(dp > 22 ? 'graze' : 'alert', dp > 22 ? 5 + this.rand() * 8 : 3);
        break;
      }
      case 'walk': case 'toDrink': {
        wantSpeed = 0.95; pitchT = -0.05;
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (d < 0.7 || this.timer <= 0) {
          if (this.state === 'toDrink' && d < 1.5) this._setState('drink', 6 + this.rand() * 6);
          else this._setState(this.rand() < 0.5 ? 'look' : 'graze', 3 + this.rand() * 10);
        }
        break;
      }
      case 'drink':
        headDownT = 1.12;
        if (this.timer <= 0) { this.target = this._pickWander(true); this._setState('walk', 16); }
        break;
      case 'flee': {
        wantSpeed = 7.2; turnRate = 3.2; pitchT = 0.2; alertT = 1;
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (d < 3 || this.timer <= 0) {
          if (dp < 24) { this.state = 'graze'; this.startle(player.pos, true); }
          else { this.home = { x: this.pos.x, z: this.pos.z, r: this.home.r }; this._setState('alert', 5); }
        }
        break;
      }
    }
    // steering
    if (wantSpeed > 0.5 && this.target) {
      let want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      // avoid tree trunks / boulders ahead
      const look = this.speed * 0.5 + 1.2;
      const ax = this.pos.x + Math.sin(this.heading) * look, az = this.pos.z + Math.cos(this.heading) * look;
      for (const c of this.world.colliders.query(ax, az, 1.6)) {
        const cx = c.x - this.pos.x, cz = c.z - this.pos.z;
        if (Math.hypot(c.x - ax, c.z - az) < c.r + 0.7) want += (Math.sin(this.heading) * cz - Math.cos(this.heading) * cx) > 0 ? 0.9 : -0.9;
      }
      // keep out of deep water unless heading for a drink
      if (this.state !== 'toDrink') {
        const fx = this.pos.x + Math.sin(want) * 3, fz = this.pos.z + Math.cos(want) * 3;
        if (Math.abs(riverDist(fx, fz)) - riverHalfWidth(fz) < 0.3) want += 1.1 * (Math.sign(riverDist(this.pos.x, this.pos.z)) * Math.cos(want) > 0 ? 1 : -1);
      }
      this.heading = dampAngle(this.heading, want, turnRate, dt);
    }
    this.speed = damp(this.speed, wantSpeed, wantSpeed > this.speed ? 3.5 : 2.2, dt);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    const s = this.scale;
    // gait phase follows the distance travelled so hooves do not skate
    this.gait = damp(this.gait, smoothstep(2.2, 4.5, this.speed), 5, dt);
    const stride = lerp(0.92, 3.0, this.gait) * s;
    this.phase = (this.phase + (this.speed * dt) / stride) % 1;
    // pose targets
    this.headDown = damp(this.headDown, this.speed > 0.6 ? 0 : headDownT, headDownT > this.headDown ? 2.2 : 4.5, dt);
    this.lookYaw = damp(this.lookYaw, yawT, 3.5, dt);
    this.lookPitch = damp(this.lookPitch, pitchT, 3, dt);
    this.alert = damp(this.alert, alertT, 6, dt);
    this._apply(dt);
  }

  // ---------- pose
  _apply(dt) {
    const b = this.bones, s = this.scale, t = this.t;
    const moving = clamp(this.speed / 0.8, 0, 1);
    const g = this.gait;
    // terrain following: height + pitch from front/back samples
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const hf = heightAt(this.pos.x + sh * 0.4 * s, this.pos.z + ch * 0.4 * s), hb = heightAt(this.pos.x - sh * 0.4 * s, this.pos.z - ch * 0.4 * s);
    const ground = (hf + hb) / 2;
    this.pos.y = ground;
    const slope = Math.atan2(hf - hb, 0.8 * s);
    this.pitch = damp(this.pitch, slope, 6, dt || 0.016);
    const ph = this.phase * Math.PI * 2;
    const bounce = g * Math.max(0, Math.sin(ph + 0.6)) * 0.16 + (1 - g) * moving * Math.sin(ph * 2) * 0.008;
    const bodyPitch = -this.pitch + g * Math.sin(ph + 1.9) * 0.11;
    this.group.position.set(this.pos.x, ground + bounce * s - 0.012, this.pos.z);
    this.group.rotation.set(bodyPitch, this.heading, 0, 'YXZ');

    // legs
    for (const L of LEGS) {
      const off = lerp(L.walk, L.run, g);
      let p = (this.phase + off) % 1;
      const duty = lerp(0.62, 0.38, g);
      let swing, lift;
      if (p < duty) { swing = 1 - 2 * (p / duty); lift = 0; }       // stance: +1 (forward) -> -1 (back)
      else { const u = (p - duty) / (1 - duty); swing = -Math.cos(u * Math.PI); lift = Math.sin(u * Math.PI); } // recovery
      const amp = lerp(0.27, 0.62, g) * moving;
      const flex = lift * lerp(0.55, 1.15, g) * moving;
      const idle = (1 - moving) * Math.sin(t * 0.4 + off * 6) * 0.01;
      if (L.front) {
        b[L.u].rotation.x = -swing * amp + idle - flex * 0.1;
        b[L.l].rotation.x = -flex * 0.55;
        b[L.c].rotation.x = flex * 1.25;
        b[L.f].rotation.x = flex * 0.7 + Math.max(0, -swing) * amp * 0.35 * (lift > 0 ? 0 : 1);
      } else {
        b[L.u].rotation.x = -swing * amp * 0.9 + idle;
        b[L.l].rotation.x = flex * 0.6 + swing * amp * 0.12;
        b[L.c].rotation.x = -flex * 1.0;
        b[L.f].rotation.x = flex * 0.9;
      }
    }
    // spine flex during gallop
    b.spine.rotation.x = g * Math.sin(ph + 0.4) * 0.12;
    b.chest.rotation.x = -g * Math.sin(ph + 0.4) * 0.1;
    b.root.position.y = this.rest.root.y;

    // neck + head: blend grazing pose, upright pose and alert pose
    const hd = clamp(this.headDown, 0, 1.2), al = this.alert;
    const nod = moving * (1 - g) * Math.sin(ph * 2 + 0.5) * 0.045;
    const chew = hd > 0.7 ? Math.sin(t * 7.5) * 0.012 : 0;
    b.neck1.rotation.x = hd * 1.18 - al * 0.2 + nod + this.lookPitch * -0.4 + g * 0.25;
    b.neck2.rotation.x = hd * 0.62 - al * 0.12 + nod * 0.5;
    b.head.rotation.x = hd * -0.55 + al * 0.22 + chew + g * -0.2 + 0.18;
    const yaw = this.lookYaw * (1 - hd * 0.6);
    b.neck1.rotation.y = yaw * 0.35; b.neck2.rotation.y = yaw * 0.35; b.head.rotation.y = yaw * 0.4;
    b.head.rotation.z = Math.sin(t * 0.7 + this.phase) * 0.03;
    // ears: swivel + occasional flick
    this.earT -= dt || 0;
    if (this.earT < -0.25) this.earT = 1.5 + this.rand() * 5;
    const flick = this.earT < 0 ? Math.sin((this.earT / -0.25) * Math.PI) : 0;
    b.earL.rotation.set(-0.15 * al + flick * 0.5, 0.25 * al, -0.2 + al * 0.25 + flick * 0.3);
    b.earR.rotation.set(-0.15 * al - flick * 0.2, -0.25 * al, 0.2 - al * 0.25);
    // tail: flicks while calm, raised white flag when fleeing
    this.tailT -= dt || 0;
    if (this.tailT < -0.5) this.tailT = 2 + this.rand() * 6;
    const wag = this.tailT < 0 ? Math.sin((this.tailT / -0.5) * Math.PI * 3) * 0.6 : 0;
    b.tail.rotation.set(-g * 1.9 - al * 0.3, 0, wag);
  }
}

export function createDeer(world, clearings) {
  const group = new THREE.Group(); group.name = 'deer';
  const list = [];
  const plan = [
    { c: 0, kind: 'stag', scale: 1.04, dx: 4, dz: -3 }, { c: 0, kind: 'doe', scale: 0.92, dx: -5, dz: 2 },
    { c: 0, kind: 'doe', scale: 0.9, dx: 1, dz: 6 }, { c: 0, kind: 'fawn', scale: 0.6, dx: -2, dz: 5 },
    { c: 1, kind: 'doe', scale: 0.93, dx: 2, dz: 1 }, { c: 1, kind: 'doe', scale: 0.89, dx: -4, dz: -3 }, { c: 1, kind: 'fawn', scale: 0.64, dx: -3, dz: -1 },
  ];
  plan.forEach((p, i) => {
    const cl = clearings[p.c];
    const d = new Deer(world, { kind: p.kind, scale: p.scale, seed: 100 + i * 17, x: cl.x + p.dx, z: cl.z + p.dz, home: { x: cl.x, z: cl.z, r: cl.r * 0.85 } });
    list.push(d); group.add(d.group);
  });
  return {
    group, list,
    update(dt, player) { for (const d of list) d.update(dt, player, list); },
  };
}
