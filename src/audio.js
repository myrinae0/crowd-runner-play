// Tiny WebAudio blips. Muted by default; the context is created on the first
// unmuted user gesture (browsers require that).

export function createAudio() {
  let ctx = null;
  let muted = true;
  let lastShot = 0;
  let lastKill = 0;

  function ensure() {
    if (ctx || muted) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function blip(freq, dur = 0.08, type = 'square', vol = 0.05, slide = 0) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      if (!muted) ensure();
    },
    unlock() { if (!muted) ensure(); },
    play(events) {
      if (muted) return;
      const now = performance.now();
      for (const e of events) {
        switch (e.type) {
          case 'shot':
            if (now - lastShot > 90) { blip(880, 0.03, 'square', 0.012); lastShot = now; }
            break;
          case 'gate':
            if (e.mood === 'good') blip(520, 0.18, 'triangle', 0.08, 500);
            else if (e.mood === 'bad') blip(300, 0.22, 'sawtooth', 0.05, -180);
            else blip(400, 0.1, 'triangle', 0.05);
            break;
          case 'gateHit':
            if (e.flipped) blip(990, 0.1, 'triangle', 0.06, 300);
            break;
          case 'kill':
            if (now - lastKill > 60) { blip(180, 0.12, 'square', 0.04, -100); lastKill = now; }
            break;
          case 'crowdLoss':
            if (e.cause !== 'boss') blip(140, 0.15, 'sawtooth', 0.05, -60);
            break;
          case 'powerup': blip(660, 0.25, 'triangle', 0.08, 700); break;
          case 'bossStart': blip(110, 0.5, 'sawtooth', 0.07, -40); break;
          case 'won': blip(523, 0.15, 'triangle', 0.08); setTimeout(() => blip(784, 0.3, 'triangle', 0.08), 140); break;
          case 'lost': blip(220, 0.5, 'sawtooth', 0.06, -150); break;
          default: break;
        }
      }
    },
  };
}
