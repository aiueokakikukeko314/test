// Shared foliage shading: wind animation in the vertex stage (also used for shadow depth so the
// dappled light on the ground moves) and cheap leaf translucency in the fragment stage.
import * as THREE from 'three';

export const WIND_GLSL = /* glsl */ `
  uniform float uTime;
  // slow gusts travelling across the valley, returns ~[-1, 1]
  float windGust(vec2 wp) {
    float ph = dot(wp, vec2(0.071, 0.043));
    return sin(uTime * 0.55 + ph) * 0.6 + sin(uTime * 1.27 + ph * 2.3 + 1.7) * 0.3 + sin(uTime * 2.9 + ph * 5.1) * 0.1;
  }
  const vec2 WIND_DIR = vec2(0.82, 0.57);
`;

// mode 'tree': whole-tree sway (shared by trunk + leaves) + leaf flutter
// mode 'plant': small plants / ferns bending from the base
// mode 'trunk': whole-tree sway only
export function windVertexChunk(mode, { treeHeight = 20, amp = 1 } = {}) {
  if (mode === 'plant') {
    return /* glsl */ `
      {
        #ifdef USE_INSTANCING
          vec3 wOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float wScale = length(instanceMatrix[1].xyz);
        #else
          vec3 wOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float wScale = 1.0;
        #endif
        float hgt = max(transformed.y, 0.0);
        float g = windGust(wOrigin.xz);
        float fl = sin(uTime * 3.7 + wOrigin.x * 1.9 + transformed.x * 7.0 + transformed.z * 5.0);
        float bend = (g * 0.11 + fl * 0.03) * hgt * ${amp.toFixed(2)};
        transformed.xz += WIND_DIR * bend / max(wScale, 0.001);
      }`;
  }
  const flutter = mode === 'tree' ? /* glsl */ `
        float fl = sin(uTime * 4.3 + wOrigin.x + transformed.x * 2.1 + transformed.y * 1.7 + transformed.z * 2.4);
        float fl2 = sin(uTime * 6.1 + transformed.x * 3.3 + transformed.z * 2.9 + wOrigin.z);
        transformed.xyz += vec3(fl * 0.035, fl2 * 0.025, fl2 * 0.035) * uv.y * (0.5 + 0.5 * abs(g)) * ${amp.toFixed(2)};` : '';
  return /* glsl */ `
      {
        #ifdef USE_INSTANCING
          vec3 wOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 wOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float g = windGust(wOrigin.xz);
        float hN = clamp(transformed.y / ${treeHeight.toFixed(1)}, 0.0, 1.3);
        transformed.xz += WIND_DIR * g * 0.32 * hN * hN * ${amp.toFixed(2)};
        ${flutter}
      }`;
}

export function applyWind(material, shared, mode, opts) {
  const chunk = windVertexChunk(mode, opts);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${chunk}`);
  };
  material.userData.key = (material.userData.key || '') + `|wind-${mode}-${JSON.stringify(opts || {})}`;
  material.customProgramCacheKey = () => material.userData.key;
  return material;
}

// Leaves lit from behind glow yellow-green instead of going black.
export function applyTranslucency(material, { tint = [1.35, 1.3, 0.5], strength = 0.85, puffy = true } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', /* glsl */ `
      float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
      vec3 normal = normalize( vNormal );
      ${puffy ? '' : 'normal *= faceDirection;'}
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 Ls = directionalLights[0].direction;
        float ndl = dot(normal, Ls);
        float back = smoothstep(0.1, -0.35, ndl);
        normal = normalize(normal - 2.0 * min(ndl, 0.0) * Ls * back);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(${tint.map((v) => v.toFixed(2)).join(',')}), back * ${strength.toFixed(2)});
      }
      #endif
      vec3 nonPerturbedNormal = normal;
      #if defined( USE_NORMALMAP_TANGENTSPACE )
        mat3 tbn = getTangentFrame( - vViewPosition, normal, vNormalMapUv );
      #endif
    `);
  };
  material.userData.key = (material.userData.key || '') + `|transl-${tint}-${strength}-${puffy}`;
  material.customProgramCacheKey = () => material.userData.key;
  return material;
}

// Depth material with the same wind + alpha cut-out, for moving leaf shadows.
export function makeWindDepthMaterial(map, alphaTest, shared, mode, opts) {
  const m = new THREE.MeshDepthMaterial({ map, alphaTest, side: THREE.DoubleSide });
  return applyWind(m, shared, mode, opts);
}
