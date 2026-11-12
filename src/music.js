// Background music: tiny chiptune songs as data, and a lookahead sequencer.
// Pure: the sequencer only does clock math and calls onNote(); the audio
// module turns those calls into oscillators on the AudioContext clock.
//
// A pattern is one bar of 16 sixteenth-note steps per channel, written as
// space-separated tokens: a note ('A4', 'C#5'), '.' for a rest, or '-' to hold
// the previous note one more step. Drums use k (kick), s (snare), h (hat).

export const STEPS = 16;

const SONG_DATA = {
  // Calm, major, unhurried: the menu and level-end screens.
  menu: {
    bpm: 96,
    lead: 'triangle',
    patterns: {
      A: {
        lead: 'E5 - G5 - A5 - - - G5 - E5 - D5 - - -',
        bass: 'C3 - - - G2 - - - A2 - - - G2 - - -',
        drums: 'k . . . h . . . s . . . h . . .',
      },
      B: {
        lead: 'C5 - D5 - E5 - G5 - E5 - D5 - C5 - - -',
        bass: 'F2 - - - C3 - - - G2 - - - G2 - - -',
        drums: 'k . . . h . . . s . . . h . h .',
      },
    },
    order: ['A', 'B', 'A', 'B'],
  },
  // Upbeat minor run music.
  run: {
    bpm: 138,
    lead: 'pulse25',
    patterns: {
      A: {
        lead: 'A4 . C5 . E5 . A5 . G5 . E5 . C5 . D5 .',
        bass: 'A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 .',
        drums: 'k . h . s . h . k k h . s . h h',
      },
      B: {
        lead: 'F5 . E5 . C5 . A4 . G4 . A4 . C5 . E5 .',
        bass: 'F2 . F3 . F2 . F3 . G2 . G3 . G2 . G3 .',
        drums: 'k . h . s . h . k k h . s . h h',
      },
      C: {
        lead: 'A5 - - . G5 . E5 . D5 - - . C5 . D5 .',
        bass: 'D2 . D3 . D2 . D3 . E2 . E3 . E2 . E3 .',
        drums: 'k . h . s . h . k . h k s . h h',
      },
      D: {
        lead: 'E5 . E5 . D5 . C5 . B4 - - - . . . .',
        bass: 'E2 . E3 . E2 . E3 . E2 . E3 . G#2 . B2 .',
        drums: 'k . h . s . h . k . h . s s s s',
      },
    },
    order: ['A', 'B', 'A', 'B', 'C', 'D', 'C', 'D'],
  },
  // Tense, driving, chromatic: the boss fight. Phase 2 plays it faster.
  boss: {
    bpm: 156,
    lead: 'pulse12',
    patterns: {
      A: {
        lead: 'E5 . E5 F5 E5 . D5 . E5 . . . B4 . C5 .',
        bass: 'E2 E2 E3 E2 E2 E2 E3 E2 E2 E2 E3 E2 F2 F2 F3 F2',
        drums: 'k . h k s . h . k . h k s . s s',
      },
      B: {
        lead: 'G5 . F5 . E5 . D#5 . E5 - - - . . B4 .',
        bass: 'C2 C2 C3 C2 C2 C2 C3 C2 B1 B1 B2 B1 B1 B1 B2 B1',
        drums: 'k . h k s . h . k . h k s . h h',
      },
      C: {
        lead: 'B5 . A5 . G5 . F#5 . G5 . A5 . B5 - - .',
        bass: 'E2 E2 E3 E2 D2 D2 D3 D2 C2 C2 C3 C2 B1 B1 B2 B1',
        drums: 'k . h k s . h k k . h k s s s s',
      },
    },
    order: ['A', 'B', 'A', 'C'],
  },
};

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'A4' -> 69 (MIDI). Returns null for anything that isn't a note.
export function noteToMidi(tok) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(tok);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

export function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// A channel line -> [{ step, len, midi }] (notes) or [{ step, drum }] (drums).
export function parseLine(line, drums = false) {
  const toks = line.trim().split(/\s+/);
  if (toks.length !== STEPS) throw new Error(`pattern needs ${STEPS} steps, got ${toks.length}: ${line}`);
  const out = [];
  toks.forEach((t, step) => {
    if (t === '.') return;
    if (t === '-') {
      const prev = out[out.length - 1];
      if (prev && !drums && prev.step + prev.len === step) prev.len += 1;
      return;
    }
    if (drums) {
      if (!'ksh'.includes(t) || t.length !== 1) throw new Error(`bad drum '${t}'`);
      out.push({ step, drum: t });
      return;
    }
    const midi = noteToMidi(t);
    if (midi === null) throw new Error(`bad note '${t}'`);
    out.push({ step, len: 1, midi });
  });
  return out;
}

function build(data) {
  const songs = {};
  for (const [name, d] of Object.entries(data)) {
    const patterns = {};
    for (const [pk, p] of Object.entries(d.patterns)) {
      patterns[pk] = { lead: parseLine(p.lead), bass: parseLine(p.bass), drums: parseLine(p.drums, true) };
    }
    // Per step lookups, so the scheduler does no searching.
    const bars = d.order.map((pk) => {
      const p = patterns[pk];
      const steps = Array.from({ length: STEPS }, () => []);
      for (const n of p.lead) steps[n.step].push({ ch: 'lead', midi: n.midi, len: n.len });
      for (const n of p.bass) steps[n.step].push({ ch: 'bass', midi: n.midi, len: n.len });
      for (const n of p.drums) steps[n.step].push({ ch: 'drum', drum: n.drum, len: 1 });
      return steps;
    });
    songs[name] = { name, bpm: d.bpm, lead: d.lead, order: d.order, bars };
  }
  return songs;
}

export const SONGS = build(SONG_DATA);
export { SONG_DATA };

// Seconds per sixteenth step.
export function stepDur(bpm, tempo = 1) {
  return 60 / (bpm * tempo) / 4;
}

// Lookahead sequencer. Call tick(now) often (every ~50 ms); it schedules every
// step that starts before now + lookahead by calling
// onNote({ ch, midi | drum, len }, time, durSeconds). Times are on the audio clock.
export function createSequencer({ onNote, lookahead = 0.2 } = {}) {
  let song = null;
  let bar = 0;
  let step = 0;
  let next = 0;
  let playing = false;
  let tempo = 1;

  return {
    get song() { return song && song.name; },
    get playing() { return playing; },
    get position() { return { bar, step }; },
    get nextTime() { return next; },
    get tempo() { return tempo; },
    setTempo(t) { tempo = t > 0 ? t : 1; },
    // Start a song from its top at time t.
    start(name, t) {
      song = SONGS[name] || null;
      bar = 0; step = 0; next = t; tempo = 1;
      playing = !!song;
    },
    // Stop scheduling; the position is kept so resume() carries on.
    pause() { playing = false; },
    resume(t) {
      if (!song) return;
      next = t;
      playing = true;
    },
    stop() { playing = false; song = null; },
    tick(now) {
      if (!playing || !song) return 0;
      // After a long stall (tab hidden, slow frame), skip ahead instead of
      // bursting out every missed note at once.
      if (next < now - 0.1) next = now + 0.02;
      let n = 0;
      const sd = stepDur(song.bpm, tempo);
      while (next < now + lookahead && n < 64) {
        for (const ev of song.bars[bar][step]) onNote(ev, next, ev.len * sd);
        next += sd;
        step += 1;
        if (step >= STEPS) { step = 0; bar = (bar + 1) % song.bars.length; }
        n += 1;
      }
      return n;
    },
  };
}
