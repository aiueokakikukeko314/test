// Ground cover from photoscanned CC0 models (Poly Haven): mossy rocks, ferns, shrubs,
// wildflowers, stumps, fallen logs and dead branches, scattered by habitat rules.
import * as THREE from 'three';
import { initSimplifier, simplifyIndices } from '../util/simplify.js';
import { HALF, heightAt, normalAt, riverDist, riverHalfWidth, clearingFactor } from './layout.js';
import { fbm, mulberry32, smoothstep } from '../util/noise.js';
import { LodInstances, composeMatrix } from './instancing.js';
import { applyWind, applyTranslucency, makeWindDepthMaterial } from './foliage.js';

// Meshopt/quantised glTF stores positions as normalised integers. Convert to plain floats
// before baking transforms, otherwise values are clamped to the integer range.
export function toFloatGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name];
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}

// Pull every mesh out of a glTF scene as a recentred geometry (base at y=0, centred in xz).
function extractVariants(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = toFloatGeometry(o.geometry);
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -bb.min.y, -cz);
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    out.push({ geometry: g, material: o.material, size, radius: Math.max(size.x, size.z) / 2 });
  });
  return out;
}

function simplified(geo, ratio, error, cell) {
  const out = simplifyIndices(Uint32Array.from(geo.index.array), geo.attributes.position.array, ratio, error, cell);
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.attributes[name]);
  g.setIndex(new THREE.BufferAttribute(out, 1));
  return g;
}

