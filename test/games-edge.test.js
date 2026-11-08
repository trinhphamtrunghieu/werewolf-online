// Edge cases of the hub games (Spyfall, Undercover, Avalon): wrong moves,
// host skips, bots in every state, and what each player is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, tick, viewFor, GameError } from '../lib/engine.js';
import { spyfall } from '../lib/games/spyfall.js';
import { undercover } from '../lib/games/undercover.js';
import { avalon } from '../lib/games/avalon.js';
import { LOCATIONS } from '../public/shared/spyfall.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A room of n players playing `gameId`. Quiet players unless `bots`.
function room(gameId, n, { seed = 7, config = {}, bots = false } = {}) {
  let now = 1_000_000;
  const rng = seeded(seed);
  const { state: s, player: host } = createRoom({ code: 'EDGE1', hostName: 'Chủ', now, rng, gameId });
  applyAction(s, host.id, 'addBot', { count: n - 1 }, now, rng);
  if (!bots) s.players.forEach(p => { p.isBot = false; });
  if (Object.keys(config).length) applyAction(s, host.id, 'gameConfig', config, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  const P = s.players;
  const act = (p, type, payload = {}) => applyAction(s, p.id, type, payload, now, rng);
  const clock = {
    get now() { return now; },
    advance(ms) { now += ms; return tick(s, now, rng); },
    end() { now = Math.max(now, s.game.phaseEndsAt); tick(s, now, rng); }
  };
  return { s, host, P, act, clock, rng, view: (p) => viewFor(s, p?.id, now, 1) };
}
// The bits of the engine's helpers the modules need when called directly.
const api = { fail: (m) => { throw new GameError(m); } };
const fails = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

// ---------------------------------------------------------------------------
// Ai là gián điệp
// ---------------------------------------------------------------------------

test('spyfall: settings must be numbers; wrong moves are refused', () => {
  const g = room('spyfall', 4);
  const { s, P, act } = g;
  fails(() => spyfall.configure({}, { roundTime: 'x' }, api), /không hợp lệ/);
  const spy = P.find(p => p.id === s.play.spy);
  const agent = P.find(p => p.id !== s.play.spy);
  const other = P.find(p => p !== spy && p !== agent);
  fails(() => act(agent, 'accuse', { target: agent.id }), /người khác/);
  fails(() => act(agent, 'accuse', { target: 'nobody' }), /người khác/);
  fails(() => act(agent, 'accuseVote', { yes: true }), /Không có lời tố cáo/);
  fails(() => act(agent, 'guess', { location: 0 }), /Chỉ gián điệp/);
  fails(() => act(spy, 'guess', { location: 999 }), /không hợp lệ/);
  fails(() => act(agent, 'spyVote', { target: spy.id }), /Chưa đến lúc/);
  fails(() => act(agent, 'dance'), /không hợp lệ/);
  act(agent, 'accuse', { target: other.id });
  fails(() => act(spy, 'accuse', { target: agent.id }), /Đang có một lời tố cáo/);
  fails(() => act(other, 'accuseVote', { yes: true }), /không bỏ phiếu/);
  fails(() => act(spy, 'guess', { location: 0 }), /chờ bỏ phiếu/);
  // The host cannot skip while the table votes on an accusation.
  const end = s.game.phaseEndsAt;
  applyAction(s, g.host.id, 'skip', {}, g.clock.now);
  assert.equal(s.game.phaseEndsAt, end);
  // Nobody finishes voting: the accusation lapses and the questions go on.
  g.clock.end();
  assert.equal(s.play.accusation, null);
  fails(() => act(agent, 'accuse', { target: other.id }), /một lần/);
  // Someone not in this game (a seat taken mid-game) only watches.
  const watcher = P[3];
  watcher.inGame = false;
  fails(() => act(watcher, 'accuse', { target: agent.id }), /đang xem/);
  watcher.inGame = true;
  // The host ends the questions: the final vote, where a second tap takes a vote back.
  applyAction(s, g.host.id, 'skip', {}, g.clock.now);
  g.clock.advance(0);
  assert.equal(s.phase, 'SPY_VOTE');
  fails(() => act(agent, 'accuse', { target: other.id }), /trong lúc hỏi đáp/);
  fails(() => act(agent, 'spyVote', { target: agent.id }), /người khác/);
  act(agent, 'spyVote', { target: other.id });
  act(agent, 'spyVote', { target: other.id });
  assert.equal(s.play.votes[agent.id], undefined);
  // Nobody votes: the spy gets away.
  g.clock.end();
  assert.equal(s.phase, 'GAME_OVER');
  assert.equal(s.play.result.winner, 'spy');
  fails(() => act(spy, 'guess', { location: 0 }), /chưa bắt đầu/);
  fails(() => spyfall.action(s, spy, 'guess', { location: 0 }, 0, g.rng, api), /đã kết thúc/);
  // After the game: the spy and the place are shown to all.
  assert.equal(g.view(agent).play.result.location, s.play.location);
  // A timeout in any other state just stops the clock.
  s.phase = 'ELSEWHERE';
  s.game.phaseEndsAt = 5;
  spyfall.onTimeout(s, 0, g.rng, {});
  assert.equal(s.game.phaseEndsAt, null);
});

test('spyfall: an innocent convicted lets the spy win; the views follow the accusation', () => {
  const g = room('spyfall', 4);
  const { s, P, act } = g;
  const spy = P.find(p => p.id === s.play.spy);
  const [a, b, c] = P.filter(p => p !== spy);
  act(a, 'accuse', { target: b.id });
  const v = g.view(c).play;
  assert.deepEqual([v.accusation.by, v.accusation.yes, v.accusation.voters, v.accusation.mine], [a.id, 1, 3, undefined]);
  // A viewer who is not seated (no player at all) sees the public parts only.
  const outside = spyfall.view(s, null);
  assert.equal(outside.me.playing, false);
  assert.equal(outside.me.location, null);
  act(c, 'accuseVote', { yes: true });
  act(spy, 'accuseVote', { yes: true });
  assert.equal(s.phase, 'GAME_OVER');
  assert.equal(s.play.result.winner, 'spy');
  assert.equal(spyfall.view({ play: null }, null), null);
});

test('spyfall: the spy guessing the place wins; the final vote can catch the spy', () => {
  const g = room('spyfall', 4);
  const spy = g.P.find(p => p.id === g.s.play.spy);
  g.act(spy, 'guess', { location: g.s.play.location });
  assert.equal(g.s.play.result.winner, 'spy');

  const h = room('spyfall', 4, { seed: 9 });
  const hspy = h.P.find(p => p.id === h.s.play.spy);
  applyAction(h.s, h.host.id, 'skip', {}, h.clock.now);
  h.clock.advance(0);
  h.P.filter(p => p !== hspy).forEach(p => h.act(p, 'spyVote', { target: hspy.id }));
  h.act(hspy, 'spyVote', { target: h.P.find(p => p !== hspy).id });
  h.clock.end();
  assert.equal(h.s.play.result.winner, 'village');
});

test('spyfall: bots vote on accusations, the spy bot guesses late, bots vote at the end', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const g = room('spyfall', 5, { seed, bots: true });
    const { s, P } = g;
    // Right after the start the bots wait.
    assert.equal(g.clock.advance(0), false);
    const human = P[0];
    human.isBot = false;
    const target = P.find(p => p !== human);
    applyAction(s, human.id, 'accuse', { target: target.id }, g.clock.now, g.rng);
    g.clock.advance(3000);
    for (let i = 0; i < 2000 && s.phase !== 'GAME_OVER'; i++) g.clock.advance(1000);
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
  }
  // A table without bots: nothing for them to do.
  const quiet = room('spyfall', 3);
  assert.equal(spyfall.bots(quiet.s, quiet.clock.now + 10000, quiet.rng, {}), false);
  assert.equal(LOCATIONS.length > 0, true);
});

