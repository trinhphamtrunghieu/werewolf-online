// Corner cases of the Ma Sói engine: room limits, the host vote, rarely used
// roles at night, bots playing every role, and what each viewer is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, applyAction, tick, viewFor, isWinner, cleanName, GameError, resolveHostVote, HOST_TIMEOUT_MS, HOST_VOTE_MS
} from '../lib/engine.js';
import { MAX_PLAYERS } from '../public/shared/roles.js';
import { setup, seeded, notes } from './helpers.js';

const fails = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));
const wolf = (roles, opts = {}) => setup(roles, [], { ...opts, config: { artifacts: false, ...(opts.config || {}) } });
const logText = (s) => s.game.log.join('\n');

test('names, a full room, a name already taken, and an unknown player', () => {
  fails(() => cleanName(), /nhập tên/);
  const rng = seeded(1);
  const { state: s, player: host } = createRoom({ code: 'FULL1', hostName: 'Chủ', now: 0, rng });
  fails(() => applyAction(s, 'nobody', 'start', {}, 0), /không còn ở trong phòng/);
  applyAction(s, host.id, 'addBot', { count: MAX_PLAYERS }, 0, rng);
  fails(() => joinRoom(s, 'Khách', 0, rng), /Phòng đã đầy/);
  const { state: t2 } = createRoom({ code: 'NAME1', hostName: 'Chủ', now: 0, rng });
  joinRoom(t2, 'Mai', 0, rng, { isBot: true });
  fails(() => joinRoom(t2, 'Mai', 0, rng), /đã có người dùng/);
  // A human whose old seat has gone quiet gets it back.
  const { state: r } = createRoom({ code: 'BACK1', hostName: 'Chủ', now: 0, rng });
  const lan = joinRoom(r, 'Lan', 0, rng);
  fails(() => joinRoom(r, 'lan', 1000, rng), /chờ khoảng/);
  assert.equal(joinRoom(r, 'LAN', 60_000, rng).id, lan.id);
});

test('starting needs enough players and not too many; other games have their own limits', () => {
  const rng = seeded(2);
  const { state: s, player: host } = createRoom({ code: 'LIM01', hostName: 'Chủ', now: 0, rng });
  fails(() => applyAction(s, host.id, 'start', {}, 0, rng), /ít nhất/);
  applyAction(s, host.id, 'addBot', { count: MAX_PLAYERS }, 0, rng);
  fails(() => applyAction(s, host.id, 'start', {}, 0, rng), /Tối đa/);
  applyAction(s, host.id, 'selectGame', { gameId: 'spyfall' }, 0, rng);
  fails(() => applyAction(s, host.id, 'start', {}, 0, rng), /tối đa/);
});

test('the host vote: no ballots, a bad candidate, and the clock', () => {
  const rng = seeded(3);
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'HV001', hostName: 'Chủ', now, rng });
  const a = joinRoom(s, 'An', now, rng);
  const b = joinRoom(s, 'Bình', now, rng);
  joinRoom(s, 'Chi', now, rng);
  now += HOST_TIMEOUT_MS + 1000;
  s.players.forEach(p => { if (p !== host) p.lastSeen = now; });
  // Nobody has voted yet (the room never had a vote).
  assert.equal(resolveHostVote(s, now, rng), false);
  assert.ok(viewFor(s, a.id, now, 1).hostOffline.votes);
  fails(() => applyAction(s, a.id, 'hostVote', { candidate: host.id }, now, rng), /đang kết nối/);
  fails(() => applyAction(s, a.id, 'hostVote', { candidate: 'nobody' }, now, rng), /đang kết nối/);
  applyAction(s, a.id, 'hostVote', { candidate: b.id }, now, rng);
  assert.equal(s.hostId, host.id, 'no majority yet');
  // A ballot from someone who went quiet does not count in the view.
  s.players.find(p => p.id === a.id).lastSeen = 0;
  assert.deepEqual(viewFor(s, b.id, now, 1).hostOffline.votes, {});
  s.players.find(p => p.id === a.id).lastSeen = now;
  now += HOST_VOTE_MS;
  s.players.forEach(p => { if (p !== host) p.lastSeen = now; });
  assert.equal(resolveHostVote(s, now, rng), true);
  assert.equal(s.hostId, b.id);
  assert.match(logText(s) || s.game.log.join(''), /thay cho Chủ/);
});

test('the log keeps the newest lines only', () => {
  const g = wolf(['werewolf', 'villager', 'villager', 'villager', 'seer']);
  g.s.game.log = Array.from({ length: 400 }, (_, i) => `dòng ${i}`);
  g.untilPhase('MORNING');
  assert.equal(g.s.game.log.length, 400);
  assert.notEqual(g.s.game.log[0], 'dòng 0');
});

