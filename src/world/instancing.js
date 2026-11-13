// Distance-partitioned instancing: every object type owns a handful of InstancedMeshes
// (one per LOD level and material part). Instances are re-bucketed by distance to the
// camera whenever it has moved a couple of metres, so draw calls stay constant.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export function composeMatrix(out, offset, x, y, z, rotY, scale, tiltX = 0, tiltZ = 0, scaleY = scale) {
  _e.set(tiltX, rotY, tiltZ, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(scale, scaleY, scale));
  _m.toArray(out, offset);
}

export class LodInstances {
  /**
   * @param levels [{ maxDist, parts: [{ geometry, material, depthMaterial, castShadow, receiveShadow, layer }] }]
   * @param matrices Float32Array(N*16)
   * @param colors   Float32Array(N*3) | null
   */
  constructor(name, levels, matrices, colors = null, { moveThreshold = 2.5, hysteresis = 3 } = {}) {
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = name;
    this.levels = levels;
    this.matrices = matrices;
    this.colors = colors;
    this.count = matrices.length / 16;
    this.assigned = new Int8Array(this.count).fill(-2);
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.moveThreshold = moveThreshold;
    this.hysteresis = hysteresis;
    for (const lvl of levels) {
      lvl.meshes = lvl.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.count);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = part.castShadow !== false;
        mesh.receiveShadow = part.receiveShadow !== false;
        if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
        if (part.layer) mesh.layers.set(part.layer);
        if (colors && part.useColor !== false) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
        }
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        return mesh;
      });
    }
  }

  update(camPos, force = false) {
    if (!force && this.last.distanceToSquared(camPos) < this.moveThreshold * this.moveThreshold) return;
    this.last.copy(camPos);
    const { levels, matrices, colors, count, assigned, hysteresis } = this;
    const nL = levels.length;
    const counts = new Array(nL).fill(0);
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      const dx = matrices[o + 12] - camPos.x, dz = matrices[o + 14] - camPos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      let lvl = -1;
      const prev = assigned[i];
      for (let l = 0; l < nL; l++) {
        const lim = levels[l].maxDist + (prev === l ? hysteresis : 0);
        if (d < lim) { lvl = l; break; }
      }
      assigned[i] = lvl;
      if (lvl < 0) continue;
      const k = counts[lvl]++;
      const meshes = levels[lvl].meshes;
      for (let m = 0; m < meshes.length; m++) {
        const arr = meshes[m].instanceMatrix.array;
        const t = k * 16;
        for (let c = 0; c < 16; c++) arr[t + c] = matrices[o + c];
        if (meshes[m].instanceColor) {
          const ca = meshes[m].instanceColor.array;
          ca[k * 3] = colors[i * 3]; ca[k * 3 + 1] = colors[i * 3 + 1]; ca[k * 3 + 2] = colors[i * 3 + 2];
        }
      }
    }
    for (let l = 0; l < nL; l++) {
      for (const mesh of levels[l].meshes) {
        mesh.count = counts[l];
        mesh.visible = counts[l] > 0;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, counts[l] * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, counts[l] * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }
}
