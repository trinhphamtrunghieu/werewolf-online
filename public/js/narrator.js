// Narrator voice for the host device.
//
// 1. Prefer pre-recorded MP3 clips listed in /audio/manifest.json (generated with
//    `npm run voice`, or your own recordings). These sound natural and identical
//    on every phone.
// 2. Fall back to the browser's speech engine with the best Vietnamese voice
//    available, paced with real pauses at "...", commas and sentence ends.

import { audioFileName, gapAfter, clipMs, PLAYBACK_LEAD_MS } from '/shared/voice-lines.js';
import { Ambience } from './ambience.js';

// How late a line read by the browser's speech engine may still start.
const TTS_LATE_MS = 2500;

const PREFERRED_VOICE = /(natural|online|neural|hoaimy|namminh|google|linh|an\b)/i;

export class Narrator {
  constructor() {
    this.files = new Set();
    this.voice = null;
    this.unlocked = false;
    // Narrations are identified by their server timestamp (`at`), which keeps
    // increasing across games (a sequence number restarts with each new game).
    this.lastAt = 0;
    this.runId = 0;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.ctx = null;
    this.ambience = null;
    this.onState = () => {};
    this.speaking = false;
  }

  async init() {
    try {
      const res = await fetch('/audio/manifest.json', { cache: 'no-cache' });
      if (res.ok) {
        const manifest = await res.json();
        (manifest.files || []).forEach(f => this.files.add(f));
      }
    } catch {
      // No generated audio yet: speech synthesis fallback only.
    }
    if ('speechSynthesis' in window) {
      this.pickVoice();
      speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  pickVoice() {
    const voices = speechSynthesis.getVoices() || [];
    const vi = voices.filter(v => /^vi/i.test(v.lang));
    this.voice = vi.find(v => PREFERRED_VOICE.test(v.name)) || vi[0] || null;
    this.onState();
  }

  get hasRecordedVoice() { return this.files.size > 0; }
  get hasVietnameseVoice() { return this.hasRecordedVoice || !!this.voice; }

  // Must run inside a user gesture (tap) so mobile browsers allow audio later.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.audio.src = silentWavUrl();
      this.audio.play().catch(() => {});
    } catch {}
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    this.audioContext();
    if (this.wantAmbience) this.setAmbience(true);
    this.prefetch();
    this.onState();
  }

  // Warm the HTTP cache so each clip starts instantly instead of waiting on
  // the network mid-sentence.
  async prefetch() {
    for (const file of this.files) {
      try { await fetch(`/audio/${file}`); } catch { return; }
    }
  }

  audioContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Play each narration from the room state once. `serverNow` lets us skip a
  // narration that is already over (e.g. the phone was asleep), so a stale
  // line never talks over the current one.
  //
  // Playback is pinned to the server clock: it starts at `at + PLAYBACK_LEAD_MS`,
  // and a phone that gets the update late (or opens mid-narration) jumps to
  // the part being read right now, so all speaking phones stay together.
  handle(narration, { replay = false, serverNow = Date.now() } = {}) {
    if (!narration) return;
    if (!replay) {
      if (narration.at <= this.lastAt) return;
      if (narration.endsAt && serverNow > narration.endsAt - 1000) {
        this.lastAt = narration.at; // already over: stay quiet
        return;
      }
    }
    if (!this.unlocked) return;
    this.lastAt = Math.max(this.lastAt, narration.at);
    const offset = replay ? 0 : serverNow - (narration.at + PLAYBACK_LEAD_MS);
    this.play(narration.clips, offset);
  }

  stop() {
    this.runId++;
    try { this.audio.pause(); } catch {}
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.setSpeaking(false);
  }

  setSpeaking(on) {
    this.speaking = on;
    this.duckAmbience(on);
    this.onState();
  }

  // `offsetMs` < 0: start that much later. > 0: start that far in.
  // Every clip has a fixed start time on this timeline (the same lengths and
  // pauses the server uses), so a phone whose voice runs a little long or
  // short catches up at the next clip instead of drifting from the others.
  async play(clips, offsetMs = 0) {
    this.stop();
    const run = this.runId;
    this.setSpeaking(true);
    let clipStart = Date.now() - offsetMs; // local time the current clip is due
    for (let i = 0; i < clips.length; i++) {
      if (run !== this.runId) return;
      const clip = clips[i];
      const length = clipMs(clip);
      const due = clipStart;
      clipStart += length + gapAfter(clip, clips[i + 1]);
      if (Date.now() < due) await wait(due - Date.now());
      if (run !== this.runId) return;
      const into = Date.now() - due;
      if (into >= length - 150) continue; // missed this clip
      const file = audioFileName(clip.k, clip.v);
      if (clip.ms != null) {
        // A deliberate silent beat: the wait for the next clip covers it.
      } else if (this.files.has(file)) {
        await this.playFile(`/audio/${file}`, run, into / 1000).catch(() => this.speak(clip.t, run));
      } else if (into < TTS_LATE_MS) {
        // Browser speech can't start mid-sentence: read it from the top, a
        // little behind; the next clip lines up again.
        await this.speak(clip.t, run);
      }
    }
    if (Date.now() < clipStart) await wait(clipStart - Date.now());
    if (run === this.runId) this.setSpeaking(false);
  }

