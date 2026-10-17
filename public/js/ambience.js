// Background soundscape, synthesised live with Web Audio (no music files, no
// licensing). Everything sits between ~200 Hz and ~5 kHz so it is audible on
// a phone speaker, which cannot reproduce deep bass.
//
// Moods:
//   night  wind, crickets, a slow music box with echo over a soft minor pad
//   day    a warmer major pad, sparse bright notes, the odd bird call
//   tense  (votes, defence, verdict) a low heartbeat and a tighter, darker pad

const MOODS = {
  night: {
    pad: [220.0, 293.66, 349.23],
    scale: [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46],
    noteGap: [2.6, 5.2],
    wind: 1,
    crickets: true,
    birds: false,
    heartbeat: false
  },
  day: {
    pad: [261.63, 329.63, 392.0],
    scale: [392.0, 440.0, 523.25, 587.33, 659.25, 783.99],
    noteGap: [3.2, 6.0],
    wind: 0.3,
    crickets: false,
    birds: true,
    heartbeat: false
  },
  tense: {
    pad: [220.0, 261.63, 311.13],
    scale: [220.0, 261.63, 311.13, 329.63],
    noteGap: [4.0, 7.0],
    wind: 0.5,
    crickets: false,
    birds: false,
    heartbeat: true
  }
};

