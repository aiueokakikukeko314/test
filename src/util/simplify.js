// Mesh simplification for LODs. Uses meshoptimizer (WebAssembly) when available and falls back
// to plain-JS vertex clustering where WebAssembly is blocked, so the scene always loads.
import { MeshoptSimplifier } from 'meshoptimizer';

let wasmOK = false;

export async function initSimplifier() {
  try {
    if (MeshoptSimplifier.supported === false || !MeshoptSimplifier.ready) throw new Error('unsupported');
    await Promise.race([MeshoptSimplifier.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    wasmOK = true;
  } catch (e) {
    wasmOK = false;
    console.info('mesh simplifier: using JS fallback', e && e.message);
  }
  return wasmOK;
}

// Snap vertices to a grid of the given cell size and drop the triangles that collapse.
function cluster(indices, positions, cell) {
  const map = new Map(), remap = new Uint32Array(positions.length / 3), inv = 1 / cell;
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(positions[i * 3] * inv)},${Math.round(positions[i * 3 + 1] * inv)},${Math.round(positions[i * 3 + 2] * inv)}`;
    let r = map.get(key);
    if (r === undefined) { r = i; map.set(key, r); }
    remap[i] = r;
  }
  const out = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/**
 * @param indices Uint32Array
 * @param positions Float32Array (xyz)
 * @param ratio target fraction of triangles (meshoptimizer path)
 * @param error allowed relative error (meshoptimizer path)
 * @param cell grid size in model units for the fallback path (0 = keep the mesh as is)
 */
export function simplifyIndices(indices, positions, ratio, error, cell = 0) {
  if (wasmOK) {
    const target = Math.max(36, Math.floor((indices.length * ratio) / 3) * 3);
    return MeshoptSimplifier.simplify(indices, positions, 3, target, error)[0];
  }
  if (cell > 0) {
    const out = cluster(indices, positions, cell);
    if (out.length >= 36) return out;
  }
  return indices;
}
