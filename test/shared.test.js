// The small helpers shared by the browser and the server (public/shared).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, stepInfo, balanceLabel, balanceRoles, validateRoleCounts, emptyRoleCounts
} from '../public/shared/roles.js';
import {
  lineText, audioFileName, gapAfter, estimateSpeechMs, clipMs, narrationMs, pauseClip, CLIP_GAP_MS, TIGHT_GAP_MS
} from '../public/shared/voice-lines.js';
import { sameWord, autoUndercovers } from '../public/shared/undercover.js';
import { gameInfo } from '../public/shared/games.js';

test('night step info, and the balance label for every range', () => {
  assert.equal(stepInfo('seer'), ROLES.seer);
  assert.equal(stepInfo('nobody'), null);
  assert.equal(balanceLabel(6), 'nghiêng nhiều về phe Dân');
  assert.equal(balanceLabel(3), 'hơi nghiêng về phe Dân');
  assert.equal(balanceLabel(0), 'cân bằng');
  assert.equal(balanceLabel(-3), 'hơi nghiêng về phe Sói');
  assert.equal(balanceLabel(-6), 'nghiêng nhiều về phe Sói');
});

test('picked roles: Werewolf, Villager and unknown ids are ignored, the Masons come as a pair', () => {
  const c = balanceRoles(['werewolf', 'villager', 'nope', 'mason', 'seer'], 8);
  assert.equal(c.mason, 2);
  assert.equal(c.seer, 1);
  assert.equal(c.nope, undefined);
  assert.equal(validateRoleCounts(c, 8), null);
  assert.deepEqual(balanceRoles([], 0), emptyRoleCounts());
});

test('role counts: one card per special role', () => {
  const c = { ...emptyRoleCounts(), werewolf: 1, seer: 2, villager: 2 };
  assert.match(validateRoleCounts(c, 5), /Chỉ được có 1 lá Tiên Tri/);
});

test('narrator lines: text, file names, gaps and lengths', () => {
  assert.equal(lineText('nope'), '');
  assert.equal(lineText('seat_3', 9), lineText('seat_3', 0), 'a missing variant falls back to the first');
  assert.equal(audioFileName('seat_3'), 'seat_3_0.mp3');
  assert.equal(audioFileName('night_start', 2), 'night_start_2.mp3');
  const a = { k: 'night_start', v: 0, t: 'x' };
  assert.equal(gapAfter(a, null), 0);
  assert.equal(gapAfter(a, pauseClip(100)), 0);
  assert.equal(gapAfter(a, { k: 'seat_2' }), TIGHT_GAP_MS);
  assert.equal(gapAfter(a, { k: 'morning_peace' }), CLIP_GAP_MS);
  assert.equal(estimateSpeechMs(), 300);
  assert.ok(estimateSpeechMs('A, b... c! d.') > estimateSpeechMs('A b c d'));
  assert.equal(clipMs(pauseClip(1234)), 1234);
  // A clip with no recorded file is timed from its text.
  assert.equal(clipMs({ k: 'unknown', v: 0, t: 'Xin chào' }), estimateSpeechMs('Xin chào'));
  assert.equal(narrationMs([pauseClip(10), pauseClip(20)]), 30);
});

test('Undercover helpers and game info fallback', () => {
  assert.ok(sameWord('  Cà  Phê ', 'cà phê'));
  assert.ok(sameWord(undefined, null));
  assert.ok(!sameWord('cà phê', 'ca phe'));
  assert.equal(autoUndercovers(6), 1);
  assert.equal(autoUndercovers(7), 2);
  assert.equal(gameInfo('nope').id, 'werewolf');
});
