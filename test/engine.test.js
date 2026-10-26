import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, applyAction, tick, viewFor, checkWin, authenticate, cleanName, GameError, resolveHostVote
} from '../lib/engine.js';
import { computeBalancedRoles, validateRoleCounts, totalRoles, balanceScore, emptyRoleCounts as emptyCounts, MAX_PLAYERS } from '../public/shared/roles.js';
import { mutateRoom, createRoomRecord, setStoreForTests, getStore, _supabaseStoreForTests } from '../lib/store.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a started game whose roles are assigned in seat order.
function setup(roles, { config = {}, rng = seeded(), extras = [] } = {}) {
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'TEST1', hostName: 'Chủ', now, rng });
  for (let i = 1; i < roles.length; i++) joinRoom(s, `P${i + 1}`, now, rng);
  // Most tests start straight at night; the swap tests turn it back on.
  applyAction(s, host.id, 'config', { swapEnabled: false, ...config }, now, rng);
  const counts = {};
  [...roles, ...extras].forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  for (const [roleId, n] of Object.entries(counts)) {
    const cur = s.roleCounts[roleId] || 0;
    for (let i = cur; i < n; i++) applyAction(s, host.id, 'role', { roleId, delta: 1 }, now, rng);
    for (let i = cur; i > n; i--) applyAction(s, host.id, 'role', { roleId, delta: -1 }, now, rng);
  }
  for (const roleId of Object.keys(s.roleCounts)) {
    while (!counts[roleId] && s.roleCounts[roleId] > 0) applyAction(s, host.id, 'role', { roleId, delta: -1 }, now, rng);
  }
  applyAction(s, host.id, 'start', {}, now, rng);
  s.players.forEach((p, i) => { p.role = roles[i]; });
  s.game.thiefExtras = [...extras];
  s.game.thiefId = s.players.find(p => p.role === 'thief')?.id || null;
  // Unless a test looks at the swap, go past the "look at your card" screen
  // so it starts at the first night.
  if (s.phase === 'REVEAL') {
    now = s.game.phaseEndsAt;
    tick(s, now, rng);
  }
  const P = s.players;
  const clock = {
    get now() { return now; },
    advance(ms) { now += ms; tick(s, now, rng); }
  };
  const act = (p, type, payload) => applyAction(s, p.id, type, payload, now, rng);
  // Jump to the end of the current phase.
  const endPhase = () => { clock.advance(Math.max(0, s.game.phaseEndsAt - now)); };
  const untilPhase = (phase, limit = 30) => {
    for (let i = 0; i < limit && s.phase !== phase; i++) endPhase();
    assert.equal(s.phase, phase);
  };
  // Stops once the role has been called and its action slot is open.
  const untilNightRole = (role) => {
    for (let i = 0; i < 30 && !(s.phase === 'NIGHT' && s.game.queue[s.game.step] === role && s.game.nightStage === 'act'); i++) endPhase();
    assert.equal(s.game.queue[s.game.step], role);
    assert.equal(s.game.nightStage, 'act');
  };
  return { s, P, host, clock, act, endPhase, untilPhase, untilNightRole, rng };
}

test('auto balance always matches player count and is playable', () => {
  for (let n = 4; n <= 18; n++) {
    const c = computeBalancedRoles(n);
    assert.equal(totalRoles(c), n + (c.thief ? 2 : 0), `n=${n}`);
    assert.equal(validateRoleCounts(c, n), null, `n=${n}`);
  }
});

test('auto balance brings in Cupid, Thief and Piper as the village grows', () => {
  const firstAt = (id) => {
    for (let n = 1; n <= 11; n++) if (computeBalancedRoles(n)[id]) return n;
    return null;
  };
  assert.equal(firstAt('cupid'), 7);
  assert.equal(firstAt('thief'), 9);
  assert.equal(firstAt('piper'), 11);
});

test('12 players get the house roles, with wolves and villagers set by the role points', () => {
  const c = computeBalancedRoles(12);
  const used = Object.fromEntries(Object.entries(c).filter(([, n]) => n));
  assert.deepEqual(used, {
    werewolf: 3, avenger: 1, seer: 1, guard: 1, witch: 1, hunter: 1,
    detective: 1, medium: 1, priest: 1, fool: 1
  });
  assert.equal(balanceScore(c), 2, 'close to zero');
  // Bigger rooms build on it.
  for (let n = 13; n <= 18; n++) {
    const d = computeBalancedRoles(n);
    for (const id of ['avenger', 'seer', 'guard', 'witch', 'hunter', 'detective', 'medium', 'priest', 'fool']) assert.equal(d[id], 1, `${id} n=${n}`);
    assert.ok(Math.abs(balanceScore(d)) <= 4, `n=${n}: ${balanceScore(d)}`);
  }
});

test('every suggested deck adds up close to zero (Ultimate Werewolf points)', () => {
  for (let n = 6; n <= 18; n++) assert.ok(Math.abs(balanceScore(computeBalancedRoles(n))) <= 4, `n=${n}`);
});

test('the host picks the roles to play and the deck is filled and balanced', () => {
  const { state: s, player: host } = createRoom({ code: 'PICK1', hostName: 'Host', now: 0 });
  applyAction(s, host.id, 'addBot', { count: 9 }, 0);
  const pick = (roleId) => applyAction(s, host.id, 'pickRole', { roleId }, 0);
  ['seer', 'witch', 'guard', 'hunter', 'cupid', 'thief'].forEach(pick); // toggle off the defaults for 10
  assert.deepEqual(s.rolePicks, []);
  ['seer', 'wolf_cub', 'cursed'].forEach(pick);
  assert.equal(s.roleMode, 'pick');
  const c = s.roleCounts;
  assert.equal(c.seer, 1); assert.equal(c.wolf_cub, 1); assert.equal(c.cursed, 1);
  assert.equal(validateRoleCounts(c, 10), null);
  assert.ok(Math.abs(balanceScore(c)) <= 4, String(balanceScore(c)));
  // A new player joining re-balances the same picks.
  applyAction(s, host.id, 'addBot', { count: 1 }, 0);
  assert.equal(validateRoleCounts(s.roleCounts, 11), null);
  assert.equal(s.roleCounts.cursed, 1);
});

test('names are cleaned so they cannot inject HTML', () => {
  assert.equal(cleanName('  <img src=x onerror=alert(1)>  '), 'img src=x onerror=al');
  assert.throws(() => cleanName('   '), GameError);
});

test('players only see their own role (wolves also see wolves)', () => {
  const { s, P } = setup(['seer', 'werewolf', 'werewolf', 'villager', 'guard', 'villager']);
  const seerView = viewFor(s, P[0].id, 0, 1);
  assert.deepEqual(seerView.players.filter(p => p.role).map(p => p.id), [P[0].id]);
  const wolfView = viewFor(s, P[1].id, 0, 1);
  assert.deepEqual(wolfView.players.filter(p => p.role).map(p => p.role), ['werewolf', 'werewolf']);
  assert.ok(!JSON.stringify(seerView).includes(P[1].token), 'tokens never leak');
});

test('only the active role may act at night and a wolf cannot bite itself', () => {
  const { P, act, untilNightRole } = setup(['guard', 'werewolf', 'seer', 'villager', 'villager']);
  untilNightRole('guard');
  assert.throws(() => act(P[1], 'night', { target: P[0].id }), /Chưa đến lượt/);
  untilNightRole('werewolf');
  assert.throws(() => act(P[1], 'night', { target: P[1].id }), /chính mình/);
});

test('wolf kill, guard save and witch potions resolve correctly', () => {
  const g = setup(['guard', 'werewolf', 'witch', 'villager', 'villager', 'werewolf', 'villager']);
  const { s, P, act, untilNightRole, untilPhase } = g;

  untilNightRole('guard');
  act(P[0], 'night', { target: P[3].id });
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[3].id });
  act(P[5], 'night', { target: P[3].id });
  assert.equal(s.game.night.complete, true, 'both wolves picked');
  untilNightRole('witch');
  const witchView = viewFor(s, P[2].id, g.clock.now, 1);
  assert.ok(!JSON.stringify(witchView.me.task).includes(P[3].id), 'witch does not learn who was bitten');
  act(P[2], 'witch', { use: 'poison', target: P[4].id });
  act(P[2], 'witch', { use: 'done' });
  untilPhase('MORNING');
  assert.equal(P[3].alive, true, 'guarded player survives');
  assert.equal(P[4].alive, false, 'poisoned player dies');
  assert.deepEqual(s.game.lastNightDeaths, [P[4].id]);
  assert.throws(() => act(P[2], 'witch', { use: 'poison', target: P[0].id }));
});

test('guard cannot protect the same person two nights in a row', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['guard', 'werewolf', 'villager', 'villager', 'villager']);
  untilNightRole('guard');
  act(P[0], 'night', { target: P[2].id });
  untilPhase('DISCUSSION');
  untilNightRole('guard');
  assert.equal(s.game.day, 2);
  assert.throws(() => act(P[0], 'night', { target: P[2].id }), /2 đêm liên tiếp/);
});

test('nobody voting or a tie sends nobody to the stand (host is not picked)', () => {
  const { s, P, act, untilPhase } = setup(['villager', 'werewolf', 'werewolf', 'seer', 'villager', 'villager']);
  untilPhase('VOTE');
  untilPhase('VERDICT');
  assert.equal(s.game.defendant, null);
  assert.equal(s.game.verdict.type, 'none');

  untilPhase('VOTE');
  const alive = P.filter(p => p.alive);
  // Two candidates, two votes each.
  act(alive[0], 'vote', { target: alive[1].id });
  act(alive[2], 'vote', { target: alive[1].id });
  act(alive[1], 'vote', { target: alive[0].id });
  act(alive[3], 'vote', { target: alive[0].id });
  untilPhase('VERDICT');
  assert.equal(s.game.verdict.type, 'none');
});

test('hunter aims at night; when lynched, the aimed player dies too and win is checked', () => {
  const { s, P, act, endPhase, untilNightRole, untilPhase } = setup(['hunter', 'werewolf', 'villager', 'villager', 'villager']);
  untilNightRole('hunter');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  endPhase();
  assert.equal(P[0].alive, false);
  assert.equal(P[1].alive, false, 'the aimed wolf dies with the hunter');
  assert.equal(s.phase, 'GAME_OVER');
  assert.equal(s.game.winner, 'village');
  assert.ok(!s.narration.clips.some(c => c.k === 'hunter_fire'), 'no gunshot line: it would expose the Hunter');
});

test('a bitten hunter takes his target along, announced as plain deaths', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['hunter', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilNightRole('hunter');
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(P[2].alive, false);
  const keys = s.narration.clips.map(c => c.k);
  assert.deepEqual(keys.filter(k => k.startsWith('seat_')).sort(), [`seat_${P[0].seat}`, `seat_${P[2].seat}`].sort());
  assert.ok(keys.includes('morning_deaths'));
  assert.ok(!keys.includes('hunter_fire'));
});

test('witch heal is blind: saves the bitten player, and is spent on a quiet night', () => {
  const g = setup(['witch', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  const { s, P, act, untilNightRole, untilPhase } = g;
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[3].id });
  untilNightRole('witch');
  act(P[0], 'witch', { use: 'heal' });
  untilPhase('MORNING');
  assert.equal(P[3].alive, true);
  assert.equal(s.game.potions.heal, false);

  const quiet = setup(['witch', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  quiet.untilNightRole('witch');
  quiet.act(quiet.P[0], 'witch', { use: 'heal' });
  assert.equal(quiet.s.game.potions.heal, false, 'potion is used even if nobody was bitten');
});

test('hunter never learns the bite, keeps last aim, and fires even when bitten', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['hunter', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('hunter');
  act(P[0], 'night', { target: P[2].id });
  assert.throws(() => act(P[0], 'night', { target: P[0].id }), /người khác/);
  untilPhase('DISCUSSION');
  // Night 2: the hunter does nothing, so the gun stays on P[2]; wolves bite the hunter.
  untilNightRole('hunter');
  const hunterView = viewFor(s, P[0].id, 0, 1);
  assert.equal(hunterView.me.task.lastAim, P[2].id);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(P[2].alive, false, 'the gun fires even though the hunter was bitten at night');
  assert.deepEqual(new Set(s.game.lastNightDeaths), new Set([P[0].id, P[2].id]));
  const villagerView = JSON.stringify(viewFor(s, P[3].id, 0, 1));
  assert.ok(!villagerView.includes('"wolf"') && !villagerView.includes('hunter_aim'), 'causes are not sent to players');
});

test('wakeAt tells clients when the phase ends', () => {
  const { s, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  const v = viewFor(s, s.players[0].id, clock.now, 1);
  assert.equal(v.game.wakeAt, s.game.phaseEndsAt);
});

test('lovers die together and a cross-team couple can win', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['cupid', 'werewolf', 'villager', 'villager', 'villager']);
  untilNightRole('cupid');
  act(P[0], 'night', { target: P[1].id });
  act(P[0], 'night', { target: P[2].id });
  assert.deepEqual(s.game.lovers, [P[1].id, P[2].id]);
  assert.equal(viewFor(s, P[2].id, 0, 1).me.lover, null, 'not while Cupid is still choosing');
  // No wake-up for the couple: each one's card shows the other once Cupid is done.
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[2].id, 0, 1).me.lover, P[1].id);
  assert.equal(viewFor(s, P[1].id, 0, 1).me.lover, P[2].id);
  assert.equal(viewFor(s, P[3].id, 0, 1).me.lover, null);
  assert.ok(s.narration.clips.some(c => c.k === 'lovers_note'), 'the narrator says where to look');
  act(P[1], 'night', { target: P[3].id });
  untilPhase('MORNING');
  // Kill everyone but the couple: the lovers win, not the wolves.
  P[0].alive = false;
  P[4].alive = false;
  assert.equal(checkWin(s).winner, 'lovers');
});

