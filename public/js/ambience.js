// Background soundscape, synthesised live with Web Audio (no music files, no
// licensing). Everything sits between ~200 Hz and ~5 kHz so it is audible on
// a phone speaker, which cannot reproduce deep bass.
//
// Each theme has three moods that follow the game:
//   night  the darkest, calmest take
//   day    warmer and brighter
//   tense  (votes, defence, verdict) tighter, often with a heartbeat
// A mood is a pad chord (always three voices, so moods glide into each
// other), a scale for the lead notes and how they are played, and the
// background layers to mix in.

const VILLAGE = {
  night: { pad: [220.0, 293.66, 349.23], scale: [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46], noteGap: [2.6, 5.2], wind: 1, crickets: true },
  day: { pad: [261.63, 329.63, 392.0], scale: [392.0, 440.0, 523.25, 587.33, 659.25, 783.99], noteGap: [3.2, 6.0], wind: 0.3, birds: true },
  tense: { pad: [220.0, 261.63, 311.13], scale: [220.0, 261.63, 311.13, 329.63], noteGap: [4.0, 7.0], wind: 0.5, heartbeat: true }
};

export const THEMES = {
  village: { name: 'Làng quê', voice: 'musicbox', padType: 'triangle', padCutoff: 1400, moods: VILLAGE },
  forest: {
    name: 'Rừng sâu',
    voice: 'flute',
    padType: 'sine',
    padCutoff: 1000,
    moods: {
      night: { pad: [196.0, 233.08, 293.66], scale: [392.0, 466.16, 523.25, 587.33, 698.46], noteGap: [4.5, 8.5], wind: 0.7, owls: true, crickets: true },
      day: { pad: [220.0, 277.18, 329.63], scale: [440.0, 493.88, 554.37, 659.25, 739.99], noteGap: [4.0, 7.5], wind: 0.35, birds: true, drips: true },
      tense: { pad: [185.0, 220.0, 261.63], scale: [369.99, 440.0, 523.25], noteGap: [5.0, 9.0], wind: 0.6, owls: true, heartbeat: true }
    }
  },
  rain: {
    name: 'Mưa đêm',
    voice: 'piano',
    padType: 'sine',
    padCutoff: 1200,
    moods: {
      night: { pad: [220.0, 261.63, 329.63], scale: [329.63, 392.0, 440.0, 523.25, 587.33, 659.25], noteGap: [2.4, 4.8], wind: 0.2, rain: 1, thunder: true },
      day: { pad: [261.63, 329.63, 392.0], scale: [392.0, 440.0, 493.88, 587.33, 659.25], noteGap: [2.8, 5.5], wind: 0.1, rain: 0.45, drips: true },
      tense: { pad: [207.65, 246.94, 311.13], scale: [311.13, 369.99, 415.3, 493.88], noteGap: [3.5, 6.5], wind: 0.3, rain: 0.8, thunder: true, heartbeat: true }
    }
  },
  castle: {
    name: 'Lâu đài cổ',
    voice: 'bell',
    padType: 'sawtooth',
    padCutoff: 900,
    moods: {
      night: { pad: [196.0, 246.94, 293.66], scale: [392.0, 440.0, 466.16, 523.25, 587.33], noteGap: [4.0, 7.5], wind: 0.6, tolls: true },
      day: { pad: [261.63, 329.63, 392.0], scale: [523.25, 587.33, 659.25, 783.99], noteGap: [3.5, 6.5], wind: 0.25, birds: true },
      tense: { pad: [185.0, 233.08, 277.18], scale: [369.99, 415.3, 466.16], noteGap: [5.0, 8.0], wind: 0.45, tolls: true, heartbeat: true }
    }
  },
  mystic: {
    name: 'Huyền bí',
    voice: 'glass',
    padType: 'sine',
    padCutoff: 1600,
    moods: {
      night: { pad: [233.08, 293.66, 369.99], scale: [466.16, 523.25, 587.33, 659.25, 739.99, 830.61], noteGap: [3.0, 6.0], wind: 0.5, drips: true },
      day: { pad: [261.63, 329.63, 415.3], scale: [523.25, 587.33, 659.25, 739.99, 830.61, 932.33], noteGap: [3.0, 5.5], wind: 0.25, birds: true },
      tense: { pad: [220.0, 277.18, 349.23], scale: [440.0, 466.16, 554.37, 622.25], noteGap: [4.0, 7.0], wind: 0.5, drips: true, heartbeat: true }
    }
  }
};
export const THEME_IDS = Object.keys(THEMES);

