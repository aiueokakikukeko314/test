// Small lofting toolkit for building animal bodies from cross-section rings, with skin weights.
import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);

export function ring(x, y, z, rx, ry, w, extra = {}) {
  return { c: new THREE.Vector3(x, y, z), rx, ry, w, ...extra };
}

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function mixWeights(a, b, t) {
  const m = new Map();
  for (const [i, w] of a) m.set(i, (m.get(i) || 0) + w * (1 - t));
  for (const [i, w] of b) m.set(i, (m.get(i) || 0) + w * t);
  return [...m.entries()].filter(([, w]) => w > 0.001);
}

// Catmull-Rom subdivision of a ring list (smoother silhouettes).
export function subdivide(rings, n) {
  if (n <= 1) return rings;
  const out = [];
  const R = (i) => rings[Math.max(0, Math.min(rings.length - 1, i))];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = R(i - 1), b = R(i), c = R(i + 1), d = R(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      if (k === 0) { out.push(b); continue; }
      out.push({
        ...b,
        c: new THREE.Vector3(cr(a.c.x, b.c.x, c.c.x, d.c.x, t), cr(a.c.y, b.c.y, c.c.y, d.c.y, t), cr(a.c.z, b.c.z, c.c.z, d.c.z, t)),
        rx: Math.max(0.0005, cr(a.rx, b.rx, c.rx, d.rx, t)),
        ry: Math.max(0.0005, cr(a.ry, b.ry, c.ry, d.ry, t)),
        w: mixWeights(b.w, c.w, t),
        top: b.top != null ? b.top + (c.top - b.top) * t : undefined,
      });
    }
  }
  out.push(rings[rings.length - 1]);
  return out;
}

export class MeshBuilder {
  constructor() {
    this.pos = []; this.uv = []; this.si = []; this.sw = []; this.idx = []; this.col = [];
    this.seams = [];
  }
  get count() { return this.pos.length / 3; }
  _vert(p, u, v, w, col) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v);
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let tot = 0; for (const [, x] of ws) tot += x;
    for (let k = 0; k < 4; k++) { this.si.push(ws[k] ? ws[k][0] : 0); this.sw.push(ws[k] ? ws[k][1] / tot : 0); }
    this.col.push(col[0], col[1], col[2]);
    return this.count - 1;
  }
  /**
   * Loft a tube through rings. u runs around (0 = underside), v along the path.
   * opts: seg, axis (lateral reference), uRect [u0,u1], vRect [v0,v1], capStart, capEnd, color, shape(theta, ringIndex01) -> radial scale
   */
  tube(rings, opts = {}) {
    const seg = opts.seg || 12;
    const axis = opts.axis || X;
    const [u0, u1] = opts.uRect || [0, 1];
    const [v0, v1] = opts.vRect || [0, 1];
    const color = opts.color || [1, 1, 1];
    const n = rings.length;
    // path length for v
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + rings[i].c.distanceTo(rings[i - 1].c));
    const total = len[n - 1] || 1;
    const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
    const base = this.count;
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      t.subVectors(rings[Math.min(i + 1, n - 1)].c, rings[Math.max(i - 1, 0)].c).normalize();
      a.copy(axis).addScaledVector(t, -axis.dot(t)).normalize();
      b.crossVectors(t, a);
      const v = v0 + (v1 - v0) * (len[i] / total);
      r.v = v;
      for (let j = 0; j <= seg; j++) {
        const th = -Math.PI / 2 + (j / seg) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        let sx = 1, sy = 1;
        if (opts.shape) [sx, sy] = opts.shape(cs, sn, len[i] / total, r);
        p.copy(r.c).addScaledVector(a, r.rx * cs * sx).addScaledVector(b, r.ry * sn * sy + (r.oy || 0));
        const id = this._vert(p, u0 + (u1 - u0) * (j / seg), v, r.w, r.color || color);
        if (j === seg) this.seams.push([id - seg, id]);
      }
    }
    const row = seg + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const k = base + i * row + j;
      this.idx.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
    }
    if (opts.capStart) {
      const r = rings[0];
      const c = this._vert(r.c, (u0 + u1) / 2, v0, r.w, r.color || color);
      for (let j = 0; j < seg; j++) this.idx.push(c, base + j + 1, base + j);
    }
    if (opts.capEnd) {
      const r = rings[n - 1];
      const c = this._vert(r.c, (u0 + u1) / 2, v1, r.w, r.color || color);
      const o = base + (n - 1) * row;
      for (let j = 0; j < seg; j++) this.idx.push(c, o + j, o + j + 1);
    }
    return { base, rows: n, row, total };
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // weld normals across the u seam
    const nm = g.attributes.normal;
    for (const [i, j] of this.seams) {
      const x = nm.getX(i) + nm.getX(j), y = nm.getY(i) + nm.getY(j), z = nm.getZ(i) + nm.getZ(j);
      const l = Math.hypot(x, y, z) || 1;
      nm.setXYZ(i, x / l, y / l, z / l); nm.setXYZ(j, x / l, y / l, z / l);
    }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Build a bone hierarchy from [name, parentName, [x,y,z]] definitions given in model space.
export function makeSkeleton(defs) {
  const bones = [], byName = {}, worldPos = {};
  for (const [name, parent, p] of defs) {
    const bone = new THREE.Bone();
    bone.name = name;
    worldPos[name] = new THREE.Vector3(...p);
    if (parent) { bone.position.copy(worldPos[name]).sub(worldPos[parent]); byName[parent].add(bone); }
    else bone.position.copy(worldPos[name]);
    byName[name] = bone; bones.push(bone);
  }
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { bones, byName, skeleton, root: bones[0] };
}