test('the card swap: a thief traded away, and bots joining a person', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const { state: s, player: host } = createRoom({ code: 'SWP01', hostName: 'Chủ', now, rng });
    applyAction(s, host.id, 'addBot', { count: 8 }, now, rng);
    applyAction(s, host.id, 'config', { swapEnabled: true }, now, rng);
    for (const k of Object.keys(s.roleCounts)) s.roleCounts[k] = 0;
    Object.assign(s.roleCounts, { werewolf: 2, thief: 1, seer: 1, villager: 7 });
    applyAction(s, host.id, 'start', {}, now, rng);
    assert.equal(s.phase, 'SWAP');
    applyAction(s, host.id, 'swapJoin', {}, now, rng);
    now += 3000;
    tick(s, now, rng);
    now = s.game.phaseEndsAt;
    tick(s, now, rng);
    assert.notEqual(s.phase, 'SWAP');
  }
});

test('the Lone Wolf loses when the pack wins; lovers win together', () => {
  const g = wolf(['werewolf', 'lone_wolf', 'villager', 'villager', 'villager', 'seer', 'villager']);
  g.P.slice(2).forEach(p => { if (p !== g.P[2]) p.alive = false; });
  g.P[2].alive = true;
  g.untilPhase('GAME_OVER');
  assert.equal(g.s.game.winner, 'werewolf');
  assert.match(g.s.game.winReason, /Sói Đơn Độc thì thua/);
  assert.equal(isWinner(g.s, g.P[1]), false);

  const h = wolf(['werewolf', 'villager', 'villager', 'villager', 'seer']);
  h.s.game.lovers = [h.P[0].id, h.P[1].id];
  h.P[2].alive = false;
  h.P[3].alive = false;
  h.P[4].alive = false;
  h.untilPhase('GAME_OVER');
  assert.equal(h.s.game.winner, 'lovers');
  assert.ok(isWinner(h.s, h.P[0]) && isWinner(h.s, h.P[1]) && !isWinner(h.s, h.P[2]));
});

test('the game makes a couple even when only third-side players could pair', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = setup(['werewolf', 'fool', 'piper', 'villager', 'villager', 'villager'], [], { rng: seeded(seed), config: { artifacts: false, autoLovers: true } });
    assert.equal(g.s.game.lovers.length, 2);
  }
});

test('a clawed player counts on the pack side when the game pairs lovers', () => {
  const g = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'claw']);
  g.untilPhase('DISCUSSION');
  g.reveal(g.P[1]);
  g.s.game.lovers = [g.P[1].id, g.P[2].id];
  g.P[0].alive = false;
  g.P[3].alive = false;
  g.P[4].alive = false;
  g.untilPhase('GAME_OVER');
  assert.equal(g.s.game.winner, 'lovers');
});

test('a quick tap while a role is still being called', () => {
  // The guard (first called) picks before the call is over.
  const g = wolf(['guard', 'werewolf', 'villager', 'villager', 'seer']);
  assert.equal(g.s.game.nightStage, 'call');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.endPhase();
  assert.equal(g.s.game.nightStage, 'act');
  assert.ok(g.s.game.night.complete);
  // The pack (first called) agrees during the call.
  const h = wolf(['werewolf', 'villager', 'villager', 'villager', 'seer']);
  h.act(h.P[0], 'night', { target: h.P[2].id });
  h.endPhase();
  assert.equal(h.s.game.nightStage, 'act');
});