  playFile(src, run, startSec = 0) {
    return new Promise((resolve, reject) => {
      if (run !== this.runId) return resolve();
      const a = this.audio;
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('audio')); };
      const cleanup = () => {
        a.removeEventListener('ended', done);
        a.removeEventListener('error', failed);
      };
      a.addEventListener('ended', done);
      a.addEventListener('error', failed);
      a.src = src;
      if (startSec > 0.05) {
        a.addEventListener('loadedmetadata', () => { a.currentTime = startSec; }, { once: true });
      }
      a.play().catch(failed);
    });
  }

  // Speech synthesis with storyteller pacing: split on "...", sentence ends and
  // commas so the engine pauses where a human narrator would.
  async speak(text, run) {
    if (!('speechSynthesis' in window) || !text) return;
    const parts = text
      .split(/(\.\.\.|…|[.!?](?=\s)|[.!?]$|,)/)
      .reduce((acc, piece) => {
        if (/^(\.\.\.|…|[.!?,])$/.test(piece) && acc.length) acc[acc.length - 1].mark = piece;
        else if (piece.trim()) acc.push({ text: piece.trim(), mark: '' });
        return acc;
      }, []);
    for (const part of parts) {
      if (run !== this.runId) return;
      const ending = part.mark === '!' ? '!' : part.mark === '?' ? '?' : '';
      await this.utter(part.text + ending, ending);
      const pause = part.mark === '...' || part.mark === '…' ? 520
        : part.mark === ',' ? 140
        : part.mark ? 300 : 80;
      await wait(pause);
    }
  }

  utter(text, ending) {
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'vi-VN';
      if (this.voice) u.voice = this.voice;
      // Slightly slow and low for suspense; lift on calls and questions.
      u.rate = ending === '!' ? 0.98 : 0.9;
      u.pitch = ending === '?' ? 1.05 : ending === '!' ? 1.08 : 0.95;
      let settled = false;
      const finish = () => { if (!settled) { settled = true; clearTimeout(guard); resolve(); } };
      // Some browsers never fire onend; never block the narration forever.
      const guard = setTimeout(finish, 1500 + text.length * 120);
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }

  // ---------- Sound effects & ambience (Web Audio, no files needed) ----------

  sfx(type) {
    const ctx = this.unlocked && this.audioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const tone = (freq, start, dur, wave = 'sine', vol = 0.15, endFreq) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(freq, now + start);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, now + start + dur);
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(vol, now + start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      o.connect(g).connect(ctx.destination);
      o.start(now + start);
      o.stop(now + start + dur + 0.05);
    };
    if (type === 'night') {
      tone(293.66, 0, 1.6, 'sine', 0.12, 196);
      tone(220, 0.25, 1.8, 'triangle', 0.06, 146.8);
    } else if (type === 'morning') {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.18, 1.2, 'triangle', 0.09));
    } else if (type === 'gavel') {
      tone(150, 0, 0.3, 'square', 0.08, 60);
      tone(150, 0.35, 0.3, 'square', 0.08, 60);
    } else if (type === 'tick') {
      // Wood-block style click for the last seconds of a timer.
      tone(1250, 0, 0.07, 'square', 0.05, 900);
    } else if (type === 'tickFinal') {
      tone(1700, 0, 0.1, 'square', 0.07, 1300);
    }
  }

  // Background soundscape. `on` can be set before audio is unlocked; it
  // starts on the first tap that unlocks audio.
  setAmbience(on, mood = this.mood) {
    this.wantAmbience = on;
    this.mood = mood || 'night';
    if (!this.unlocked) return;
    const ctx = this.audioContext();
    if (!ctx) return;
    if (on) {
      if (!this.ambience) this.ambience = new Ambience(ctx);
      this.ambience.setVolume(this.ambienceVolume ?? 0.6);
      this.ambience.start(this.mood);
      this.ambience.duck(this.speaking);
    } else {
      this.ambience?.stop();
    }
  }

  setMood(mood) {
    this.mood = mood;
    this.ambience?.setMood(mood);
  }

  setAmbienceVolume(v) {
    this.ambienceVolume = v;
    this.ambience?.setVolume(v);
  }

  duckAmbience(speaking) {
    this.ambience?.duck(speaking);
  }
}

// 50 ms of silence, played inside the unlock tap so iOS lets this element play later.
function silentWavUrl() {
  const samples = 400;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}
