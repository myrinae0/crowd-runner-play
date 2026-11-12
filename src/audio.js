// Retro sound effects and chiptune music, synthesized with WebAudio at runtime
// (no audio files). Sound effects and music have separate switches. Browsers
// only allow audio after a user gesture, so the AudioContext is created by
// unlock(), which main.js calls on the first tap or key. Without WebAudio
// every call is a harmless no-op.
//
// Graph: sfx bus ─┐
//                 ├─ master gain ─ compressor (limiter) ─ speakers
//      music bus ─┘
//
// The recipes and the rules (event -> sound, rate limits, voice cap, music
// patterns and sequencer) are pure and live in sfx.js and music.js.

import { RECIPES, soundFor, createLimiter, createVoicePool, recipeDur, freqCurve, pulseTerms } from './sfx.js';
import { createSequencer, midiToHz } from './music.js';

export const MAX_VOICES = 10;          // sound effects playing at once
export const MAX_STARTS_PER_FRAME = 5; // low-priority sounds started per play() call
export const SFX_VOL = 0.9;
export const MUSIC_VOL = 0.5;          // music sits under the effects
export const MASTER_VOL = 1.0;
const SILENT = 0.0001;

// Volume sliders (0-100 per channel). 80 is the loudness the game was tuned
// at; 100 is 1.25x that (the headroom measured before the busiest mix reaches
// full scale; the compressor still catches anything over). The curve is a
// smooth cubic through (0, 0), (80, 1) and (100, 1.25): it bends like an
// audio taper, so the low half stays usable (50 -> 0.51x, about -6 dB;
// 25 -> 0.15x, about -16 dB; 10 -> 0.03x, about -32 dB). A plain power curve
// can't hit both 80 -> 1 and 100 -> 1.25 (only a straight line can).
export const DEFAULT_VOL = 80;
export const MAX_BOOST = 1.25;
const CUBE_B = 2.8125;  // gain(x) = B x^2 - C x^3, x = v / 100
const CUBE_C = 1.5625;
export function clampVol(v, def = DEFAULT_VOL) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : def;
}
export function volumeGain(v) {
  const x = clampVol(v) / 100;
  return x <= 0 ? 0 : CUBE_B * x * x - CUBE_C * x * x * x;
}
const SLIDE_TAU = 0.03; // slider moves glide over ~0.1 s (no zipper clicks)
const PREVIEW_GAP_MS = 150;
const PREVIEW_SOUND = 'gateNeutral';

// Builds the noise buffer and pulse waves once for a context, and plays
// recipes and music notes into a destination node. Used by the engine and by
// the offline render check.
export function createSynth(ctx) {
  const rate = ctx.sampleRate || 44100;
  const noise = ctx.createBuffer(1, rate, rate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const waves = {};
  for (const [name, duty] of [['pulse25', 0.25], ['pulse12', 0.125]]) {
    try {
      const { real, imag } = pulseTerms(duty);
      waves[name] = ctx.createPeriodicWave(real, imag);
    } catch {
      waves[name] = null;
    }
  }
  const curves = new Map(); // frequency curves per recipe layer, built once

  function source(w, t0) {
    if (w === 'noise') {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(t0, Math.random() * 0.9);
      return s;
    }
    const o = ctx.createOscillator();
    if (w === 'pulse25' || w === 'pulse12') {
      if (waves[w]) o.setPeriodicWave(waves[w]);
      else o.type = 'square';
    } else {
      o.type = w;
    }
    o.start(t0);
    return o;
  }

  function envelope(param, t0, l) {
    const a = l.a || 0.002;
    const end = t0 + l.dur;
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(l.v, t0 + a);
    if (l.hold) param.setValueAtTime(l.v, t0 + Math.max(a, l.dur * 0.7));
    param.exponentialRampToValueAtTime(SILENT, end);
  }

  // Plays recipe `name` at time t. Returns a function that cuts it short.
  function playRecipe(name, t, dest, jit = 0) {
    const r = RECIPES[name];
    const parts = [];
    r.layers.forEach((l, i) => {
      const t0 = t + (l.at || 0);
      const src = source(l.w, t0);
      if (l.w === 'noise') {
        src.playbackRate.value = 1 + jit;
      } else {
        const key = `${name}:${i}`;
        let c = curves.get(key);
        if (!c) { c = freqCurve(l); curves.set(key, c); }
        src.frequency.setValueCurveAtTime(c, t0, l.dur);
        if (jit) src.detune.value = 1200 * Math.log2(1 + jit);
      }
      const g = ctx.createGain();
      envelope(g.gain, t0, l);
      let node = src;
      if (l.filt) {
        const f = ctx.createBiquadFilter();
        f.type = l.filt.t;
        const [f0, f1] = Array.isArray(l.filt.f) ? l.filt.f : [l.filt.f, l.filt.f];
        f.frequency.setValueAtTime(f0, t0);
        if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + l.dur);
        if (l.filt.q) f.Q.value = l.filt.q;
        node.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(dest);
      src.stop(t0 + l.dur + 0.02);
      parts.push([src, g]);
    });
    return (now) => {
      for (const [src, g] of parts) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.008);
        src.stop(now + 0.04);
      }
    };
  }

  // One music event ({ ch: 'lead' | 'bass', midi } or { ch: 'drum', drum }).
  function playNote(ev, t, dur, dest, leadWave = 'pulse25') {
    if (ev.ch === 'drum') {
      if (ev.drum === 'k') {
        const o = source('sine', t);
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(SILENT, t + 0.13);
        o.connect(g).connect(dest);
        o.stop(t + 0.15);
        return;
      }
      const snare = ev.drum === 's';
      const s = source('noise', t);
      const f = ctx.createBiquadFilter();
      f.type = snare ? 'bandpass' : 'highpass';
      f.frequency.value = snare ? 1800 : 7000;
      if (snare) f.Q.value = 0.8;
      const g = ctx.createGain();
      const len = snare ? 0.12 : 0.035;
      g.gain.setValueAtTime(snare ? 0.18 : 0.07, t);
      g.gain.exponentialRampToValueAtTime(SILENT, t + len);
      s.connect(f).connect(g).connect(dest);
      s.stop(t + len + 0.02);
      return;
    }
    const lead = ev.ch === 'lead';
    const o = source(lead ? leadWave : 'triangle', t);
    o.frequency.setValueAtTime(midiToHz(ev.midi), t);
    const v = lead ? 0.12 : 0.22;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(v * 0.45, t + Math.max(0.01, dur * 0.85));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.stop(t + dur + 0.02);
  }

  return { playRecipe, playNote, noise };
}

