// Red fox (imported glTF model, see CREDITS.md) patrolling the far bank. Shy: trots off when approached.
import * as THREE from 'three';
import { heightAt, riverDist, riverHalfWidth } from '../world/layout.js';
import { mulberry32, damp, dampAngle, clamp } from '../util/noise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function createFox(world, gltf, home) {
  if (!gltf) return null;
  const rand = mulberry32(7);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 0.62 / size.y;
  model.scale.setScalar(scale);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    // the source model is faceted low-poly: weld vertices and rebuild smooth normals for a softer, furrier read
    const g = o.geometry.clone(); g.deleteAttribute('normal');
    o.geometry = mergeVertices(g, 1e-3); o.geometry.computeVertexNormals();
    o.material = new THREE.MeshPhysicalMaterial({ map: o.material.map, roughness: 0.9, metalness: 0, color: 0xd9c4b0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.7, 0.5, 0.3) });
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
  });
  const group = new THREE.Group(); group.name = 'fox'; group.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  let current = null;
  const play = (name, speed = 1) => {
    const a = clips[name]; if (!a) return;
    a.timeScale = speed;
    if (current === a) return;
    a.reset().fadeIn(0.35).play(); if (current) current.fadeOut(0.35); current = a;
  };
  const st = { pos: new THREE.Vector3(home.x, 0, home.z), heading: rand() * 6.28, speed: 0, state: 'survey', timer: 4, target: new THREE.Vector3(home.x, 0, home.z), home };
  play('Survey');
  const pick = (dist) => {
    for (let i = 0; i < 10; i++) {
      const a = rand() * 6.28, r = dist * (0.4 + rand() * 0.6);
      const x = st.home.x + Math.cos(a) * r, z = st.home.z + Math.sin(a) * r;
      if (Math.abs(riverDist(x, z)) - riverHalfWidth(z) > 2) { st.target.set(x, 0, z); return; }
    }
  };
  function update(dt, player) {
    st.timer -= dt;
    const dp = Math.hypot(player.pos.x - st.pos.x, player.pos.z - st.pos.z);
    if (st.state !== 'flee' && dp < 13) {
      const a = Math.atan2(st.pos.x - player.pos.x, st.pos.z - player.pos.z) + (rand() - 0.5);
      st.target.set(st.pos.x + Math.sin(a) * 34, 0, st.pos.z + Math.cos(a) * 34);
      if (Math.abs(riverDist(st.target.x, st.target.z)) - riverHalfWidth(st.target.z) < 2) st.target.set(st.pos.x + Math.sin(a + 1.3) * 30, 0, st.pos.z + Math.cos(a + 1.3) * 30);
      st.state = 'flee'; st.timer = 7;
    }
    let want = 0;
    const d = Math.hypot(st.target.x - st.pos.x, st.target.z - st.pos.z);
    if (st.state === 'survey') { play('Survey'); if (st.timer < 0) { pick(18); st.state = 'walk'; st.timer = 25; } }
    else if (st.state === 'walk') { want = 0.85; play('Walk', 1.0); if (d < 0.6 || st.timer < 0) { st.state = 'survey'; st.timer = 5 + rand() * 9; } }
    else { want = 5.4; play('Run', 1.15); if (d < 2 || st.timer < 0) { st.home = { x: st.pos.x, z: st.pos.z }; st.state = 'survey'; st.timer = 6; } }
    if (want > 0) {
      let h = Math.atan2(st.target.x - st.pos.x, st.target.z - st.pos.z);
      const ax = st.pos.x + Math.sin(st.heading) * 1.2, az = st.pos.z + Math.cos(st.heading) * 1.2;
      for (const c of world.colliders.query(ax, az, 1.4)) if (Math.hypot(c.x - ax, c.z - az) < c.r + 0.5) h += 0.9;
      st.heading = dampAngle(st.heading, h, st.state === 'flee' ? 4 : 2, dt);
    }
    st.speed = damp(st.speed, want, 4, dt);
    st.pos.x = clamp(st.pos.x + Math.sin(st.heading) * st.speed * dt, -150, 150);
    st.pos.z = clamp(st.pos.z + Math.cos(st.heading) * st.speed * dt, -150, 150);
    st.pos.y = heightAt(st.pos.x, st.pos.z);
    group.position.copy(st.pos);
    group.rotation.y = st.heading;
    mixer.update(dt);
  }
  update(0, { pos: new THREE.Vector3(1e4, 0, 1e4) });
  return { group, state: st, update };
}