// ---------------------------------------------------------------------------
// Ai là nội gián
// ---------------------------------------------------------------------------

const ucRole = (g, role) => g.P.filter(p => g.s.play.roles[p.id] === role);
const speakAll = (g) => { while (g.s.phase === 'UC_SPEAK') g.act(g.P.find(p => p.id === g.s.play.order[g.s.play.speaker]), 'spoke'); };

test('undercover: settings, wrong moves, and taking a vote back', () => {
  const c = {};
  undercover.configure(c, { speakTime: 50, mrWhite: 1 }, api);
  assert.equal(c.mrWhite, true);
  assert.equal(c.speakTime, 50);
  fails(() => undercover.configure({}, { speakTime: 'abc' }, api), /không hợp lệ/);
  const g = room('undercover', 6, { config: { mrWhite: true } });
  const { s, P, act } = g;
  const notSpeaker = P.find(p => p.id !== s.play.order[s.play.speaker]);
  fails(() => act(notSpeaker, 'spoke'), /Chưa đến lượt bạn/);
  fails(() => act(notSpeaker, 'ucVote', { target: P[0].id }), /Chưa đến lúc/);
  fails(() => act(notSpeaker, 'whiteGuess', { word: 'x' }), /Chưa đến lượt bạn đoán/);
  fails(() => act(notSpeaker, 'dance'), /không hợp lệ/);
  P[0].inGame = false;
  fails(() => undercover.action(s, P[0], 'spoke', {}, 0, g.rng, api), /đang xem/);
  P[0].inGame = true;
  // The host's skip moves the turn on.
  applyAction(s, g.host.id, 'skip', {}, g.clock.now);
  g.clock.advance(0);
  assert.equal(s.play.speaker, 1);
  speakAll(g);
  assert.equal(s.phase, 'UC_VOTE');
  fails(() => act(P[0], 'spoke'), /Chưa đến lượt mô tả/);
  fails(() => act(P[0], 'ucVote', { target: P[0].id }), /người khác/);
  act(P[0], 'ucVote', { target: P[1].id });
  act(P[0], 'ucVote', { target: P[1].id });
  assert.equal(s.play.votes[P[0].id], undefined);
  // The view mid-vote shows the votes; a viewer without a seat sees no word.
  assert.deepEqual(undercover.view(s, null).me, { playing: false, alive: false, word: null, white: false });
  assert.equal(undercover.view({ play: null }), null);
  // Any other state: the clock just stops.
  const phase = s.phase;
  s.phase = 'ELSEWHERE';
  undercover.onTimeout(s, 0, g.rng, api);
  assert.equal(s.game.phaseEndsAt, null);
  s.phase = phase;
});

