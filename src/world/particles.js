// Atmosphere particles: pollen / dust motes glittering in the light, midges dancing over
// the water, and the occasional leaf spiralling down from the canopy.
import * as THREE from 'three';
import { FOG_GLSL } from './atmosphere.js';
import { riverX, WATER_Y } from './layout.js';
import { mulberry32 } from '../util/noise.js';

export function createParticles(shared, quality) {
  const group = new THREE.Group(); group.name = 'particles';
  const rand = mulberry32(555);

  // --- motes: wrap around the camera in a box
  {
    const N = Math.round(2600 * quality.particles);
    const pos = new Float32Array(N * 3), rnd = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(); pos[i * 3 + 1] = rand(); pos[i * 3 + 2] = rand(); rnd[i * 3] = rand(); rnd[i * 3 + 1] = rand(); rnd[i * 3 + 2] = rand(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('rnd', new THREE.BufferAttribute(rnd, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 rnd; uniform float uTime, uScale; varying float vA;
        ${FOG_GLSL}
        void main() {
          const vec3 BOX = vec3(36.0, 14.0, 36.0);
          vec3 drift = vec3(0.22, -0.02 - rnd.x * 0.03, 0.15) * uTime + vec3(sin(uTime * 0.31 + rnd.y * 40.0), sin(uTime * 0.27 + rnd.z * 40.0) * 0.5, cos(uTime * 0.23 + rnd.x * 40.0)) * 0.4;
          vec3 p = mod(position * BOX + drift - cameraPosition + 0.5 * BOX, BOX) - 0.5 * BOX + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vec3 rd = normalize(p - cameraPosition);
          float fwd = pow(max(dot(rd, FOG_SUN_DIR), 0.0), 3.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + rnd.y * 3.0) + rnd.z * 60.0);
          vA = (0.12 + 0.88 * fwd) * tw * smoothstep(0.4, 1.5, d) * (1.0 - smoothstep(12.0, 18.0, d));
          gl_PointSize = uScale * (0.014 + rnd.x * 0.02) / d;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(c)); gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * 2.2 * a * vA, 1.0); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.layers.set(1); pts.renderOrder = 20;
    group.add(pts);
    group.userData.motes = mat;
  }

  // --- midges: tight swarms hovering above the river
  {
    const SW = 9, PER = Math.round(46 * quality.particles), N = SW * PER;
    const pos = new Float32Array(N * 3), rnd = new Float32Array(N * 3);
    for (let s = 0; s < SW; s++) {
      const z = shared.spawn.z - 60 + s * 16 + rand() * 6, x = riverX(z) + (rand() - 0.5) * 5, y = WATER_Y + 0.7 + rand() * 0.9;
      for (let i = 0; i < PER; i++) { const k = (s * PER + i) * 3; pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; rnd[k] = rand(); rnd[k + 1] = rand(); rnd[k + 2] = rand(); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('rnd', new THREE.BufferAttribute(rnd, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 rnd; uniform float uTime, uScale; varying float vA;
        void main() {
          float t = uTime * (1.3 + rnd.x * 1.4);
          vec3 o = vec3(sin(t * 1.7 + rnd.y * 30.0) + sin(t * 3.1 + rnd.z * 9.0) * 0.4, sin(t * 2.3 + rnd.x * 30.0) * 0.6 + sin(t * 4.3) * 0.2, cos(t * 1.9 + rnd.z * 30.0) + cos(t * 2.7 + rnd.y * 9.0) * 0.4) * (0.25 + rnd.y * 0.35);
          vec4 mv = viewMatrix * vec4(position + o, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vA = smoothstep(0.3, 1.0, d) * (1.0 - smoothstep(22.0, 32.0, d));
          gl_PointSize = max(uScale * 0.012 / d, 1.0);
        }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.2, length(c)); gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * 1.4 * a * vA, 1.0); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.layers.set(1); pts.renderOrder = 20;
    group.add(pts);
    group.userData.midges = mat;
  }

  // --- falling leaves
  {
    const N = Math.round(70 * quality.particles);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.035, 0, -0.02, 0.035, 0, -0.02, 0.05, 0, 0.02, -0.02, 0, 0.03], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = rand();
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time },
      vertexShader: /* glsl */ `
        attribute vec4 seed; uniform float uTime; varying vec3 vCol; varying vec3 vW;
        mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
        mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
        void main() {
          const vec3 BOX = vec3(60.0, 22.0, 60.0);
          float t = uTime * (0.55 + seed.w * 0.5) + seed.x * 300.0;
          vec3 base = vec3(seed.x, 0.0, seed.z) * BOX;
          float fall = mod(t * 0.9, BOX.y);
          vec3 p = base + vec3(sin(t * 1.1 + seed.y * 20.0) * 0.8 + t * 0.25, BOX.y - fall, cos(t * 0.9 + seed.z * 20.0) * 0.8 + t * 0.17);
          p.xz = mod(p.xz - cameraPosition.xz + 0.5 * BOX.xz, BOX.xz) - 0.5 * BOX.xz + cameraPosition.xz;
          p.y += cameraPosition.y - 4.0;
          vec3 l = rotZ(t * 2.3 + seed.y * 6.0) * rotX(t * 1.7 + seed.z * 6.0) * (position * (0.8 + seed.y * 0.7));
          vW = p + l;
          vCol = mix(vec3(0.34, 0.42, 0.08), vec3(0.62, 0.44, 0.1), seed.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying vec3 vW;
        ${FOG_GLSL}
        void main(){ vec3 c = vCol * 1.3; gl_FragColor = vec4(applyFog(c, cameraPosition, vW), 1.0); }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.layers.set(1);
    group.add(mesh);
  }

  return {
    group,
    setSize(h) { const s = h * 1.1; group.userData.motes.uniforms.uScale.value = s; group.userData.midges.uniforms.uScale.value = s; },
  };
}
