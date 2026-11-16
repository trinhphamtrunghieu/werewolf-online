// "Hết giờ thì chọn ngẫu nhiên": a role that must pick someone each night
// and lets its time run out gets a random pick (on by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, AUTO_PICK_RULE } from '../lib/engine.js';
import { setup, notes } from './helpers.js';

const on = { config: { autoPick: true } };
const PICKED = /Hết giờ mà bạn chưa chọn/;

test('on by default, and the rule is in the log as the game starts', () => {
  const { state } = createRoom({ code: 'AUTO1', hostName: 'Chủ', now: 0 });
  assert.equal(state.config.autoPick, true);
  const { s } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager'], [], on);
  assert.ok(s.game.log.some(l => l.includes(AUTO_PICK_RULE)));
  const off = setup(['werewolf', 'villager', 'villager', 'villager', 'villager']);
  assert.ok(!off.s.game.log.some(l => l.includes(AUTO_PICK_RULE)));
});

test('out of time: the pack bites, the Seer looks and the Guard protects, at random', () => {
  const { s, P, untilPhase } = setup(['werewolf', 'seer', 'guard', 'villager', 'villager', 'villager', 'witch'], [], on);
  untilPhase('MORNING');
  const n = s.game.night;
  assert.equal(n.wolfTargets.length, 1);
  assert.notEqual(n.wolfTargets[0], P[0].id, 'never a wolf');
  assert.ok(n.seerTarget && n.seerTarget !== P[1].id);
  assert.match(notes(s, P[1]), /Bạn soi/);
  // No guarding oneself on the first night.
  assert.ok(n.guard && n.guard !== P[2].id);
  for (const p of [P[0], P[1], P[2]]) assert.match(notes(s, p), PICKED);
  // The Witch's potions are not spent for her.
  assert.equal(n.heal, false);
  assert.equal(n.poison, null);
  assert.doesNotMatch(notes(s, P[6]), PICKED);
  assert.ok(s.game.log.some(l => l.includes('⏱️ Ma Sói: hết giờ')));
});

test('a pass, a "nobody" or a pick made in time is kept', () => {
  const { s, P, act, untilPhase, untilNightRole } = setup(['werewolf', 'seer', 'villager', 'villager', 'villager'], [], on);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilNightRole('seer');
  act(P[1], 'seerDone');
  untilPhase('MORNING');
  assert.deepEqual(s.game.night.wolfTargets, []);
  assert.equal(s.game.night.seerTarget, null);
  assert.doesNotMatch(notes(s, P[0]) + notes(s, P[1]), PICKED);
});

test('a wolf who picked then dropped it leaves the pack undecided: the game bites', () => {
  const { s, P, act, untilPhase, untilNightRole } = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager'], [], on);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[2].id });
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(s.game.night.wolfTargets.length, 1);
  assert.ok(![P[0].id, P[1].id].includes(s.game.night.wolfTargets[0]));
});

test('a revenge night gets two bites; the Prism keeps the bite to its three', () => {
  const two = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'], [], on);
  two.untilNightRole('werewolf');
  two.s.game.night.wolfKills = 2;
  two.untilPhase('MORNING');
  assert.equal(two.s.game.night.wolfTargets.length, 2);

  const prism = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'], [], on);
  prism.untilNightRole('werewolf');
  prism.s.game.art.prism = { day: prism.s.game.day - 1, ids: [prism.P[4].id, prism.P[0].id] };
  prism.untilPhase('MORNING');
  assert.deepEqual(prism.s.game.night.wolfTargets, [prism.P[4].id]);
});

test('roles that pick two get the rest filled in', () => {
  const { s, P, act, untilPhase, untilNightRole } = setup(
    ['werewolf', 'detective', 'piper', 'cupid', 'hoodlum', 'villager', 'villager', 'villager'], [], on);
  untilNightRole('cupid');
  untilNightRole('detective');
  act(P[1], 'night', { target: P[5].id });
  untilPhase('MORNING');
  const g = s.game;
  assert.equal(g.lovers.length, 2);
  assert.equal(g.hoodlumMarks.length, 2);
  assert.ok(!g.hoodlumMarks.includes(P[4].id));
  assert.equal(g.charmed.length, 2);
  assert.ok(!g.charmed.includes(P[2].id));
  assert.equal(g.night.detectivePicks.length, 2);
  assert.ok(g.night.detectivePicks.includes(P[5].id), 'the pick made in time stays');
});

test('the Hunter and the Avenger get an aim, and keep the one they had', () => {
  const { s, P, untilPhase } = setup(['werewolf', 'hunter', 'avenger', 'villager', 'villager', 'villager', 'villager'], [], on);
  untilPhase('MORNING');
  const aim = s.game.hunterAim;
  assert.ok(aim && aim !== P[1].id);
  assert.ok(s.game.avengerTarget && s.game.avengerTarget !== P[2].id);
  const avenged = s.game.avengerTarget;
  untilPhase('NIGHT');
  untilPhase('MORNING');
  assert.equal(s.game.hunterAim, aim);
  assert.equal(s.game.avengerTarget, avenged);
});

test('nothing is picked for a powerless village, a dead holder, or when every choice is refused', () => {
  const lost = setup(['werewolf', 'seer', 'villager', 'villager', 'villager'], [], on);
  lost.untilNightRole('werewolf');
  lost.s.game.powersLost = true;
  lost.untilPhase('MORNING');
  assert.equal(lost.s.game.night.seerTarget, null);

  const dead = setup(['werewolf', 'seer', 'villager', 'villager', 'villager'], [], on);
  dead.untilNightRole('werewolf');
  dead.P[1].alive = false;
  dead.untilPhase('MORNING');
  assert.equal(dead.s.game.night.seerTarget, null);

  // The Pháp Sư Phong Ấn has already muted everyone else once.
  const spell = setup(['werewolf', 'spellcaster', 'villager', 'villager', 'villager'], [], on);
  spell.untilNightRole('werewolf');
  spell.s.game.mutedEver = spell.P.filter(p => p.id !== spell.P[1].id).map(p => p.id);
  spell.untilPhase('MORNING');
  assert.equal(spell.s.game.night.mute, null);
  assert.doesNotMatch(notes(spell.s, spell.P[1]), PICKED);
});
