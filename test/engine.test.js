import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, applyAction, tick, viewFor, checkWin, authenticate, cleanName, GameError
} from '../lib/engine.js';
import { computeBalancedRoles, validateRoleCounts, totalRoles } from '../public/shared/roles.js';
import { mutateRoom, createRoomRecord, setStoreForTests, _supabaseStoreForTests } from '../lib/store.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a started game whose roles are assigned in seat order.
function setup(roles, { config = {}, rng = seeded() } = {}) {
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'TEST1', hostName: 'Chủ', now, rng });
  for (let i = 1; i < roles.length; i++) joinRoom(s, `P${i + 1}`, now, rng);
  applyAction(s, host.id, 'config', config, now, rng);
  const counts = {};
  roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
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
  const untilNightRole = (role) => {
    for (let i = 0; i < 20 && !(s.phase === 'NIGHT' && s.game.queue[s.game.step] === role); i++) endPhase();
    assert.equal(s.game.queue[s.game.step], role);
  };
  return { s, P, host, clock, act, endPhase, untilPhase, untilNightRole, rng };
}

test('auto balance always matches player count and is playable', () => {
  for (let n = 4; n <= 18; n++) {
    const c = computeBalancedRoles(n);
    assert.equal(totalRoles(c), n, `n=${n}`);
    assert.equal(validateRoleCounts(c, n), null, `n=${n}`);
  }
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

test('only the active role may act at night and wolves cannot bite wolves', () => {
  const { P, act, untilNightRole } = setup(['guard', 'werewolf', 'seer', 'villager', 'villager']);
  untilNightRole('guard');
  assert.throws(() => act(P[1], 'night', { target: P[0].id }), /Chưa đến lượt/);
  untilNightRole('werewolf');
  assert.throws(() => act(P[1], 'night', { target: P[1].id }), /đồng bọn/);
});

test('wolf kill, guard save and witch potions resolve correctly', () => {
  const g = setup(['guard', 'werewolf', 'witch', 'villager', 'villager', 'werewolf', 'villager']);
  const { s, P, act, untilNightRole, untilPhase } = g;

  untilNightRole('guard');
  act(P[0], 'night', { target: P[3].id });
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[3].id });
  act(P[5], 'night', { target: P[3].id });
  assert.equal(s.game.night.wolfTarget, P[3].id);
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

test('lynching the hunter lets them shoot, and win is checked afterwards', () => {
  const { s, P, act, untilPhase } = setup(['hunter', 'werewolf', 'villager', 'villager', 'villager']);
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('DEFENSE');
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('HUNTER');
  assert.equal(viewFor(s, P[2].id, 0, 1).players[0].role, 'hunter', 'hunter is revealed while shooting');
  act(P[0], 'shoot', { target: P[1].id });
  assert.equal(P[1].alive, false);
  assert.equal(s.phase, 'GAME_OVER');
  assert.equal(s.game.winner, 'village');
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

test('the hunter shoots whatever killed them, so the cause of death stays hidden', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['witch', 'werewolf', 'hunter', 'villager', 'villager', 'villager']);
  untilNightRole('witch');
  act(P[0], 'witch', { use: 'poison', target: P[2].id });
  untilPhase('HUNTER');
  assert.equal(s.game.hunter.id, P[2].id);
  const villagerView = JSON.stringify(viewFor(s, P[3].id, 0, 1));
  assert.ok(!villagerView.includes('poison'), 'cause of death is not sent to players');
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
  assert.equal(viewFor(s, P[2].id, 0, 1).me.lover, P[1].id);
  untilNightRole('werewolf');
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
  assert.ok(s.narration.clips.some(c => c.k === 'lover_death'));
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
  for (let i = 0; i < 2000 && s.phase !== 'GAME_OVER'; i++) {
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
      return reply(200, row ? [{ state: row.state, version: row.version }] : []);
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
    if (init.method === 'DELETE') return reply(204);
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
