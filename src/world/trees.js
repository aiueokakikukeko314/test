// Forest: procedurally grown trees (ez-tree) turned into three LOD levels and instanced
// across the valley. Species are distributed by habitat (riverbank, slope, valley floor).
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { initSimplifier, simplifyIndices } from '../util/simplify.js';
import { HALF, heightAt, riverDist, riverHalfWidth, clearingFactor } from './layout.js';
import { fbm, mulberry32, smoothstep, clamp } from '../util/noise.js';
import { LodInstances, composeMatrix } from './instancing.js';
import { applyWind, applyTranslucency, makeWindDepthMaterial } from './foliage.js';

const SPECIES = [
  { id: 'oakL', preset: 'Oak Large', height: 25, seed: 23399, leafMul: 1.7, leafSize: 1.0, tint: [0.62, 0.78, 0.42] },
  { id: 'oakL2', preset: 'Oak Large', height: 22, seed: 9127, leafMul: 1.7, leafSize: 1.0, tint: [0.58, 0.76, 0.40] },
  { id: 'oakM', preset: 'Oak Medium', height: 16, seed: 512, leafMul: 1.5, leafSize: 1.0, tint: [0.66, 0.82, 0.42] },
  { id: 'ashL', preset: 'Ash Large', height: 23, seed: 3011, leafMul: 1.5, leafSize: 1.0, tint: [0.66, 0.84, 0.44] },
  { id: 'ashM', preset: 'Ash Medium', height: 15, seed: 77, leafMul: 1.4, leafSize: 1.0, tint: [0.7, 0.88, 0.46] },
  { id: 'aspenL', preset: 'Aspen Large', height: 21, seed: 30631, leafMul: 1.3, leafSize: 1.0, tint: [0.74, 0.9, 0.46] },
  { id: 'aspenM', preset: 'Aspen Medium', height: 14, seed: 4242, leafMul: 1.3, leafSize: 1.0, tint: [0.78, 0.92, 0.48] },
  { id: 'pineL', preset: 'Pine Large', height: 30, seed: 44166, leafMul: 1.5, leafSize: 1.15, tint: [0.5, 0.66, 0.42] },
  { id: 'pineL2', preset: 'Pine Large', height: 26, seed: 1203, leafMul: 1.5, leafSize: 1.15, tint: [0.48, 0.64, 0.42] },
  { id: 'pineM', preset: 'Pine Medium', height: 18, seed: 6, leafMul: 1.4, leafSize: 1.15, tint: [0.52, 0.68, 0.42] },
  { id: 'bush1', preset: 'Bush 1', height: 2.2, seed: 11, leafMul: 1.2, leafSize: 1.0, tint: [0.6, 0.8, 0.4], bush: true },
  { id: 'bush2', preset: 'Bush 2', height: 2.8, seed: 12, leafMul: 1.2, leafSize: 1.0, tint: [0.62, 0.82, 0.42], bush: true },
  { id: 'bush3', preset: 'Bush 3', height: 1.7, seed: 13, leafMul: 1.2, leafSize: 1.0, tint: [0.58, 0.78, 0.4], bush: true },
];

function waitForImage(tex) {
  return new Promise((resolve) => {
    const check = () => (tex.image && (tex.image.complete !== false) && tex.image.width > 0 ? resolve(tex) : setTimeout(check, 30));
    check();
  });
}

