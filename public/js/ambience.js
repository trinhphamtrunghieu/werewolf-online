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
Object.assign(THEMES, {
  storm: {
    name: 'Bão giông',
    voice: 'piano',
    padType: 'sine',
    padCutoff: 900,
    moods: {
      night: { pad: [196.0, 233.08, 293.66], scale: [293.66, 349.23, 392.0, 466.16], noteGap: [5.0, 9.0], wind: 1.3, rain: 1.6, thunder: 2, gusts: true },
      day: { pad: [220.0, 261.63, 329.63], scale: [329.63, 392.0, 440.0, 523.25], noteGap: [5.0, 9.0], wind: 0.6, rain: 0.9, thunder: 1, drips: true },
      tense: { pad: [185.0, 220.0, 277.18], scale: [277.18, 329.63, 369.99], noteGap: [6.0, 10.0], wind: 1, rain: 1.3, thunder: 2, gusts: true, heartbeat: true }
    }
  },
  sea: {
    name: 'Làng chài',
    voice: 'flute',
    padType: 'sine',
    padCutoff: 1100,
    moods: {
      night: { pad: [220.0, 277.18, 329.63], scale: [440.0, 493.88, 554.37, 659.25, 739.99], noteGap: [4.5, 8.5], wind: 0.45, waves: 1, crickets: true },
      day: { pad: [246.94, 311.13, 369.99], scale: [493.88, 554.37, 622.25, 739.99, 830.61], noteGap: [4.0, 7.5], wind: 0.3, waves: 0.8, gulls: true },
      tense: { pad: [207.65, 246.94, 311.13], scale: [415.3, 493.88, 554.37], noteGap: [5.0, 9.0], wind: 0.5, waves: 1, heartbeat: true }
    }
  },
  campfire: {
    name: 'Lửa trại',
    voice: 'musicbox',
    padType: 'triangle',
    padCutoff: 1100,
    moods: {
      night: { pad: [196.0, 246.94, 293.66], scale: [392.0, 440.0, 493.88, 587.33, 659.25], noteGap: [3.5, 6.5], wind: 0.25, fire: 1, crickets: true, owls: true },
      day: { pad: [261.63, 329.63, 392.0], scale: [523.25, 587.33, 659.25, 783.99], noteGap: [3.5, 6.5], wind: 0.15, fire: 0.6, birds: true },
      tense: { pad: [196.0, 233.08, 293.66], scale: [392.0, 466.16, 523.25], noteGap: [5.0, 8.0], wind: 0.3, fire: 1, heartbeat: true }
    }
  },
  winter: {
    name: 'Đêm đông, sói tru',
    voice: 'glass',
    padType: 'sine',
    padCutoff: 1000,
    moods: {
      night: { pad: [185.0, 220.0, 277.18], scale: [369.99, 415.3, 440.0, 554.37], noteGap: [5.0, 9.0], wind: 0.9, howl: 1, wolves: true },
      day: { pad: [220.0, 277.18, 329.63], scale: [440.0, 493.88, 554.37, 659.25], noteGap: [4.0, 7.5], wind: 0.6, howl: 0.4 },
      tense: { pad: [174.61, 207.65, 261.63], scale: [349.23, 415.3, 466.16], noteGap: [5.0, 9.0], wind: 0.8, howl: 0.8, wolves: true, heartbeat: true }
    }
  },
  temple: {
    name: 'Chùa cổ',
    voice: 'bell',
    padType: 'sine',
    padCutoff: 1000,
    moods: {
      night: { pad: [196.0, 261.63, 293.66], scale: [392.0, 440.0, 523.25, 587.33, 659.25], noteGap: [5.0, 9.0], wind: 0.4, gong: true, moktak: true, crickets: true },
      day: { pad: [220.0, 293.66, 329.63], scale: [440.0, 523.25, 587.33, 659.25, 783.99], noteGap: [4.5, 8.0], wind: 0.2, gong: true, birds: true },
      tense: { pad: [185.0, 246.94, 277.18], scale: [369.99, 440.0, 493.88], noteGap: [6.0, 10.0], wind: 0.4, moktak: true, heartbeat: true }
    }
  }
});
// The rain night gets the new rain and a gust now and then.
THEMES.rain.moods.night.gusts = true;
export const THEME_IDS = Object.keys(THEMES);

// ---------------------------------------------------------------------------
// Recorded-like textures, computed once per sample rate and looped.
// Stereo, with different random content per side, so the sound is wide.
// ---------------------------------------------------------------------------