test('night notes and log lines for the Ultimate Werewolf roles, used and not', () => {
  const g = wolf(['werewolf', 'aura_seer', 'pi', 'sorcerer', 'martyr', 'spellcaster', 'old_hag', 'doppelganger', 'hoodlum', 'troublemaker', 'seer', 'villager']);
  const { P, act, untilNightRole } = g;
  untilNightRole('doppelganger');
  g.endPhase(); g.endPhase(); // out of time: picked for them
  untilNightRole('hoodlum');
  act(P[8], 'night', { target: P[1].id });
  act(P[8], 'night', { target: P[1].id }); // tap again: dropped
  act(P[8], 'night', { target: P[1].id });
  act(P[8], 'night', { target: P[2].id });
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[11].id });
  untilNightRole('martyr');
  act(P[4], 'night', { target: P[11].id });
  untilNightRole('aura_seer');
  act(P[1], 'night', { target: P[11].id });
  untilNightRole('pi');
  act(P[2], 'night', { target: P[11].id });
  untilNightRole('sorcerer');
  act(P[3], 'night', { target: P[10].id });
  untilNightRole('spellcaster');
  act(P[5], 'night', { target: P[11].id });
  untilNightRole('old_hag');
  act(P[6], 'night', { target: P[11].id });
  untilNightRole('troublemaker');
  act(P[9], 'troublemaker');
  g.untilPhase('MORNING');
  assert.match(notes(g.s, P[1]), /Dân Làng hoặc Ma Sói thường/);
  assert.match(notes(g.s, P[2]), /CÓ Sói/);
  assert.match(notes(g.s, P[3]), /ĐÚNG là Tiên Tri/);
  assert.match(notes(g.s, P[4]), /chết thay/);
  assert.match(notes(g.s, P[5]), /phong ấn/);
  assert.match(notes(g.s, P[6]), /đuổi/);
  assert.match(notes(g.s, P[7]), /quản trò chọn giúp/);
  assert.match(notes(g.s, P[8]), /Hai mục tiêu/);
  assert.match(notes(g.s, P[9]), /gây rối/);
  assert.match(logText(g.s), /tìm Tiên Tri ở .*: đúng/);
  // The Hoodlum sees their marks on the card.
  assert.equal(viewFor(g.s, P[8].id, 0, 1).me.hoodlumMarks.length, 2);
  // Night two: roles that pass.
  g.untilNightRole('aura_seer');
  act(P[1], 'endTurn');
  g.untilNightRole('sorcerer');
  act(P[3], 'night', { target: P[11].id });
  g.untilPhase('MORNING');
  assert.match(notes(g.s, P[1]), /không soi ai/);
  assert.match(notes(g.s, P[3]), /không phải/);
  assert.match(logText(g.s), /tìm Tiên Tri ở .*: sai/);
});

test('a night with nobody chosen by the Sorcerer and the P.I. finding no wolf', () => {
  const g = wolf(['werewolf', 'villager', 'villager', 'sorcerer', 'pi', 'villager', 'villager', 'seer']);
  g.untilNightRole('werewolf');
  g.act(g.P[0], 'night', { noKill: true });
  g.untilNightRole('pi');
  g.act(g.P[4], 'night', { target: g.P[6].id });
  g.untilPhase('MORNING');
  assert.match(notes(g.s, g.P[4]), /không có Sói/);
  assert.match(notes(g.s, g.P[3]), /không chọn ai/);
});

test('the Martyr dies for one of two victims on the Wolf Cub\'s night', () => {
  const g = wolf(['werewolf', 'wolf_cub', 'martyr', 'villager', 'villager', 'villager', 'villager', 'seer']);
  g.untilNightRole('werewolf');
  g.s.game.night.wolfKills = 2;
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.act(g.P[0], 'night', { target: g.P[4].id });
  g.act(g.P[1], 'night', { target: g.P[3].id });
  g.act(g.P[1], 'night', { target: g.P[4].id });
  g.act(g.P[1], 'night', { target: g.P[4].id }); // and changes their mind
  g.act(g.P[1], 'night', { target: g.P[4].id });
  g.untilNightRole('martyr');
  g.act(g.P[2], 'night', { target: g.P[4].id });
  assert.deepEqual(g.s.game.night.wolfTargets.sort(), [g.P[3].id, g.P[2].id].sort());
});

test('toggling picks: Piper, Cupid and Detective take a second tap back', () => {
  const g = wolf(['cupid', 'werewolf', 'piper', 'detective', 'villager', 'villager', 'seer']);
  g.untilNightRole('cupid');
  g.act(g.P[0], 'night', { target: g.P[4].id });
  g.act(g.P[0], 'night', { target: g.P[4].id });
  assert.deepEqual(g.s.game.night.cupid, []);
  g.untilNightRole('detective');
  g.act(g.P[3], 'night', { target: g.P[4].id });
  g.act(g.P[3], 'night', { target: g.P[4].id });
  assert.deepEqual(g.s.game.night.detectivePicks, []);
  g.untilNightRole('piper');
  g.act(g.P[2], 'night', { target: g.P[4].id });
  g.act(g.P[2], 'night', { target: g.P[4].id });
  assert.deepEqual(g.s.game.night.piperPicks, []);
});

test('wrong moves: night actions by day, a dead target, an unknown action', () => {
  const g = wolf(['werewolf', 'villager', 'villager', 'villager', 'seer']);
  g.untilPhase('DISCUSSION');
  fails(() => g.act(g.P[0], 'night', { target: g.P[1].id }), /ban đêm/);
  fails(() => g.act(g.P[0], 'dance'), /không hợp lệ/);
  g.untilPhase('VOTE');
  fails(() => g.act(g.P[0], 'vote', { target: 'nobody' }), /không hợp lệ/);
  g.P[2].alive = false;
  fails(() => g.act(g.P[0], 'vote', { target: g.P[2].id }), /không hợp lệ/);
  // Someone who is not seated at all sees the room but has no card.
  const v = viewFor(g.s, 'stranger', 0, 1);
  assert.equal(v.me, null);
  // A clock in a state the game does not know just stops.
  g.s.phase = 'ELSEWHERE';
  g.s.game.phaseEndsAt = 1;
  tick(g.s, g.clock.now, g.rng);
  assert.equal(g.s.game.phaseEndsAt, null);
});