test('undercover: Trắng out must type a guess, a wrong one or the clock moves on; the dead cannot vote', () => {
  const g = room('undercover', 7, { config: { mrWhite: true } });
  const { s, act } = g;
  const [white] = ucRole(g, 'white');
  speakAll(g);
  g.P.filter(p => p !== white).forEach(p => act(p, 'ucVote', { target: white.id }));
  act(white, 'ucVote', { target: g.P.find(p => p !== white).id });
  g.clock.end();
  assert.equal(s.phase, 'UC_GUESS');
  assert.equal(g.view(white).play.guess, null);
  fails(() => act(white, 'whiteGuess', { word: '   ' }), /Hãy nhập/);
  fails(() => act(white, 'whiteGuess', {}), /Hãy nhập/);
  act(white, 'whiteGuess', { word: 'chắc chắn sai' });
  assert.equal(s.phase, 'UC_OUT');
  g.clock.end();
  speakAll(g);
  fails(() => act(white, 'ucVote', { target: g.P[0] === white ? g.P[1].id : g.P[0].id }), /đã bị loại/);

  // Trắng who lets the clock run out.
  const h = room('undercover', 7, { config: { mrWhite: true }, seed: 11 });
  const [w2] = ucRole(h, 'white');
  speakAll(h);
  h.P.filter(p => p !== w2).forEach(p => h.act(p, 'ucVote', { target: w2.id }));
  h.clock.end();
  assert.equal(h.s.phase, 'UC_GUESS');
  h.clock.end();
  assert.equal(h.s.phase, 'UC_OUT');
});