const textures = new Map();
function texture(ctx, name, make) {
  const key = `${name}@${ctx.sampleRate}`;
  if (!textures.has(key)) textures.set(key, make(ctx));
  return textures.get(key);
}

// Plain white noise, the raw material for rain sheets and surf.
function whiteNoise(ctx, seconds = 4) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// Many tiny impacts scattered over a loop: each is a short noise tick that
// rings at its own pitch and dies away in a few milliseconds. Dense and high
// for the patter of rain; sparse and lower for big drops off the eaves;
// sharp and broadband for a fire's crackle. The loop wraps so it is seamless.
function impacts(ctx, { seconds, perSecond, freq, decay, level, noise = 0.5, burst = 0 }) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const count = Math.floor(perSecond * seconds);
    for (let n = 0; n < count; n++) {
      const start = Math.floor(Math.random() * len);
      const f = rand(...freq);
      const tau = rand(...decay) * sr;
      const amp = level * Math.pow(Math.random(), 1.6);
      const w = (2 * Math.PI * f) / sr;
      const span = Math.min(len, Math.floor(tau * 5));
      const phase = Math.random() * Math.PI * 2;
      for (let k = 0; k < span; k++) {
        const env = Math.exp(-k / tau);
        const tick = (Math.random() * 2 - 1) * Math.exp(-k / (0.0015 * sr));
        d[(start + k) % len] += amp * env * (Math.sin(w * k + phase) * (1 - noise) + tick * noise);
      }
    }
    // Every so often a cluster (a gust throwing drops, a log settling).
    for (let b = 0; b < burst * seconds; b++) {
      const at = Math.floor(Math.random() * len);
      for (let n = 0; n < 12; n++) {
        const start = (at + Math.floor(Math.random() * sr * 0.25)) % len;
        const tau = rand(...decay) * sr;
        const amp = level * rand(0.4, 1);
        for (let k = 0; k < tau * 5; k++) d[(start + k) % len] += amp * Math.exp(-k / tau) * (Math.random() * 2 - 1);
      }
    }
  }
  return buf;
}

const RAIN_PATTER = (ctx) => impacts(ctx, { seconds: 7, perSecond: 520, freq: [1800, 6500], decay: [0.0015, 0.005], level: 0.5, noise: 0.55 });
const RAIN_DROPS = (ctx) => impacts(ctx, { seconds: 9, perSecond: 9, freq: [500, 1400], decay: [0.012, 0.03], level: 0.9, noise: 0.25 });
const FIRE_CRACKLE = (ctx) => impacts(ctx, { seconds: 8, perSecond: 28, freq: [1500, 5000], decay: [0.0008, 0.003], level: 1, noise: 0.9, burst: 0.35 });


