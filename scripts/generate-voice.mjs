// Generate the narrator's MP3 clips from public/shared/voice-lines.js.
//
// Uses edge-tts (free, no API key, Microsoft neural Vietnamese voices):
//   pip install edge-tts
//   npm run voice                       # default: vi-VN-NamMinhNeural (giọng nam trầm)
//   VOICE=vi-VN-HoaiMyNeural npm run voice   # giọng nữ
//   FORCE=1 npm run voice               # regenerate files that already exist
//
// New clips have their leading/trailing silence trimmed with ffmpeg (if it is
// installed), then every clip's length is written to
// public/shared/voice-durations.js. The game server uses those lengths so it
// never moves on while the narrator is still talking.
//
// You can also record your own voice: save files with the same names into
// public/audio/ and run `node scripts/generate-voice.mjs --manifest-only`.
// Add --trim to also trim silence from every existing clip (do it once).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LINES, audioFileName } from '../public/shared/voice-lines.js';

const run = promisify(execFile);
const outDir = fileURLToPath(new URL('../public/audio/', import.meta.url));
const durationsFile = fileURLToPath(new URL('../public/shared/voice-durations.js', import.meta.url));
const force = process.env.FORCE === '1';
const manifestOnly = process.argv.includes('--manifest-only');
const trimAll = process.argv.includes('--trim');

// Per-line delivery: slower and lower for night calls, brighter for mornings
// and victories. edge-tts only accepts rate/pitch/volume, so the emotion comes
// from these plus the punctuation in the script.
function prosody(key) {
  if (key.startsWith('seat_') || key === 'and') return { rate: '-5%', pitch: '-2Hz' };
  if (key.endsWith('_wake') || key === 'night_start') return { rate: '-14%', pitch: '-6Hz' };
  if (key.endsWith('_sleep')) return { rate: '-10%', pitch: '-4Hz' };
  if (key === 'morning_peace' || key.startsWith('win_')) return { rate: '-4%', pitch: '+2Hz' };
  if (key === 'morning_deaths' || key === 'lover_death' || key === 'verdict_kill') return { rate: '-12%', pitch: '-5Hz' };
  return { rate: '-8%', pitch: '-2Hz' };
}

async function hasTool(name) {
  try {
    await run(name, ['-version']);
    return true;
  } catch {
    return false;
  }
}

// Cut the dead air edge-tts leaves at both ends (often 0.5 s or more), so
// "người chơi số ba ... và ... người chơi số năm" flows as one sentence.
// Pauses inside a line ("...") are kept.
async function trimSilence(file) {
  const tmp = file.replace(/\.mp3$/, '.trim.mp3');
  const filter = [
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08',
    'areverse'
  ].join(',');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', filter, '-ar', '24000', '-ac', '1', '-b:a', '48k', tmp]);
  await rename(tmp, file);
}

async function durationMs(file, ffprobe) {
  if (ffprobe) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    return Math.round(Number(stdout.trim()) * 1000);
  }
  // edge-tts and our ffmpeg pass both write 48 kbps constant-bitrate MP3.
  return Math.round(((await stat(file)).size * 8) / 48);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const manifestPath = outDir + 'manifest.json';
  const previous = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
  const voice = process.env.VOICE || previous.voice || 'vi-VN-NamMinhNeural';
  const ffmpeg = await hasTool('ffmpeg');
  const ffprobe = await hasTool('ffprobe');
  if (!ffmpeg) console.warn('Không có ffmpeg: bỏ qua bước cắt khoảng lặng.');

  const made = [];
  if (!manifestOnly) {
    for (const [key, variants] of Object.entries(LINES)) {
      for (let v = 0; v < variants.length; v++) {
        const name = audioFileName(key, v);
        const file = outDir + name;
        if (existsSync(file) && !force) continue;
        const { rate, pitch } = prosody(key);
        const args = ['--voice', voice, `--rate=${rate}`, `--pitch=${pitch}`, '--text', variants[v], '--write-media', file];
        if (process.env.HTTPS_PROXY) args.push('--proxy', process.env.HTTPS_PROXY);
        await run('edge-tts', args);
        made.push(name);
        process.stdout.write(`\r${made.length} file(s) generated: ${name}           `);
      }
    }
    console.log(`\nDone with voice ${voice}.`);
  }

  const files = (await readdir(outDir)).filter(f => f.endsWith('.mp3')).sort();
  if (ffmpeg) {
    const toTrim = trimAll ? files : made;
    for (const name of toTrim) await trimSilence(outDir + name);
    if (toTrim.length) console.log(`Trimmed silence from ${toTrim.length} clip(s).`);
  }

  const durations = {};
  for (const name of files) durations[name.replace(/\.mp3$/, '')] = await durationMs(outDir + name, ffprobe);
  await writeFile(manifestPath, JSON.stringify({ voice, files }, null, 2) + '\n');
  await writeFile(durationsFile, [
    '// Generated by scripts/generate-voice.mjs: length in ms of each clip in public/audio.',
    '// The server uses these so a phase never ends while the narrator is still talking.',
    `export const CLIP_MS = ${JSON.stringify(durations, null, 2)};`,
    ''
  ].join('\n'));
  console.log(`manifest.json and voice-durations.js list ${files.length} clip(s).`);
}

main().catch(err => {
  if (err.code === 'ENOENT') {
    console.error('Không tìm thấy lệnh edge-tts. Hãy cài: pip install edge-tts');
  } else {
    console.error(err.stderr || err.message);
  }
  process.exit(1);
});