test('undercover: bots describe, vote and guess as Trắng', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = room('undercover', 6, { seed, bots: true, config: { mrWhite: true } });
    assert.equal(g.clock.advance(0), false, 'bots wait a moment');
    for (let i = 0; i < 5000 && g.s.phase !== 'GAME_OVER'; i++) g.clock.advance(1000);
    assert.equal(g.s.phase, 'GAME_OVER', `seed ${seed}`);
  }
});

test('undercover: a bot move the rules refuse is simply skipped', () => {
  const g = room('undercover', 5, { bots: true });
  const speaker = g.P.find(p => p.id === g.s.play.order[g.s.play.speaker]);
  speaker.isBot = true;
  speaker.inGame = false;
  assert.equal(undercover.bots(g.s, g.clock.now + 10000, g.rng, api), false);
});

// ---------------------------------------------------------------------------
// Avalon
// ---------------------------------------------------------------------------

const avLeader = (g) => g.P.find(p => p.id === g.s.play.ring[g.s.play.leader % g.s.play.ring.length]);
const avRole = (g, role) => g.P.filter(p => g.s.play.roles[p.id] === role);

test('avalon: settings, wrong moves, and every step left to the clock', () => {
  const c = {};
  avalon.configure(c, { pickTime: 30, lady: 1 }, api);
  assert.deepEqual([c.pickTime >= 30, c.lady], [true, true]);
  fails(() => avalon.configure({}, { pickTime: 'x' }, api), /không hợp lệ/);
  const g = room('avalon', 7, { config: { lady: true } });
  const { s, act } = g;
  const lead = avLeader(g);
  const other = g.P.find(p => p !== lead);
  fails(() => act(other, 'avPick', { target: lead.id }), /Chỉ đội trưởng/);
  fails(() => act(other, 'avPropose'), /Chỉ đội trưởng/);
  fails(() => act(lead, 'avPick', { target: 'nobody' }), /không ở trong ván/);
  fails(() => act(lead, 'avPropose'), /Hãy chọn đủ/);
  fails(() => act(lead, 'avVote', { approve: true }), /Chưa đến lúc bỏ phiếu/);
  fails(() => act(lead, 'avQuest', {}), /Chưa đến lúc làm nhiệm vụ/);
  fails(() => act(lead, 'avLady', { target: lead.id }), /Chưa đến lúc dùng/);
  fails(() => act(lead, 'avAssassinate', { target: lead.id }), /Chưa đến lúc ám sát/);
  fails(() => act(lead, 'dance'), /không hợp lệ/);
  lead.inGame = false;
  fails(() => avalon.action(s, lead, 'avPick', {}, 0, g.rng, api), /đang xem/);
  lead.inGame = true;
  // A full team: one more is refused; tapping a member takes them out.
  g.P.forEach(p => { try { act(lead, 'avPick', { target: p.id }); } catch (e) { assert.match(e.message, /Đội chỉ có/); } });
  act(lead, 'avPick', { target: s.play.team[0] });
  // The leader runs out of time: the team is filled at random, with the leader.
  g.clock.end();
  assert.equal(s.phase, 'AV_VOTE');
  assert.ok(s.play.team.includes(lead.id));
  // Missing votes count as approve; missing cards as Success.
  g.clock.end();
  assert.equal(s.phase, 'AV_QUEST');
  const member = g.P.find(p => s.play.team.includes(p.id));
  const outsider = g.P.find(p => !s.play.team.includes(p.id));
  fails(() => act(outsider, 'avQuest', {}), /không ở trong đội/);
  act(member, 'avQuest', {});
  fails(() => act(member, 'avQuest', {}), /đã chọn rồi/);
  g.clock.end();
  assert.equal(s.phase, 'AV_RESULT');
  g.clock.end();
  // Quest 2 goes the same way, then Tiên Nữ Hồ, also left to the clock.
  for (let i = 0; i < 4; i++) g.clock.end();
  assert.equal(s.phase, 'AV_LADY');
  fails(() => act(g.P.find(p => p.id !== s.play.lady), 'avLady', { target: lead.id }), /không giữ Tiên Nữ Hồ/);
  fails(() => act(g.P.find(p => p.id === s.play.lady), 'avLady', { target: s.play.lady }), /đã từng giữ/);
  g.clock.end();
  assert.equal(s.phase, 'AV_PICK');
  assert.equal(s.play.ladyLooks.length, 1);
  // Three successes (nobody fails anything), then the Assassin, out of time too.
  for (let i = 0; i < 30 && s.phase !== 'AV_ASSASSIN'; i++) g.clock.end();
  assert.equal(s.phase, 'AV_ASSASSIN');
  const assassin = avRole(g, 'assassin')[0];
  fails(() => act(other.id === assassin.id ? lead : g.P.find(p => p !== assassin), 'avAssassinate', { target: assassin.id }), /Chỉ Sát Thủ/);
  fails(() => act(assassin, 'avAssassinate', { target: assassin.id }), /phe Thiện/);
  fails(() => act(assassin, 'avAssassinate', { target: 'nobody' }), /phe Thiện/);
  g.clock.end();
  assert.equal(s.phase, 'GAME_OVER');
  assert.ok(g.view(lead).play.result.roles);
  fails(() => avalon.action(s, lead, 'avPick', { target: lead.id }, 0, g.rng, api), /chọn đội/);
  fails(() => avalon.action(s, lead, 'avPropose', {}, 0, g.rng, api), /chọn đội/);
  // Any other state: the clock stops.
  s.phase = 'ELSEWHERE';
  avalon.onTimeout(s, 0, g.rng, api);
  assert.equal(s.game.phaseEndsAt, null);
});