test('lynching one lover takes the other one too', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['cupid', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('cupid');
  act(P[0], 'night', { target: P[3].id });
  act(P[0], 'night', { target: P[4].id });
  untilPhase('VOTE');
  const voters = P.filter(p => p.id !== P[3].id);
  voters.forEach(v => act(v, 'vote', { target: P[3].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('VERDICT');
  assert.equal(P[3].alive, false);
  assert.equal(P[4].deathCause, 'heartbreak');
  // The narrator just says who else died, never why: that would expose the couple.
  const keys = s.narration.clips.map(c => c.k);
  assert.ok(keys.includes('also_died') && keys.includes(`seat_${P[4].seat}`));
  assert.ok(!keys.includes('lover_death'));
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).game.lovers, [], 'nor the view');
});

test('night wake-up order follows the house rules', () => {
  const { s } = setup(['thief', 'cupid', 'guard', 'werewolf', 'werewolf', 'seer', 'witch', 'piper', 'elder', 'hunter', 'villager', 'villager', 'villager'], { extras: ['villager', 'villager'] });
  assert.deepEqual(s.game.queue, [
    'thief', 'cupid', 'guard', 'werewolf', 'seer', 'witch', 'piper', 'elder', 'hunter'
  ]);
});

test('thief can swap for a spare card and must take one when both are wolves', () => {
  const { s, P, act } = setup(['thief', 'werewolf', 'villager', 'villager', 'villager', 'seer', 'villager', 'villager'], { extras: ['werewolf', 'werewolf'] });
  assert.equal(s.game.queue[s.game.step], 'thief');
  assert.throws(() => act(P[0], 'thief', { pick: null }), /bắt buộc/);
  act(P[0], 'thief', { pick: 1 });
  assert.equal(P[0].role, 'werewolf');
  assert.deepEqual(s.game.thiefExtras, ['werewolf', 'thief']);
  assert.ok(viewFor(s, P[1].id, 0, 1).me.wolves.includes(P[0].id), 'the old wolf sees the new one');
});

test('thief deck has two extra cards', () => {
  let now = 0;
  const rng = seeded(3);
  const { state: s, player: host } = createRoom({ code: 'THF01', hostName: 'Host', now, rng, debug: true });
  for (let i = 0; i < 4; i++) applyAction(s, host.id, 'addBot', {}, now, rng);
  applyAction(s, host.id, 'role', { roleId: 'thief', delta: 1 }, now, rng);
  assert.throws(() => applyAction(s, host.id, 'start', {}, now, rng), /2 lá dư/);
  applyAction(s, host.id, 'role', { roleId: 'villager', delta: 1 }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  assert.equal(s.game.thiefExtras.length, 2);
  assert.equal(s.players.filter(p => p.inGame).length + 2, 7);
});

test('piper charms two per night, the charmed see each other, and the piper can win', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['piper', 'werewolf', 'villager', 'villager', 'villager']);
  untilNightRole('piper');
  assert.throws(() => act(P[0], 'night', { target: P[0].id }));
  act(P[0], 'night', { target: P[2].id });
  act(P[0], 'night', { target: P[3].id });
  assert.equal(viewFor(s, P[2].id, 0, 1).me.charmed, false, 'not while the Piper is still choosing');
  // No wake-up for the charmed: their cards show each other once the Piper is done.
  untilPhase('MORNING');
  const v = viewFor(s, P[2].id, 0, 1);
  assert.equal(v.me.charmed, true);
  assert.deepEqual(v.me.charmedWith, [P[3].id]);
  assert.equal(viewFor(s, P[4].id, 0, 1).me.charmedWith, undefined, 'nobody else learns who is charmed');
  // Charm the rest and kill nobody: the piper wins at dawn.
  s.game.charmed.push(P[1].id, P[4].id);
  untilPhase('GAME_OVER');
  assert.equal(s.game.winner, 'piper');
});

test('village needs the piper dead too', () => {
  const { s, P } = setup(['piper', 'werewolf', 'villager', 'villager', 'villager']);
  P[1].alive = false;
  assert.equal(checkWin(s), null);
  P[0].alive = false;
  assert.equal(checkWin(s).winner, 'village');
});

test('elder survives the first bite only', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['elder', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilNightRole('elder');
  act(P[0], 'ack', {});
  untilPhase('MORNING');
  assert.equal(P[0].alive, true);
  assert.deepEqual(s.game.lastNightDeaths, []);
  assert.ok(!s.game.queue.includes('elder') || s.game.day === 1);
  untilPhase('DISCUSSION');
  untilNightRole('werewolf');
  assert.ok(!s.game.queue.includes('elder'), 'elder only wakes on the first night');
  act(P[1], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
});

test('dead roles are still called at night so nothing leaks', () => {
  const { s, P, untilPhase } = setup(['seer', 'werewolf', 'villager', 'villager', 'villager']);
  P[0].alive = false;
  untilPhase('DISCUSSION');
  untilPhase('NIGHT');
  assert.ok(s.game.queue.includes('seer'));
});

test('dead players cannot vote and votes need a valid session token', () => {
  const { s, P, act, untilPhase } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  untilPhase('VOTE');
  P[4].alive = false;
  assert.throws(() => act(P[4], 'vote', { target: P[1].id }), /bị loại/);
  assert.throws(() => authenticate(s, P[2].id, 'wrong-token'), GameError);
});

test('a room full of bots plays to the end', () => {
  const rng = seeded(7);
  let now = 5_000_000;
  const { state: s, player: host } = createRoom({ code: 'BOTS1', hostName: 'Host', now, rng, debug: true });
  applyAction(s, host.id, 'config', { hostPlays: false }, now, rng);
  for (let i = 0; i < 9; i++) applyAction(s, host.id, 'addBot', {}, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  for (let i = 0; i < 20000 && s.phase !== 'GAME_OVER'; i++) {
    now += 1000;
    tick(s, now, rng);
  }
  assert.equal(s.phase, 'GAME_OVER');
  assert.ok(['village', 'werewolf', 'lovers'].includes(s.game.winner));
  applyAction(s, host.id, 'restart', {}, now, rng);
  assert.equal(s.phase, 'LOBBY');
  assert.ok(s.players.every(p => p.role === null && p.alive));
});

test('store compare-and-set retries instead of losing concurrent writes', async () => {
  globalThis.__masoiRooms = new Map();
  const { getStore } = await import('../lib/store.js');
  setStoreForTests(undefined);
  const store = getStore();
  assert.equal(store.kind, 'memory');
  const { state } = createRoom({ code: 'CAS01', hostName: 'Host', now: 0 });
  assert.ok(await createRoomRecord(store, 'CAS01', state));
  assert.ok(!(await createRoomRecord(store, 'CAS01', state)), 'cannot create twice');
  const notFound = () => new Error('missing');
  await Promise.all(Array.from({ length: 6 }, (_, i) =>
    mutateRoom(store, 'CAS01', (s) => { joinRoom(s, `Người ${i}`, 0); return {}; }, notFound)
  ));
  const saved = await store.load('CAS01');
  assert.equal(saved.state.players.length, 7);
  assert.equal(saved.version, 7);
});

// Minimal stand-in for Supabase's PostgREST + Realtime REST endpoints, enough to
// check the requests the store sends and the compare-and-set behaviour.
function fakeSupabase() {
  const rows = new Map();
  const broadcasts = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    assert.equal(init.headers.apikey, 'service-key');
    const reply = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status });
    if (u.pathname === '/realtime/v1/api/broadcast') {
      broadcasts.push(JSON.parse(init.body));
      return reply(202);
    }
    assert.equal(u.pathname, '/rest/v1/rooms');
    const code = u.searchParams.get('code')?.replace('eq.', '');
    if (init.method === 'GET') {
      const row = rows.get(code);
      return reply(200, row ? [{ state: row.state, version: row.version, updated_at: row.updated_at }] : []);
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (rows.has(body.code)) return reply(409, { code: '23505', message: 'duplicate key' });
      rows.set(body.code, body);
      return reply(201);
    }
    if (init.method === 'PATCH') {
      const expected = Number(u.searchParams.get('version').replace('eq.', ''));
      const row = rows.get(code);
      if (!row || row.version !== expected) return reply(200, []);
      Object.assign(row, JSON.parse(init.body));
      return reply(200, [{ version: row.version }]);
    }
    if (init.method === 'DELETE') {
      const before = u.searchParams.get('updated_at')?.replace('lt.', '');
      for (const [k, row] of rows) {
        if ((!code || k === code) && (!before || row.updated_at < before)) rows.delete(k);
      }
      return reply(204);
    }
    throw new Error('unexpected ' + init.method);
  };
  return { rows, broadcasts, fetch };
}

test('supabase store: create, compare-and-set, and version-only broadcast', async () => {
  const fake = fakeSupabase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const store = _supabaseStoreForTests('https://demo.supabase.co/', 'service-key');
    const { state } = createRoom({ code: 'SUPA1', hostName: 'Host', now: 0 });
    assert.ok(await createRoomRecord(store, 'SUPA1', state));
    assert.ok(!(await createRoomRecord(store, 'SUPA1', state)), 'duplicate code is rejected');
    assert.ok(!(await store.cas('SUPA1', 5, state, 6)), 'stale version is rejected');
    const notFound = () => new Error('missing');
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      mutateRoom(store, 'SUPA1', (s) => { joinRoom(s, `Người ${i}`, 0); return {}; }, notFound)
    ));
    const saved = await store.load('SUPA1');
    assert.equal(saved.state.players.length, 5);
    assert.equal(saved.version, 5);
    await store.notify('SUPA1', 5);
    assert.deepEqual(fake.broadcasts[0].messages[0], { topic: 'room:SUPA1', event: 'update', payload: { v: 5 }, private: false });
    assert.equal(await store.load('NOPE1'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('rooms nobody has touched for 30 minutes are gone', async () => {
  const fake = fakeSupabase();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    const store = _supabaseStoreForTests('https://demo.supabase.co/', 'service-key');
    const { state } = createRoom({ code: 'IDLE1', hostName: 'Host', now: 0 });
    await createRoomRecord(store, 'IDLE1', state);
    await createRoomRecord(store, 'BUSY1', state);
    fake.rows.get('IDLE1').updated_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    fake.rows.get('BUSY1').updated_at = new Date(Date.now() - 29 * 60 * 1000).toISOString();
    assert.equal(await store.load('IDLE1'), null);
    assert.ok(!fake.rows.has('IDLE1'), 'an expired room is deleted when read');
    assert.ok(await store.load('BUSY1'));
    assert.ok(await createRoomRecord(store, 'IDLE1', state), 'the code can be used again');
  } finally {
    globalThis.fetch = realFetch;
  }

  setStoreForTests(undefined);
  const mem = getStore();
  const { state } = createRoom({ code: 'IDLE2', hostName: 'Host', now: 0 });
  await createRoomRecord(mem, 'IDLE2', state);
  globalThis.__masoiRooms.get('IDLE2').updatedAt = Date.now() - 31 * 60 * 1000;
  assert.equal(await mem.load('IDLE2'), null);
});

test('bots finish games that use every role', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rng = seeded(seed);
    let now = 9_000_000;
    const { state: s, player: host } = createRoom({ code: 'ALL01', hostName: 'Host', now, rng, debug: true });
    applyAction(s, host.id, 'config', { hostPlays: false }, now, rng);
    for (let i = 0; i < 12; i++) applyAction(s, host.id, 'addBot', {}, now, rng);
    const want = { werewolf: 3, seer: 1, guard: 1, witch: 1, hunter: 1, cupid: 1, thief: 1, piper: 1, elder: 1, villager: 3 };
    for (const roleId of Object.keys(s.roleCounts)) {
      const n = want[roleId] || 0;
      while ((s.roleCounts[roleId] || 0) < n) applyAction(s, host.id, 'role', { roleId, delta: 1 }, now, rng);
      while ((s.roleCounts[roleId] || 0) > n) applyAction(s, host.id, 'role', { roleId, delta: -1 }, now, rng);
    }
    applyAction(s, host.id, 'start', {}, now, rng);
    for (let i = 0; i < 8000 && s.phase !== 'GAME_OVER'; i++) {
      now += 1000;
      tick(s, now, rng);
    }
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
  }
});

