// Post-processing: volumetric sun shafts ray-marched against the real shadow map,
// ambient occlusion, bloom, depth of field, filmic tone mapping and a gentle grade.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  SMAAEffect, SMAAPreset, DepthOfFieldEffect, Effect, Pass, BlendFunction, KawaseBlurPass, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { FOG_GLSL, ATMOS } from '../world/atmosphere.js';

const VOL_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler2DShadow;
  uniform sampler2D tDepth;
  uniform sampler2DShadow tShadow;
  uniform mat4 uShadowMatrix, uProjInv, uViewInv;
  uniform vec3 uCamPos, uSunColor;
  uniform float uMaxDist;
  varying vec2 vUv;
  ${FOG_GLSL}
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float depth = texture2D(tDepth, vUv).r;
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCamPos; float dist = length(rd); rd /= dist;
    float maxD = min(dist, uMaxDist);
    float stepLen = maxD / float(VOL_STEPS);
    float jitter = ign(gl_FragCoord.xy);
    float cosT = dot(rd, FOG_SUN_DIR);
    const float g = 0.5;
    float phase = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
    phase = phase * 0.8 + 0.04;   // a little isotropic scattering so side-lit shafts still read
    float acc = 0.0;
    for (int i = 0; i < VOL_STEPS; i++) {
      float t = (float(i) + jitter) * stepLen;
      vec3 p = uCamPos + rd * t;
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      sc.xyz /= sc.w;
      float vis = 0.3;
      if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(tShadow, vec3(sc.xy, sc.z - 0.0006));
      acc += vis * fogDensityAt(p.y) * exp(-fogOpticalDepth(uCamPos, rd, t)) * stepLen;
    }
    gl_FragColor = vec4(uSunColor * phase * acc, 1.0);
  }
`;

class VolumetricPass extends Pass {
  constructor(sun, camera, steps) {
    super('VolumetricPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.sun = sun; this.cam = camera;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rt.texture.name = 'volumetric';
    this.blurRT = this.rt.clone();
    this.blur = new KawaseBlurPass({ kernelSize: KernelSize.SMALL });
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      defines: { VOL_STEPS: steps },
      uniforms: {
        tDepth: { value: null }, tShadow: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uMaxDist: { value: 95 },
        uSunColor: { value: ATMOS.sunColor.clone().multiplyScalar(ATMOS.sunIntensity) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: VOL_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
  }
  get texture() { return this.blurRT.texture; }
  setDepthTexture(depthTexture) { this.fullscreenMaterial.uniforms.tDepth.value = depthTexture; }
  initialize(renderer, alpha, frameBufferType) { this.blur.initialize(renderer, alpha, frameBufferType); }
  render(renderer) {
    const u = this.fullscreenMaterial.uniforms;
    const map = this.sun.shadow.map;
    if (!map || !map.depthTexture) return;
    u.tShadow.value = map.depthTexture;
    u.uShadowMatrix.value.copy(this.sun.shadow.matrix);
    u.uProjInv.value.copy(this.cam.projectionMatrixInverse);
    u.uViewInv.value.copy(this.cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.cam.matrixWorld);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    this.blur.render(renderer, this.rt, this.blurRT);
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.rt.setSize(hw, hh); this.blurRT.setSize(hw, hh); this.blur.setSize(hw, hh);
  }
}

class CompositeEffect extends Effect {
  constructor(texture) {
    super('CompositeEffect', /* glsl */ `
      uniform sampler2D tShafts; uniform float uExposure; uniform float uStrength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 s = texture2D(tShafts, uv).rgb;
        outputColor = vec4((inputColor.rgb + s * uStrength) * uExposure, inputColor.a);
      }`, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map([['tShafts', new THREE.Uniform(texture)], ['uExposure', new THREE.Uniform(1)], ['uStrength', new THREE.Uniform(1)]]),
    });
  }
}

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uSaturation; uniform float uContrast; uniform float uTime;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.18) * uContrast + 0.18;
        // split tone: slightly cool shadows, warm highlights (morning light)
        c += mix(vec3(-0.006, 0.002, 0.012), vec3(0.014, 0.006, -0.012), smoothstep(0.0, 0.7, l));
        // fine film grain
        c += (gh(uv * 913.0 + fract(uTime) * 31.0) - 0.5) * 0.012;
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map([['uSaturation', new THREE.Uniform(1.1)], ['uContrast', new THREE.Uniform(1.05)], ['uTime', new THREE.Uniform(0)]]),
    });
  }
}

export function createPost(renderer, scene, camera, sun, quality) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: quality.msaa });
  composer.addPass(new RenderPass(scene, camera));

  let ao = null;
  if (quality.ao) {
    ao = new N8AOPostPass(scene, camera, 1, 1);
    ao.configuration.aoRadius = 1.4;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.4;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x05080a);
    ao.setQualityMode('Medium');
    composer.addPass(ao);
  }

  let vol = null;
  if (quality.volumetric) {
    vol = new VolumetricPass(sun, camera, quality.volSteps);
    composer.addPass(vol);
  }

  let dof = null;
  if (quality.dof) {
    dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 12, worldFocusRange: 30, bokehScale: 2.5, resolutionScale: 0.5 });
    const dofPass = new EffectPass(camera, dof);
    dofPass.enabled = false;
    dof.pass = dofPass;
    composer.addPass(dofPass);
  }

  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const composite = new CompositeEffect(vol ? vol.texture : black);
  composite.uniforms.get('uExposure').value = 0.62;
  composite.uniforms.get('uStrength').value = 0.85;
  const effects = [composite];
  if (quality.bloom) {
    effects.push(new BloomEffect({ intensity: 0.55, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 }));
  }
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  const grade = new GradeEffect();
  effects.push(grade);
  effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.42 }));
  composer.addPass(new EffectPass(camera, ...effects));
  if (quality.msaa === 0) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));

  return {
    composer, ao, vol, dof, composite, grade,
    setSize(w, h) { composer.setSize(w, h); },
    render(dt, time) { grade.uniforms.get('uTime').value = time; composer.render(dt); },
    setDof(enabled, focusDist, range, scale) {
      if (!dof) return;
      dof.pass.enabled = enabled;
      if (enabled) {
        const m = dof.cocMaterial;
        m.worldFocusDistance = focusDist; m.worldFocusRange = range; dof.bokehScale = scale;
      }
    },
  };
}