const PAD_LEVEL = 0.045;
const WIND_LEVEL = 0.07;
const DUCKED = 0.3; // fraction of the volume left while the narrator talks
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Ambience {
  constructor(ctx) {
    this.ctx = ctx;
    this.volume = 0.6;
    this.ducked = false;
    this.mood = MOODS.night;
    this.moodName = 'night';
    this.running = false;
  }

  start(moodName = 'night') {
    if (this.running) return this.setMood(moodName);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.running = true;
    this.mood = MOODS[moodName] || MOODS.night;
    this.moodName = moodName;

    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.0001, t);
    this.master.connect(ctx.destination);

    // Echo for the plucked notes.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.echo.connect(feedback).connect(this.echo);
    this.echo.connect(wet).connect(this.master);

    // Pad: three soft triangle voices with a slow swell.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = PAD_LEVEL;
    this.padFilter.connect(this.padGain).connect(this.master);
    const swell = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    swell.frequency.value = 0.12;
    swellDepth.gain.value = PAD_LEVEL * 0.4;
    swell.connect(swellDepth).connect(this.padGain.gain);
    swell.start();
    this.padVoices = this.mood.pad.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 5;
      o.connect(this.padFilter);
      o.start();
      return o;
    });

    // Wind: looping noise through a slowly sweeping band-pass filter.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); // soften towards pink-ish noise
      data[i] = last * 6;
    }
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 550;
    windFilter.Q.value = 0.9;
    const gust = ctx.createOscillator();
    const gustDepth = ctx.createGain();
    gust.frequency.value = 0.07;
    gustDepth.gain.value = 260;
    gust.connect(gustDepth).connect(windFilter.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = WIND_LEVEL * this.mood.wind;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();
    gust.start();

    this.sources = [swell, windSrc, gust, ...this.padVoices];
    const now = ctx.currentTime;
    this.next = { note: now + 1.5, cricket: now + 2, bird: now + 4, beat: now + 1 };
    this.timer = setInterval(() => this.schedule(), 200);
    this.applyLevel(1.5);
  }

  setMood(moodName) {
    const mood = MOODS[moodName];
    if (!mood || !this.running || moodName === this.moodName) return;
    const t = this.ctx.currentTime;
    this.mood = mood;
    this.moodName = moodName;
    this.padVoices.forEach((o, i) => o.frequency.setTargetAtTime(mood.pad[i], t, 0.8));
    this.windGain.gain.setTargetAtTime(WIND_LEVEL * mood.wind, t, 1.2);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyLevel(0.3);
  }

  duck(on) {
    this.ducked = on;
    this.applyLevel(on ? 0.25 : 0.8);
  }

  applyLevel(seconds) {
    if (!this.running) return;
    const level = Math.max(0.0001, this.volume * (this.ducked ? DUCKED : 1));
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, seconds / 3);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0.0001, t, 0.3);
    const sources = this.sources;
    const master = this.master;
    setTimeout(() => {
      sources.forEach(s => { try { s.stop(); } catch {} });
      master.disconnect();
    }, 1500);
  }

  // Look-ahead scheduler for the one-off sounds.
  schedule() {
    const t = this.ctx.currentTime;
    const ahead = t + 0.4;
    const m = this.mood;
    if (this.next.note < ahead) {
      this.note(this.next.note, pick(m.scale));
      if (Math.random() < 0.35) this.note(this.next.note + 0.28, pick(m.scale));
      this.next.note += rand(...m.noteGap);
    }
    if (this.next.cricket < ahead) {
      if (m.crickets) this.cricket(this.next.cricket);
      this.next.cricket += rand(1.2, 3.5);
    }
    if (this.next.bird < ahead) {
      if (m.birds) this.bird(this.next.bird);
      this.next.bird += rand(4, 9);
    }
    if (this.next.beat < ahead) {
      if (m.heartbeat) this.heartbeat(this.next.beat);
      this.next.beat += 1.15;
    }
    // Catch up after the tab was in the background.
    for (const k of Object.keys(this.next)) if (this.next[k] < t) this.next[k] = t + 0.5;
  }

  envelope(at, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  // Music-box pluck with an octave shimmer, sent to the echo.
  note(at, freq) {
    const ctx = this.ctx;
    const g = this.envelope(at, 0.07, 0.008, 2.4);
    [[freq, 'triangle', 1], [freq * 2, 'sine', 0.35]].forEach(([f, type, level]) => {
      const o = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      lg.gain.value = level;
      o.connect(lg).connect(g);
      o.start(at);
      o.stop(at + 2.6);
    });
    g.connect(this.master);
    g.connect(this.echo);
  }

  // A burst of 3-5 quick chirps around 4.3 kHz.
  cricket(at) {
    const ctx = this.ctx;
    const pulses = 3 + Math.floor(Math.random() * 3);
    const freq = rand(4100, 4500);
    for (let i = 0; i < pulses; i++) {
      const start = at + i * 0.07;
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = this.envelope(start, 0.018, 0.005, 0.03);
      o.connect(g).connect(this.master);
      o.start(start);
      o.stop(start + 0.05);
    }
  }

  // Two or three rising whistles.
  bird(at) {
    const ctx = this.ctx;
    const calls = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < calls; i++) {
      const start = at + i * 0.18;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(rand(2100, 2500), start);
      o.frequency.exponentialRampToValueAtTime(rand(3200, 3700), start + 0.11);
      const g = this.envelope(start, 0.02, 0.01, 0.11);
      o.connect(g).connect(this.master);
      o.start(start);
      o.stop(start + 0.14);
    }
  }

  // "Lub-dub": a short low thump with a harmonic so phones can hear it.
  heartbeat(at) {
    const ctx = this.ctx;
    [0, 0.22].forEach((offset, i) => {
      const start = at + offset;
      [[150, 0.22], [300, 0.07]].forEach(([f, level]) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f, start);
        o.frequency.exponentialRampToValueAtTime(f * 0.55, start + 0.12);
        const g = this.envelope(start, level * (i ? 0.7 : 1), 0.006, 0.14);
        o.connect(g).connect(this.master);
        o.start(start);
        o.stop(start + 0.18);
      });
    });
  }
}

// Which mood fits a game phase.
export function moodForPhase(phase) {
  if (phase === 'NIGHT' || phase === 'LOBBY') return 'night';
  if (phase === 'VOTE' || phase === 'DEFENSE' || phase === 'JUDGE') return 'tense';
  return 'day';
}