test('no player ever learns another player\'s role or secret before the game ends', () => {
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const rng = seeded(seed);
    let now = 9_000_000;
    const { state: s, player: host } = createRoom({ code: 'LEAK1', hostName: 'Host', now, rng });
    applyAction(s, host.id, 'config', { hostPlays: false }, now, rng);
    applyAction(s, host.id, 'addBot', { count: 12 }, now, rng);
    // Odd seeds use the newer roles.
    const want = seed % 2
      ? { werewolf: 1, wolf_cub: 1, avenger: 1, seer: 1, detective: 1, witch: 1, hunter: 1, priest: 1, medium: 1, fool: 1, villager: 2 }
      : { werewolf: 3, seer: 1, guard: 1, witch: 1, hunter: 1, cupid: 1, thief: 1, piper: 1, elder: 1, villager: 3 };
    for (const roleId of Object.keys(s.roleCounts)) {
      const n = want[roleId] || 0;
      while ((s.roleCounts[roleId] || 0) < n) applyAction(s, host.id, 'role', { roleId, delta: 1 }, now, rng);
      while ((s.roleCounts[roleId] || 0) > n) applyAction(s, host.id, 'role', { roleId, delta: -1 }, now, rng);
    }
    applyAction(s, host.id, 'start', {}, now, rng);
    for (let i = 0; i < 8000 && s.phase !== 'GAME_OVER'; i++) {
      now += 1000;
      tick(s, now, rng);
      if (s.phase === 'GAME_OVER') break;
      for (const p of s.players.filter(x => x.inGame)) {
        const v = viewFor(s, p.id, now, 1);
        for (const o of v.players) {
          if (o.id === p.id || !o.role) continue;
          const pack = ['werewolf', 'wolf_cub', 'avenger'];
          assert.ok(pack.includes(p.role) && pack.includes(o.role), `seed ${seed}: ${p.role} saw a ${o.role}`);
        }
        assert.deepEqual(v.game.lovers, [], 'the couple stays secret');
        assert.ok(!v.game.powersLost, 'the Elder\'s fate stays secret');
        if (v.me.lover) assert.ok(s.game.lovers.includes(p.id));
        if (v.me.charmedWith) assert.ok(s.game.charmed.includes(p.id));
      }
      const keys = s.narration?.clips.map(c => c.k) || [];
      assert.ok(!keys.some(k => /hunter_fire|lover_death|elder_betrayed/.test(k)), `seed ${seed}: narration explained a death`);
      const deathKeys = keys.includes('revived') ? keys.slice(0, keys.indexOf('revived')) : keys;
      const seats = deathKeys.filter(k => k.startsWith('seat_')).map(k => Number(k.slice(5)));
      if (keys.includes('morning_deaths')) assert.deepEqual(seats, [...seats].sort((a, b) => a - b), 'deaths read by seat');
    }
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
  }
});

test('lynching the elder strips every village power for the rest of the game', () => {
  const { s, P, act, endPhase, untilNightRole, untilPhase } = setup(['elder', 'werewolf', 'seer', 'hunter', 'villager', 'villager', 'villager']);
  untilNightRole('hunter');
  act(P[3], 'night', { target: P[4].id });
  untilPhase('VOTE');
  const voters = P.filter(p => p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  endPhase();
  assert.equal(P[0].alive, false);
  assert.equal(s.game.powersLost, true);
  // Kept secret: announcing it would tell everyone the hanged player was the Elder.
  assert.ok(!s.narration.clips.some(c => c.k === 'elder_betrayed'));
  assert.ok(!viewFor(s, P[4].id, 0, 1).game.powersLost, 'a villager is not told');
  assert.ok(!viewFor(s, P[4].id, 0, 1).me.powerless);
  assert.equal(viewFor(s, P[2].id, 0, 1).me.powerless, true, 'the seer learns it on their own card');
  untilNightRole('seer');
  assert.equal(viewFor(s, P[2].id, 0, 1).me.task.powerless, true);
  assert.throws(() => act(P[2], 'night', { target: P[1].id }), /mất chức năng/);
  // The hunter's gun no longer fires either.
  untilNightRole('hunter');
  assert.throws(() => act(P[3], 'night', { target: P[5].id }), /mất chức năng/);
  untilPhase('VOTE');
  const voters2 = P.filter(p => p.alive && p.id !== P[3].id);
  voters2.forEach(v => act(v, 'vote', { target: P[3].id }));
  untilPhase('JUDGE');
  voters2.forEach(v => act(v, 'judge', { choice: 'kill' }));
  endPhase();
  assert.equal(P[3].alive, false);
  assert.equal(P[4].alive, true, 'powerless hunter takes nobody with them');
});

test('deaths are announced in seat order, never in the order they happened', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['villager', 'witch', 'cupid', 'villager', 'werewolf', 'villager', 'villager']);
  untilNightRole('cupid');
  act(P[2], 'night', { target: P[0].id });
  act(P[2], 'night', { target: P[6].id });
  untilNightRole('werewolf');
  act(P[4], 'night', { target: P[6].id }); // bitten: the highest seat
  untilNightRole('witch');
  act(P[1], 'witch', { use: 'poison', target: P[3].id });
  untilPhase('MORNING');
  const seats = s.narration.clips.filter(c => c.k.startsWith('seat_')).map(c => Number(c.k.slice(5)));
  assert.deepEqual(seats, [P[0].seat, P[3].seat, P[6].seat], 'bitten, poisoned and heartbroken all read by seat');
  assert.deepEqual(s.game.lastNightDeaths, [P[0].id, P[3].id, P[6].id]);
});

test('the log is for the moderator, or for a playing host once the game is over', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['werewolf', 'seer', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[2].id });
  untilNightRole('seer');
  act(P[1], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).game.log, [], 'players see no log');
  assert.deepEqual(viewFor(s, P[0].id, 0, 1).game.log, [], 'nor the playing host during the game');
  // The log says who did what.
  const text = s.game.log.join('\n');
  assert.match(text, /Bầy Sói .*cắn .*P3/);
  assert.match(text, /Tiên Tri .*soi .*Chủ.*Sói/);
  assert.match(text, /P3 .*bị Sói cắn/);
  P[1].alive = false;
  P[3].alive = false;
  untilPhase('GAME_OVER');
  assert.ok(viewFor(s, P[0].id, 0, 1).game.log.length > 0, 'the host reads it after the game');
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).game.log, [], 'other players still do not');
  // A host who only moderates sees it all along.
  const { state, player: host } = createRoom({ code: 'MOD01', hostName: 'Host', now: 0 });
  applyAction(state, host.id, 'config', { hostPlays: false }, 0);
  applyAction(state, host.id, 'addBot', { count: 4 }, 0);
  applyAction(state, host.id, 'start', {}, 0);
  assert.ok(viewFor(state, host.id, 0, 1).game.log.length > 0);
});

test('wolf cub wakes with the pack; once it dies the wolves bite two the next night', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['werewolf', 'wolf_cub', 'villager', 'villager', 'villager', 'villager', 'villager']);
  assert.equal(viewFor(s, P[0].id, 0, 1).players[1].role, 'wolf_cub', 'the pack knows the cub');
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).me.wolves, [P[0].id]);
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[1].id, 0, 1).me.task.role, 'werewolf', 'the cub hunts too');
  assert.equal(s.game.night.wolfKills, 1);
  act(P[0], 'night', { target: P[2].id });
  act(P[1], 'night', { target: P[2].id });
  assert.equal(s.game.night.complete, true);
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[1].id);
  voters.forEach(v => act(v, 'vote', { target: P[1].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('VERDICT');
  assert.equal(P[1].alive, false);
  untilNightRole('werewolf');
  assert.equal(s.game.night.wolfKills, 2, 'revenge night');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.kills, 2);
  act(P[0], 'night', { target: P[3].id });
  act(P[0], 'night', { target: P[4].id });
  untilPhase('MORNING');
  assert.equal(P[3].alive, false);
  assert.equal(P[4].alive, false);
  untilNightRole('werewolf');
  assert.equal(s.game.night.wolfKills, 1, 'only once');
});

test('priest: holy water once per game; a wolf dies, a villager costs the priest their life', () => {
  const g = setup(['priest', 'werewolf', 'wolf_cub', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('priest');
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[0].id }));
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'the cub is a wolf too');
  assert.equal(g.P[0].alive, true);
  g.untilNightRole('priest');
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.task.used, true);
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[1].id }), /đã dùng/);

  const h = setup(['priest', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('priest');
  h.act(h.P[0], 'night', { target: h.P[3].id });
  h.untilPhase('MORNING');
  assert.equal(h.P[3].alive, true, 'the villager is unharmed');
  assert.equal(h.P[0].alive, false, 'the priest pays for it');
  assert.ok(h.s.narration.clips.some(c => c.k === `seat_${h.P[0].seat}`), 'announced like any death');

  const k = setup(['priest', 'werewolf', 'fool', 'villager', 'villager', 'villager']);
  k.untilNightRole('priest');
  k.act(k.P[0], 'night', { target: k.P[2].id });
  k.untilPhase('MORNING');
  assert.ok(k.P[0].alive && k.P[2].alive, 'a third-party player: nothing happens');
});

test('medium brings one dead player back, once per game', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['medium', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  assert.ok(!s.game.queue.includes('medium'), 'not called while nobody has died');
  act(P[1], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, false);
  untilNightRole('medium');
  assert.throws(() => act(P[0], 'night', { target: P[3].id }), /đã chết/, 'only the dead');
  assert.deepEqual(viewFor(s, P[0].id, 0, 1).me.task.dead, [P[2].id]);
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, true);
  assert.equal(P[2].role, 'seer', 'back with the same card');
  const keys = s.narration.clips.map(c => c.k);
  assert.ok(keys.includes('revived') && keys.includes(`seat_${P[2].seat}`));
  untilNightRole('werewolf');
  assert.ok(!s.game.queue.includes('medium'), 'not called once the power is used');
});

test('the madman (third party) wins alone when the village hangs them', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['fool', 'werewolf', 'seer', 'villager', 'villager']);
  untilNightRole('seer');
  act(P[2], 'night', { target: P[0].id });
  assert.equal(s.game.night.seerResult, 'village', 'the seer only tells wolf from not-wolf');
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('GAME_OVER');
  assert.equal(s.game.winner, 'fool');
  assert.ok(s.narration.clips.some(c => c.k === 'win_fool'));
});

test('avenger wolf: hunts with the pack, marks a target, takes it along only when hanged', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['avenger', 'werewolf', 'seer', 'witch', 'villager', 'villager', 'villager', 'villager']);
  assert.equal(viewFor(s, P[1].id, 0, 1).players[0].role, 'avenger', 'the pack knows the avenger');
  assert.deepEqual(viewFor(s, P[0].id, 0, 1).me.wolves, [P[1].id]);
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.role, 'werewolf', 'hunts with the pack');
  untilNightRole('seer');
  act(P[2], 'night', { target: P[0].id });
  assert.equal(s.game.night.seerResult, 'werewolf');
  untilNightRole('avenger');
  act(P[0], 'night', { target: P[4].id });
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('VERDICT');
  assert.equal(P[0].alive, false);
  assert.equal(P[4].alive, false, 'the marked player dies with the hanged avenger');
  assert.equal(P[4].deathCause, 'avenger');

  // Poisoned at night: no revenge.
  const g = setup(['avenger', 'werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('witch');
  g.act(g.P[2], 'witch', { use: 'poison', target: g.P[0].id });
  g.untilNightRole('avenger');
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  assert.equal(g.P.filter(p => !p.alive).length, 1);
});

test('detective: picks two players and learns whether they are on the same side', () => {
  const { s, P, act, untilNightRole } = setup(['detective', 'werewolf', 'avenger', 'villager', 'fool', 'villager', 'villager']);
  untilNightRole('detective');
  act(P[0], 'night', { target: P[1].id });
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.result, null, 'needs two');
  act(P[0], 'night', { target: P[2].id });
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.result, 'same', 'wolf and avenger are both wolves');
  assert.throws(() => act(P[0], 'night', { target: P[3].id }), /đã kiểm tra/);
  act(P[0], 'detectiveDone', {});
  assert.equal(s.game.night.complete, true);
  const g = setup(['detective', 'werewolf', 'villager', 'fool', 'villager', 'villager']);
  g.untilNightRole('detective');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.act(g.P[0], 'night', { target: g.P[3].id });
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.task.result, 'different', 'villager and madman (third side) differ');
  const k = setup(['detective', 'werewolf', 'fool', 'villager', 'villager', 'villager']);
  k.untilNightRole('detective');
  k.act(k.P[0], 'night', { target: k.P[1].id });
  k.act(k.P[0], 'night', { target: k.P[2].id });
  assert.equal(viewFor(k.s, k.P[0].id, 0, 1).me.task.result, 'different', 'wolf and madman differ');
  const h = setup(['detective', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('detective');
  h.act(h.P[0], 'night', { target: h.P[1].id });
  h.act(h.P[0], 'night', { target: h.P[2].id });
  assert.equal(viewFor(h.s, h.P[0].id, 0, 1).me.task.result, 'different', 'wolf and villager differ');
});

test('the seer only learns wolf or villager', () => {
  const { s, P, act, untilNightRole } = setup(['seer', 'piper', 'wolf_cub', 'villager', 'villager']);
  untilNightRole('seer');
  act(P[0], 'night', { target: P[1].id });
  assert.equal(s.game.night.seerResult, 'village', 'the piper reads as a villager');
  const g = setup(['seer', 'wolf_cub', 'villager', 'villager', 'villager']);
  g.untilNightRole('seer');
  g.act(g.P[0], 'night', { target: g.P[1].id });
  assert.equal(g.s.game.night.seerResult, 'werewolf');
});

test('only the host sees who is connected; others learn only when the host is gone', () => {
  const { s, P, clock, untilNightRole, untilPhase } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  untilPhase('DISCUSSION');
  P.forEach(p => { p.lastSeen = clock.now; });
  P[3].lastSeen = clock.now - 120_000;
  assert.equal(viewFor(s, P[0].id, clock.now, 1).players[3].online, false, 'the host sees it');
  assert.ok(viewFor(s, P[2].id, clock.now, 1).players.every(p => p.online), 'players do not');
  // A playing host does not see it at night either (it would show who is awake).
  untilNightRole('werewolf');
  P.forEach(p => { p.lastSeen = clock.now; });
  P[3].lastSeen = clock.now - 120_000;
  assert.ok(viewFor(s, P[0].id, clock.now, 1).players.every(p => p.online));
  // The host's phone goes quiet at night: everyone is told, the vote waits for day.
  P[0].lastSeen = clock.now - 120_000;
  const night = viewFor(s, P[2].id, clock.now, 1).hostOffline;
  assert.deepEqual(night, { night: true }, 'a notice only, no candidates at night');
  untilPhase('MORNING');
  P.forEach(p => { p.lastSeen = clock.now; });
  P[0].lastSeen = clock.now - 120_000;
  const day = viewFor(s, P[2].id, clock.now, 1).hostOffline;
  assert.ok(day.candidates.length > 0, 'by day the vote opens');
});