const PAD_LEVEL = 0.045;
const WIND_LEVEL = 0.07;
// Rain is four layers: a soft roof rumble, the hiss of the sheet of rain,
// the patter of drops hitting things, and bigger drops off the eaves.
const RAIN_LEVEL = { rumble: 0.06, sheet: 0.05, patter: 0.13, drops: 0.07 };
const WAVE_LEVEL = 0.06;
const FIRE_LEVEL = { roar: 0.05, crackle: 0.08 };
const HOWL_LEVEL = 0.035;
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

    // Loop a buffer through a filter into its own gain.
    const loop = (buffer, rate, filters) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let node = src;
      gain.filters = filters.map(([type, freq, q = 0.7]) => {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        node.connect(f);
        node = f;
        return f;
      });
      node.connect(gain).connect(this.master);
      src.start(t, Math.random() * buffer.duration);
      this.sources.push(src);
      return gain;
    };
    this.sources = [];
    const white = texture(ctx, 'white', whiteNoise);
    // Only the textures this theme uses, to spare the phone's battery.
    const uses = (k) => Object.values(this.theme.moods).some(m => m[k]);
    this.layers = {};
    if (uses('rain')) {
      this.layers.rumble = loop(noise, 0.6, [['lowpass', 700], ['highpass', 160]]);
      this.layers.sheet = loop(white, 1, [['bandpass', 3800, 0.4], ['lowpass', 9000]]);
      this.layers.patter = loop(texture(ctx, 'patter', RAIN_PATTER), 1, [['highpass', 900]]);
      this.layers.drops = loop(texture(ctx, 'drops', RAIN_DROPS), 1, [['bandpass', 1100, 0.6]]);
    }
    // Surf on a beach: a steady wash, swelled by each wave.
    if (uses('waves')) this.layers.wash = loop(white, 0.8, [['lowpass', 900], ['highpass', 180]]);
    // A campfire: a low roar and the crackle.
    if (uses('fire')) {
      this.layers.roar = loop(noise, 0.45, [['lowpass', 500], ['highpass', 150]]);
      this.layers.crackle = loop(texture(ctx, 'crackle', FIRE_CRACKLE), 1, [['highpass', 700]]);
    }
    // Winter wind whistling round the corners; its pitch drifts like wind
    // through a gap.
    if (uses('howl')) {
      this.layers.howl = loop(white, 1, [['bandpass', 650, 9]]);
      const whistle = ctx.createOscillator();
      const whistleDepth = ctx.createGain();
      whistle.frequency.value = 0.05;
      whistleDepth.gain.value = 220;
      whistle.connect(whistleDepth).connect(this.layers.howl.filters[0].frequency);
      whistle.start();
      this.sources.push(whistle);
    }

    this.sources.push(swell, windSrc, gust, ...this.padVoices);
    const now = ctx.currentTime;
    this.next = { note: now + 1.5, cricket: now + 2, bird: now + 4, beat: now + 1, owl: now + 6, drip: now + 3, toll: now + 5, thunder: now + 10, gust: now + 4, wave: now + 1, wolf: now + 8, gong: now + 6, moktak: now + 12, gull: now + 5 };
    this.setLayers(0.1);
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
    this.setLayers(1.2);
  }

  // Bring each texture to the level the mood asks for.
  setLayers(tc) {
    const m = this.mood;
    const t = this.ctx.currentTime;
    const rain = m.rain || 0;
    const target = {
      rumble: RAIN_LEVEL.rumble * rain,
      sheet: RAIN_LEVEL.sheet * rain,
      patter: RAIN_LEVEL.patter * Math.min(rain, 1.3),
      drops: RAIN_LEVEL.drops * Math.min(rain, 1),
      wash: WAVE_LEVEL * (m.waves || 0) * 0.5,
      roar: FIRE_LEVEL.roar * (m.fire || 0),
      crackle: FIRE_LEVEL.crackle * (m.fire || 0),
      howl: HOWL_LEVEL * (m.howl || 0)
    };
    for (const [k, v] of Object.entries(target)) this.layers[k]?.gain.setTargetAtTime(v, t, tc);
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
      this.next.thunder += m.thunder === 2 ? rand(12, 26) : rand(22, 45);
    }
    if (this.next.gust < ahead) {
      // The rain thickens and thins as the wind pushes it about.
      if (m.rain) this.rainGust(this.next.gust, m.gusts ? rand(1.3, 1.9) : rand(0.8, 1.25));
      this.next.gust += rand(3, 7);
    }
    if (this.next.wave < ahead) {
      if (m.waves) this.wave(this.next.wave, m.waves);
      this.next.wave += rand(6.5, 11);
    }
    if (this.next.wolf < ahead) {
      if (m.wolves) this.wolf(this.next.wolf);
      this.next.wolf += rand(18, 35);
    }
    if (this.next.gong < ahead) {
      if (m.gong) this.gong(this.next.gong);
      this.next.gong += rand(20, 34);
    }
    if (this.next.moktak < ahead) {
      if (m.moktak) this.moktak(this.next.moktak);
      this.next.moktak += rand(16, 28);
    }
    if (this.next.gull < ahead) {
      if (m.gulls) this.gull(this.next.gull);
      this.next.gull += rand(7, 14);
    }
    // The howl's whistle wanders.
    if (this.layers?.howl && Math.random() < 0.02) {
      const howl = this.layers.howl;
      howl.gain.setTargetAtTime(HOWL_LEVEL * (m.howl || 0) * rand(0.4, 1.3), t, 1.5);
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

  // Thunder: sometimes a near crack first, then a long rolling rumble made of
  // a few overlapping swells that fade out over several seconds.
  thunder(at) {
    const ctx = this.ctx;
    const near = Math.random() < 0.35;
    const out = ctx.createGain();
    out.gain.value = near ? 1.2 : 0.8;
    out.connect(this.master);
    if (near) {
      const crack = ctx.createBufferSource();
      crack.buffer = texture(ctx, 'white', whiteNoise);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const g = this.envelope(at, 0.09, 0.005, 0.35);
      crack.connect(hp).connect(g).connect(out);
      crack.start(at, Math.random() * 2);
      crack.stop(at + 0.5);
    }
    const rolls = 3 + Math.floor(Math.random() * 3);
    let when = at + (near ? 0.08 : 0);
    for (let i = 0; i < rolls; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = rand(0.25, 0.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(rand(500, 900), when);
      lp.frequency.exponentialRampToValueAtTime(220, when + 3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 90;
      const peak = (i === 0 ? 0.16 : rand(0.06, 0.12));
      const len = rand(2.2, 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + rand(0.15, 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      src.connect(lp).connect(hp).connect(g).connect(out);
      src.start(when, Math.random());
      src.stop(when + len + 0.1);
      when += rand(0.6, 1.6);
    }
  }

  // A gust: the rain swells for a few seconds and settles back.
  rainGust(at, amount) {
    const m = this.mood;
    const rain = m.rain || 0;
    ['sheet', 'patter'].forEach(k => {
      const g = this.layers[k]?.gain;
      if (!g) return;
      const base = RAIN_LEVEL[k] * Math.min(rain, k === 'patter' ? 1.3 : 9);
      g.setTargetAtTime(base * amount, at, 0.8);
      g.setTargetAtTime(base, at + rand(2, 4), 1.5);
    });
  }

  // One wave: the surf rises, breaks with a hiss, and draws back.
  wave(at, size) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = texture(ctx, 'white', whiteNoise);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(350, at);
    lp.frequency.exponentialRampToValueAtTime(rand(2200, 3200), at + 2.4);
    lp.frequency.exponentialRampToValueAtTime(400, at + 7);
    const g = ctx.createGain();
    const peak = WAVE_LEVEL * size * rand(0.7, 1.2);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 2.4);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, at + 3.4);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 7.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(at, Math.random() * 3);
    src.stop(at + 7.6);
  }

  // A wolf howling far away: rises, holds with a waver, falls off.
  wolf(at) {
    const ctx = this.ctx;
    const base = rand(330, 420);
    const len = rand(2.6, 3.6);
    const wolves = Math.random() < 0.4 ? 2 : 1;
    for (let w = 0; w < wolves; w++) {
      const start = at + w * rand(0.8, 1.6);
      const f0 = base * (w ? rand(1.12, 1.3) : 1);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.75, start);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, start + 0.6);
      o.frequency.setValueAtTime(f0 * 1.5, start + len * 0.7);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.95, start + len);
      const vib = ctx.createOscillator();
      const depth = ctx.createGain();
      vib.frequency.value = 5.5;
      depth.gain.value = f0 * 0.012;
      vib.connect(depth).connect(o.frequency);
      // A soft vowel: the sawtooth through a low-pass, so it is breathy.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      lp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.022, start + 0.5);
      g.gain.setValueAtTime(0.022, start + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
      o.connect(lp).connect(g);
      g.connect(this.master);
      g.connect(this.echo);
      o.start(start);
      vib.start(start);
      o.stop(start + len + 0.1);
      vib.stop(start + len + 0.1);
    }
  }

  // A temple gong: inharmonic partials with a long shimmer.
  gong(at) {
    const ctx = this.ctx;
    const f = rand(196, 247);
    const g = this.envelope(at, 0.06, 0.01, 9);
    [[1, 1], [1.48, 0.6], [1.98, 0.45], [2.44, 0.3], [3.1, 0.18], [4.3, 0.1]].forEach(([ratio, level]) => {
      const o = ctx.createOscillator();
      const lg = ctx.createGain();
      o.frequency.setValueAtTime(f * ratio * 1.01, at);
      o.frequency.exponentialRampToValueAtTime(f * ratio, at + 1.5);
      lg.gain.value = level;
      o.connect(lg).connect(g);
      o.start(at);
      o.stop(at + 9.2);
    });
    g.connect(this.master);
    g.connect(this.echo);
  }

  // The wooden fish (mõ): a run of hollow knocks, slowing at the end.
  moktak(at) {
    const ctx = this.ctx;
    const f = rand(700, 820);
    const knocks = 5 + Math.floor(Math.random() * 5);
    let when = at;
    for (let i = 0; i < knocks; i++) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * 1.1, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.03);
      const g = this.envelope(when, 0.05, 0.002, 0.09);
      o.connect(g).connect(this.master);
      o.start(when);
      o.stop(when + 0.12);
      when += i < knocks - 2 ? 0.55 : 0.8;
    }
  }

  // A gull's cry: a couple of falling squawks.
  gull(at) {
    const ctx = this.ctx;
    const cries = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cries; i++) {
      const start = at + i * rand(0.35, 0.5);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = rand(1400, 1700);
      o.frequency.setValueAtTime(f, start);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, start + 0.28);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2000;
      bp.Q.value = 3;
      const g = this.envelope(start, 0.012, 0.03, 0.28);
      o.connect(bp).connect(g).connect(this.master);
      o.start(start);
      o.stop(start + 0.35);
    }
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
