// Fully synthesised soundscape (no audio files): river, wind in the canopy, birdsong, footsteps.
import { riverDist, riverHalfWidth } from './world/layout.js';
import { clamp, mulberry32 } from './util/noise.js';

export function createAudio() {
  let ctx = null, master, riverLow, riverHigh, riverPan, wind, windFilter, started = false, muted = false;
  const rand = mulberry32(12345);
  let nextBird = 2, nextDrum = 20;

  function noiseBuffer(seconds, brown) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      // crossfade the loop seam
      const f = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[n - f + i] * (1 - t); }
    }
    return buf;
  }
  function loop(buffer, filterType, freq, q, gain) {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g); src.start();
    return { src, filter: f, gain: g };
  }

  function start() {
    if (started) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC(); started = true;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
    // gentle room: two feedback delays give distant birds some air
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    const white = noiseBuffer(4, false), brown = noiseBuffer(6, true);
    riverPan = ctx.createStereoPanner(); riverPan.connect(master);
    riverLow = loop(brown, 'lowpass', 520, 0.4, 0); riverLow.gain.connect(riverPan);
    riverHigh = loop(white, 'bandpass', 2600, 0.55, 0); riverHigh.gain.connect(riverPan);
    wind = loop(brown, 'bandpass', 420, 0.5, 0); windFilter = wind.filter; wind.gain.connect(master);
    api.echo = ctx.createDelay(1); api.echo.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.28; const wet = ctx.createGain(); wet.gain.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    api.echo.connect(lp).connect(fb).connect(api.echo); lp.connect(wet).connect(master);
  }

  // one whistled note: frequency glides f0 -> f1, optional vibrato
  function note(t, dur, f0, f1, vol, pan, vib = 0, vibRate = 30) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 50), t + dur);
    if (vib) { const l = ctx.createOscillator(); l.frequency.value = vibRate; const lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3)); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p); p.connect(master); p.connect(api.echo);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const SONGS = [
    // Japanese bush warbler: long rising whistle, then "ho-ke-kyo"
    (t, v, p) => { note(t, 0.95, 1150, 1500, v * 0.9, p, 6, 5); note(t + 1.0, 0.09, 2600, 3400, v, p); note(t + 1.11, 0.1, 3600, 2500, v, p); note(t + 1.24, 0.22, 3000, 2100, v, p); return 1.6; },
    // tit: bright repeated two-note phrase
    (t, v, p) => { let d = 0; const n = 3 + Math.floor(rand() * 3); for (let i = 0; i < n; i++) { note(t + d, 0.09, 5200, 5000, v * 0.7, p); note(t + d + 0.12, 0.1, 3900, 3700, v * 0.7, p); d += 0.3; } return d; },
    // cuckoo, far away
    (t, v, p) => { let d = 0; const n = 2 + Math.floor(rand() * 3); for (let i = 0; i < n; i++) { note(t + d, 0.22, 590, 575, v * 0.8, p); note(t + d + 0.34, 0.3, 470, 455, v * 0.8, p); d += 1.25; } return d; },
    // warbling twitter
    (t, v, p) => { let d = 0; const n = 6 + Math.floor(rand() * 8); for (let i = 0; i < n; i++) { const f = 2800 + rand() * 3200, len = 0.04 + rand() * 0.08; note(t + d, len, f, f * (0.75 + rand() * 0.6), v * 0.55, p, 80 * rand(), 40); d += len + 0.02 + rand() * 0.07; } return d; },
    // thin high "tsee tsee"
    (t, v, p) => { let d = 0; for (let i = 0; i < 3; i++) { note(t + d, 0.16, 7200, 6600, v * 0.4, p); d += 0.24; } return d; },
    // wagtail call: sharp double chip
    (t, v, p) => { note(t, 0.05, 4600, 6200, v * 0.7, p); note(t + 0.12, 0.05, 4600, 6200, v * 0.7, p); return 0.3; },
  ];
  function drum(t, pan) { // woodpecker
    const n = 14 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.047, o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(900, tt); o.frequency.exponentialRampToValueAtTime(300, tt + 0.03);
      const g = ctx.createGain(); const v = 0.09 * (1 - i / n * 0.6); g.gain.setValueAtTime(v, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.035);
      const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(g).connect(p); p.connect(master); p.connect(api.echo); o.start(tt); o.stop(tt + 0.05);
    }
  }
  function burst(freq, q, vol, dur, type = 'bandpass') {
    const src = ctx.createBufferSource(); const n = Math.floor(ctx.sampleRate * dur); const b = ctx.createBuffer(1, n, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    src.buffer = b; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol; src.connect(f).connect(g).connect(master); src.start();
  }

  const api = {
    start, echo: null,
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.1); },
    suspend() { if (ctx) ctx.suspend(); }, resume() { if (ctx) ctx.resume(); },
    step(kind, running) {
      if (!started || muted) return;
      if (kind === 'water') { burst(900 + rand() * 500, 0.7, 0.3, 0.32); burst(3200, 0.8, 0.12, 0.22); }
      else { burst(260 + rand() * 120, 0.8, running ? 0.42 : 0.3, 0.12, 'lowpass'); burst(2800 + rand() * 1500, 0.9, 0.07, 0.09); }
    },
    update(dt, camPos, yaw, time) {
      if (!started) return;
      const t = ctx.currentTime;
      // river loudness from distance to the water, panned towards it
      const rd = riverDist(camPos.x, camPos.z);
      const d = Math.max(Math.abs(rd) - riverHalfWidth(camPos.z), 0);
      const near = 1 / (1 + d * 0.11);
      riverLow.gain.gain.setTargetAtTime(0.5 * near + 0.03, t, 0.2);
      riverHigh.gain.gain.setTargetAtTime(0.11 * near * near + 0.004, t, 0.2);
      const right = Math.cos(yaw) * -Math.sign(rd); // river lies towards -sign(rd) along x
      riverPan.pan.setTargetAtTime(clamp(right * (1 - near) * 1.6, -0.75, 0.75), t, 0.2);
      // wind follows the same gust function as the foliage shader
      const ph = camPos.x * 0.071 + camPos.z * 0.043;
      const g = Math.sin(time * 0.55 + ph) * 0.6 + Math.sin(time * 1.27 + ph * 2.3 + 1.7) * 0.3;
      wind.gain.gain.setTargetAtTime(0.1 + 0.11 * Math.max(0, g + 0.3), t, 0.4);
      windFilter.frequency.setTargetAtTime(380 + 260 * Math.max(0, g), t, 0.5);
      // birdsong
      nextBird -= dt;
      if (nextBird <= 0) {
        const far = rand();
        const len = SONGS[Math.floor(rand() * SONGS.length)](t + 0.05, 0.035 + 0.075 * (1 - far), rand() * 1.8 - 0.9);
        nextBird = len + 0.4 + rand() * rand() * 5;
      }
      nextDrum -= dt;
      if (nextDrum <= 0) { drum(t + 0.05, rand() * 1.6 - 0.8); nextDrum = 18 + rand() * 40; }
    },
  };
  return api;
}