test('a non-playing host sees connections at any time', () => {
  const { state: s, player: host } = createRoom({ code: 'MOD02', hostName: 'Host', now: 0 });
  const lan = joinRoom(s, 'Lan', 0);
  applyAction(s, host.id, 'config', { hostPlays: false, swapEnabled: false }, 0);
  applyAction(s, host.id, 'addBot', { count: 3 }, 0);
  applyAction(s, host.id, 'start', {}, 0);
  tick(s, s.game.phaseEndsAt); // past the look at the cards
  assert.equal(s.phase, 'NIGHT');
  lan.lastSeen = -120_000;
  assert.equal(viewFor(s, host.id, 1000, 1).players.find(p => p.id === lan.id).online, false);
});

test('the witch may use both bottles in the same night, each once per game', () => {
  const g = setup(['witch', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilNightRole('witch');
  g.act(g.P[0], 'witch', { use: 'heal' });
  g.act(g.P[0], 'witch', { use: 'poison', target: g.P[3].id });
  assert.throws(() => g.act(g.P[0], 'witch', { use: 'heal' }), /hết|đêm nay|xong/);
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, true, 'healed');
  assert.equal(g.P[3].alive, false, 'poisoned');
  g.untilNightRole('witch');
  const task = viewFor(g.s, g.P[0].id, 0, 1).me.task;
  assert.equal(task.healAvailable, false);
  assert.equal(task.poisonAvailable, false);
});

test('a role only sees its choices once it has been called', () => {
  const { s, P, endPhase } = setup(['guard', 'werewolf', 'villager', 'villager', 'villager']);
  // Night one opens with the welcome, "night falls" and the guard's call.
  assert.equal(s.game.queue[s.game.step], 'guard');
  assert.equal(s.game.nightStage, 'call');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task, null, 'nothing while the narrator is still talking');
  endPhase();
  assert.equal(s.game.nightStage, 'act');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.role, 'guard');
});

test('each role has its own action time; the pack gets longer with more wolves; the host can change it mid-game', () => {
  const { s, P, host, clock, act, endPhase, untilNightRole } = setup(['seer', 'werewolf', 'wolf_cub', 'avenger', 'villager', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  assert.equal(s.game.phaseEndsAt - clock.now, (s.config.step_werewolf + 10) * 1000, '3 pack cards: +5 s for each extra one');
  untilNightRole('seer');
  assert.equal(s.game.phaseEndsAt - clock.now, s.config.step_seer * 1000);
  // Mid-game, the host may retime steps but not change who plays.
  applyAction(s, P[0].id, 'config', { step_seer: 45 }, clock.now);
  assert.equal(s.config.step_seer, 45);
  assert.throws(() => applyAction(s, P[0].id, 'config', { hostPlays: false }, clock.now), /phòng chờ/);
  untilNightRole('werewolf');
  untilNightRole('seer');
  assert.equal(s.game.phaseEndsAt - clock.now, 45_000);
});

test('when the pack is split, the victim is drawn among the most voted', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const { s, P, act, untilNightRole, untilPhase } = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'], { rng: seeded(seed) });
    untilNightRole('werewolf');
    act(P[0], 'night', { target: P[2].id });
    act(P[1], 'night', { target: P[3].id });
    untilPhase('MORNING');
    const dead = [P[2], P[3]].filter(p => !p.alive);
    assert.equal(dead.length, 1, `seed ${seed}: exactly one of the tied targets dies`);
    assert.ok(P.slice(4).every(p => p.alive));
    seen.add(dead[0] === P[2] ? 'first' : 'second');
  }
  assert.equal(seen.size, 2, 'either one can be drawn');
});

test('a role\'s step ends by itself once it is done; a step nobody can play ends at a random time', () => {
  const { s, P, clock, act, untilNightRole, endPhase } = setup(['seer', 'werewolf', 'villager', 'villager', 'villager'], { config: { step_seer: 20 } });
  untilNightRole('seer');
  assert.throws(() => act(P[2], 'endTurn', {}), /lượt của bạn/);
  clock.advance(6000);
  act(P[0], 'night', { target: P[1].id });
  assert.equal(s.game.phaseEndsAt, clock.now + 4000, 'a few seconds to read the result, then on');
  // A dead seer cannot press it: the slot ends early anyway, at a random time.
  const lengths = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const g = setup(['seer', 'werewolf', 'villager', 'villager', 'villager'], { rng: seeded(seed) });
    g.P[0].alive = false;
    g.untilNightRole('seer');
    const len = g.s.game.phaseEndsAt - g.clock.now;
    assert.ok(len >= 5000 && len <= 15000, `seed ${seed}: ${len}`);
    lengths.add(len);
  }
  assert.ok(lengths.size > 1, 'not always the same length');
});

test('the elder dying to wolves does not cost the village its powers', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['elder', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  s.game.elderShield = false;
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(s.game.powersLost, false);
});

test('the narrator is never cut off: each narration starts after the previous one ends', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const rng = seeded(seed);
    let now = 20_000_000;
    const { state: s, player: host } = createRoom({ code: 'TALK1', hostName: 'Host', now, rng, debug: true });
    applyAction(s, host.id, 'config', { hostPlays: false }, now, rng);
    for (let i = 0; i < 12; i++) applyAction(s, host.id, 'addBot', {}, now, rng);
    const want = { werewolf: 3, seer: 1, guard: 1, witch: 1, hunter: 1, cupid: 1, thief: 1, piper: 1, elder: 1, villager: 3 };
    for (const roleId of Object.keys(s.roleCounts)) {
      const n = want[roleId] || 0;
      while ((s.roleCounts[roleId] || 0) < n) applyAction(s, host.id, 'role', { roleId, delta: 1 }, now, rng);
      while ((s.roleCounts[roleId] || 0) > n) applyAction(s, host.id, 'role', { roleId, delta: -1 }, now, rng);
    }
    applyAction(s, host.id, 'start', {}, now, rng);
    let prev = s.narration;
    let checked = 0;
    for (let i = 0; i < 20000 && s.phase !== 'GAME_OVER'; i++) {
      now += 250;
      tick(s, now, rng);
      const cur = s.narration;
      if (cur.seq !== prev.seq) {
        assert.ok(cur.at >= prev.endsAt, `seed ${seed}: "${cur.clips[0].k}" started ${prev.endsAt - cur.at} ms before "${prev.clips.at(-1).k}" finished`);
        checked++;
        prev = cur;
      }
    }
    assert.equal(s.phase, 'GAME_OVER');
    assert.ok(checked > 10);
  }
});

test('each night step is call, then act, then sleep, with fixed lengths', () => {
  const { s, P, act, clock, endPhase } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  const cfg = s.config;
  // First step: the call slot stretches to fit the opening narration.
  assert.equal(s.game.nightStage, 'call');
  assert.ok(s.game.phaseEndsAt >= s.narration.endsAt);
  assert.ok(s.game.phaseEndsAt - s.narration.endsAt < 1000, 'action timer starts right after the call');
  endPhase();
  assert.equal(s.game.nightStage, 'act');
  assert.equal(s.game.phaseEndsAt - clock.now, cfg.step_werewolf * 1000, 'the first step here is the pack');
  // Acting ends the slot early, but never before the 5 s minimum that a
  // step nobody can play also keeps (timing gives nothing away).
  act(P[1], 'night', { target: P[3].id });
  assert.equal(s.game.phaseEndsAt, clock.now + 5000);
  endPhase();
  assert.equal(s.game.nightStage, 'sleep');
  const chained = s.narration;
  assert.deepEqual(chained.clips.map(c => c.k), ['werewolf_sleep', 'pause', 'seer_wake'],
    'go-to-sleep, a short pause and the next wake call are one narration');
  assert.equal(chained.clips[1].ms, cfg.nightPauseTime * 1000);
  assert.throws(() => act(P[1], 'night', { target: P[4].id }), /hết lượt/);
  endPhase();
  assert.equal(s.game.queue[s.game.step], 'seer');
  assert.equal(s.game.nightStage, 'call');
  assert.equal(s.narration.seq, chained.seq, 'no new narration: the host is already reading the call');
  // The action timer starts right after the queued call has been read.
  assert.ok(s.game.phaseEndsAt - chained.endsAt < 1000);
});

test('after the verdict the narrator announces the night and counts down 10 s', () => {
  const { s, untilPhase } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  untilPhase('VERDICT');
  assert.ok(s.narration.clips.some(c => c.k === 'night_soon'));
  assert.ok(s.game.phaseEndsAt >= s.narration.endsAt + 10000);
  untilPhase('NIGHT');
  assert.equal(s.game.day, 2);
});

