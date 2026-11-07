import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, tick, viewFor } from '../lib/engine.js';
import { WORD_PAIRS } from '../public/shared/undercover.js';
import { AVALON_SIDES, QUEST_SIZES } from '../public/shared/avalon.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A room of n quiet players (no bots acting) playing `gameId`.
function room(gameId, n, { seed = 7, config = {} } = {}) {
  let now = 1_000_000;
  const rng = seeded(seed);
  const { state: s, player: host } = createRoom({ code: 'GAME1', hostName: 'Chủ', now, rng });
  for (let i = 1; i < n; i++) applyAction(s, host.id, 'addBot', {}, now, rng);
  s.players.forEach(p => { p.isBot = false; });
  applyAction(s, host.id, 'selectGame', { gameId }, now, rng);
  if (Object.keys(config).length) applyAction(s, host.id, 'gameConfig', config, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  const P = s.players;
  const act = (p, type, payload = {}) => applyAction(s, typeof p === 'string' ? p : p.id, type, payload, now, rng);
  const clock = {
    get now() { return now; },
    advance(ms) { now += ms; tick(s, now, rng); },
    end() { now = Math.max(now, s.game.phaseEndsAt); tick(s, now, rng); }
  };
  return { s, host, P, act, clock, view: (p) => viewFor(s, typeof p === 'string' ? p : p.id, now, 1) };
}

// A room of bots, played to the end.
function botsToTheEnd(gameId, n, seed) {
  let now = 0;
  const rng = seeded(seed);
  const { state: s, player: host } = createRoom({ code: 'BOTS1', hostName: 'Chủ', now, rng });
  applyAction(s, host.id, 'addBot', { count: n - 1 }, now, rng);
  host.isBot = true; // the host's seat plays itself too
  applyAction(s, host.id, 'selectGame', { gameId }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  for (let i = 0; i < 20000 && s.phase !== 'GAME_OVER'; i++) { now += 1000; tick(s, now, rng); }
  return s;
}

// ---------------------------------------------------------------------------
// Ai là nội gián
// ---------------------------------------------------------------------------

const roleOf = (g, p) => g.s.play.roles[p.id];
const ofRole = (g, role) => g.P.filter(p => roleOf(g, p) === role);

test('undercover: everyone sees a word but not whose side it is; Trắng sees none', () => {
  const g = room('undercover', 7, { config: { mrWhite: true } });
  assert.equal(g.s.phase, 'UC_SPEAK');
  assert.equal(ofRole(g, 'undercover').length, 2, 'two undercover from seven players');
  assert.equal(ofRole(g, 'white').length, 1);
  const { civilian, undercover } = g.s.play.words;
  assert.ok(WORD_PAIRS.some(([a, b]) => [a, b].includes(civilian) && [a, b].includes(undercover)));
  g.P.forEach(p => {
    const me = g.view(p).play.me;
    const role = roleOf(g, p);
    assert.equal(me.word, role === 'white' ? null : g.s.play.words[role]);
    assert.equal(me.white, role === 'white');
    assert.ok(!('role' in me), 'nobody is told their side');
    assert.equal(g.view(p).play.result, null);
  });
  assert.notEqual(g.s.play.roles[g.s.play.order[0]], 'white', 'Trắng never speaks first');
});

test('undercover: speakers take turns, then the most voted leaves and their part is shown', () => {
  const g = room('undercover', 5, { seed: 3 });
  const order = g.s.play.order;
  assert.throws(() => g.act(order[1], 'spoke'), /Chưa đến lượt bạn/);
  order.forEach(id => g.act(id, 'spoke'));
  assert.equal(g.s.phase, 'UC_VOTE');
  const uc = ofRole(g, 'undercover')[0];
  g.P.filter(p => p !== uc).forEach(p => g.act(p, 'ucVote', { target: uc.id }));
  g.act(uc, 'ucVote', { target: g.P.find(p => p !== uc).id });
  g.clock.end();
  assert.equal(uc.alive, false);
  assert.equal(g.s.phase, 'GAME_OVER', 'the only undercover is out: the village wins');
  assert.equal(g.s.play.result.winner, 'civilian');
  assert.deepEqual(g.view(g.P[0]).play.out, [{ id: uc.id, role: 'undercover', round: 1 }]);
  assert.equal(g.view(g.P[0]).stats.sideWins.civilian, 1);
});

test('undercover: a tie sends nobody away; the undercover side wins when one villager is left', () => {
  const g = room('undercover', 4, { seed: 5 });
  const civ = ofRole(g, 'civilian');
  const uc = ofRole(g, 'undercover')[0];
  g.clock.end(); g.clock.end(); g.clock.end(); g.clock.end(); // nobody taps "Xong"
  assert.equal(g.s.phase, 'UC_VOTE');
  g.act(civ[0], 'ucVote', { target: civ[1].id });
  g.act(civ[1], 'ucVote', { target: civ[0].id });
  g.clock.end();
  assert.ok(g.P.every(p => p.alive), 'tie: nobody leaves');
  g.clock.end(); // the pause
  assert.equal(g.s.phase, 'UC_SPEAK');
  assert.equal(g.s.play.round, 2);
  // Round 2: the village sends two of its own away and is outnumbered.
  g.s.play.order.forEach(id => g.act(id, 'spoke'));
  [uc, civ[1], civ[2]].forEach(p => g.act(p, 'ucVote', { target: civ[0].id }));
  g.clock.end();
  assert.equal(g.s.phase, 'UC_OUT');
  g.clock.end();
  g.s.play.order.forEach(id => g.act(id, 'spoke'));
  g.P.filter(p => p.alive).forEach(p => g.act(p, 'ucVote', { target: p === civ[1] ? civ[2].id : civ[1].id }));
  g.clock.end();
  assert.equal(g.s.phase, 'GAME_OVER');
  assert.equal(g.s.play.result.winner, 'undercover');
});

test('undercover: Trắng voted out may guess the village word and win alone', () => {
  const g = room('undercover', 6, { seed: 11, config: { mrWhite: true } });
  const white = ofRole(g, 'white')[0];
  g.s.play.order.forEach(id => g.act(id, 'spoke'));
  g.P.filter(p => p !== white).forEach(p => g.act(p, 'ucVote', { target: white.id }));
  g.act(white, 'ucVote', { target: g.P.find(p => p !== white).id });
  g.clock.end();
  assert.equal(g.s.phase, 'UC_GUESS');
  assert.throws(() => g.act(g.P.find(p => p !== white), 'whiteGuess', { word: 'x' }), /Chưa đến lượt/);
  g.act(white, 'whiteGuess', { word: `  ${g.s.play.words.civilian.toUpperCase()} ` });
  assert.equal(g.s.play.result.winner, 'white');
});

test('undercover: rooms of bots play to the end', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = botsToTheEnd('undercover', 4 + (seed % 7), seed);
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
  }
});

