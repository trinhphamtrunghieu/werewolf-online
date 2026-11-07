import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, tick, viewFor } from '../lib/engine.js';
import { LOCATIONS } from '../public/shared/spyfall.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A room of `n` players (the host and computer-free guests) playing Spyfall.
function spyRoom(n = 5, { seed = 7 } = {}) {
  let now = 1_000_000;
  const rng = seeded(seed);
  const { state: s, player: host } = createRoom({ code: 'SPY01', hostName: 'Chủ', now, rng });
  const guests = [];
  for (let i = 1; i < n; i++) {
    applyAction(s, host.id, 'addBot', {}, now, rng);
    guests.push(s.players[s.players.length - 1]);
  }
  // Turn the bots into quiet players so tests drive every move.
  guests.forEach(p => { p.isBot = false; });
  applyAction(s, host.id, 'selectGame', { gameId: 'spyfall' }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  const P = s.players;
  const act = (p, type, payload = {}) => applyAction(s, p.id, type, payload, now, rng);
  const clock = { get now() { return now; }, advance(ms) { now += ms; tick(s, now, rng); } };
  const spy = () => P.find(p => p.id === s.play.spy);
  const agents = () => P.filter(p => p.id !== s.play.spy);
  return { s, host, P, act, clock, spy, agents, view: (p) => viewFor(s, p.id, now, 1) };
}

test('hub: a room picks its game; only ready games, only in the lobby', () => {
  const { state: s, player: host } = createRoom({ code: 'HUB01', hostName: 'Chủ', now: 0 });
  assert.equal(viewFor(s, host.id, 0, 1).gameId, 'werewolf');
  assert.throws(() => applyAction(s, host.id, 'selectGame', { gameId: 'chess' }, 0), /chưa có/);
  applyAction(s, host.id, 'selectGame', { gameId: 'spyfall' }, 0);
  const v = viewFor(s, host.id, 0, 1);
  assert.equal(v.gameId, 'spyfall');
  assert.equal(v.gameConfig.roundTime, 480);
  applyAction(s, host.id, 'gameConfig', { roundTime: 300, voteTime: 5 }, 0);
  assert.equal(viewFor(s, host.id, 0, 1).gameConfig.roundTime, 300);
  assert.equal(viewFor(s, host.id, 0, 1).gameConfig.voteTime, 20, 'kept within limits');
  // Too few players for Spyfall.
  assert.throws(() => applyAction(s, host.id, 'start', {}, 0), /ít nhất 3/);
});

test('spyfall: everyone but the spy sees the place; the spy sees nothing of it', () => {
  const g = spyRoom(5);
  assert.equal(g.s.phase, 'SPY_ROUND');
  const spyView = g.view(g.spy());
  assert.equal(spyView.play.me.spy, true);
  assert.equal(spyView.play.me.location, null);
  assert.ok(!JSON.stringify(spyView).includes(`"location":${g.s.play.location}`), 'the place never reaches the spy');
  g.agents().forEach(p => {
    const v = g.view(p);
    assert.equal(v.play.me.spy, false);
    assert.equal(v.play.me.location, g.s.play.location);
    assert.equal(v.play.result, null, 'nobody is told who the spy is');
    assert.deepEqual(Object.keys(v.play).sort(), ['accusation', 'first', 'me', 'result', 'votes']);
  });
  assert.equal(spyView.play.result, null);
});

test('spyfall: a unanimous accusation of the spy wins for the village', () => {
  const g = spyRoom(5);
  const [a, ...rest] = g.agents();
  g.act(a, 'accuse', { target: g.spy().id });
  assert.ok(g.s.play.accusation);
  rest.forEach(p => g.act(p, 'accuseVote', { yes: true }));
  assert.equal(g.s.phase, 'GAME_OVER');
  assert.equal(g.s.play.result.winner, 'village');
  const v = g.view(a);
  assert.equal(v.play.result.spy, g.s.play.spy);
  assert.equal(v.stats.games, 1);
  assert.equal(v.stats.sideWins.village, 1);
});

test('spyfall: one "no" drops the accusation, the clock resumes, one accusation each', () => {
  const g = spyRoom(5);
  const leftBefore = g.s.game.phaseEndsAt - g.clock.now;
  const [a, b] = g.agents();
  g.act(a, 'accuse', { target: b.id });
  g.clock.advance(5000); // time spent voting does not count
  g.act(b === g.spy() ? a : g.spy(), 'accuseVote', { yes: false });
  assert.equal(g.s.play.accusation, null);
  assert.equal(g.s.phase, 'SPY_ROUND');
  assert.equal(g.s.game.phaseEndsAt - g.clock.now, leftBefore);
  assert.throws(() => g.act(a, 'accuse', { target: g.spy().id }), /một lần/);
});

test('spyfall: convicting an innocent hands the spy the win', () => {
  const g = spyRoom(4);
  const innocent = g.agents()[0];
  const voters = g.P.filter(p => p.id !== innocent.id);
  g.act(voters[0], 'accuse', { target: innocent.id });
  voters.slice(1).forEach(p => g.act(p, 'accuseVote', { yes: true }));
  assert.equal(g.s.play.result.winner, 'spy');
});

test('spyfall: the spy may guess the place; right wins, wrong loses', () => {
  const right = spyRoom(4, { seed: 3 });
  assert.throws(() => right.act(right.agents()[0], 'guess', { location: 0 }), /Chỉ gián điệp/);
  right.act(right.spy(), 'guess', { location: right.s.play.location });
  assert.equal(right.s.play.result.winner, 'spy');
  const wrong = spyRoom(4, { seed: 4 });
  wrong.act(wrong.spy(), 'guess', { location: (wrong.s.play.location + 1) % LOCATIONS.length });
  assert.equal(wrong.s.play.result.winner, 'village');
});

test('spyfall: when time is up, more than half on the spy catches them; otherwise the spy escapes', () => {
  const g = spyRoom(5);
  g.clock.advance(g.s.game.phaseEndsAt - g.clock.now);
  assert.equal(g.s.phase, 'SPY_VOTE');
  const spy = g.spy();
  g.agents().forEach(p => g.act(p, 'spyVote', { target: spy.id }));
  g.act(spy, 'spyVote', { target: g.agents()[0].id });
  g.clock.advance(g.s.game.phaseEndsAt - g.clock.now);
  assert.equal(g.s.phase, 'GAME_OVER');
  assert.equal(g.s.play.result.winner, 'village');

  const h = spyRoom(5, { seed: 9 });
  h.clock.advance(h.s.game.phaseEndsAt - h.clock.now);
  h.clock.advance(h.s.game.phaseEndsAt - h.clock.now); // nobody votes
  assert.equal(h.s.play.result.winner, 'spy');
});

test('spyfall: back to the lobby, the room keeps its game and a leaderboard per game', () => {
  const g = spyRoom(4);
  g.act(g.spy(), 'guess', { location: g.s.play.location });
  applyAction(g.s, g.host.id, 'restart', {}, g.clock.now);
  assert.equal(g.s.phase, 'LOBBY');
  assert.equal(g.s.gameId, 'spyfall');
  assert.equal(g.s.play, null);
  assert.equal(viewFor(g.s, g.host.id, g.clock.now, 1).stats.games, 1);
  applyAction(g.s, g.host.id, 'selectGame', { gameId: 'werewolf' }, g.clock.now);
  assert.equal(viewFor(g.s, g.host.id, g.clock.now, 1).stats.games, 0, 'Ma Sói has its own board');
});

test('spyfall: a room of bots plays to the end', () => {
  let now = 0;
  const rng = seeded(5);
  const { state: s, player: host } = createRoom({ code: 'SPYB1', hostName: 'Chủ', now, rng });
  applyAction(s, host.id, 'addBot', { count: 5 }, now, rng);
  applyAction(s, host.id, 'selectGame', { gameId: 'spyfall' }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  for (let i = 0; i < 5000 && s.phase !== 'GAME_OVER'; i++) {
    now += 1000;
    tick(s, now, rng);
    // The host (not a bot) names someone in the final vote.
    if (s.phase === 'SPY_VOTE' && !s.play.votes[host.id]) {
      applyAction(s, host.id, 'spyVote', { target: s.players[1].id }, now, rng);
    }
  }
  assert.equal(s.phase, 'GAME_OVER');
  assert.ok(['spy', 'village'].includes(s.play.result.winner));
});