test('rooms saved before the night slot settings existed still work', () => {
  const { s, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  delete s.config.step_werewolf;
  delete s.config.step_seer;
  delete s.config.nightPauseTime;
  for (let i = 0; i < 10; i++) {
    clock.advance(Math.max(0, s.game.phaseEndsAt - clock.now));
    assert.ok(Number.isFinite(s.game.phaseEndsAt), 'phase end stays a number');
  }
});

test('the game opens: welcome, a 10 s look at the cards, then night falls and the first call', () => {
  const { state: s, player: host } = createRoom({ code: 'OPEN1', hostName: 'Host', now: 0 });
  applyAction(s, host.id, 'config', { swapEnabled: false }, 0);
  applyAction(s, host.id, 'addBot', { count: 4 }, 0);
  applyAction(s, host.id, 'start', {}, 0);
  assert.equal(s.phase, 'REVEAL', 'everyone looks at their card first');
  assert.deepEqual(s.narration.clips.map(c => c.k), ['game_start', 'pause', 'game_soon']);
  assert.ok(s.game.phaseEndsAt >= 10000);
  tick(s, s.game.phaseEndsAt);
  assert.equal(s.phase, 'NIGHT');
  const clips = s.narration.clips;
  assert.deepEqual(clips.map(c => c.k).slice(0, 2), ['night_start', 'pause']);
  assert.equal(clips[1].ms, 5000);
});

test('with the swap on: swap phase, then the look at the cards, then night', () => {
  const { state: s, player: host } = createRoom({ code: 'OPEN2', hostName: 'Host', now: 0 });
  applyAction(s, host.id, 'config', { swapEnabled: true, swapTime: 15 }, 0);
  applyAction(s, host.id, 'addBot', { count: 4 }, 0);
  applyAction(s, host.id, 'start', {}, 0);
  assert.equal(s.phase, 'SWAP');
  tick(s, s.game.phaseEndsAt);
  assert.equal(s.phase, 'REVEAL');
  tick(s, s.game.phaseEndsAt);
  assert.equal(s.phase, 'NIGHT');
});

test('a silent host phone is replaced by a majority vote, with no new secrets', () => {
  const { untilPhase, s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager'], { config: { hostPlays: true } });
  untilPhase('DISCUSSION'); // host votes happen by day
  const t = clock.now;
  const host = P[0];
  P.forEach(p => { p.lastSeen = t; });
  assert.equal(viewFor(s, P[1].id, t, 1).hostOffline, null);
  assert.throws(() => applyAction(s, P[1].id, 'hostVote', { candidate: P[2].id }, t), /kết nối lại/);

  // The host goes quiet; everyone else keeps checking in.
  const later = t + 13000;
  P.slice(1).forEach(p => { p.lastSeen = later; });
  const v = viewFor(s, P[1].id, later, 2).hostOffline;
  assert.ok(v, 'players see the host is offline');
  assert.equal(v.needed, 3, 'majority of the 4 players still here');
  assert.ok(!v.candidates.includes(host.id));

  applyAction(s, P[1].id, 'hostVote', { candidate: P[2].id }, later);
  applyAction(s, P[3].id, 'hostVote', { candidate: P[2].id }, later);
  assert.equal(s.hostId, host.id, 'two votes are not enough');
  applyAction(s, P[2].id, 'hostVote', { candidate: P[2].id }, later);
  assert.equal(s.hostId, P[2].id, 'third vote hands over the host phone');
  assert.deepEqual(s.hostVotes, {});

  const newHost = viewFor(s, P[2].id, later, 3);
  assert.equal(newHost.me.isHost, true);
  assert.equal(newHost.me.moderatorNight, undefined, 'a playing host gets no moderator view');
  assert.deepEqual(newHost.players.filter(p => p.role).map(p => p.id), [P[2].id], 'still only sees their own card');
  assert.equal(viewFor(s, host.id, later, 3).me.isHost, false, 'the old host is a normal player when back');
});

test('when the host leaves the lobby, the next player hosts and also plays', () => {
  let now = 0;
  const { state: s, player: host } = createRoom({ code: 'LEAVE', hostName: 'Host', now });
  joinRoom(s, 'An', now);
  joinRoom(s, 'Bình', now);
  applyAction(s, host.id, 'config', { hostPlays: false }, now);
  applyAction(s, host.id, 'leave', {}, now);
  assert.equal(s.players.find(p => p.id === s.hostId).name, 'An');
  assert.equal(s.config.hostPlays, true);
  assert.equal(s.players.filter(p => p.seat).length, 2, 'the new host keeps a seat');
});

test('a tied host vote is settled by drawing one of the tied players', () => {
  const picks = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { untilPhase, s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager'], { rng: seeded(seed) });
  untilPhase('DISCUSSION'); // host votes happen by day
    const later = clock.now + 13000;
    P.forEach(p => { p.lastSeen = p === P[0] ? clock.now : later; });
    // 4 players left: two votes each for P[1] and P[2], everyone has voted.
    const rng = seeded(seed * 31);
    applyAction(s, P[1].id, 'hostVote', { candidate: P[1].id }, later, rng);
    applyAction(s, P[2].id, 'hostVote', { candidate: P[2].id }, later, rng);
    applyAction(s, P[3].id, 'hostVote', { candidate: P[1].id }, later, rng);
    assert.equal(s.hostId, P[0].id, 'not decided while someone has not voted');
    applyAction(s, P[4].id, 'hostVote', { candidate: P[2].id }, later, rng);
    assert.ok([P[1].id, P[2].id].includes(s.hostId), 'one of the tied players wins');
    picks.add(s.hostId === P[1].id ? 'first' : 'second');
    assert.ok(s.game.log.at(-1).includes('bốc thăm'));
  }
  assert.equal(picks.size, 2, 'either tied player can be drawn');
});

test('a host vote closes after 20 s even if some players never vote', () => {
  const { untilPhase, s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  untilPhase('DISCUSSION'); // host votes happen by day
  const later = clock.now + 13000;
  P.forEach(p => { p.lastSeen = p === P[0] ? clock.now : later; });
  applyAction(s, P[1].id, 'hostVote', { candidate: P[3].id }, later);
  assert.equal(resolveHostVote(s, later + 19000), false);
  P.slice(1).forEach(p => { p.lastSeen = later + 19000; });
  assert.equal(resolveHostVote(s, later + 20000), true);
  assert.equal(s.hostId, P[3].id);
});

test('the host can add computer players in a normal (non-debug) room', () => {
  const { state: s, player: host } = createRoom({ code: 'BOTS2', hostName: 'Host', now: 0 });
  for (let i = 0; i < 4; i++) applyAction(s, host.id, 'addBot', {}, 0);
  assert.equal(s.players.filter(p => p.isBot).length, 4);
  applyAction(s, host.id, 'start', {}, 0);
  assert.equal(s.phase, 'SWAP', 'cards are looked at (and may be traded) before the night');
  const bot = s.players.find(p => p.isBot);
  assert.throws(() => applyAction(s, bot.id, 'addBot', {}, 0), /Chủ phòng/);
});

test('the host can add several computer players at once, up to a full room', () => {
  const { state: s, player: host } = createRoom({ code: 'BOTS3', hostName: 'Host', now: 0 });
  applyAction(s, host.id, 'addBot', { count: 5 }, 0);
  assert.equal(s.players.filter(p => p.isBot).length, 5);
  assert.equal(new Set(s.players.map(p => p.name)).size, s.players.length);
  // Asking for more than fits fills the room and stops there.
  applyAction(s, host.id, 'addBot', { count: 50 }, 0);
  assert.equal(s.players.length, MAX_PLAYERS + 1);
  assert.throws(() => applyAction(s, host.id, 'addBot', { count: 1 }, 0), /đầy/);
});

test('a player who lost their session can take their seat back by name once offline', () => {
  const { s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  const lan = P[1];
  const oldToken = lan.token;
  // Still online: the name is taken.
  assert.throws(() => joinRoom(s, 'p2', clock.now), /đang có người dùng/);
  // Gone quiet for a while: same name (any case) gets the same seat and card back.
  clock.advance(60_000);
  const back = joinRoom(s, ' P2 ', clock.now);
  assert.equal(back.id, lan.id);
  assert.equal(back.role, 'werewolf');
  assert.equal(s.players.length, 5);
  assert.notEqual(back.token, oldToken);
  assert.throws(() => authenticate(s, lan.id, oldToken), GameError); // the old phone is signed out
  // A new name still can't join a game in progress.
  assert.throws(() => joinRoom(s, 'Người mới', clock.now), /Ván chơi đang diễn ra/);
});

// ---------------------------------------------------------------------------
// Rules audit: one check per agreed rule, focused on edge cases and on how
// roles interact.
// ---------------------------------------------------------------------------

const lynch = (g, target) => {
  g.untilPhase('VOTE');
  const voters = g.P.filter(p => p.alive && p.id !== target.id);
  voters.forEach(v => g.act(v, 'vote', { target: target.id }));
  g.untilPhase('JUDGE');
  voters.forEach(v => g.act(v, 'judge', { choice: 'kill' }));
  g.endPhase();
};

test('rules: guard may protect themselves from night two; protection stops bites only, not poison', () => {
  const g = setup(['guard', 'werewolf', 'witch', 'villager', 'villager', 'villager']);
  g.untilNightRole('guard');
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[0].id }), /Đêm đầu/);
  g.untilPhase('DISCUSSION');
  g.untilNightRole('guard');
  g.act(g.P[0], 'night', { target: g.P[0].id });
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, true, 'self-protection works');

  const h = setup(['guard', 'werewolf', 'witch', 'villager', 'villager', 'villager']);
  h.untilNightRole('guard');
  h.act(h.P[0], 'night', { target: h.P[3].id });
  h.untilNightRole('witch');
  h.act(h.P[2], 'witch', { use: 'poison', target: h.P[3].id });
  h.untilPhase('MORNING');
  assert.equal(h.P[3].alive, false, 'the guard does not stop poison');
});

