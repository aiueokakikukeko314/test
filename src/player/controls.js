// First-person walking: keyboard + mouse (pointer lock) and touch (left stick / right drag).
import * as THREE from 'three';
import { heightAt, riverDist, riverHalfWidth, WATER_Y } from '../world/layout.js';
import { clamp, damp } from '../util/noise.js';

export const BOUNDS = { z: 112, river: 92 };

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera; this.dom = dom; this.world = world;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.eye = 1.66; this.bob = 0; this.bobAmt = 0;
    this.keys = new Set(); this.enabled = false; this.speed = 0; this.inWater = 0;
    this.move = { x: 0, y: 0 }; this.run = false; this.stepPhase = 0; this.onStep = null;
    this.smoothY = null;
    this._bind();
  }
  place(x, z, yaw = 0, pitch = 0) {
    this.pos.set(x, heightAt(x, z), z); this.yaw = yaw; this.pitch = pitch; this.smoothY = null; this.vel.set(0, 0, 0);
    this.apply(0);
  }
  _bind() {
    const dom = this.dom;
    addEventListener('keydown', (e) => { this.keys.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== dom) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    // touch
    const touches = new Map();
    dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const left = t.clientX < innerWidth * 0.45;
        touches.set(t.identifier, { left, sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY });
      }
      if (this.enabled) e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); if (!s) continue;
        if (s.left) {
          const dx = (t.clientX - s.sx) / 60, dy = (t.clientY - s.sy) / 60;
          const l = Math.hypot(dx, dy); const k = l > 1 ? 1 / l : 1;
          this.move.x = dx * k; this.move.y = -dy * k; this.run = l > 1.6;
          this.onStick && this.onStick(s.sx, s.sy, dx * k, dy * k);
        } else if (this.enabled) {
          this.look((t.clientX - s.x) * 0.005, (t.clientY - s.y) * 0.005);
        }
        s.x = t.clientX; s.y = t.clientY;
      }
      if (this.enabled) e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (s && s.left) { this.move.x = this.move.y = 0; this.run = false; this.onStick && this.onStick(null); }
        touches.delete(t.identifier);
      }
    };
    dom.addEventListener('touchend', end); dom.addEventListener('touchcancel', end);
  }
  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.35, 1.35);
  }
  update(dt) {
    const k = this.keys;
    let mx = this.move.x, my = this.move.y;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    } else { mx = my = 0; }
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    const running = this.run || k.has('ShiftLeft') || k.has('ShiftRight');
    const depth = Math.max(WATER_Y - this.pos.y, 0);
    this.inWater = depth;
    const maxSpeed = (running ? 4.6 : 1.9) * (1 - clamp(depth * 0.55, 0, 0.6));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const tx = (mx * cos - my * sin) * maxSpeed, tz = (-mx * sin - my * cos) * maxSpeed;
    this.vel.x = damp(this.vel.x, tx, 9, dt); this.vel.z = damp(this.vel.z, tz, 9, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // keep inside the valley
    nz = clamp(nz, -BOUNDS.z, BOUNDS.z);
    const rd = riverDist(nx, nz);
    if (Math.abs(rd) > BOUNDS.river) nx -= (rd - Math.sign(rd) * BOUNDS.river);
    // solid obstacles (tree trunks, boulders)
    const hits = this.world.colliders ? this.world.colliders.query(nx, nz, 2.5) : [];
    for (const c of hits) {
      const dx = nx - c.x, dz = nz - c.z; const d = Math.hypot(dx, dz), min = c.r + 0.32;
      if (d < min && d > 1e-4) { nx = c.x + (dx / d) * min; nz = c.z + (dz / d) * min; }
    }
    this.pos.x = nx; this.pos.z = nz;
    this.pos.y = heightAt(nx, nz);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // head bob + footsteps
    const moving = clamp(this.speed / 1.9, 0, 1.6);
    this.bobAmt = damp(this.bobAmt, moving, 6, dt);
    const prev = this.stepPhase;
    this.stepPhase += dt * (1.55 + this.speed * 0.62) * (this.speed > 0.3 ? 1 : 0);
    if (Math.floor(prev) !== Math.floor(this.stepPhase) && this.onStep) this.onStep(depth > 0.05 ? 'water' : 'ground', running);
    this.apply(dt);
  }
  apply(dt) {
    const target = this.pos.y + this.eye;
    this.smoothY = this.smoothY == null ? target : damp(this.smoothY, target, 12, dt || 0.016);
    const ph = this.stepPhase * Math.PI;
    const bobY = Math.abs(Math.sin(ph)) * 0.045 * this.bobAmt;
    const bobX = Math.cos(ph) * 0.02 * this.bobAmt;
    const cam = this.camera;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bobX, this.smoothY + bobY - 0.03 * this.bobAmt, this.pos.z - Math.sin(this.yaw) * bobX);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(ph) * 0.004 * this.bobAmt, 'YXZ');
  }
}

// Uniform grid of circular obstacles for cheap neighbourhood queries.
export class ColliderGrid {
  constructor(cell = 6) { this.cell = cell; this.map = new Map(); this.out = []; }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(c) {
    const k = this.key(Math.floor(c.x / this.cell), Math.floor(c.z / this.cell));
    let a = this.map.get(k); if (!a) this.map.set(k, a = []);
    a.push(c);
  }
  query(x, z, r) {
    const out = this.out; out.length = 0;
    const c = this.cell;
    for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++)
      for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
        const a = this.map.get(this.key(ix, iz));
        if (a) for (const o of a) out.push(o);
      }
    return out;
  }
}
