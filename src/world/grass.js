// GPU grass: blade clusters in a tile that wraps around the camera. Placement, height and
// density all come from the terrain height texture, so no CPU work per frame.
import * as THREE from 'three';
import { WORLD } from './layout.js';
import { WIND_GLSL, applyTranslucency } from './foliage.js';
import { mulberry32 } from '../util/noise.js';

export function createGrass(shared, quality) {
  const rand = mulberry32(99);
  // one cluster = 3 curved blades
  const BL = 4, SEG = 2;
  const pos = [], idx = [], bn = [];
  for (let b = 0; b < BL; b++) {
    const a = (b / BL) * Math.PI * 2 + rand() * 1.2, r = 0.03 + rand() * 0.09;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, rot = rand() * Math.PI;
    const cx = Math.cos(rot), sz = Math.sin(rot), hs = 0.7 + rand() * 0.45;
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, w = 0.0085 * (1 - t * t * 0.9) * (0.8 + rand() * 0.5);
      if (s === SEG) { pos.push(ox, t * hs, oz); bn.push(-sz, cx); }
      else { pos.push(ox - cx * w, t * hs, oz - sz * w, ox + cx * w, t * hs, oz + sz * w); bn.push(-sz, cx, -sz, cx); }
    }
    for (let s = 0; s < SEG - 1; s++) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const k = base + (SEG - 1) * 2; idx.push(k, k + 1, k + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('bnormal', new THREE.Float32BufferAttribute(bn, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  const N = quality.grassBlades;
  const off = new Float32Array(N * 2), rnd = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    off[i * 2] = rand(); off[i * 2 + 1] = rand();
    rnd[i * 4] = rand(); rnd[i * 4 + 1] = rand(); rnd[i * 4 + 2] = rand(); rnd[i * 4 + 3] = rand();
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('rnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.tHeight = shared.heightTex;
    sh.uniforms.uTile = { value: quality.grassRange * 2 };
    sh.uniforms.uWorld = { value: WORLD };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${WIND_GLSL}
        attribute vec2 offset; attribute vec4 rnd; attribute vec2 bnormal;
        uniform sampler2D tHeight; uniform float uTile, uWorld;
        varying vec3 vGrassCol;
        vec3 gPos;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 objectNormal;
        {
          vec2 rel = mod(offset * uTile - cameraPosition.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
          vec2 wxz = cameraPosition.xz + rel;
          vec4 hm = texture2D(tHeight, wxz / uWorld + 0.5);
          float fade = 1.0 - smoothstep(0.62, 0.98, length(rel) / (0.5 * uTile));
          float dens = hm.g;
          float keep = step(rnd.x, dens * 1.1) * step(0.12, hm.r);
          float hgt = (0.12 + 0.36 * rnd.y * rnd.y * (0.35 + 0.65 * dens) + 0.1 * dens) * fade * keep;
          float ang = rnd.z * 6.2831853;
          float ca = cos(ang), sa = sin(ang);
          float wid = 0.8 + 0.6 * rnd.w;
          vec3 p = vec3((position.x * ca - position.z * sa) * wid, position.y * hgt, (position.x * sa + position.z * ca) * wid);
          float y2 = position.y * position.y;
          vec2 lean = vec2(cos(ang * 1.7 + rnd.w * 3.0), sin(ang * 1.7 + rnd.w * 3.0)) * 0.22;
          float g = windGust(wxz);
          float fl = sin(uTime * 3.1 + wxz.x * 2.0 + wxz.y * 1.3 + rnd.w * 6.0);
          p.xz += (lean + WIND_DIR * (g * 0.3 + fl * 0.07)) * hgt * y2;
          p.y -= dot(lean, lean) * hgt * y2 * 0.5;
          gPos = vec3(wxz.x + p.x, hm.r + p.y - 0.015, wxz.y + p.z);
          vec2 bnr = vec2(bnormal.x * ca - bnormal.y * sa, bnormal.x * sa + bnormal.y * ca);
          objectNormal = normalize(vec3(bnr.x * 0.35, 1.0, bnr.y * 0.35));
          float hue = rnd.w;
          vec3 root = vec3(0.035, 0.07, 0.018);
          vec3 tip = mix(vec3(0.17, 0.30, 0.06), vec3(0.30, 0.34, 0.10), hue * hue);
          vGrassCol = mix(root, tip, position.y) * (0.75 + 0.5 * rnd.y);
        }`)
      .replace('#include <begin_vertex>', `vec3 transformed = gPos;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGrassCol;`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vGrassCol;`);
  };
  applyTranslucency(mat, { strength: 0.8, tint: [1.5, 1.45, 0.6] });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.layers.set(1);
  mesh.name = 'grass';
  return { mesh };
}