function defaultAC() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

const LEADS = { menu: 'triangle', run: 'pulse25', boss: 'pulse12' };

// opts (for tests): AC (AudioContext constructor or null), nowMs(),
// setInterval / clearInterval, random().
export function createAudio(opts = {}) {
  const getAC = 'AC' in opts ? () => opts.AC : defaultAC;
  const nowMs = opts.nowMs || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const setTimer = opts.setInterval || ((f, ms) => setInterval(f, ms));
  const clearTimer = opts.clearInterval || ((id) => clearInterval(id));
  const random = opts.random || Math.random;

  let sfxOn = true;
  let musicOn = true;
  let sfxVol = DEFAULT_VOL;
  let musicVol = DEFAULT_VOL;
  let lastPreview = -Infinity;
  let ctx = null;
  let failed = false;
  let sleeping = false;
  let synth = null;
  let sfxBus = null, musicBus = null;
  let scene = null; // 'menu' | 'run' | 'boss' | 'paused' | null
  let timer = null;
  let songLead = 'pulse25';
  const limiter = createLimiter();
  const pool = createVoicePool(MAX_VOICES);
  const seq = createSequencer({
    lookahead: 0.2,
    onNote: (ev, t, dur) => { if (synth) synth.playNote(ev, t, dur, musicBus, songLead); },
  });

  function init() {
    if (ctx || failed) return ctx;
    const AC = getAC();
    if (!AC) { failed = true; return null; }
    try {
      ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = MASTER_VOL;
      let out = master;
      if (ctx.createDynamicsCompressor) {
        // A fast, high-ratio compressor acts as a gentle limiter.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 6;
        comp.ratio.value = 12;
        comp.attack.value = 0.002;
        comp.release.value = 0.2;
        master.connect(comp);
        out = comp;
      }
      out.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxGain();
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);
      synth = createSynth(ctx);
    } catch {
      ctx = null;
      synth = null;
      failed = true;
    }
    return ctx;
  }

  // A channel at 0% counts as off: no notes, no nodes, no waking the context.
  const sfxLive = () => sfxOn && sfxVol > 0;
  const musicLive = () => musicOn && musicVol > 0;
  const anyOn = () => sfxLive() || musicLive();
  const sfxGain = () => SFX_VOL * volumeGain(sfxVol);
  const musicGain = () => MUSIC_VOL * volumeGain(musicVol);

  function resumeCtx() {
    if (ctx && ctx.state === 'suspended' && !sleeping && anyOn()) {
      try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
  }
  function suspendCtx() {
    if (ctx && ctx.state === 'running') {
      try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
  }

  // The timer only wakes the sequencer; notes are timed on the audio clock.
  function startTimer() {
    if (timer === null) timer = setTimer(() => { if (ctx) seq.tick(ctx.currentTime); }, 50);
  }
  function stopTimer() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }
  function fadeMusic(to, tau) {
    if (!musicBus) return;
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(to, now, tau);
  }

  // Make the music match the scene and the music switch.
  function applyScene() {
    if (!ctx) return;
    if (!musicLive() || sleeping || scene === 'paused') {
      // Keep the song position, so resuming carries on where it stopped.
      seq.pause();
      fadeMusic(0, 0.08);
      stopTimer();
      return;
    }
    const song = scene === 'menu' || scene === 'run' || scene === 'boss' ? scene : null;
    if (!song) {
      seq.stop();
      fadeMusic(0, 0.15);
      stopTimer();
      return;
    }
    const t = ctx.currentTime + 0.06;
    if (seq.song === song) {
      if (!seq.playing) seq.resume(t);
    } else {
      seq.start(song, t);
      songLead = LEADS[song];
    }
    fadeMusic(musicGain(), 0.15);
    seq.tick(ctx.currentTime);
    startTimer();
  }

  function play(events) {
    if (!ctx) return;
    for (const e of events) {
      if (e.type === 'bossPhase2' && seq.song === 'boss') seq.setTempo(1.12);
    }
    if (!sfxLive() || sleeping || ctx.state === 'suspended') return;
    const t = ctx.currentTime;
    const ms = nowMs();
    let started = 0;
    for (const e of events) {
      const name = soundFor(e);
      if (!name) continue;
      const r = RECIPES[name];
      if (r.prio < 2 && started >= MAX_STARTS_PER_FRAME) continue;
      if (!limiter.allow(name, ms)) continue;
      const voice = pool.admit(t, recipeDur(r), r.prio);
      if (!voice) continue;
      const jit = r.jit ? (random() * 2 - 1) * r.jit : 0;
      try {
        voice.stop = synth.playRecipe(name, t, sfxBus, jit);
      } catch {
        voice.end = t; // free the slot
      }
      started += 1;
    }
  }

  // After a switch or slider change: wake or park the context to match.
  function syncCtx() {
    if (anyOn()) resumeCtx();
    applyScene();
    if (!anyOn()) suspendCtx();
  }

  // A short blip at the current effects level (for the Sound slider). Rate
  // limited; silent when effects are off, at 0% or the tab is hidden.
  function preview() {
    if (!sfxLive() || sleeping || !ctx || !synth) return false;
    const ms = nowMs();
    if (ms - lastPreview < PREVIEW_GAP_MS) return false;
    lastPreview = ms;
    const t = ctx.currentTime;
    const r = RECIPES[PREVIEW_SOUND];
    const voice = pool.admit(t, recipeDur(r), 3);
    if (!voice) return false;
    try {
      voice.stop = synth.playRecipe(PREVIEW_SOUND, t, sfxBus, 0);
    } catch {
      voice.end = t;
      return false;
    }
    return true;
  }

  return {
    get muted() { return !sfxOn; },
    get music() { return musicOn; },
    get sfxVol() { return sfxVol; },
    get musicVol() { return musicVol; },
    get scene() { return scene; },
    setMuted(m) {
      sfxOn = !m;
      if (anyOn()) resumeCtx();
      else suspendCtx();
    },
    setMusic(on) {
      musicOn = !!on;
      syncCtx();
    },
    // Slider values, 0-100. The switches above don't change them, so turning
    // a channel back on brings back its level.
    setSfxVolume(v) {
      sfxVol = clampVol(v, sfxVol);
      if (sfxBus) {
        const now = ctx.currentTime;
        sfxBus.gain.cancelScheduledValues(now);
        sfxBus.gain.setTargetAtTime(sfxGain(), now, SLIDE_TAU);
      }
      syncCtx();
    },
    setMusicVolume(v) {
      const was = musicLive();
      musicVol = clampVol(v, musicVol);
      if (ctx && was && musicLive() && !sleeping && scene !== 'paused' && seq.playing) {
        fadeMusic(musicGain(), SLIDE_TAU); // already playing: just glide
        if (anyOn()) resumeCtx();
      } else {
        syncCtx();
      }
    },
    preview,
    // Call from a user gesture: creates or resumes the context.
    unlock() {
      if (!anyOn() || sleeping) return;
      const fresh = !ctx;
      if (!init()) return;
      resumeCtx();
      if (fresh) applyScene();
    },
    // 'menu' | 'run' | 'boss' | 'paused' | null. Cheap to call every frame.
    setScene(s) {
      if (s === scene) return;
      scene = s;
      applyScene();
    },
    // Tab hidden / shown.
    sleep() {
      if (sleeping) return;
      sleeping = true;
      applyScene();
      suspendCtx();
    },
    wake() {
      if (!sleeping) return;
      sleeping = false;
      resumeCtx();
      applyScene();
    },
    play,
    _debug: {
      pool, limiter, seq,
      get ctx() { return ctx; }, get timer() { return timer; },
      get sfxBus() { return sfxBus; }, get musicBus() { return musicBus; },
    },
  };
}