export async function createScatter(models, shared, quality, world) {
  await initSimplifier();
  const rand = mulberry32(777);
  const group = new THREE.Group();
  group.name = 'scatter';
  const sets = [];
  const rocksInWater = [];

  const prepMat = (src, kind) => {
    const m = new THREE.MeshStandardMaterial({
      map: src.map, normalMap: src.normalMap, roughness: kind === 'rock' ? 0.88 : 0.75, metalness: 0,
      color: kind === 'rock' ? 0xb8b8b0 : kind === 'wood' ? 0xa09a90 : 0xffffff,
    });
    if (m.map) m.map.anisotropy = quality.anisotropy;
    if (kind === 'plant') {
      m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.alphaToCoverage = quality.msaa > 0;
      m.normalMap = null;
      applyWind(m, shared, 'plant', { amp: 1 });
      applyTranslucency(m, { strength: 0.8, tint: [1.2, 1.22, 0.5], puffy: false });
    }
    return m;
  };

  // spec: { model, kind, size:[min,max] target bounding size in metres, place(x,z,info) -> probability, spacing, sink, colliderMin, lodDist, range }
  function addType(spec) {
    const gltf = models[spec.model];
    if (!gltf) return;
    let variants = extractVariants(gltf);
    if (spec.pickVariants) variants = variants.filter((v, i) => spec.pickVariants(v, i));
    if (!variants.length) return;
    const lists = variants.map(() => []);
    const S = spec.spacing;
    for (let gz = -HALF + 3; gz < HALF - 3; gz += S) {
      for (let gx = -HALF + 3; gx < HALF - 3; gx += S) {
        const x = gx + rand() * S, z = gz + rand() * S;
        const dOut = Math.abs(riverDist(x, z)) - riverHalfWidth(z);
        const h = heightAt(x, z);
        const p = spec.place(x, z, { dOut, h, clear: clearingFactor(x, z) });
        if (rand() > p) continue;
        if (Math.hypot(x - shared.spawn.x, z - shared.spawn.z) < (spec.kind === 'plant' ? 0.6 : 2.2)) continue;
        const vi = Math.floor(rand() * variants.length);
        const v = variants[vi];
        const target = spec.size[0] + Math.pow(rand(), spec.sizePow || 1.6) * (spec.size[1] - spec.size[0]);
        const native = Math.max(v.size.x, v.size.z, v.size.y * (spec.kind === 'plant' ? 1 : 0.6));
        const scale = target / native;
        const n = normalAt(x, z);
        const align = spec.kind === 'plant' ? 0.4 : 1.0;
        lists[vi].push({
          x, z, y: h - (spec.sink || 0) * v.size.y * scale, rot: rand() * Math.PI * 2, scale,
          tx: Math.atan2(n[2], n[1]) * align + (rand() - 0.5) * (spec.tilt || 0.1),
          tz: -Math.atan2(n[0], n[1]) * align + (rand() - 0.5) * (spec.tilt || 0.1),
          v: rand(), radius: v.radius * scale, dOut, height: v.size.y * scale,
        });
      }
    }
    variants.forEach((v, vi) => {
      const list = lists[vi];
      if (!list.length) return;
      const mat = prepMat(v.material, spec.kind);
      const plant = spec.kind === 'plant';
      const depth = plant ? makeWindDepthMaterial(mat.map, 0.4, shared, 'plant', { amp: 1 }) : undefined;
      const shadow = spec.shadow !== false;
      const levels = [{ maxDist: spec.lodDist, parts: [{ geometry: v.geometry, material: mat, depthMaterial: depth, castShadow: shadow, layer: spec.layer }] }];
      if (spec.range > spec.lodDist) {
        levels.push({ maxDist: spec.range, parts: [{ geometry: simplified(v.geometry, spec.lodRatio || 0.25, spec.lodError || 0.03, plant ? 0 : Math.max(v.size.x, v.size.y, v.size.z) * 0.09), material: mat, depthMaterial: depth, castShadow: shadow && !plant, layer: spec.layer }] });
      }
      const mats = new Float32Array(list.length * 16), cols = new Float32Array(list.length * 3);
      list.forEach((o, i) => {
        composeMatrix(mats, i * 16, o.x, o.y, o.z, o.rot, o.scale, o.tx, o.tz, o.scale * (spec.scaleY ? spec.scaleY[0] + o.v * (spec.scaleY[1] - spec.scaleY[0]) : 1));
        const b = plant ? 0.72 + o.v * 0.42 : 0.82 + o.v * 0.3;
        const warm = plant ? 0.92 + ((o.v * 5.7) % 1) * 0.2 : 1;
        const tn = spec.tint || [1, 1, 1];
        cols[i * 3] = b * warm * tn[0]; cols[i * 3 + 1] = b * tn[1]; cols[i * 3 + 2] = b * (2 - warm) * tn[2];
        if (spec.colliderMin && o.radius > spec.colliderMin) world.colliders.add({ x: o.x, z: o.z, r: o.radius * (spec.colliderScale || 0.75) });
        if (spec.kind === 'rock' && o.dOut < 0.3) rocksInWater.push(o);
      });
      const inst = new LodInstances(`${spec.model}-${vi}`, levels, mats, cols, { moveThreshold: plant ? 1.5 : 3 });
      inst.stats = { n: list.length, tris: levels.map((l) => l.parts[0].geometry.index.count / 3) };
      group.add(inst.group);
      sets.push(inst);
    });
  }

  const D = quality.plantDensity, R = quality.plantRange;
  const patch = (x, z, f, o) => fbm(x * f + o, z * f + o * 1.7, 3);

  // ---- rocks: boulders in and along the river, mossy stones through the forest
  for (const model of ['rock_moss_set_01', 'rock_moss_set_02']) {
    addType({ model, kind: 'rock', size: [0.35, 2.6], sizePow: 2.6, spacing: 3.1, sink: 0.22, colliderMin: 0.55, lodDist: 24, range: 125, lodRatio: 0.1, lodError: 0.06,
      place: (x, z, i) => (i.dOut < 2.5 ? 0.34 * smoothstep(-7, -0.5, i.dOut) + 0.16 * smoothstep(0.42, 0.7, patch(x, z, 0.05, 3)) : 0.02 + 0.07 * smoothstep(0.6, 0.8, patch(x, z, 0.04, 9))) });
  }
  addType({ model: 'rock_07', kind: 'rock', size: [1.2, 4.2], sizePow: 2, spacing: 13, sink: 0.25, colliderMin: 0.6, lodDist: 40, range: 170, lodRatio: 0.3,
    place: (x, z, i) => (i.dOut < 3 ? 0.5 : 0.1 + 0.25 * smoothstep(0.6, 0.8, patch(x, z, 0.03, 21))) });
  addType({ model: 'rock_09', kind: 'rock', size: [1.0, 3.6], sizePow: 2, spacing: 12, sink: 0.25, colliderMin: 0.6, lodDist: 40, range: 170, lodRatio: 0.3,
    place: (x, z, i) => (i.dOut < 4 ? 0.45 : 0.08 + 0.25 * smoothstep(0.6, 0.8, patch(x, z, 0.03, 41))) });
  addType({ model: 'stone_01', kind: 'rock', size: [0.25, 0.9], spacing: 4.5, sink: 0.2, lodDist: 14, range: 48, lodRatio: 0.12, lodError: 0.06,
    place: (x, z, i) => (i.dOut < 5 ? 0.5 : 0.12) });

  // ---- dead wood
  addType({ model: 'dead_tree_trunk', kind: 'wood', size: [4.5, 8], spacing: 21, sink: 0.12, tilt: 0.05, colliderMin: 99, lodDist: 30, range: 130, lodRatio: 0.3,
    place: (x, z, i) => (i.dOut > 1 ? 0.5 * (1 - i.clear) : 0) });
  for (const model of ['tree_stump_01', 'tree_stump_02']) {
    addType({ model, kind: 'wood', size: [0.9, 1.6], spacing: 24, sink: 0.06, colliderMin: 0.3, colliderScale: 0.6, lodDist: 26, range: 110, lodRatio: 0.3,
      place: (x, z, i) => (i.dOut > 2 ? 0.5 : 0) });
  }
  addType({ model: 'dry_branches_medium_01', kind: 'wood', size: [1.0, 2.4], spacing: 8.5, sink: 0.03, lodDist: 16, range: 55, lodRatio: 0.3,
    place: (x, z, i) => (i.dOut > 0.5 ? 0.4 * (1 - i.clear * 0.7) : 0) });
  addType({ model: 'root_cluster_01', kind: 'wood', size: [1.8, 3.4], spacing: 26, sink: 0.25, lodDist: 26, range: 90, lodRatio: 0.3,
    place: (x, z, i) => (i.dOut > 0.5 && i.dOut < 10 ? 0.55 : 0.12 * (1 - i.clear)) });

  // ---- ferns: shady forest floor, in drifts
  addType({ model: 'fern_02', kind: 'plant', tint: [0.62, 1.0, 0.5], size: [0.75, 1.5], scaleY: [1.4, 2.1], spacing: 1.7 / Math.sqrt(D), sink: 0.03, lodDist: 15, range: R, lodRatio: 0.5, lodError: 0.012, layer: 1, shadow: true,
    place: (x, z, i) => (i.dOut > 0.8 ? smoothstep(0.42, 0.62, patch(x, z, 0.07, 5)) * (1 - i.clear * 0.85) * 0.8 + 0.05 : 0) });
  // ---- leafy undergrowth
  addType({ model: 'shrub_02', kind: 'plant', size: [0.6, 1.3], spacing: 3.3 / Math.sqrt(D), sink: 0.02, lodDist: 14, range: R, lodRatio: 0.5, lodError: 0.012, layer: 1,
    place: (x, z, i) => (i.dOut > 0.8 ? 0.2 + 0.45 * smoothstep(0.5, 0.7, patch(x, z, 0.05, 61)) : 0) });
  addType({ model: 'shrub_03', kind: 'plant', size: [0.45, 0.9], spacing: 2.8 / Math.sqrt(D), sink: 0.02, lodDist: 14, range: R * 0.85, lodRatio: 0.5, lodError: 0.012, layer: 1,
    place: (x, z, i) => (i.dOut > 0.5 ? 0.15 + 0.5 * i.clear + 0.3 * smoothstep(8, 2, i.dOut) : 0) });
  addType({ model: 'nettle_plant', kind: 'plant', size: [0.5, 1.1], spacing: 3.0 / Math.sqrt(D), sink: 0.02, lodDist: 12, range: R * 0.8, lodRatio: 0.5, lodError: 0.012, layer: 1,
    place: (x, z, i) => (i.dOut > 0.4 ? 0.5 * smoothstep(9, 1.5, i.dOut) + 0.3 * smoothstep(0.55, 0.75, patch(x, z, 0.06, 101)) : 0) });
  addType({ model: 'weed_plant_02', kind: 'plant', size: [0.35, 0.8], spacing: 2.6 / Math.sqrt(D), sink: 0.02, lodDist: 12, range: R * 0.7, lodRatio: 0.5, lodError: 0.012, layer: 1, shadow: false,
    place: (x, z, i) => (i.dOut > 0.3 ? 0.18 + 0.5 * i.clear + 0.3 * smoothstep(6, 1, i.dOut) : 0) });
  // ---- wildflowers in the meadows and along the banks
  addType({ model: 'dandelion_01', kind: 'plant', size: [0.22, 0.42], spacing: 2.0 / Math.sqrt(D), sink: 0.0, lodDist: 10, range: R * 0.6, lodRatio: 0.5, lodError: 0.012, layer: 1, shadow: false,
    place: (x, z, i) => (i.dOut > 0.5 ? i.clear * 0.8 * smoothstep(0.4, 0.6, patch(x, z, 0.12, 121)) + 0.04 : 0) });
  addType({ model: 'periwinkle_plant', kind: 'plant', size: [0.3, 0.6], spacing: 2.4 / Math.sqrt(D), sink: 0.0, lodDist: 10, range: R * 0.6, lodRatio: 0.5, lodError: 0.012, layer: 1, shadow: false,
    place: (x, z, i) => (i.dOut > 0.5 ? 0.6 * smoothstep(0.58, 0.72, patch(x, z, 0.09, 141)) * (0.3 + i.clear) : 0) });

  return {
    group, sets, rocksInWater,
    update(camPos, force) { for (const s of sets) s.update(camPos, force); },
  };
}
