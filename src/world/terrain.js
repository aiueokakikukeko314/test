// Terrain mesh with multi-layer PBR ground (leaf litter, moss, river pebbles, mud, rock),
// plus a height/mask texture that other shaders (water, grass, particles) sample.
import * as THREE from 'three';
import { WORLD, HALF, heightAt, riverDist, riverHalfWidth, clearingFactor } from './layout.js';
import { fbm, vnoise, smoothstep, clamp } from '../util/noise.js';

const CAUSTICS_GLSL = /* glsl */ `
  // Animated caustic pattern (after Dave Hoskins' tileable water caustic)
  float caustic(vec2 uv, float time) {
    const float TAU = 6.28318530718;
    vec2 p = mod(uv * TAU, TAU) - 250.0;
    vec2 i = p; float c = 1.0; const float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float t = time * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 4.0; c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }
`;

export function createTerrain(tex, shared, quality) {
  const N = quality.terrainRes;            // vertices per side
  const step = WORLD / (N - 1);
  const pos = new Float32Array(N * N * 3);
  const nrm = new Float32Array(N * N * 3);
  const splat = new Float32Array(N * N * 4); // moss, pebbles, mud, rock  (remainder = leaf litter)
  const tint = new Float32Array(N * N);
  const H = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    const z = -HALF + j * step;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * step;
      H[j * N + i] = heightAt(x, z);
    }
  }
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * step;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * step;
      const k = j * N + i;
      const h = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const hl = H[j * N + Math.max(i - 1, 0)], hr = H[j * N + Math.min(i + 1, N - 1)];
      const hd = H[Math.max(j - 1, 0) * N + i], hu = H[Math.min(j + 1, N - 1) * N + i];
      let nx = (hl - hr) / (2 * step), nz = (hd - hu) / (2 * step);
      const l = Math.hypot(nx, 1, nz);
      nx /= l; nz /= l; const ny = 1 / l;
      nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;

      const d = Math.abs(riverDist(x, z)) - riverHalfWidth(z); // distance from the waterline
      const n1 = fbm(x * 0.06 + 31, z * 0.06 + 7, 3);
      const n2 = fbm(x * 0.17 + 5, z * 0.17 + 19, 2);
      const slope = 1 - ny;
      const clear = clearingFactor(x, z);
      let pebbles = smoothstep(0.55, 0.05, h + (n2 - 0.5) * 0.5);
      pebbles = Math.max(pebbles, smoothstep(2.5, 0.5, d) * smoothstep(0.42, 0.62, n1) * 0.9);
      let mud = smoothstep(0.1, 0.5, h) * smoothstep(5.5, 1.2, d + (n2 - 0.5) * 3) * 0.85;
      let moss = smoothstep(0.42, 0.66, n1 + clear * 0.35 + smoothstep(14, 3, d) * 0.12) * (1 - slope * 3);
      moss = clamp(Math.max(moss, clear * 0.9), 0, 1);
      const rock = smoothstep(0.16, 0.3, slope + (n2 - 0.5) * 0.08);
      mud *= 1 - pebbles; moss *= (1 - pebbles) * (1 - mud * 0.8);
      splat[k * 4] = moss * (1 - rock); splat[k * 4 + 1] = pebbles * (1 - rock * 0.5);
      splat[k * 4 + 2] = mud * (1 - rock); splat[k * 4 + 3] = rock;
      tint[k] = 0.78 + 0.44 * fbm(x * 0.022 + 90, z * 0.022 + 40, 3);
    }
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let q = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();

  // --- height texture: R = height, G = grass density, B = distance outside the waterline (m), A = spare
  const TN = 512;
  const data = new Float32Array(TN * TN * 4);
  for (let j = 0; j < TN; j++) {
    const z = -HALF + (j + 0.5) / TN * WORLD;
    for (let i = 0; i < TN; i++) {
      const x = -HALF + (i + 0.5) / TN * WORLD;
      const h = heightAt(x, z);
      const d = Math.abs(riverDist(x, z)) - riverHalfWidth(z);
      const clear = clearingFactor(x, z);
      const n = fbm(x * 0.05 + 13, z * 0.05 + 77, 3);
      let grass = clamp(clear * 1.2 + smoothstep(0.52, 0.72, n) * 0.55 + smoothstep(9, 2.5, d) * 0.5, 0, 1);
      grass *= smoothstep(0.12, 0.45, h);
      const k = (j * TN + i) * 4;
      data[k] = h; data[k + 1] = grass; data[k + 2] = d; data[k + 3] = vnoise(x * 0.3, z * 0.3);
    }
  }
  const half = new Uint16Array(TN * TN * 4);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(clamp(data[i], -60000, 60000));
  const heightTex = new THREE.DataTexture(half, TN, TN, THREE.RGBAFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;
  shared.heightTex.value = heightTex;

  // --- material
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tLeavesD: { value: tex.leavesD }, tLeavesN: { value: tex.leavesN },
      tMossD: { value: tex.mossD }, tMossN: { value: tex.mossN },
      tPebD: { value: tex.pebD }, tPebN: { value: tex.pebN },
      tMudD: { value: tex.mudD }, tMudN: { value: tex.mudN },
      tRockD: { value: tex.rockD }, tRockN: { value: tex.rockN },
      uTime: shared.time,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat; attribute float tint;
        varying vec4 vSplat; varying float vTint; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat; vTint = tint; vWPos = position; vWNrm = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tLeavesD, tLeavesN, tMossD, tMossN, tPebD, tPebN, tMudD, tMudN, tRockD, tRockN;
        uniform float uTime;
        varying vec4 vSplat; varying float vTint; varying vec3 vWPos; varying vec3 vWNrm;
        vec3 gDetailN; float gRough;
        ${CAUSTICS_GLSL}
        vec4 lyrD(sampler2D t, vec2 uv, float farMix) {
          return mix(texture2D(t, uv), texture2D(t, uv * 0.137 + 0.31), farMix);
        }
        vec2 lyrN(sampler2D t, vec2 uv, float farMix) {
          return mix(texture2D(t, uv).xy, texture2D(t, uv * 0.137 + 0.31).xy, farMix) * 2.0 - 1.0;
        }`)
      .replace('#include <map_fragment>', `
        {
          float dist = length(vWPos - cameraPosition);
          float farMix = smoothstep(14.0, 55.0, dist) * 0.85 + 0.08;
          vec2 uv = vWPos.xz;
          vec4 cL = lyrD(tLeavesD, uv * 0.42, farMix);
          vec4 cM = lyrD(tMossD, uv * 0.36, farMix);
          vec4 cP = lyrD(tPebD, uv * 0.55, farMix);
          vec4 cU = lyrD(tMudD, uv * 0.48, farMix);
          vec4 cR = lyrD(tRockD, uv * 0.3, farMix);
          // height-ish blend: brighter texels of a layer win at transitions
          float lM = dot(cM.rgb, vec3(0.5)), lP = dot(cP.rgb, vec3(0.45)), lU = dot(cU.rgb, vec3(0.5));
          float wM = smoothstep(0.25, 0.75, vSplat.x * (0.65 + lM * 1.6));
          float wP = smoothstep(0.25, 0.75, vSplat.y * (0.7 + lP * 1.2));
          float wU = smoothstep(0.25, 0.75, vSplat.z * (0.7 + lU * 1.2));
          float wR = smoothstep(0.3, 0.7, vSplat.w);
          vec3 col = cL.rgb * vec3(0.92, 0.86, 0.78);
          vec2 nn = lyrN(tLeavesN, uv * 0.42, farMix); float rough = 0.92;
          col = mix(col, cM.rgb * vec3(0.78, 0.95, 0.6), wM); nn = mix(nn, lyrN(tMossN, uv * 0.36, farMix), wM); rough = mix(rough, 0.96, wM);
          col = mix(col, cU.rgb * 0.8, wU); nn = mix(nn, lyrN(tMudN, uv * 0.48, farMix), wU); rough = mix(rough, 0.7, wU);
          col = mix(col, cP.rgb * 0.95, wP); nn = mix(nn, lyrN(tPebN, uv * 0.55, farMix) * 1.4, wP); rough = mix(rough, 0.72, wP);
          col = mix(col, cR.rgb * 0.8, wR); nn = mix(nn, lyrN(tRockN, uv * 0.3, farMix) * 1.3, wR); rough = mix(rough, 0.85, wR);
          col *= vTint;
          // wet band along the waterline and submerged bed
          float wet = smoothstep(0.32, 0.02, vWPos.y);
          col *= mix(1.0, 0.5, wet);
          rough = mix(rough, 0.28, wet);
          float under = smoothstep(0.0, -0.12, vWPos.y);
          if (under > 0.0) {
            float c = caustic(uv * 0.21 + vec2(0.0, uTime * 0.02), uTime * 0.55) + 0.6 * caustic(uv * 0.13 - 3.0, uTime * 0.4 + 2.0);
            col *= 1.0 + under * c * 2.2 * exp(vWPos.y * 0.9);
            col *= mix(vec3(1.0), vec3(0.72, 0.92, 0.78), under * clamp(-vWPos.y * 0.8, 0.0, 1.0));
          }
          diffuseColor.rgb = col;
          gDetailN = normalize(vWNrm + vec3(nn.x, 0.0, nn.y) * 0.85);
          gRough = rough;
        }`)
      .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(gDetailN, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return { mesh, heightTex };
}

export { CAUSTICS_GLSL };