test('avalon: views for a voter, for someone outside, and before the game', () => {
  const g = room('avalon', 5);
  const lead = avLeader(g);
  const picks = g.P.slice(0, 2);
  picks.forEach(p => g.act(lead, 'avPick', { target: p.id }));
  g.act(lead, 'avPropose');
  g.act(g.P[0], 'avVote', { approve: false });
  assert.equal(g.view(g.P[0]).play.myVote, false);
  assert.equal(g.view(g.P[1]).play.myVote, null);
  const outside = avalon.view(g.s, null);
  assert.deepEqual([outside.me.playing, outside.me.role, outside.me.sees, outside.myVote], [false, null, null, null]);
  assert.equal(avalon.view({ play: null }, null), null);
});

test('avalon: bots lead, vote, play, use Tiên Nữ Hồ and assassinate', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = room('avalon', 7, { seed, bots: true, config: { lady: true, percival: true, oberon: true } });
    g.host.isBot = true;
    assert.equal(g.clock.advance(0), false);
    for (let i = 0; i < 5000 && g.s.phase !== 'GAME_OVER'; i++) g.clock.advance(1000);
    assert.equal(g.s.phase, 'GAME_OVER', `seed ${seed}`);
  }
  // A bot move the rules refuse is skipped (an Assassin with nobody good left to name).
  const h = room('avalon', 5, { bots: true });
  const assassin = avRole(h, 'assassin')[0];
  h.P.forEach(p => { h.s.play.roles[p.id] = 'minion'; });
  h.s.play.roles[assassin.id] = 'assassin';
  h.s.phase = 'AV_ASSASSIN';
  assert.equal(avalon.bots(h.s, h.clock.now + 10000, h.rng, { ...api, pick: () => undefined }), false);
  // The host's skip ends the step at once.
  avalon.skip(h.s, 123);
  assert.equal(h.s.game.phaseEndsAt, 123);
});

test('avalon: without Percival there is no Morgana either', () => {
  const g = room('avalon', 6, { config: { percival: false } });
  const roles = Object.values(g.s.play.roles);
  assert.ok(!roles.includes('percival') && !roles.includes('morgana'));
});
