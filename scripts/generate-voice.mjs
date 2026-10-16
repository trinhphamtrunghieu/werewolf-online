// Generate the narrator's MP3 clips from public/shared/voice-lines.js.
//
// Uses edge-tts (free, no API key, Microsoft neural Vietnamese voices):
//   pip install edge-tts
//   npm run voice                       # default: vi-VN-NamMinhNeural (giọng nam trầm)
//   VOICE=vi-VN-HoaiMyNeural npm run voice   # giọng nữ
//   FORCE=1 npm run voice               # regenerate files that already exist
//
// You can also record your own voice: save files with the same names into
// public/audio/ and run `node scripts/generate-voice.mjs --manifest-only`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LINES, audioFileName } from '../public/shared/voice-lines.js';

const run = promisify(execFile);
const outDir = fileURLToPath(new URL('../public/audio/', import.meta.url));
const voice = process.env.VOICE || 'vi-VN-NamMinhNeural';
const force = process.env.FORCE === '1';
const manifestOnly = process.argv.includes('--manifest-only');

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

async function main() {
  await mkdir(outDir, { recursive: true });
  if (!manifestOnly) {
    let made = 0;
    for (const [key, variants] of Object.entries(LINES)) {
      for (let v = 0; v < variants.length; v++) {
        const file = outDir + audioFileName(key, v);
        if (existsSync(file) && !force) continue;
        const { rate, pitch } = prosody(key);
        const args = ['--voice', voice, `--rate=${rate}`, `--pitch=${pitch}`, '--text', variants[v], '--write-media', file];
        if (process.env.HTTPS_PROXY) args.push('--proxy', process.env.HTTPS_PROXY);
        await run('edge-tts', args);
        made++;
        process.stdout.write(`\r${made} file(s) generated: ${audioFileName(key, v)}           `);
      }
    }
    console.log(`\nDone with voice ${voice}.`);
  }
  const files = (await readdir(outDir)).filter(f => f.endsWith('.mp3')).sort();
  await writeFile(outDir + 'manifest.json', JSON.stringify({ voice, files }, null, 2) + '\n');
  console.log(`manifest.json lists ${files.length} clip(s).`);
}

main().catch(err => {
  if (err.code === 'ENOENT') {
    console.error('Không tìm thấy lệnh edge-tts. Hãy cài: pip install edge-tts');
  } else {
    console.error(err.stderr || err.message);
  }
  process.exit(1);
});
