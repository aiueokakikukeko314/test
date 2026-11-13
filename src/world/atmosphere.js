// Sky dome, sun light + shadow, image-based ambient light and a custom height-fog model
// that is patched into every three.js material.
import * as THREE from 'three';
import { SUN_DIR } from './layout.js';

export const sunDir = new THREE.Vector3(...SUN_DIR).normalize();

export const ATMOS = {
  sunColor: new THREE.Color(1.0, 0.83, 0.64),
  sunIntensity: 6.5,
  fogColor: new THREE.Color(0.36, 0.45, 0.5),
  fogSunColor: new THREE.Color(0.95, 0.74, 0.5),
  mistDensity: 0.0085,   // extra density at water level (mist pooling in the valley)
  mistFalloff: 0.3,    // 1/m: how fast the mist thins out with height
  haze: 0.0026,        // uniform haze density
};

const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v3 = (c) => `vec3(${f(c.r ?? c.x)}, ${f(c.g ?? c.y)}, ${f(c.b ?? c.z)})`;

// GLSL shared by the fog chunk, the sky and the volumetric light pass.
export const FOG_GLSL = /* glsl */ `
  const vec3 FOG_SUN_DIR = ${v3(sunDir)};
  const vec3 FOG_COLOR = ${v3(ATMOS.fogColor)};
  const vec3 FOG_SUN_COLOR = ${v3(ATMOS.fogSunColor)};
  const float MIST_A = ${f(ATMOS.mistDensity)};
  const float MIST_B = ${f(ATMOS.mistFalloff)};
  const float HAZE = ${f(ATMOS.haze)};
  float fogDensityAt(float y) { return HAZE + MIST_A * exp(-max(y, -1.0) * MIST_B); }
  // optical depth along a ray of length dist starting at ro in direction rd
  float fogOpticalDepth(vec3 ro, vec3 rd, float dist) {
    float k = rd.y * MIST_B;
    float seg = abs(k) < 1e-4 ? dist : (1.0 - exp(-dist * k)) / k;
    return HAZE * dist + MIST_A * exp(-ro.y * MIST_B) * seg;
  }
  vec3 fogInscatterColor(vec3 rd) {
    float s = max(dot(rd, FOG_SUN_DIR), 0.0);
    return mix(FOG_COLOR, FOG_SUN_COLOR, pow(s, 5.0) * 0.75) * (1.0 + 0.25 * rd.y);
  }
  vec3 applyFog(vec3 col, vec3 ro, vec3 p) {
    vec3 rd = p - ro; float dist = length(rd); rd /= max(dist, 1e-4);
    float fogF = 1.0 - exp(-fogOpticalDepth(ro, rd, dist));
    return mix(col, fogInscatterColor(rd), fogF);
  }
`;

export function patchFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
    #endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying float vFogDepth;
      varying vec3 vFogWorld;
      ${FOG_GLSL}
    #endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      gl_FragColor.rgb = applyFog( gl_FragColor.rgb, cameraPosition, vFogWorld );
    #endif`;
}

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform float uEnv;     // 1 = rendering the ambient environment map
  uniform float uTime;
  ${FOG_GLSL}
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  void main(){
    vec3 rd = normalize(vDir);
    float h = max(rd.y, 0.0);
    vec3 zen = vec3(0.13, 0.30, 0.66);
    vec3 hor = vec3(0.60, 0.70, 0.78);
    vec3 col = mix(hor, zen, pow(h, 0.5));
    float sd = max(dot(rd, FOG_SUN_DIR), 0.0);
    vec3 sunCol = vec3(1.0, 0.80, 0.55);
    col += sunCol * (pow(sd, 5.0) * 0.30 + pow(sd, 40.0) * 0.55);
    // soft high clouds, lit warm on the sun side
    vec2 cuv = rd.xz / (rd.y + 0.12) * 0.55 + vec2(uTime * 0.0015, 0.0);
    float c = smoothstep(0.48, 0.85, fbm(cuv * 1.6));
    c *= smoothstep(0.02, 0.25, rd.y);
    vec3 cloudCol = mix(vec3(0.85, 0.88, 0.93), vec3(1.25, 1.05, 0.85), pow(sd, 3.0));
    col = mix(col, cloudCol, c * 0.65);
    if (uEnv < 0.5) {
      col += sunCol * smoothstep(0.99975, 0.99992, sd) * 60.0;   // sun disc (HDR, feeds bloom)
    } else {
      // ambient: dim the sky as if seen through a canopy; ground bounce from below
      float can = smoothstep(0.35, 0.6, fbm(rd.xz / (abs(rd.y) + 0.35) * 2.2));
      col = mix(col, vec3(0.045, 0.075, 0.022), can * 0.72 * smoothstep(-0.05, 0.3, rd.y));
      col = mix(vec3(0.075, 0.07, 0.04), col, smoothstep(-0.25, 0.05, rd.y));
    }
    // melt the horizon into the fog so distant terrain blends seamlessly
    vec3 fogc = fogInscatterColor(rd);
    col = mix(fogc, col, smoothstep(-0.02, 0.32, rd.y) * (uEnv > 0.5 ? 1.0 : 1.0));
    if (uEnv < 0.5 && rd.y < 0.0) col = fogc;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAtmosphere(scene, renderer, shared, quality) {
  // --- sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uEnv: { value: 0 }, uTime: shared.time },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.name = 'sky';
  scene.add(sky);

  // --- ambient environment map (IBL) baked once from the sky shader
  const envScene = new THREE.Scene();
  const envMat = skyMat.clone();
  envMat.uniforms.uEnv.value = 1;
  envMat.uniforms.uTime = { value: 0 };
  envMat.vertexShader = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * 50.0, 1.0); }`;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.45;
  pmrem.dispose();

  // --- fog (parameters live in FOG_GLSL; the scene fog object only switches the chunk on)
  scene.fog = new THREE.FogExp2(ATMOS.fogColor.getHex(), 0.01);

  // --- sun
  const sun = new THREE.DirectionalLight(ATMOS.sunColor, ATMOS.sunIntensity);
  sun.castShadow = true;
  const R = quality.shadowRange;
  const cam = sun.shadow.camera;
  cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 420;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2.0;
  scene.add(sun, sun.target);

  const tmp = new THREE.Vector3();
  const lightView = new THREE.Matrix4();
  const lightViewInv = new THREE.Matrix4();
  function update(camera) {
    sky.position.copy(camera.position);
    // Keep the shadow frustum centred slightly ahead of the camera and snapped to shadow texels
    // (prevents shimmering when the player walks).
    camera.getWorldDirection(tmp);
    tmp.y = 0; tmp.normalize().multiplyScalar(R * 0.45).add(camera.position);
    lightView.lookAt(sunDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    lightViewInv.copy(lightView).invert();
    const texel = (2 * R) / quality.shadowSize;
    tmp.applyMatrix4(lightViewInv);
    tmp.x = Math.round(tmp.x / texel) * texel;
    tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyMatrix4(lightView);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(sunDir, 200);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  return { sun, sky, update };
}