// ---------------------------------------------------------------------------
// Avalon
// ---------------------------------------------------------------------------

const av = (g, role) => g.P.filter(p => g.s.play.roles[p.id] === role);
const leader = (g) => g.s.play.ring[g.s.play.leader % g.s.play.ring.length];

// The leader proposes these players; everyone votes as told.
function propose(g, team, approve = true) {
  team.forEach(p => g.act(leader(g), 'avPick', { target: p.id }));
  g.act(leader(g), 'avPropose');
  g.P.forEach(p => g.act(p, 'avVote', { approve }));
}

test('avalon: the deal by table size; Merlin, Percival and evil each see what they should', () => {
  for (let n = 5; n <= 10; n++) {
    const g = room('avalon', n, { seed: n });
    const evil = g.P.filter(p => ['assassin', 'morgana', 'mordred', 'oberon', 'minion'].includes(g.s.play.roles[p.id]));
    assert.equal(evil.length, AVALON_SIDES[n][1], `n=${n}`);
    assert.equal(av(g, 'merlin').length, 1);
    assert.equal(av(g, 'assassin').length, 1);
  }
  // Ten players: four evil seats, room for Morgana, Mordred and Oberon.
  const g = room('avalon', 10, { seed: 2, config: { mordred: true, oberon: true } });
  const [merlin] = av(g, 'merlin');
  const [percival] = av(g, 'percival');
  const [morgana] = av(g, 'morgana');
  const [mordred] = av(g, 'mordred');
  const [oberon] = av(g, 'oberon');
  const [assassin] = av(g, 'assassin');
  const sees = (p) => g.view(p).play.me.sees.ids.slice().sort();
  assert.deepEqual(sees(merlin), [assassin.id, morgana.id, oberon.id].sort(), 'Merlin: evil but Mordred');
  assert.deepEqual(sees(percival), [merlin.id, morgana.id].sort());
  assert.deepEqual(sees(assassin), [morgana.id, mordred.id].sort(), 'evil: each other but Oberon');
  assert.deepEqual(sees(oberon), [], 'Oberon knows nobody');
  const servant = av(g, 'servant')[0];
  assert.deepEqual(g.view(servant).play.me.sees.ids, []);
  assert.equal(g.view(servant).play.result, null);
});