function processLeaves(src, scale, rand, leafSize) {
  const g = new THREE.BufferGeometry();
  const pos = Float32Array.from(src.attributes.position.array);
  const nor = Float32Array.from(src.attributes.normal.array);
  const uv = Float32Array.from(src.attributes.uv.array);
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i++) pos[i] *= scale;
  // crown centre + radius
  const bb = new THREE.Box3().setFromArray(pos);
  const c = bb.getCenter(new THREE.Vector3());
  const rad = bb.getSize(new THREE.Vector3()).length() * 0.5;
  const col = new Float32Array(n * 3);
  const V = 8; // vertices per leaf (double billboard)
  const cen = new THREE.Vector3(), puff = new THREE.Vector3(), qn = new THREE.Vector3();
  for (let i = 0; i + V <= n; i += V) {
    cen.set(0, 0, 0);
    for (let k = 0; k < V; k++) cen.x += pos[(i + k) * 3], cen.y += pos[(i + k) * 3 + 1], cen.z += pos[(i + k) * 3 + 2];
    cen.multiplyScalar(1 / V);
    if (leafSize !== 1) for (let k = 0; k < V; k++) for (let a = 0; a < 3; a++) {
      const o = (i + k) * 3 + a; const cv = a === 0 ? cen.x : a === 1 ? cen.y : cen.z;
      pos[o] = cv + (pos[o] - cv) * leafSize;
    }
    puff.copy(cen).sub(c); puff.y *= 0.8; puff.y += rad * 0.22; puff.normalize();
    const depth = clamp(cen.distanceTo(c) / (rad * 0.62), 0, 1);
    const ao = 0.42 + 0.58 * depth * depth;
    const hue = 0.88 + rand() * 0.24;
    for (let k = 0; k < V; k++) {
      const o = (i + k) * 3;
      qn.set(nor[o], nor[o + 1], nor[o + 2]);
      if (qn.dot(puff) < 0) qn.negate();
      qn.lerp(puff, 0.72).normalize();
      nor[o] = qn.x; nor[o + 1] = qn.y; nor[o + 2] = qn.z;
      col[o] = ao * hue; col[o + 1] = ao; col[o + 2] = ao * (2 - hue) * 0.9;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}

// Keep every n-th leaf card and enlarge the survivors so the crown keeps its volume.
function thinLeaves(src, every, grow) {
  const V = 8;
  const n = src.attributes.position.count;
  const keep = [];
  for (let i = 0, l = 0; i + V <= n; i += V, l++) if (l % every === 0) keep.push(i);
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = src.attributes[name], sz = a.itemSize;
    const out = new Float32Array(keep.length * V * sz);
    keep.forEach((i, k) => out.set(a.array.subarray(i * sz, (i + V) * sz), k * V * sz));
    g.setAttribute(name, new THREE.BufferAttribute(out, sz));
  }
  const p = g.attributes.position.array;
  for (let k = 0; k < keep.length; k++) {
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < V; v++) { const o = (k * V + v) * 3; cx += p[o]; cy += p[o + 1]; cz += p[o + 2]; }
    cx /= V; cy /= V; cz /= V;
    for (let v = 0; v < V; v++) { const o = (k * V + v) * 3; p[o] = cx + (p[o] - cx) * grow; p[o + 1] = cy + (p[o + 1] - cy) * grow; p[o + 2] = cz + (p[o + 2] - cz) * grow; }
  }
  const idx = new Uint32Array(keep.length * 12);
  for (let k = 0; k < keep.length * 2; k++) { const b = k * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k * 6); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function simplifyGeo(src, ratio, error, cell) {
  const out = simplifyIndices(Uint32Array.from(src.index.array), src.attributes.position.array, ratio, error, cell);
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.attributes[name]);
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

