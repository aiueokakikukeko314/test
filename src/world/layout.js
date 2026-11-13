// World layout: analytic river course + terrain height function.
// Everything else (meshes, vegetation placement, animal movement) queries these functions.
import { fbm, vnoise, smoothstep, clamp, lerp } from '../util/noise.js';

export const WORLD = 360;          // terrain is WORLD x WORLD metres, centred on origin
export const HALF = WORLD / 2;
export const PLAY = 150;           // the player is kept within +-PLAY
export const WATER_Y = 0;

// Direction TOWARDS the sun (low morning sun, slightly upstream so the river sparkles).
const SUN_ELEV = (35 * Math.PI) / 180;
const SUN_AZ = (-28 * Math.PI) / 180; // measured from -Z towards +X
export const SUN_DIR = [
  Math.sin(SUN_AZ) * Math.cos(SUN_ELEV),
  Math.sin(SUN_ELEV),
  -Math.cos(SUN_AZ) * Math.cos(SUN_ELEV),
];

// Open meadows where trees thin out and grass grows tall.
export const CLEARINGS = [
  { x: 0, z: 0, r: 0 }, // filled in below (relative to the river)
  { x: 0, z: 0, r: 0 },
  { x: 0, z: 0, r: 0 },
];

// River centreline x as a function of z. The river flows towards +z.
export function riverX(z) {
  return 24 * Math.sin(z * 0.019 + 0.6) + 9 * Math.sin(z * 0.047 + 2.1) + 3.5 * Math.sin(z * 0.11 + 4.0);
}
export function riverDX(z) {
  return 24 * 0.019 * Math.cos(z * 0.019 + 0.6) + 9 * 0.047 * Math.cos(z * 0.047 + 2.1) + 3.5 * 0.11 * Math.cos(z * 0.11 + 4.0);
}
export function riverHalfWidth(z) {
  return 4.8 + 1.7 * Math.sin(z * 0.041 + 1.3) + 0.9 * Math.sin(z * 0.093 + 0.2);
}
export function riverDepth(z) {
  return 0.85 + 0.4 * Math.sin(z * 0.031 + 0.4);
}

CLEARINGS[0] = { x: riverX(38) + 26, z: 38, r: 19 };
CLEARINGS[1] = { x: riverX(-62) - 30, z: -62, r: 16 };
CLEARINGS[2] = { x: riverX(-8) - 21, z: -8, r: 10 };

// Signed-ish distance to the river centreline (positive on +x side), first-order corrected for the bend.
export function riverDist(x, z) {
  const k = riverDX(z);
  return (x - riverX(z)) / Math.sqrt(1 + k * k);
}

// Unit flow direction at z (xz plane).
export function flowDir(z, out = [0, 0]) {
  const k = riverDX(z);
  const l = Math.sqrt(1 + k * k);
  out[0] = k / l; out[1] = 1 / l;
  return out;
}

export function clearingFactor(x, z) {
  let c = 0;
  for (const cl of CLEARINGS) {
    const d = Math.hypot(x - cl.x, z - cl.z);
    c = Math.max(c, 1 - smoothstep(cl.r * 0.55, cl.r, d));
  }
  return c;
}

export function heightAt(x, z) {
  const sd = riverDist(x, z);
  const d = Math.abs(sd);
  const w = riverHalfWidth(z);

  const n2 = fbm(x * 0.035 + 3.1, z * 0.035 + 8.7, 3);
  const n3 = vnoise(x * 0.21 + 11.0, z * 0.21 + 2.0);

  if (d < w) {
    // river bed: shallow near the edges, deeper pool in the middle
    const t = d / w;
    const depth = clamp(riverDepth(z) + (n2 - 0.5) * 0.7, 0.3, 1.7);
    const bed = -depth * (1 - smoothstep(0.2, 1.0, t));
    const pebbles = (n3 - 0.5) * 0.14 * smoothstep(1.0, 0.6, t);
    return bed + pebbles - 0.02;
  }

  const b = d - w;
  // forest floor away from the river: rolling ground, rising into valley sides
  const n1 = fbm(x * 0.0075 + 10.0, z * 0.0075 + 3.0, 4);
  let base = 1.25
    + Math.pow(Math.max(d - 8, 0), 1.3) * 0.036
    + (n1 - 0.5) * 11 * smoothstep(8, 70, d)
    + (n2 - 0.5) * 1.7
    + (n3 - 0.5) * 0.22;
  base = Math.max(base, 0.6 + n3 * 0.2);

  // bank profile: mixes gentle gravel bars with steeper cut banks along the course
  const side = sd > 0 ? 1 : -1;
  const steep = smoothstep(0.35, 0.7, fbm(z * 0.028 + side * 40.0, side * 3.3, 2));
  const gentle = 0.06 * b + 0.0025 * b * b;
  const cut = 0.85 * (1 - Math.exp(-b * 0.9)) + 0.03 * b;
  const bank = lerp(gentle, cut, steep) + (n3 - 0.5) * 0.1 * smoothstep(0, 1.5, b);

  const k = smoothstep(1.5, 15, b);
  return lerp(bank, base, k) - 0.02 * (1 - smoothstep(0, 0.5, b));
}

// Finite-difference normal (unnormalised y=1 form) and slope helpers.
export function normalAt(x, z, out = [0, 1, 0], e = 0.4) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e);
  const l = Math.hypot(nx, 1, nz);
  out[0] = nx / l; out[1] = 1 / l; out[2] = nz / l;
  return out;
}

export function isWater(x, z, margin = 0) {
  return Math.abs(riverDist(x, z)) < riverHalfWidth(z) + margin;
}