test('rules: guard can protect again after skipping a night', () => {
  const g = setup(['guard', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('guard');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('DISCUSSION');
  g.untilNightRole('guard'); // night 2: no choice
  g.untilPhase('DISCUSSION');
  g.untilNightRole('guard'); // night 3: the same player again is fine
  g.act(g.P[0], 'night', { target: g.P[2].id });
  assert.equal(g.s.game.night.guard, g.P[2].id);
});

test('rules: wolves may bite a pack mate, or agree to bite nobody', () => {
  const g = setup(['werewolf', 'werewolf', 'wolf_cub', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.act(g.P[2], 'night', { target: g.P[0].id }); // the cub disagrees
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'the pack bit its own cub');

  const h = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('werewolf');
  h.act(h.P[0], 'night', { noKill: true });
  h.act(h.P[1], 'night', { noKill: true });
  assert.equal(h.s.game.night.complete, true, 'agreed on nobody');
  h.untilPhase('MORNING');
  assert.ok(h.P.every(p => p.alive), 'nobody was bitten');
  assert.ok(h.s.narration.clips.some(c => c.k === 'morning_peace'));

  // "Nobody" is worth no votes: one wolf picking a victim is enough.
  const k = setup(['werewolf', 'werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager']);
  k.untilNightRole('werewolf');
  k.act(k.P[0], 'night', { noKill: true });
  k.act(k.P[1], 'night', { noKill: true });
  k.act(k.P[2], 'night', { noKill: true });
  k.act(k.P[3], 'night', { target: k.P[4].id });
  assert.equal(k.s.game.night.complete, true, 'every wolf has picked, agreeing or not');
  // Each wolf sees what every other wolf picked.
  const votes = viewFor(k.s, k.P[0].id, 0, 1).me.task.votes;
  assert.deepEqual(votes[k.P[3].id], [k.P[4].id]);
  assert.deepEqual(votes[k.P[1].id], ['none']);
  k.untilPhase('MORNING');
  assert.equal(k.P[4].alive, false, '3 x nobody + 1 x a victim: the victim is bitten');
});

test('rules: every wolf card counts for the wolves\' win', () => {
  const g = setup(['werewolf', 'wolf_cub', 'avenger', 'villager', 'villager', 'villager', 'villager']);
  g.P[6].alive = false; // 3 wolves against 3 others
  assert.equal(checkWin(g.s)?.winner, 'werewolf');
});

test('rules: the hunter fires on any death (poison, heartbreak) and keeps the last aim', () => {
  const g = setup(['hunter', 'werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('witch');
  g.act(g.P[2], 'witch', { use: 'poison', target: g.P[0].id });
  g.untilNightRole('hunter');
  g.act(g.P[0], 'night', { target: g.P[4].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  assert.equal(g.P[4].alive, false, 'poisoned hunter still fires');

  const h = setup(['cupid', 'werewolf', 'hunter', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('cupid');
  h.act(h.P[0], 'night', { target: h.P[2].id });
  h.act(h.P[0], 'night', { target: h.P[3].id });
  h.untilNightRole('hunter');
  h.act(h.P[2], 'night', { target: h.P[5].id });
  h.untilPhase('DISCUSSION');
  h.untilNightRole('werewolf');
  h.act(h.P[1], 'night', { target: h.P[3].id }); // bite the hunter's lover
  h.untilPhase('MORNING');
  assert.equal(h.P[2].alive, false, 'the hunter dies of a broken heart');
  assert.equal(h.P[5].alive, false, 'and still fires at the aim kept from night one');
});

test('rules: the elder shield is spent only by a real bite; a second bite kills', () => {
  const g = setup(['elder', 'werewolf', 'guard', 'villager', 'villager', 'villager']);
  g.untilNightRole('guard');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.s.game.elderShield, true, 'guarded: the shield is untouched');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, true);
  assert.equal(g.s.game.elderShield, false, 'first real bite: survives, shield gone');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false, 'second bite kills');
  assert.equal(g.s.game.powersLost, false, 'killed by wolves: the village keeps its powers');
});

test('rules: the witch\'s poison on the elder costs the village its powers', () => {
  const g = setup(['elder', 'werewolf', 'witch', 'seer', 'villager', 'villager']);
  g.untilNightRole('witch');
  g.act(g.P[2], 'witch', { use: 'poison', target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  assert.equal(g.s.game.powersLost, true);
});

test('rules: thief who does not choose keeps the thief card and plays as a villager', () => {
  const g = setup(['thief', 'werewolf', 'villager', 'villager', 'villager'], { extras: ['seer', 'guard'] });
  g.untilNightRole('thief');
  g.untilPhase('DISCUSSION');
  assert.equal(g.P[0].role, 'thief');
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.role, 'thief');
  // A forced take also counts the Wolf Cub as a wolf card.
  const h = setup(['thief', 'werewolf', 'villager', 'villager', 'villager'], { extras: ['werewolf', 'wolf_cub'] });
  h.untilNightRole('thief');
  assert.throws(() => h.act(h.P[0], 'thief', { pick: null }), /bắt buộc/);
  h.untilPhase('DISCUSSION');
  assert.ok(['werewolf', 'wolf_cub'].includes(h.P[0].role), 'took a wolf card when time ran out');
});

test('rules: lovers on the same team win with their team, not as a couple', () => {
  const g = setup(['cupid', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('cupid');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.P[1].alive = false; // the only wolf is gone
  g.P[0].alive = false;
  g.P[4].alive = false;
  assert.equal(checkWin(g.s)?.winner, 'village');
});

test('rules: a dead piper cannot win; the madman alive does not stop the village winning', () => {
  const g = setup(['piper', 'werewolf', 'fool', 'villager', 'villager']);
  g.s.game.charmed = [g.P[1].id, g.P[2].id, g.P[3].id, g.P[4].id];
  g.P[0].alive = false;
  assert.notEqual(checkWin(g.s)?.winner, 'piper');
  g.P[1].alive = false; // last wolf gone, piper dead, madman alive
  assert.equal(checkWin(g.s)?.winner, 'village');
});

test('rules: the detective tells the three sides apart (wolves, village, third side)', () => {
  const g = setup(['detective', 'werewolf', 'piper', 'fool', 'villager', 'villager']);
  g.untilNightRole('detective');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.act(g.P[0], 'night', { target: g.P[3].id });
  assert.equal(g.s.game.night.detectiveResult, 'same', 'piper and madman are both on the third side');
});

test('rules: holy water on a wolf-team cub or avenger kills it; on the piper nothing happens', () => {
  const g = setup(['priest', 'werewolf', 'avenger', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('priest');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false);
  assert.equal(g.P[0].alive, true);
  const h = setup(['priest', 'werewolf', 'piper', 'villager', 'villager', 'villager']);
  h.untilNightRole('priest');
  h.act(h.P[0], 'night', { target: h.P[2].id });
  h.untilPhase('MORNING');
  assert.ok(h.P[0].alive && h.P[2].alive);
});

test('rules: the avenger takes nobody when killed other than by hanging; hanged, the target dies', () => {
  const g = setup(['avenger', 'werewolf', 'hunter', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('avenger');
  g.act(g.P[0], 'night', { target: g.P[4].id });
  g.untilNightRole('hunter');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  g.untilPhase('DISCUSSION');
  lynch(g, g.P[2]); // hang the hunter: his gun kills the avenger
  assert.equal(g.P[0].alive, false);
  assert.equal(g.P[4].alive, true, 'shot, not hanged: no revenge');
});

test('rules: a revived player keeps their card and links (charm, couple)', () => {
  const g = setup(['medium', 'werewolf', 'cupid', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('cupid');
  g.act(g.P[2], 'night', { target: g.P[3].id });
  g.act(g.P[2], 'night', { target: g.P[4].id });
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[5].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[5].alive, false);
  g.untilNightRole('medium');
  g.act(g.P[0], 'night', { target: g.P[5].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[5].alive, true);
  assert.equal(g.P[5].role, 'villager');
});

test('rules: the madman hanged ends the game even if the wolves would also win', () => {
  const g = setup(['fool', 'werewolf', 'werewolf', 'villager', 'villager']);
  g.untilPhase('DISCUSSION');
  lynch(g, g.P[0]);
  assert.equal(g.s.phase, 'GAME_OVER');
  assert.equal(g.s.game.winner, 'fool');
});

test('rules: a powerless guard, seer, detective, priest, medium and hunter cannot act', () => {
  const g = setup(['elder', 'werewolf', 'guard', 'seer', 'detective', 'priest', 'medium', 'hunter', 'villager', 'villager', 'villager']);
  g.untilPhase('DISCUSSION');
  lynch(g, g.P[0]);
  assert.equal(g.s.game.powersLost, true);
  for (const [i, role] of [[2, 'guard'], [3, 'seer'], [4, 'detective'], [5, 'priest'], [7, 'hunter']]) {
    g.untilNightRole(role);
    assert.throws(() => g.act(g.P[i], 'night', { target: g.P[8].id }), /mất chức năng/, role);
  }
});

test('the pack moves on as soon as every living wolf has picked, no confirming', () => {
  const g = setup(['werewolf', 'werewolf', 'wolf_cub', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  const end = g.s.game.phaseEndsAt;
  g.clock.advance(6000);
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.act(g.P[1], 'night', { target: g.P[4].id });
  assert.equal(g.s.game.phaseEndsAt, end, 'two of three picked: the third is still choosing');
  // Picks can change until the last wolf has chosen.
  g.act(g.P[0], 'night', { target: g.P[4].id });
  assert.throws(() => g.act(g.P[2], 'endTurn', {}), /Không cắn ai/);
  g.act(g.P[2], 'night', { noKill: true });
  assert.equal(g.s.game.phaseEndsAt, g.clock.now, 'all three picked: the turn ends');
  g.endPhase();
  g.untilPhase('MORNING');
  assert.equal(g.P[4].alive, false, 'the most voted is bitten');
});

test('a role with nothing to do tonight can pass with "Bỏ qua"', () => {
  const g = setup(['guard', 'werewolf', 'villager', 'villager', 'villager'], { config: { step_guard: 20 } });
  g.untilNightRole('guard');
  g.clock.advance(6000);
  g.act(g.P[0], 'endTurn', {});
  assert.equal(g.s.game.phaseEndsAt, g.clock.now);
});

test('a role that finishes at once still waits out the 5 s minimum', () => {
  const g = setup(['guard', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('guard');
  const start = g.clock.now;
  g.act(g.P[0], 'night', { target: g.P[2].id });
  assert.equal(g.s.game.phaseEndsAt, start + 5000);
  g.act(g.P[0], 'night', { target: g.P[3].id });
  assert.equal(g.s.game.night.guard, g.P[3].id, 'can still change their mind meanwhile');
});

test('a human wolf with bot mates: the bots back the human, then the turn ends', () => {
  const g = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.P[1].isBot = true;
  g.untilNightRole('werewolf');
  g.clock.advance(3000);
  assert.ok(!g.s.game.night.wolfVotes[g.P[1].id]?.length, 'the bot waits for the human');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.clock.advance(3000);
  assert.deepEqual(g.s.game.night.wolfVotes[g.P[1].id], [g.P[3].id]);
  assert.equal(g.s.game.night.complete, true);
});

test('the host skipping at night never shows a role its choices before the narrator is done', () => {
  const { s, P, host, clock, endPhase } = setup(['guard', 'werewolf', 'villager', 'villager', 'villager']);
  assert.equal(s.game.nightStage, 'call');
  // The host taps "Sang bước tiếp" during the opening narration.
  applyAction(s, P[0].id, 'skip', {}, clock.now);
  clock.advance(0);
  assert.notEqual(s.game.nightStage, 'act', 'still calling: the narrator has not finished');
  assert.equal(viewFor(s, P[0].id, clock.now, 1).me.task, null);
  clock.advance(Math.max(0, s.narration.endsAt - clock.now) + 400);
  assert.equal(s.game.nightStage, 'act');
  assert.equal(viewFor(s, P[0].id, clock.now, 1).me.task.role, 'guard');
  // Skipping during the action slot still ends it right away.
  applyAction(s, P[0].id, 'skip', {}, clock.now);
  clock.advance(0);
  assert.equal(s.game.nightStage, 'sleep');
  void host; void endPhase;
});

test('cards are dealt uniformly at random: every seat gets every card equally often', () => {
  const roles = { werewolf: 2, seer: 1, guard: 1, witch: 1, villager: 1 };
  const N = 6000;
  const tally = Array.from({ length: 6 }, () => ({}));
  for (let i = 0; i < N; i++) {
    const { state: s, player: host } = createRoom({ code: 'FAIR1', hostName: 'H', now: 0 }); // default random source
    for (let k = 1; k < 6; k++) joinRoom(s, `P${k}`, 0);
    applyAction(s, host.id, 'config', { hostPlays: true }, 0);
    for (const id of Object.keys(s.roleCounts)) {
      while ((s.roleCounts[id] || 0) < (roles[id] || 0)) applyAction(s, host.id, 'role', { roleId: id, delta: 1 }, 0);
      while ((s.roleCounts[id] || 0) > (roles[id] || 0)) applyAction(s, host.id, 'role', { roleId: id, delta: -1 }, 0);
    }
    applyAction(s, host.id, 'start', {}, 0);
    s.players.forEach((p, seat) => { tally[seat][p.role] = (tally[seat][p.role] || 0) + 1; });
  }
  for (const [seat, counts] of tally.entries()) {
    for (const [role, n] of Object.entries(roles)) {
      const expected = N * n / 6;
      // 5 standard deviations: a fair deal essentially never fails this.
      const sd = Math.sqrt(N * (n / 6) * (1 - n / 6));
      assert.ok(Math.abs((counts[role] || 0) - expected) < 5 * sd, `seat ${seat + 1} got ${role} ${counts[role]} times, expected ~${expected}`);
    }
  }
});

test('the default random source is cryptographic and stays in [0, 1)', async () => {
  const { secureRandom } = await import('../lib/engine.js');
  assert.equal(typeof secureRandom, 'function');
  for (let i = 0; i < 1000; i++) {
    const x = secureRandom();
    assert.ok(x >= 0 && x < 1);
  }
});

test('the view tells each phone whether it may show connection status', () => {
  const { s, P, untilNightRole, untilPhase } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
  untilPhase('DISCUSSION');
  assert.equal(viewFor(s, P[0].id, 0, 1).seesConnections, true, 'the host, by day');
  assert.equal(viewFor(s, P[2].id, 0, 1).seesConnections, false, 'a player, never');
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[0].id, 0, 1).seesConnections, false, 'a playing host, not at night');
});

test('a bitten Cursed does not die but joins the pack', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['seer', 'werewolf', 'cursed', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[2].id });
  untilNightRole('seer');
  act(P[0], 'night', { target: P[2].id });
  assert.equal(s.game.night.seerResult, 'village', 'still a villager while the night lasts');
  untilPhase('MORNING');
  assert.equal(P[2].alive, true);
  assert.deepEqual(s.game.lastNightDeaths, [], 'the village only hears that nobody died');
  assert.equal(P[2].role, 'werewolf');
  const own = viewFor(s, P[2].id, 0, 1);
  assert.equal(own.me.turned, true);
  assert.deepEqual(own.me.wolves, [P[1].id]);
  assert.ok(viewFor(s, P[1].id, 0, 1).me.wolves.includes(P[2].id), 'the pack sees its new member');
  const outsider = viewFor(s, P[3].id, 0, 1).players.find(p => p.id === P[2].id);
  assert.equal(outsider.role, null);
  assert.equal(outsider.turned, false);
  untilPhase('DISCUSSION');
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[2].id, 0, 1).me.task?.role, 'werewolf', 'wakes with the pack');
  untilNightRole('seer');
  act(P[0], 'night', { target: P[2].id });
  assert.equal(s.game.night.seerResult, 'werewolf');
});

test('a Cursed saved from the bite stays a villager', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['guard', 'werewolf', 'cursed', 'villager', 'villager', 'villager']);
  untilNightRole('guard');
  act(P[0], 'night', { target: P[2].id });
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, true);
  assert.equal(P[2].role, 'cursed');
  assert.ok(!P[2].turned);
});

test('turning the Cursed can hand the wolves the game', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['villager', 'werewolf', 'cursed', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[2].id });
  untilPhase('GAME_OVER');
  assert.equal(s.game.winner, 'werewolf');
  assert.equal(viewFor(s, P[0].id, 0, 1).players.find(p => p.id === P[2].id).turned, true, 'revealed at the end');
});

test('each player keeps private notes of what they did at night', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['seer', 'werewolf', 'detective', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[3].id });
  untilNightRole('seer');
  act(P[0], 'night', { target: P[1].id });
  untilNightRole('detective');
  act(P[2], 'night', { target: P[1].id });
  act(P[2], 'night', { target: P[4].id });
  untilPhase('MORNING');
  const notes = (p) => viewFor(s, p.id, 0, 1).me.notes;
  assert.deepEqual(notes(P[0]), [{ night: 1, text: `Bạn soi ${P[1].name}: Sói 🐺` }]);
  assert.deepEqual(notes(P[1]), [{ night: 1, text: `Đàn Sói cắn ${P[3].name}` }]);
  assert.deepEqual(notes(P[2]), [{ night: 1, text: `Bạn điều tra ${P[1].name} và ${P[4].name}: khác phe` }]);
  assert.deepEqual(notes(P[4]), [], 'villagers have nothing to note');
});

test('nobody is dealt the same card two games running when it can be avoided', () => {
  const { s, host, clock, rng } = setup(['seer', 'werewolf', 'guard', 'witch', 'hunter', 'villager']);
  const deal = () => {
    applyAction(s, host.id, 'endGame', {}, clock.now, rng);
    applyAction(s, host.id, 'start', {}, clock.now, rng);
    return Object.fromEntries(s.players.filter(p => p.inGame).map(p => [p.id, p.role]));
  };
  let last = deal();
  for (let i = 0; i < 50; i++) {
    const next = deal();
    for (const id of Object.keys(next)) assert.notEqual(next[id], last[id], `game ${i}: ${id} got ${next[id]} again`);
    last = next;
  }
});

test('the no-repeat deal still gives every player every card over time', () => {
  const { s, host, clock, rng } = setup(['seer', 'werewolf', 'guard', 'villager', 'villager']);
  const seen = {};
  for (let i = 0; i < 200; i++) {
    applyAction(s, host.id, 'endGame', {}, clock.now, rng);
    applyAction(s, host.id, 'start', {}, clock.now, rng);
    s.players.filter(p => p.inGame).forEach(p => { (seen[p.id] ||= new Set()).add(p.role); });
  }
  Object.values(seen).forEach(roles => assert.equal(roles.size, 4));
});

test('a bot wolf whose human mate picks the bot itself votes nobody, so the pick stands', () => {
  const g = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.P[1].isBot = true;
  g.untilNightRole('werewolf');
  g.act(g.P[0], 'night', { target: g.P[1].id });
  g.clock.advance(3000);
  assert.deepEqual(g.s.game.night.wolfVotes[g.P[1].id], ['none']);
  assert.equal(g.s.game.night.complete, true);
  g.untilPhase('MORNING');
  assert.equal(g.P[1].alive, false);
});

test('the thief\'s step lasts the same whether they swap or keep', () => {
  const end = (pick) => {
    const g = setup(['thief', 'werewolf', 'villager', 'villager', 'villager'], { extras: ['seer', 'villager'], config: { step_thief: 20 } });
    g.untilNightRole('thief');
    g.clock.advance(6000);
    g.act(g.P[0], 'thief', { pick });
    return g.s.game.phaseEndsAt - g.clock.now;
  };
  assert.equal(end(0), end(null));
});

test('a role that lost its power can pass, so its step is not longer', () => {
  const g = setup(['seer', 'werewolf', 'villager', 'villager', 'villager'], { config: { step_seer: 20 } });
  g.s.game.powersLost = true;
  g.untilNightRole('seer');
  g.clock.advance(6000);
  g.act(g.P[0], 'endTurn', {});
  assert.equal(g.s.game.phaseEndsAt, g.clock.now);
});

test('a step nobody can play ends between 5 and 15 s, even with a long role time', () => {
  const lengths = [];
  for (let seed = 1; seed <= 20; seed++) {
    const g = setup(['seer', 'werewolf', 'villager', 'villager', 'villager'], { rng: seeded(seed), config: { step_seer: 60 } });
    g.P[0].alive = false;
    g.untilNightRole('seer');
    lengths.push(g.s.game.phaseEndsAt - g.clock.now);
  }
  assert.ok(lengths.every(l => l >= 5000 && l <= 15000), lengths.join());
  assert.ok(new Set(lengths).size > 1);
});

test('the couple find the news in their own notes, not on screen', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['cupid', 'werewolf', 'villager', 'villager', 'villager']);
  untilNightRole('cupid');
  act(P[0], 'night', { target: P[2].id });
  act(P[0], 'night', { target: P[3].id });
  untilPhase('MORNING');
  const notes = (p) => viewFor(s, p.id, 0, 1).me.notes.map(n => n.text);
  assert.deepEqual(notes(P[2]), [`💘 Bạn và ${P[3].name} đã thành Tình Nhân.`]);
  assert.deepEqual(notes(P[3]), [`💘 Bạn và ${P[2].name} đã thành Tình Nhân.`]);
  assert.deepEqual(notes(P[4]), []);
});

test('a hunter brought back does not shoot a second time', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['hunter', 'werewolf', 'medium', 'villager', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilNightRole('hunter');
  act(P[0], 'night', { target: P[3].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(P[3].alive, false, 'the gun went off');
  untilNightRole('medium');
  act(P[2], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, true, 'back');
  untilPhase('DISCUSSION');
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilNightRole('hunter');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.spent, true);
  assert.throws(() => act(P[0], 'night', { target: P[4].id }), /đã nổ/);
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(P[4].alive, true, 'no second shot');
});

test('a wolf cub brought back gives the pack its double bite only once', () => {
  const g = setup(['wolf_cub', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.s.game.cubSpent = true; // the cub already died once and was brought back
  const { s } = g;
  g.untilPhase('DISCUSSION');
  g.untilPhase('VOTE');
  const voters = g.P.filter(p => p.alive && p.id !== g.P[0].id);
  voters.forEach(v => g.act(v, 'vote', { target: g.P[0].id }));
  g.untilPhase('JUDGE');
  voters.forEach(v => g.act(v, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  assert.equal(g.P[0].alive, false);
  g.untilNightRole('werewolf');
  assert.equal(s.game.night.wolfKills, 1);
});

test('used potions stay used for a witch brought back', () => {
  const g = setup(['witch', 'werewolf', 'medium', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[3].id });
  g.untilNightRole('witch');
  g.act(g.P[0], 'witch', { use: 'heal' });
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  g.untilNightRole('medium');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, true);
  g.untilPhase('DISCUSSION');
  g.untilNightRole('witch');
  const task = viewFor(g.s, g.P[0].id, 0, 1).me.task;
  assert.equal(task.healAvailable, false, 'the heal was used before');
  assert.equal(task.poisonAvailable, true, 'the poison is still there');
});

test('every role gets 5 s by default and can add 5 s at a time until done', () => {
  const g = setup(['seer', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  assert.equal(g.s.game.phaseEndsAt - g.clock.now, 5000, 'one wolf card: 5 s');
  g.untilNightRole('seer');
  const start = g.clock.now;
  assert.equal(g.s.game.phaseEndsAt - start, 5000);
  assert.throws(() => g.act(g.P[2], 'extend', {}), /lượt của bạn/, 'only the role being called');
  g.clock.advance(4000);
  g.act(g.P[0], 'extend', {});
  assert.equal(g.s.game.phaseEndsAt, start + 10000, '+5 s');
  g.clock.advance(5000);
  g.act(g.P[0], 'extend', {});
  assert.equal(g.s.game.phaseEndsAt, start + 15000, '+5 s again');
  // Taps cannot bank more than 15 s ahead.
  g.act(g.P[0], 'extend', {});
  g.act(g.P[0], 'extend', {});
  assert.equal(g.s.game.phaseEndsAt, g.clock.now + 15000);
  g.act(g.P[0], 'night', { target: g.P[1].id });
  assert.throws(() => g.act(g.P[0], 'extend', {}), /xong/, 'nothing to extend once done');
});

test('a result picked at the last second still gets its reading time', () => {
  const g = setup(['seer', 'werewolf', 'villager', 'villager', 'villager']);
  g.untilNightRole('seer');
  g.clock.advance(4500);
  g.act(g.P[0], 'night', { target: g.P[1].id });
  assert.equal(g.s.game.phaseEndsAt, g.clock.now + 4000);
});

test('swap: one offer and one taker trade cards before the first night', () => {
  const g = setup(['seer', 'werewolf', 'villager', 'guard', 'villager'], { config: { swapEnabled: true } });
  const { s, P, act, untilPhase } = g;
  assert.equal(s.phase, 'SWAP');
  assert.throws(() => act(P[1], 'swapAccept', {}), /Chưa có ai/);
  act(P[0], 'swapRequest', {});
  // Others only learn that someone wants to swap.
  const other = viewFor(s, P[3].id, 0, 1);
  assert.deepEqual(other.me.swap, { offers: 1, asked: false, accepted: false });
  assert.ok(!JSON.stringify(other).includes('"requests"'));
  assert.throws(() => act(P[0], 'swapAccept', {}), /muốn đổi/);
  act(P[3], 'swapAccept', {});
  untilPhase('NIGHT');
  assert.equal(P[0].role, 'guard');
  assert.equal(P[3].role, 'seer');
  assert.ok(viewFor(s, P[0].id, 0, 1).me.notes.some(n => n.text.includes('Bảo Vệ')));
  assert.ok(!viewFor(s, P[0].id, 0, 1).me.notes.some(n => n.text.includes(P[3].name)), 'not told with whom');
  assert.throws(() => act(P[2], 'swapRequest', {}), /trước đêm đầu/);
});

test('swap: with several takers, the asker trades with one drawn at random', () => {
  const partners = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const g = setup(['seer', 'werewolf', 'villager', 'guard', 'hunter', 'villager'], { config: { swapEnabled: true }, rng: seeded(seed) });
    g.act(g.P[0], 'swapRequest', {});
    [1, 3, 4].forEach(i => g.act(g.P[i], 'swapAccept', {}));
    g.untilPhase('NIGHT');
    const taker = [1, 3, 4].find(i => g.P[i].role === 'seer');
    assert.ok(taker, 'someone took the seer card');
    assert.equal(g.P[0].role, ['seer', 'werewolf', 'villager', 'guard', 'hunter'][taker]);
    partners.add(taker);
  }
  assert.ok(partners.size > 1, 'not always the same taker');
});

test('swap: nobody accepts, nothing changes; two askers trade with each other', () => {
  const g = setup(['seer', 'werewolf', 'villager', 'guard', 'villager'], { config: { swapEnabled: true } });
  g.act(g.P[0], 'swapRequest', {});
  g.untilPhase('NIGHT');
  assert.equal(g.P[0].role, 'seer');
  const h = setup(['seer', 'werewolf', 'villager', 'guard', 'villager'], { config: { swapEnabled: true } });
  h.act(h.P[0], 'swapRequest', {});
  h.act(h.P[3], 'swapRequest', {});
  h.untilPhase('NIGHT');
  assert.equal(h.P[0].role, 'guard');
  assert.equal(h.P[3].role, 'seer');
});

test('swap: a person who accepted is always picked before a bot', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const g = setup(['seer', 'werewolf', 'villager', 'guard', 'villager'], { config: { swapEnabled: true }, rng: seeded(seed) });
    g.P[1].isBot = true;
    g.P[2].isBot = true;
    g.act(g.P[0], 'swapRequest', {});
    g.act(g.P[1], 'swapAccept', {});
    g.act(g.P[2], 'swapAccept', {});
    g.act(g.P[3], 'swapAccept', {});
    g.untilPhase('REVEAL');
    assert.equal(g.P[0].role, 'guard', `seed ${seed}`);
    assert.equal(g.P[3].role, 'seer');
  }
});

// ---------------------------------------------------------------------------
// Roles from Ultimate Werewolf
// ---------------------------------------------------------------------------

test('UW: the Seer sees the Người Lai Sói as a wolf, the Tay Sai and Pháp Sư Hắc Ám as villagers', () => {
  const read = (role) => {
    const g = setup(['seer', 'werewolf', role, 'villager', 'villager', 'villager']);
    g.untilNightRole('seer');
    g.act(g.P[0], 'night', { target: g.P[2].id });
    return g.s.game.night.seerResult;
  };
  assert.equal(read('lycan'), 'werewolf');
  assert.equal(read('minion'), 'village');
  assert.equal(read('sorcerer'), 'village');
});

test('UW: the Tay Sai knows the wolves, is not a wolf for the count, and wins with them', () => {
  const g = setup(['minion', 'werewolf', 'villager', 'villager', 'villager']);
  const v = viewFor(g.s, g.P[0].id, 0, 1);
  assert.deepEqual(v.me.wolves, [g.P[1].id]);
  assert.equal(v.players[1].role, 'werewolf');
  assert.ok(!viewFor(g.s, g.P[1].id, 0, 1).me.wolves.includes(g.P[0].id), 'the pack does not know the minion');
  g.P[2].alive = false; g.P[3].alive = false;
  // 1 wolf vs minion + villager: not yet parity (the minion is not a wolf).
  assert.equal(checkWin(g.s), null);
  g.P[4].alive = false;
  assert.equal(checkWin(g.s).winner, 'werewolf');
});

test('UW: Pháp Sư Hắc Ám finds the Seer; Tiên Tri Hào Quang sees special roles', () => {
  const g = setup(['sorcerer', 'werewolf', 'seer', 'aura_seer', 'villager', 'villager']);
  g.untilNightRole('aura_seer');
  g.act(g.P[3], 'night', { target: g.P[4].id });
  assert.equal(g.s.game.night.auraResult, 'plain');
  g.untilNightRole('sorcerer');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  assert.equal(g.s.game.night.sorcererResult, 'seer');
  const h = setup(['sorcerer', 'werewolf', 'seer', 'aura_seer', 'villager', 'villager']);
  h.untilNightRole('aura_seer');
  h.act(h.P[3], 'night', { target: h.P[0].id });
  assert.equal(h.s.game.night.auraResult, 'special');
});

test('UW: Nhà Ngoại Cảm reads a player and their two neighbours, once per game', () => {
  const g = setup(['pi', 'villager', 'villager', 'werewolf', 'villager', 'villager']);
  g.untilNightRole('pi');
  g.act(g.P[0], 'night', { target: g.P[4].id }); // seats 4,5,6 → wolf at 4
  assert.equal(g.s.game.night.piResult, 'wolf');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('pi');
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[1].id }), /rồi/);
  const h = setup(['pi', 'villager', 'villager', 'werewolf', 'villager', 'villager', 'villager']);
  h.untilNightRole('pi');
  h.act(h.P[0], 'night', { target: h.P[5].id }); // seats 5,6,7 → no wolf
  assert.equal(h.s.game.night.piResult, 'clear');
});

test('UW: the Thầy Tu\'s blessing saves the first death only', () => {
  const g = setup(['blesser', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('blesser');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, true, 'saved');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'only once');
});

test('UW: the Người Tử Đạo dies in place of the bitten player', () => {
  const g = setup(['martyr', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilNightRole('martyr');
  assert.deepEqual(viewFor(g.s, g.P[0].id, 0, 1).me.task.targets, [g.P[2].id]);
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, true);
  assert.equal(g.P[0].alive, false);
});

test('UW: the Gã Cứng Cựa lives through the day and dies the next night', () => {
  const g = setup(['tough_guy', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, true);
  assert.deepEqual(g.s.game.lastNightDeaths, []);
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.wounded, true);
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[3].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  assert.equal(g.P[3].alive, false);
});

test('UW: eating the Người Bệnh makes the next bite harmless', () => {
  const g = setup(['diseased', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, true, 'the sick pack kills nobody');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'well again');
});

const toJudge = (g, defendant) => {
  g.untilPhase('VOTE');
  g.P.filter(p => p.alive && p.id !== defendant.id && p.id !== g.s.game.banished).forEach(p => g.act(p, 'vote', { target: defendant.id }));
  g.untilPhase('JUDGE');
};

test('UW: the Trưởng Làng counts twice; Gã Khờ always hangs, Người Hoà Bình always spares', () => {
  const g = setup(['mayor', 'werewolf', 'idiot', 'pacifist', 'villager', 'villager']);
  toJudge(g, g.P[1]);
  assert.equal(g.s.game.judge[g.P[2].id], 'kill');
  assert.equal(g.s.game.judge[g.P[3].id], 'spare');
  assert.throws(() => g.act(g.P[2], 'judge', { choice: 'spare' }), /cố định/);
  g.act(g.P[0], 'judge', { choice: 'spare' });
  g.act(g.P[4], 'judge', { choice: 'kill' });
  g.act(g.P[5], 'judge', { choice: 'kill' });
  g.untilPhase('VERDICT');
  // kill: idiot + 2 = 3; spare: pacifist + mayor×2 = 3 → not hanged.
  assert.equal(g.s.game.verdict.type, 'spare');
  assert.equal(g.s.game.verdict.spare, 3);
});

test('UW: the Hoàng Tử survives his first hanging and shows his card', () => {
  const g = setup(['prince', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  toJudge(g, g.P[0]);
  g.P.slice(1).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  assert.equal(g.s.game.verdict.type, 'prince');
  assert.equal(g.P[0].alive, true);
  assert.equal(viewFor(g.s, g.P[3].id, 0, 1).players[0].role, 'prince', 'everyone sees the card');
});

test('UW: the Mụ Già\'s pick sits out the day; the Pháp Sư Phong Ấn\'s pick is muted', () => {
  const g = setup(['old_hag', 'werewolf', 'spellcaster', 'villager', 'villager', 'villager']);
  g.untilNightRole('spellcaster');
  g.act(g.P[2], 'night', { target: g.P[4].id });
  g.untilNightRole('old_hag');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.untilPhase('MORNING');
  const v = viewFor(g.s, g.P[5].id, 0, 1).game;
  assert.equal(v.banished, g.P[3].id);
  assert.equal(v.muted, g.P[4].id);
  assert.ok(g.s.narration.clips.some(c => c.k === 'banished') && g.s.narration.clips.some(c => c.k === 'muted'));
  g.untilPhase('VOTE');
  assert.throws(() => g.act(g.P[3], 'vote', { target: g.P[1].id }), /đuổi/);
  assert.throws(() => g.act(g.P[5], 'vote', { target: g.P[3].id }), /không có mặt/);
  g.untilPhase('NIGHT');
  assert.equal(g.s.game.banished, null, 'just for one day');
});

test('UW: the Kẻ Gây Rối brings a second vote after the first hanging', () => {
  const g = setup(['troublemaker', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('troublemaker');
  g.act(g.P[0], 'troublemaker', {});
  toJudge(g, g.P[3]);
  g.P.filter(p => p.alive && p.id !== g.P[3].id).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  assert.equal(g.P[3].alive, false);
  assert.ok(g.s.narration.clips.some(c => c.k === 'second_lynch'));
  g.endPhase();
  assert.equal(g.s.phase, 'VOTE', 'a second vote, the same day');
  assert.equal(g.s.game.voteRound, 2);
  assert.equal(g.s.game.day, 1);
});

test('UW: the Hồn Ma dies the first night and leaves a letter every night', () => {
  const g = setup(['ghost', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('ghost');
  g.act(g.P[0], 'ghost', { letter: 'k' });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false);
  assert.equal(viewFor(g.s, g.P[3].id, 0, 1).game.ghostLetter, 'K');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('ghost');
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.task.role, 'ghost', 'acts from beyond');
  g.act(g.P[0], 'ghost', { letter: 'M' });
  assert.throws(() => g.act(g.P[0], 'vote', { target: g.P[1].id }), /bị loại/);
});

test('UW: the Ông Lão dies on night (living wolves + 1)', () => {
  const g = setup(['old_man', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, true, 'night 1 of 2');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('werewolf');
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false, 'night 2');
});

test('UW: the Kẻ Song Trùng takes the role of their pick when that player dies', () => {
  const g = setup(['doppelganger', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  g.untilNightRole('doppelganger');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].role, 'seer');
  assert.ok(viewFor(g.s, g.P[0].id, 0, 1).me.notes.some(n => n.text.includes('Tiên Tri')));
});

test('UW: the Kẻ Côn Đồ wins too when both marks are dead and they are alive', () => {
  const g = setup(['hoodlum', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('hoodlum');
  g.act(g.P[0], 'night', { target: g.P[1].id });
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.P[2].alive = false;
  toJudge(g, g.P[1]);
  g.P.filter(p => p.alive && p.id !== g.P[1].id).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('GAME_OVER');
  assert.equal(g.s.game.winner, 'village');
  assert.deepEqual(g.s.game.coWinners, ['hoodlum']);
});

test('UW: the Sói Đơn Độc wins only as the last wolf', () => {
  const g = setup(['lone_wolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  [2, 3, 4].forEach(i => { g.P[i].alive = false; });
  assert.equal(checkWin(g.s).winner, 'werewolf', 'the pack wins; the lone wolf does not');
  const h = setup(['lone_wolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  [1, 2, 3, 4].forEach(i => { h.P[i].alive = false; });
  assert.equal(checkWin(h.s).winner, 'lone_wolf');
});

test('UW: the Tiên Tri Tập Sự takes the Seer\'s turn once the Seer is dead; Masons know each other', () => {
  const g = setup(['seer', 'werewolf', 'apprentice_seer', 'mason', 'mason', 'villager', 'villager']);
  assert.deepEqual(viewFor(g.s, g.P[3].id, 0, 1).me.masons, [g.P[4].id]);
  g.untilNightRole('werewolf');
  g.act(g.P[1], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  g.untilPhase('DISCUSSION');
  g.untilNightRole('seer');
  const task = viewFor(g.s, g.P[2].id, 0, 1).me.task;
  assert.equal(task.role, 'seer');
  assert.equal(task.apprentice, true);
  g.act(g.P[2], 'night', { target: g.P[1].id });
  assert.equal(g.s.game.night.seerResult, 'werewolf');
});

test('UW: the Kẻ Say sees a Villager card until the third night', () => {
  const g = setup(['drunk', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.P[0].drunkRole = 'mayor';
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.role, 'villager');
  g.untilPhase('DISCUSSION'); g.untilPhase('NIGHT');
  assert.equal(g.P[0].role, 'drunk');
  g.untilPhase('DISCUSSION'); g.untilPhase('NIGHT');
  assert.equal(g.s.game.day, 3);
  assert.equal(g.P[0].role, 'mayor');
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.role, 'mayor');
});

test('UW: Masons come at least two; every new role has points and a description', () => {
  assert.match(validateRoleCounts({ ...emptyCounts(), werewolf: 1, mason: 1, villager: 3 }, 5), /Hội Kín/);
  assert.equal(validateRoleCounts({ ...emptyCounts(), werewolf: 1, mason: 2, villager: 2 }, 5), null);
});

// ---------------------------------------------------------------------------
// Interactions between roles
// ---------------------------------------------------------------------------

const bite = (g, wolf, target) => { g.untilNightRole('werewolf'); g.act(wolf, 'night', { target: target.id }); };
const nextNight = (g) => { g.untilPhase('DISCUSSION'); };

test('mix: the Bảo Vệ guarding the Người Tử Đạo saves them both', () => {
  const g = setup(['martyr', 'werewolf', 'guard', 'villager', 'villager', 'villager']);
  g.untilNightRole('guard');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  bite(g, g.P[1], g.P[3]);
  g.untilNightRole('martyr');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[3].alive, true, 'the bitten one was replaced');
  assert.equal(g.P[0].alive, true, 'the martyr was guarded');
});

test('mix: the witch\'s heal keeps the Gã Cứng Cựa unhurt and the Người Bệnh uneaten', () => {
  const g = setup(['tough_guy', 'werewolf', 'witch', 'diseased', 'villager', 'villager', 'villager']);
  bite(g, g.P[1], g.P[0]);
  g.untilNightRole('witch');
  g.act(g.P[2], 'witch', { use: 'heal' });
  g.untilPhase('MORNING');
  assert.equal(g.s.game.toughWounded, null);
  nextNight(g);
  bite(g, g.P[1], g.P[3]);
  g.untilPhase('MORNING');
  assert.equal(g.P[3].alive, false);
  assert.equal(g.P[0].alive, true, 'no wound from a healed bite');
  assert.equal(g.s.game.wolvesSick, true, 'eating the diseased makes the pack sick');
});

test('mix: a bitten Sói Nguyền who is blessed still turns (the bite does not kill)', () => {
  const g = setup(['cursed', 'werewolf', 'blesser', 'villager', 'villager', 'villager']);
  g.untilNightRole('blesser');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  bite(g, g.P[1], g.P[0]);
  g.untilPhase('MORNING');
  assert.equal(g.P[0].role, 'werewolf');
  assert.equal(g.s.game.blessed, g.P[0].id, 'the blessing is still there');
});

test('mix: a blessing does not stop the Hồn Ma leaving or the Ông Lão dying of age', () => {
  const g = setup(['ghost', 'werewolf', 'blesser', 'villager', 'villager', 'villager']);
  g.untilNightRole('blesser');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[0].alive, false, 'the ghost leaves the living anyway');
  const h = setup(['old_man', 'werewolf', 'blesser', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('blesser');
  h.act(h.P[2], 'night', { target: h.P[0].id });
  h.untilPhase('DISCUSSION');
  h.untilNightRole('werewolf');
  h.untilPhase('MORNING');
  assert.equal(h.P[0].alive, false, 'old age is not an attack');
});

test('mix: the Thầy Đồng cannot bring back the Hồn Ma', () => {
  const g = setup(['ghost', 'werewolf', 'medium', 'villager', 'villager', 'villager', 'villager']);
  g.untilPhase('MORNING');
  nextNight(g);
  g.untilNightRole('werewolf');
  assert.ok(!g.s.game.queue.includes('medium'), 'only the ghost is dead: nobody to bring back');
  g.act(g.P[1], 'night', { target: g.P[3].id });
  g.untilPhase('MORNING');
  nextNight(g);
  g.untilNightRole('medium');
  assert.deepEqual(viewFor(g.s, g.P[2].id, 0, 1).me.task.dead, [g.P[3].id]);
  assert.throws(() => g.act(g.P[2], 'night', { target: g.P[0].id }), /Hồn Ma/);
});

test('mix: the Kẻ Côn Đồ only wins alongside the village', () => {
  const g = setup(['hoodlum', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('hoodlum');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.act(g.P[0], 'night', { target: g.P[3].id });
  [2, 3, 4, 5].forEach(i => { g.P[i].alive = false; });
  g.untilPhase('GAME_OVER');
  assert.equal(g.s.game.winner, 'werewolf');
  assert.deepEqual(g.s.game.coWinners, [], 'the wolves won: the hoodlum loses');
});

test('mix: the one the Mụ Già sent away is safe from the day\'s Thợ Săn shot and Sói Báo Thù', () => {
  const g = setup(['old_hag', 'avenger', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('avenger');
  g.act(g.P[1], 'night', { target: g.P[3].id });
  g.untilNightRole('old_hag');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  toJudge(g, g.P[1]);
  g.P.filter(p => p.alive && p.id !== g.P[1].id && p.id !== g.P[3].id).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  assert.equal(g.P[1].alive, false);
  assert.equal(g.P[3].alive, true, 'not in the village today');
});

test('mix: the Pháp Sư Hắc Ám finds the Tiên Tri Tập Sự only once they act as Seer', () => {
  const g = setup(['sorcerer', 'werewolf', 'seer', 'apprentice_seer', 'villager', 'villager']);
  g.untilNightRole('sorcerer');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  assert.equal(g.s.game.night.sorcererResult, 'not');
});

test('mix: the Thám Tử and the Mục Sư judge a Kẻ Say by the real card', () => {
  const g = setup(['drunk', 'werewolf', 'detective', 'villager', 'villager', 'villager']);
  g.P[0].drunkRole = 'werewolf';
  g.untilNightRole('detective');
  g.act(g.P[2], 'night', { target: g.P[0].id });
  g.act(g.P[2], 'night', { target: g.P[1].id });
  assert.equal(g.s.game.night.detectiveResult, 'same');
});

test('mix: a Kẻ Song Trùng copying a Kẻ Say keeps the hidden card and sobers up too', () => {
  const g = setup(['doppelganger', 'werewolf', 'drunk', 'villager', 'villager', 'villager', 'villager']);
  g.P[2].drunkRole = 'mayor';
  g.untilNightRole('doppelganger');
  g.act(g.P[0], 'night', { target: g.P[2].id });
  bite(g, g.P[1], g.P[2]);
  g.untilPhase('MORNING');
  assert.equal(g.P[0].role, 'drunk');
  assert.equal(g.P[0].drunkRole, 'mayor');
});

test('mix: Kẻ Gây Rối + Hoàng Tử: a saved Prince is no hanging, so no second vote', () => {
  const g = setup(['troublemaker', 'werewolf', 'prince', 'villager', 'villager', 'villager']);
  g.untilNightRole('troublemaker');
  g.act(g.P[0], 'troublemaker', {});
  toJudge(g, g.P[2]);
  g.P.filter(p => p.alive && p.id !== g.P[2].id).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  assert.equal(g.s.game.verdict.type, 'prince');
  g.endPhase();
  assert.equal(g.s.phase, 'NIGHT');
});

test('mix: a blessed lover survives the heartbreak; a blessed target survives the Thợ Săn', () => {
  const g = setup(['cupid', 'werewolf', 'blesser', 'villager', 'villager', 'villager']);
  g.untilNightRole('cupid');
  g.act(g.P[0], 'night', { target: g.P[3].id });
  g.act(g.P[0], 'night', { target: g.P[4].id });
  g.untilNightRole('blesser');
  g.act(g.P[2], 'night', { target: g.P[4].id });
  bite(g, g.P[1], g.P[3]);
  g.untilPhase('MORNING');
  assert.equal(g.P[3].alive, false);
  assert.equal(g.P[4].alive, true);
});

test('mix: the Elder\'s death by the village takes the new village powers too', () => {
  const g = setup(['elder', 'werewolf', 'aura_seer', 'villager', 'villager', 'villager']);
  toJudge(g, g.P[0]);
  g.P.filter(p => p.alive && p.id !== g.P[0].id).forEach(p => g.act(p, 'judge', { choice: 'kill' }));
  g.untilPhase('VERDICT');
  g.untilNightRole('aura_seer');
  assert.equal(viewFor(g.s, g.P[2].id, 0, 1).me.task.powerless, true);
  assert.throws(() => g.act(g.P[2], 'night', { target: g.P[1].id }), /mất chức năng/);
});

test('mix: once the village kills its Elder, the passive village powers are gone too', () => {
  const g = setup(['prince', 'werewolf', 'mayor', 'tough_guy', 'villager', 'villager', 'villager']);
  g.s.game.powersLost = true;
  toJudge(g, g.P[0]);
  g.act(g.P[2], 'judge', { choice: 'spare' });
  g.act(g.P[3], 'judge', { choice: 'kill' });
  g.act(g.P[4], 'judge', { choice: 'kill' });
  g.act(g.P[5], 'judge', { choice: 'spare' });
  g.act(g.P[6], 'judge', { choice: 'spare' });
  g.act(g.P[1], 'judge', { choice: 'kill' });
  g.untilPhase('VERDICT');
  assert.equal(g.s.game.verdict.spare, 3, 'the mayor counts once');
  const h = setup(['prince', 'werewolf', 'tough_guy', 'villager', 'villager', 'villager']);
  h.s.game.powersLost = true;
  toJudge(h, h.P[0]);
  h.P.filter(p => p.alive && p.id !== h.P[0].id).forEach(p => h.act(p, 'judge', { choice: 'kill' }));
  h.untilPhase('VERDICT');
  assert.equal(h.P[0].alive, false, 'no royal pardon');
  h.untilNightRole('werewolf');
  h.act(h.P[1], 'night', { target: h.P[2].id });
  h.untilPhase('MORNING');
  assert.equal(h.P[2].alive, false, 'the tough guy dies at once');
});