// Far LOD trunk: the main stem only, as a 5-sided tapered tube following the real trunk line.
function farTrunk(bGeo, trunkR) {
  const p = bGeo.attributes.position;
  let top = 0;
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
  // sample the stem centre at a few heights from vertices close to the axis
  const rings = 4, sides = 5, pos = [], nor = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const y = (r / rings) * top * 0.8, rad = trunkR * (1 - 0.75 * (r / rings));
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad); nor.push(Math.cos(a), 0, Math.sin(a)); uv.push(s / sides, y * 0.2);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
    const a = r * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export async function createForest(shared, quality, onProgress = () => {}) {
  await initSimplifier();
  const rand = mulberry32(20241);
  const group = new THREE.Group();
  group.name = 'forest';

  // ---------- 1. choose tree positions (jittered grid filtered by habitat)
  const placed = SPECIES.map(() => []);
  const trees = []; // for collisions, bird perches, etc.
  const S = quality.treeSpacing;
  const speciesIndex = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));
  const pick = (table) => {
    let t = 0; for (const [, w] of table) t += w;
    let r = rand() * t;
    for (const [id, w] of table) { r -= w; if (r <= 0) return speciesIndex[id]; }
    return speciesIndex[table[0][0]];
  };
  for (let gz = -HALF + 4; gz < HALF - 4; gz += S) {
    for (let gx = -HALF + 4; gx < HALF - 4; gx += S) {
      const x = gx + rand() * S, z = gz + rand() * S;
      const dOut = Math.abs(riverDist(x, z)) - riverHalfWidth(z);
      if (dOut < 1.6) continue;
      const clear = clearingFactor(x, z);
      const dens = 0.72 * (1 - clear) * (0.55 + 0.6 * fbm(x * 0.03 + 50, z * 0.03 + 9, 2)) * smoothstep(1.5, 6, dOut + 2);
      if (rand() > dens) continue;
      if (Math.hypot(x - shared.spawn.x, z - shared.spawn.z) < 3.5) continue;
      const y = heightAt(x, z);
      const conifer = fbm(x * 0.012 + 200, z * 0.012 + 77, 3) + smoothstep(4, 14, y) * 0.25;
      let sp;
      if (dOut < 9) sp = pick([['ashM', 3], ['aspenM', 3], ['aspenL', 2], ['ashL', 2], ['oakM', 1]]);
      else if (conifer > 0.66) sp = pick([['pineL', 4], ['pineL2', 4], ['pineM', 3], ['oakM', 1], ['aspenL', 1]]);
      else if (conifer > 0.58) sp = pick([['pineL', 2], ['pineM', 2], ['oakL', 2], ['oakL2', 2], ['ashL', 2], ['oakM', 1]]);
      else sp = pick([['oakL', 4], ['oakL2', 4], ['oakM', 3], ['ashL', 3], ['ashM', 2], ['aspenL', 1.5], ['aspenM', 1], ['pineM', 0.6]]);
      const scale = 0.78 + Math.pow(rand(), 1.4) * 0.5;
      placed[sp].push({ x, y: y - 0.12, z, rot: rand() * Math.PI * 2, scale, tx: (rand() - 0.5) * 0.07, tz: (rand() - 0.5) * 0.07, v: rand() });
    }
  }
  // understory bushes: forest edges, banks and clearing rims
  const SB = quality.treeSpacing * 0.9;
  for (let gz = -HALF + 4; gz < HALF - 4; gz += SB) {
    for (let gx = -HALF + 4; gx < HALF - 4; gx += SB) {
      const x = gx + rand() * SB, z = gz + rand() * SB;
      const dOut = Math.abs(riverDist(x, z)) - riverHalfWidth(z);
      if (dOut < 1.0) continue;
      const clear = clearingFactor(x, z);
      const edge = clear * (1 - clear) * 4;
      const dens = 0.16 + edge * 0.5 + smoothstep(10, 3, dOut) * 0.2;
      if (rand() > dens * quality.undergrowth) continue;
      const sp = pick([['bush1', 1], ['bush2', 1], ['bush3', 1]]);
      placed[sp].push({ x, y: heightAt(x, z) - 0.05, z, rot: rand() * Math.PI * 2, scale: 0.7 + rand() * 0.7, tx: 0, tz: 0, v: rand() });
    }
  }

  // ---------- 2. grow one mesh per species and derive LODs
  const sets = [];
  for (let si = 0; si < SPECIES.length; si++) {
    const sp = SPECIES[si];
    const list = placed[si];
    if (!list.length) continue;
    const tree = new Tree();
    tree.loadPreset(sp.preset);
    tree.options.seed = sp.seed;
    tree.options.leaves.count = Math.max(1, Math.round(tree.options.leaves.count * sp.leafMul * quality.leafDensity));
    tree.generate();
    const bSrc = tree.branchesMesh.geometry, lSrc = tree.leavesMesh.geometry;
    bSrc.computeBoundingBox(); lSrc.computeBoundingBox();
    const h0 = Math.max(bSrc.boundingBox.max.y, lSrc.boundingBox.max.y);
    const scale = sp.height / h0;
    const trunkR = tree.options.branch.radius[0] * scale;

    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(bSrc.attributes.position.array, (v) => v * scale), 3));
    bGeo.setAttribute('normal', bSrc.attributes.normal.clone());
    bGeo.setAttribute('uv', bSrc.attributes.uv.clone());
    bGeo.setIndex(new THREE.BufferAttribute(Uint32Array.from(bSrc.index.array), 1));
    const lGeo = processLeaves(lSrc, scale, rand, sp.leafSize);

    const barkSrc = tree.branchesMesh.material, leafSrc = tree.leavesMesh.material;
    await Promise.all([waitForImage(barkSrc.map), waitForImage(leafSrc.map), barkSrc.normalMap ? waitForImage(barkSrc.normalMap) : null]);
    const cloneTex = (t, srgb) => {
      const c = t.clone(); c.repeat.copy(t.repeat); c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; c.anisotropy = quality.anisotropy; c.needsUpdate = true; return c;
    };
    const barkMap = cloneTex(barkSrc.map, true);
    const barkNor = barkSrc.normalMap ? cloneTex(barkSrc.normalMap, false) : null;
    const leafMap = leafSrc.map.clone();
    leafMap.colorSpace = THREE.SRGBColorSpace; leafMap.anisotropy = 4; leafMap.premultiplyAlpha = false; leafMap.needsUpdate = true;

    const barkMat = new THREE.MeshStandardMaterial({ map: barkMap, normalMap: barkNor, roughness: 0.93, metalness: 0, color: new THREE.Color(sp.bush ? 0x8a7a66 : 0xd2cac0) });
    applyWind(barkMat, shared, 'trunk', { treeHeight: sp.height, amp: sp.bush ? 0.3 : 1 });
    const mkLeafMat = (alphaTest) => {
      const m = new THREE.MeshStandardMaterial({
        map: leafMap, alphaTest, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, vertexColors: true,
        color: new THREE.Color(...sp.tint), alphaToCoverage: quality.msaa > 0,
      });
      applyWind(m, shared, 'tree', { treeHeight: sp.height, amp: sp.bush ? 0.3 : 1 });
      applyTranslucency(m, { strength: 0.9, tint: [1.12, 1.16, 0.42] });
      return m;
    };
    const windOpts = { treeHeight: sp.height, amp: sp.bush ? 0.3 : 1 };
    const leafDepth = (a) => makeWindDepthMaterial(leafMap, a, shared, 'tree', windOpts);
    const barkDepth = applyWind(new THREE.MeshDepthMaterial(), shared, 'trunk', windOpts);

    const levels = sp.bush
      ? [
        { maxDist: quality.lod[0], parts: [{ geometry: bGeo, material: barkMat, depthMaterial: barkDepth, useColor: false }, { geometry: lGeo, material: mkLeafMat(0.42), depthMaterial: leafDepth(0.42) }] },
        { maxDist: quality.lod[1] * 0.8, parts: [{ geometry: thinLeaves(lGeo, 2, 1.35), material: mkLeafMat(0.3), depthMaterial: leafDepth(0.3), castShadow: false }] },
      ]
      : [
        { maxDist: quality.lod[0], parts: [{ geometry: simplifyGeo(bGeo, 0.5, 0.004, 0.05), material: barkMat, depthMaterial: barkDepth, useColor: false }, { geometry: lGeo, material: mkLeafMat(0.42), depthMaterial: leafDepth(0.42) }] },
        { maxDist: quality.lod[1], parts: [{ geometry: simplifyGeo(bGeo, 0.06, 0.06, 0.2), material: barkMat, depthMaterial: barkDepth, useColor: false }, { geometry: thinLeaves(lGeo, 4, 1.85), material: mkLeafMat(0.3), depthMaterial: leafDepth(0.3) }] },
        { maxDist: quality.lod[2], parts: [{ geometry: farTrunk(bGeo, trunkR), material: barkMat, castShadow: false, useColor: false }, { geometry: thinLeaves(lGeo, 16, 3.8), material: mkLeafMat(0.2), castShadow: false }] },
      ];

    const mats = new Float32Array(list.length * 16), cols = new Float32Array(list.length * 3);
    list.forEach((t, i) => {
      composeMatrix(mats, i * 16, t.x, t.y, t.z, t.rot, t.scale, t.tx, t.tz, t.scale * (0.92 + t.v * 0.16));
      const b = 0.8 + t.v * 0.4, warm = 0.9 + ((t.v * 7.3) % 1) * 0.25;
      cols[i * 3] = b * warm; cols[i * 3 + 1] = b; cols[i * 3 + 2] = b * (1.9 - warm) * 0.95;
      if (!sp.bush) trees.push({ x: t.x, y: t.y, z: t.z, r: Math.max(trunkR * t.scale * 0.9, 0.22), h: sp.height * t.scale, conifer: sp.id.startsWith('pine') });
    });
    const inst = new LodInstances(sp.id, levels, mats, cols);
    inst.stats = { n: list.length, tris: levels.map((l) => l.parts.reduce((a, p) => a + p.geometry.index.count / 3, 0)) };
    group.add(inst.group);
    sets.push(inst);
    onProgress((si + 1) / SPECIES.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    group, trees, sets,
    update(camPos, force) { for (const s of sets) s.update(camPos, force); },
  };
}