test('avalon: team votes stay hidden until all are in; five rejections hand evil the win', () => {
  const g = room('avalon', 5, { seed: 4 });
  for (let i = 0; i < 4; i++) {
    const team = g.P.slice(0, QUEST_SIZES[5][0]);
    team.forEach(p => g.act(leader(g), 'avPick', { target: p.id }));
    g.act(leader(g), 'avPropose');
    g.act(g.P[0], 'avVote', { approve: false });
    const v = g.view(g.P[1]).play;
    assert.deepEqual(v.voted, [g.P[0].id]);
    assert.equal(v.myVote, null);
    g.P.slice(1).forEach(p => g.act(p, 'avVote', { approve: false }));
    assert.equal(g.s.phase, 'AV_PICK');
    assert.equal(g.s.play.rejects, i + 1);
    assert.equal(g.view(g.P[1]).play.lastVote.votes[g.P[0].id], false, 'shown once all are in');
  }
  propose(g, g.P.slice(0, 2), false);
  assert.equal(g.s.phase, 'GAME_OVER');
  assert.equal(g.s.play.result.winner, 'evil');
});

test('avalon: good can only play Success; one Fail fails a quest; cards stay anonymous', () => {
  const g = room('avalon', 5, { seed: 6 });
  const [good1] = av(g, 'merlin');
  const evil = g.P.find(p => ['assassin', 'morgana', 'minion'].includes(g.s.play.roles[p.id]));
  propose(g, [good1, evil]);
  assert.equal(g.s.phase, 'AV_QUEST');
  assert.throws(() => g.act(good1, 'avQuest', { fail: true }), /chỉ được chọn Thành công/);
  g.act(good1, 'avQuest', { fail: false });
  assert.equal(g.view(g.P[0]).play.playedCount, 1);
  g.act(evil, 'avQuest', { fail: true });
  assert.equal(g.s.phase, 'AV_RESULT');
  assert.deepEqual(g.view(g.P[0]).play.results, [{ success: false, fails: 1, team: [good1.id, evil.id] }]);
  g.clock.end();
  assert.equal(g.s.phase, 'AV_PICK');
  assert.equal(g.s.play.quest, 1);
});

test('avalon: three successes, then the Assassin names Merlin (or not)', () => {
  const run = (hitMerlin) => {
    const g = room('avalon', 5, { seed: 8 });
    const good = g.P.filter(p => ['merlin', 'percival', 'servant'].includes(g.s.play.roles[p.id]));
    for (let q = 0; q < 3; q++) {
      propose(g, good.slice(0, QUEST_SIZES[5][q]));
      good.slice(0, QUEST_SIZES[5][q]).forEach(p => g.act(p, 'avQuest', { fail: false }));
      g.clock.end();
    }
    assert.equal(g.s.phase, 'AV_ASSASSIN');
    const [assassin] = av(g, 'assassin');
    const target = hitMerlin ? av(g, 'merlin')[0] : good.find(p => g.s.play.roles[p.id] !== 'merlin');
    assert.throws(() => g.act(good[0], 'avAssassinate', { target: target.id }), /Sát Thủ/);
    g.act(assassin, 'avAssassinate', { target: target.id });
    return g.s.play.result.winner;
  };
  assert.equal(run(true), 'evil');
  assert.equal(run(false), 'good');
});

test('avalon: from seven players the fourth quest needs two Fail cards', () => {
  const g = room('avalon', 7, { seed: 9 });
  assert.deepEqual(g.view(g.P[0]).play.twoFails, [false, false, false, true, false]);
});

test('avalon: rooms of bots play to the end', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = botsToTheEnd('avalon', 5 + (seed % 6), seed);
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
    assert.ok(['good', 'evil'].includes(s.play.result.winner));
  }
});
