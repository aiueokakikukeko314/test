// River surface: flow-mapped ripples, planar reflection of the forest, depth-based
// absorption (clear in the shallows, green in the pools), shore foam and sun glints.
import * as THREE from 'three';
import { HALF, WORLD, WATER_Y, riverX, riverDX, riverHalfWidth } from './layout.js';

export function createWater(tex, shared, quality) {
  // --- ribbon mesh following the river course
  const SEG = Math.round(WORLD / 1.5), ACROSS = 8, MARGIN = 3.0;
  const pos = [], flow = [], idx = [];
  for (let j = 0; j <= SEG; j++) {
    const z = -HALF + (j / SEG) * WORLD;
    const k = riverDX(z), l = Math.sqrt(1 + k * k);
    const ext = (riverHalfWidth(z) + MARGIN) * l;
    for (let i = 0; i <= ACROSS; i++) {
      const s = (i / ACROSS) * 2 - 1;
      pos.push(riverX(z) + s * ext, WATER_Y, z);
      flow.push(k / l, 1 / l);
    }
  }
  for (let j = 0; j < SEG; j++) for (let i = 0; i < ACROSS; i++) {
    const a = j * (ACROSS + 1) + i, b = a + 1, c = a + ACROSS + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // --- planar reflection target
  const rt = new THREE.WebGLRenderTarget(quality.reflectionSize, quality.reflectionSize, { type: THREE.HalfFloatType, samples: 0 });
  const textureMatrix = new THREE.Matrix4();
  const virt = new THREE.PerspectiveCamera();
  virt.layers.set(0); // skip small ground cover / particles (layer 1) in the reflection

  const uniforms = {
    tReflect: { value: rt.texture },
    uReflMatrix: { value: textureMatrix },
    tWaterN: { value: tex.waterN },
    tHeight: shared.heightTex,
    uTime: shared.time,
    uWorld: { value: WORLD },
    uReflOn: { value: quality.reflection ? 1 : 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.09, metalness: 0, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    envMapIntensity: 0, depthWrite: true,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 flow; varying vec2 vFlow; varying vec3 vWPos; varying vec4 vReflUv;
        uniform mat4 uReflMatrix;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlow = flow; vWPos = position; vReflUv = uReflMatrix * vec4(position, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tReflect, tWaterN, tHeight; uniform float uTime, uWorld, uReflOn;
        varying vec2 vFlow; varying vec3 vWPos; varying vec4 vReflUv;
        vec3 gWN; float gDepth, gShore, gFleck;
        float whash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float wnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(whash(i), whash(i+vec2(1,0)), f.x), mix(whash(i+vec2(0,1)), whash(i+vec2(1,1)), f.x), f.y); }
        vec3 flowNormal(vec2 uv, vec2 fl, float scale, float cyc, float off, out float fleck) {
          float t = uTime / cyc + off;
          float p0 = fract(t), p1 = fract(t + 0.5);
          vec2 a = (uv - fl * p0 * cyc) * scale, b = (uv - fl * p1 * cyc) * scale + 0.37;
          float w = abs(1.0 - 2.0 * p0);
          vec4 na = texture2D(tWaterN, a), nb = texture2D(tWaterN, b);
          fleck = mix(wnoise(a * 9.0), wnoise(b * 9.0), w);
          return mix(na.xyz, nb.xyz, w) * 2.0 - 1.0;
        }`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 huv = vWPos.xz / uWorld + 0.5;
          vec4 hm = texture2D(tHeight, huv);
          gDepth = max(-hm.r, 0.0);
          float inside = max(-hm.b, 0.0);                 // metres from the bank
          float speed = 0.22 + 0.95 * smoothstep(0.0, 3.5, inside);
          vec2 fl = normalize(vFlow) * speed;
          float jitter = wnoise(vWPos.xz * 0.11);
          float f1, f2;
          vec3 n1 = flowNormal(vWPos.xz, fl, 0.16, 3.2, jitter, f1);
          vec3 n2 = flowNormal(vWPos.xz + 7.3, fl * 1.25, 0.47, 2.1, jitter + 0.4, f2);
          float calm = smoothstep(0.25, 1.3, gDepth);     // deep pools are glassier
          vec2 nxy = n1.xy * mix(0.5, 0.26, calm) + n2.xy * mix(0.42, 0.2, calm);
          float distFade = 1.0 / (1.0 + length(vWPos - cameraPosition) * 0.035);
          nxy *= 0.35 + 0.65 * distFade;
          gWN = normalize(vec3(nxy.x, 1.0, nxy.y));
          gShore = smoothstep(0.035, 0.0, gDepth - 0.02 * f2) * smoothstep(0.45, 0.8, f2 + f1 * 0.5);
          gFleck = smoothstep(0.83, 0.9, f1 * 0.55 + f2 * 0.5) * smoothstep(0.3, 1.5, inside);
          normal = normalize((viewMatrix * vec4(gWN, 0.0)).xyz);
        }`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(vViewPosition);
          float NdV = clamp(dot(normal, V), 0.0, 1.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          float shadow = 1.0;
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            shadow = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity,
              directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
          #endif
          // reflection of the far bank, trees and sky
          vec2 ruv = vReflUv.xy / vReflUv.w + gWN.xz * 0.045;
          vec3 refl = texture2D(tReflect, clamp(ruv, 0.002, 0.998)).rgb;
          vec3 skyRefl = mix(vec3(0.06, 0.10, 0.05), vec3(0.45, 0.58, 0.66), smoothstep(0.0, 0.5, gWN.y - NdV * 0.2));
          refl = mix(skyRefl, refl, uReflOn);
          // light scattered back out of the water column
          vec3 scatter = vec3(0.02, 0.055, 0.036) * (0.5 + 1.8 * shadow);
          float T = exp(-gDepth * 0.6 / max(NdV, 0.4));
          vec3 col = outgoingLight + refl * F + scatter * (1.0 - T) * (1.0 - F);
          float alpha = 1.0 - (1.0 - F) * T;
          // foam along the bank and drifting flecks in the current
          float foam = clamp(gShore * 0.3 + gFleck * 0.14, 0.0, 1.0);
          vec3 foamCol = vec3(0.75, 0.8, 0.8) * (0.25 + 1.5 * shadow);
          col = mix(col, foamCol, foam);
          alpha = mix(alpha, 1.0, foam);
          // soft edge where the surface meets dry ground
          float edge = smoothstep(-0.03, 0.02, gDepth + gShore * 0.02);
          col *= edge; alpha *= edge;
          gl_FragColor = vec4(col, alpha);
        }`)
      .replace('#include <fog_fragment>', `
        {
          vec3 rdF = vFogWorld - cameraPosition; float dF = length(rdF); rdF /= dF;
          float fogF = 1.0 - exp(-fogOpticalDepth(cameraPosition, rdF, dF));
          gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - fogF) + fogInscatterColor(rdF) * fogF * gl_FragColor.a;
        }`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 10;
  mesh.name = 'water';

  // --- reflection pass (adapted from three.js Reflector)
  const normal = new THREE.Vector3(0, 1, 0);
  const planePos = new THREE.Vector3(0, WATER_Y, 0);
  const camPos = new THREE.Vector3(), view = new THREE.Vector3(), target = new THREE.Vector3(), look = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clipPlane = new THREE.Vector4(), q = new THREE.Vector4();
  let frame = 0;

  function renderReflection(renderer, scene, camera) {
    if (!quality.reflection) return;
    frame++;
    if (quality.reflectionEvery > 1 && frame % quality.reflectionEvery !== 0) return;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < WATER_Y + 0.05) return;
    planePos.set(camPos.x, WATER_Y, camPos.z);
    view.subVectors(planePos, camPos).reflect(normal).negate().add(planePos);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(planePos, look).reflect(normal).negate().add(planePos);
    virt.position.copy(view);
    virt.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    virt.lookAt(target);
    virt.far = camera.far; virt.near = camera.near;
    virt.updateMatrixWorld();
    virt.matrixWorldInverse.copy(virt.matrixWorld).invert();
    virt.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virt.projectionMatrix).multiply(virt.matrixWorldInverse);
    // oblique near plane so nothing below the water leaks into the reflection
    plane.setFromNormalAndCoplanarPoint(normal, planePos).applyMatrix4(virt.matrixWorldInverse);
    clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = virt.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm.elements[2] = clipPlane.x; pm.elements[6] = clipPlane.y;
    pm.elements[10] = clipPlane.z + 1.0 - 0.003; pm.elements[14] = clipPlane.w;
    virt.projectionMatrixInverse.copy(pm).invert();

    mesh.visible = false;
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, virt);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevAuto;
    mesh.visible = true;
  }

  return { mesh, renderReflection, uniforms };
}