const PAD_LEVEL = 0.045;
const WIND_LEVEL = 0.07;
const RAIN_LEVEL = 0.05;
const DUCKED = 0.3; // fraction of the volume left while the narrator talks
// How loud each mood plays, against the volume the player set: quieter by day
// (discussion and votes) so people can hear each other.
const MOOD_LEVEL = { night: 1, day: 0.35, tense: 0.45 };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Ambience {
  constructor(ctx) {
    this.ctx = ctx;
    this.volume = 0.6;
    this.ducked = false;
    this.theme = THEMES.village;
    this.themeId = 'village';
    this.mood = this.theme.moods.night;
    this.moodName = 'night';
    this.running = false;
  }

  // Switching theme while playing restarts the soundscape with a short fade.
  setTheme(themeId) {
    const id = THEMES[themeId] ? themeId : 'village';
    if (id === this.themeId) return;
    this.themeId = id;
    this.theme = THEMES[id];
    if (!this.running) return;
    const mood = this.moodName;
    this.stop();
    this.start(mood);
  }

  start(moodName = 'night') {
    if (this.running) return this.setMood(moodName);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.running = true;
    this.mood = this.theme.moods[moodName] || this.theme.moods.night;
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
    this.padFilter.frequency.value = this.theme.padCutoff;
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
      o.type = this.theme.padType;
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
    this.noise = noise;
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

    // Rain: the same noise, high-passed into a steady hiss.
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noise;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 1.7;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 2200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = RAIN_LEVEL * (this.mood.rain || 0);
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rainSrc.start();

    this.sources = [swell, windSrc, gust, rainSrc, ...this.padVoices];
    const now = ctx.currentTime;
    this.next = { note: now + 1.5, cricket: now + 2, bird: now + 4, beat: now + 1, owl: now + 6, drip: now + 3, toll: now + 5, thunder: now + 12, rainDrop: now + 1 };
    this.timer = setInterval(() => this.schedule(), 200);
    this.applyLevel(1.5);
  }

  setMood(moodName) {
    const mood = this.theme.moods[moodName];
    if (!mood || !this.running || moodName === this.moodName) return;
    const t = this.ctx.currentTime;
    this.mood = mood;
    this.moodName = moodName;
    this.padVoices.forEach((o, i) => o.frequency.setTargetAtTime(mood.pad[i], t, 0.8));
    this.applyLevel(3);
    this.windGain.gain.setTargetAtTime(WIND_LEVEL * mood.wind, t, 1.2);
    this.rainGain.gain.setTargetAtTime(RAIN_LEVEL * (mood.rain || 0), t, 1.2);
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
    // By day the village talks: the music steps back on its own.
    const mood = MOOD_LEVEL[this.moodName] ?? 1;
    const level = Math.max(0.0001, this.volume * mood * (this.ducked ? DUCKED : 1));
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
    if (this.next.owl < ahead) {
      if (m.owls) this.owl(this.next.owl);
      this.next.owl += rand(9, 18);
    }
    if (this.next.drip < ahead) {
      if (m.drips) this.drip(this.next.drip);
      this.next.drip += rand(1.5, 5);
    }
    if (this.next.toll < ahead) {
      if (m.tolls) this.toll(this.next.toll);
      this.next.toll += rand(12, 22);
    }
    if (this.next.thunder < ahead) {
      if (m.thunder) this.thunder(this.next.thunder);
      this.next.thunder += rand(20, 40);
    }
    if (this.next.rainDrop < ahead) {
      if (m.rain) this.drip(this.next.rainDrop, 0.008 * m.rain);
      this.next.rainDrop += rand(0.15, 0.6);
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

  // One lead note, played in the theme's voice and sent to the echo.
  note(at, freq) {
    const ctx = this.ctx;
    // [partial ratio, wave, level], peak, attack, decay
    const voices = {
      musicbox: [[[1, 'triangle', 1], [2, 'sine', 0.35]], 0.07, 0.008, 2.4],
      piano: [[[1, 'triangle', 1], [2, 'sine', 0.3], [3, 'sine', 0.12]], 0.07, 0.005, 1.8],
      flute: [[[1, 'sine', 1], [2, 'sine', 0.15]], 0.05, 0.25, 1.6],
      bell: [[[1, 'sine', 1], [2.76, 'sine', 0.4], [5.4, 'sine', 0.15]], 0.06, 0.004, 3.5],
      glass: [[[1, 'sine', 1], [2.01, 'sine', 0.5], [4.03, 'sine', 0.12]], 0.05, 0.02, 3.2]
    };
    const [partials, peak, attack, decay] = voices[this.theme.voice] || voices.musicbox;
    const g = this.envelope(at, peak, attack, decay);
    partials.forEach(([ratio, type, level]) => {
      const o = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * ratio;
      lg.gain.value = level;
      if (this.theme.voice === 'flute') {
        // A gentle vibrato makes the sine sound breathed.
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5;
        depth.gain.value = freq * ratio * 0.006;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(at);
        lfo.stop(at + attack + decay + 0.2);
      }
      o.connect(lg).connect(g);
      o.start(at);
      o.stop(at + attack + decay + 0.2);
    });
    g.connect(this.master);
    g.connect(this.echo);
  }

  // "Hoo, hoo-hoo": a soft falling owl call.
  owl(at) {
    const ctx = this.ctx;
    const base = rand(360, 420);
    [[0, 1], [0.55, 0.92], [0.85, 0.9]].forEach(([offset, bend]) => {
      const start = at + offset;
      [[1, 0.035], [2, 0.012]].forEach(([ratio, level]) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(base * ratio, start);
        o.frequency.exponentialRampToValueAtTime(base * ratio * bend, start + 0.3);
        const g = this.envelope(start, level, 0.06, 0.3);
        o.connect(g).connect(this.master);
        o.start(start);
        o.stop(start + 0.4);
      });
    });
  }

  // A water drop: a quick upward blip with echo. Also used, quieter, for rain.
  drip(at, level = 0.03) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const f = rand(900, 1500);
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 1.9, at + 0.05);
    const g = this.envelope(at, level, 0.003, 0.08);
    o.connect(g).connect(this.master);
    g.connect(this.echo);
    o.start(at);
    o.stop(at + 0.12);
  }

  // A distant bell tolling once or twice.
  toll(at) {
    const ctx = this.ctx;
    const f = pick([293.66, 329.63, 392.0]);
    const strikes = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < strikes; i++) {
      const start = at + i * 2.2;
      const g = this.envelope(start, 0.05, 0.004, 4.5);
      [[1, 1], [2, 0.5], [2.76, 0.35], [4.07, 0.15]].forEach(([ratio, level]) => {
        const o = ctx.createOscillator();
        const lg = ctx.createGain();
        o.frequency.value = f * ratio;
        lg.gain.value = level;
        o.connect(lg).connect(g);
        o.start(start);
        o.stop(start + 4.8);
      });
      g.connect(this.master);
      g.connect(this.echo);
    }
  }

  // Far-off thunder: a slow swell of filtered noise.
  thunder(at) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = rand(250, 400);
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12, at + 0.4);
    g.gain.exponentialRampToValueAtTime(0.03, at + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
    src.connect(filter).connect(g).connect(this.master);
    src.start(at);
    src.stop(at + 3.6);
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
