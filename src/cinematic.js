// Film mode: a looping sequence of composed shots (river glides, forest light, wildlife portraits).
import * as THREE from 'three';
import { heightAt, riverX, riverHalfWidth, CLEARINGS, WATER_Y } from './world/layout.js';
import { smoothstep, lerp } from './util/noise.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);

export function createCinematic(app) {
  const { camera, deer, birds, fox, fish, shared } = app;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  const riverPt = (z, y, off = 0) => v(riverX(z) + off, y, z);
  const ground = (x, z, h) => v(x, heightAt(x, z) + h, z);

  // each shot: { dur, fov, dof: [focusDistance|'subject', range, bokeh] | null, update(u, t) sets pos/look, optional subject() }
  const shots = [
    { // low glide upstream over the water, into the light
      dur: 15, fov: 50, dof: null,
      update(u) { const z = lerp(46, 6, u); pos.copy(riverPt(z, WATER_Y + 0.55 + Math.sin(u * 3) * 0.08, Math.sin(u * 2.2) * 1.2)); look.copy(riverPt(z - 14, WATER_Y + 0.9, 0)); },
    },
    { // stag in the meadow, long lens orbit
      dur: 14, fov: 24, dof: ['subject', 5, 3.2], subject: () => deer.list[0].group.position,
      update(u) { const d = deer.list[0].group.position; const a = 0.9 + u * 0.55; pos.set(d.x + Math.sin(a) * 13, 0, d.z + Math.cos(a) * 13); pos.y = heightAt(pos.x, pos.z) + 1.05; look.set(d.x, d.y + 0.95, d.z); },
    },
    { // sun shafts in the forest interior: slow rise among the trunks
      dur: 13, fov: 46, dof: null,
      update(u) { const x = riverX(-30) + 34, z = -30 + u * 5; pos.copy(ground(x, z, 0.5 + u * 2.4)); look.set(pos.x - 14, pos.y + 2.2 + u * 1.5, pos.z - 22); },
    },
    { // fish holding in the current, looking straight down through the water
      dur: 12, fov: 38, dof: null,
      update(u) { const f = fish.fish[0]; const z = f.pool.z + lerp(-3, 3, u); pos.copy(riverPt(z, WATER_Y + 1.7, lerp(-1, 1, u))); look.copy(riverPt(z - 1.4, WATER_Y - 0.6, 0)); },
    },
    { // wagtail on a river stone
      dur: 10, fov: 20, dof: ['subject', 0.9, 4], subject: () => birds.birds[0].pos,
      update(u) { const b = birds.birds[0].pos; const a = 2.2 + u * 0.4; pos.set(b.x + Math.sin(a) * 4.2, b.y + 0.35, b.z + Math.cos(a) * 4.2); look.set(b.x, b.y + 0.03, b.z); },
    },
    { // across the meadow: herd grazing, backlit
      dur: 14, fov: 30, dof: ['subject', 9, 2.4], subject: () => deer.list[1].group.position,
      update(u) { const c = CLEARINGS[0]; const d = deer.list[1].group.position; pos.copy(ground(c.x + 16 - u * 3, c.z + 15, 0.75)); look.set(lerp(c.x, d.x, 0.7), d.y + 0.8, lerp(c.z, d.z, 0.7)); },
    },
    { // fox on the far bank
      dur: 11, fov: 22, dof: ['subject', 4, 3.2], subject: () => fox.group.position, skip: () => !fox,
      update(u) { const p = fox.group.position; const a = 1.2 + u * 0.3; pos.set(p.x + Math.sin(a) * 11, 0, p.z + Math.cos(a) * 11); pos.y = heightAt(pos.x, pos.z) + 0.7; look.set(p.x, p.y + 0.35, p.z); },
    },
    { // crane up from the ferns to the canopy over the river
      dur: 16, fov: 56, dof: null,
      update(u) { const e = ease(u); const z = -52 + e * 10; pos.copy(riverPt(z, 1.2 + e * 26, riverHalfWidth(z) + 6 - e * 4)); look.copy(riverPt(z + 40 + e * 20, 2 + e * 6, 0)); },
    },
    { // downstream drift past the boulders at eye level
      dur: 15, fov: 44, dof: [7, 14, 1.6],
      update(u) { const z = lerp(-26, 6, u); pos.copy(riverPt(z, WATER_Y + 1.25, -1.5 + Math.sin(u * 2) * 1.0)); look.copy(riverPt(z + 12, WATER_Y + 0.6, 2)); },
    },
    { // fawn and doe in the second meadow
      dur: 12, fov: 26, dof: ['subject', 5, 3], subject: () => deer.list[6].group.position,
      update(u) { const d = deer.list[6].group.position; const a = -0.6 - u * 0.5; pos.set(d.x + Math.sin(a) * 10, 0, d.z + Math.cos(a) * 10); pos.y = heightAt(pos.x, pos.z) + 0.8; look.set(d.x, d.y + 0.6, d.z); },
    },
  ];

  let index = 0, time = 0, active = false, fade = 1;
  const state = { active: false, fade: 0, title: '' };

  function start(i = 0) { active = state.active = true; index = i; time = 0; }
  function stop() { active = state.active = false; state.fade = 0; }
  function next() { time = 0; do { index = (index + 1) % shots.length; } while (shots[index].skip && shots[index].skip()); }

  function update(dt, post) {
    if (!active) return;
    const s = shots[index];
    time += dt;
    const u = Math.min(time / s.dur, 1);
    s.update(u, time);
    // keep the camera above the ground / water
    const floor = Math.max(heightAt(pos.x, pos.z), WATER_Y) + 0.25;
    if (pos.y < floor) pos.y = floor;
    // subtle handheld drift
    const t = shared.time.value;
    pos.x += Math.sin(t * 0.7) * 0.012; pos.y += Math.sin(t * 0.9 + 1) * 0.01;
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.rotation.z += Math.sin(t * 0.5) * 0.003;
    if (camera.fov !== s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
    if (s.dof) {
      const dist = s.dof[0] === 'subject' ? tmp.copy(s.subject()).distanceTo(pos) : s.dof[0];
      post.setDof(true, dist, s.dof[1], s.dof[2]);
    } else post.setDof(false);
    // fade through black between shots
    state.fade = 1 - smoothstep(0, 0.9, time) * (1 - smoothstep(s.dur - 0.9, s.dur, time));
    if (time >= s.dur) next();
  }
  return { start, stop, update, next, state, shots };
}