test('the Ghost and the Old Man: the bitten Ghost leaves once; the Old Man dies of age', () => {
  const g = wolf(['werewolf', 'ghost', 'old_man', 'villager', 'villager', 'seer']);
  g.untilNightRole('werewolf');
  g.act(g.P[0], 'night', { target: g.P[1].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[1].alive, false);
  g.untilNightRole('werewolf');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'bitten on the night old age comes');
});

test('with the wolves gone but the Piper alive, the pack is still called and casts no votes', () => {
  const g = wolf(['werewolf', 'piper', 'villager', 'villager', 'villager', 'seer']);
  g.P[0].alive = false;
  g.untilNightRole('werewolf');
  g.untilPhase('MORNING');
  assert.ok(!logText(g.s).includes('🐺 Phiếu Sói'));
});

test('the Eye of the Beholder sees whom the Seer picks', () => {
  const g = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'eye']);
  g.untilPhase('DISCUSSION');
  g.reveal(g.P[1]);
  g.untilNightRole('seer');
  assert.deepEqual(viewFor(g.s, g.P[1].id, 0, 1).me.beholder, { target: null, wolf: null });
  g.act(g.P[4], 'night', { target: g.P[0].id });
  assert.deepEqual(viewFor(g.s, g.P[1].id, 0, 1).me.beholder, { target: g.P[0].id, wolf: true });
  g.endPhase();
  g.untilPhase('MORNING');
  assert.match(notes(g.s, g.P[1]), /LÀ Sói/);
});

test('a waiting Spear settled at the vote can end the game', () => {
  const g = setup(['werewolf', 'villager', 'villager', 'seer'], [null, 'spear'], {});
  g.untilPhase('DISCUSSION');
  g.P[2].alive = false;
  g.act(g.P[1], 'artReveal', { uid: 101 });
  g.endPhase();
  assert.equal(g.s.phase, 'GAME_OVER');
});

test('bots play every Ultimate Werewolf role to the end', () => {
  const roles = { werewolf: 2, lone_wolf: 1, aura_seer: 1, pi: 1, sorcerer: 1, blesser: 1, spellcaster: 1, old_hag: 1, doppelganger: 1, hoodlum: 1, troublemaker: 1, ghost: 1, martyr: 1, villager: 3 };
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const { state: s, player: host } = createRoom({ code: 'UW001', hostName: 'Chủ', now, rng });
    applyAction(s, host.id, 'config', { hostPlays: false, swapEnabled: false }, now, rng);
    applyAction(s, host.id, 'addBot', { count: 17 }, now, rng);
    for (const k of Object.keys(s.roleCounts)) s.roleCounts[k] = 0;
    Object.assign(s.roleCounts, roles);
    applyAction(s, host.id, 'start', {}, now, rng);
    for (let i = 0; i < 20000 && s.phase !== 'GAME_OVER'; i++) { now += 1000; tick(s, now, rng); }
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
  }
});

test('bot wolves with no one the Prism allows bite nobody', () => {
  const g = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'prism']);
  g.untilPhase('DISCUSSION');
  g.reveal(g.P[1], [g.P[2], g.P[3], g.P[4]]);
  [g.P[2], g.P[3], g.P[4]].forEach(p => { p.alive = false; });
  g.untilNightRole('werewolf');
  g.P[0].isBot = true;
  g.clock.advance(3000);
  assert.deepEqual(g.s.game.night.wolfVotes[g.P[0].id], ['none']);
});

test('notes: the Eye on a villager, a chosen Doppelgänger, a Hoodlum who passed', () => {
  const g = setup(['werewolf', 'villager', 'doppelganger', 'hoodlum', 'villager', 'seer'], [null, 'eye']);
  g.untilNightRole('doppelganger');
  g.act(g.P[2], 'night', { target: g.P[4].id });
  g.untilNightRole('hoodlum');
  g.act(g.P[3], 'endTurn');
  g.untilPhase('DISCUSSION');
  assert.match(notes(g.s, g.P[2]), /Bạn theo bóng/);
  assert.ok(!notes(g.s, g.P[3]).includes('Hai mục tiêu'));
  g.reveal(g.P[1]);
  g.untilNightRole('seer');
  g.act(g.P[5], 'night', { target: g.P[4].id });
  g.untilPhase('MORNING');
  assert.match(notes(g.s, g.P[1]), /không phải Sói/);
});
