import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, applyAction, tick, viewFor, checkWin, authenticate, cleanName, GameError, resolveHostVote
} from '../lib/engine.js';
import { computeBalancedRoles, validateRoleCounts, totalRoles, MAX_PLAYERS } from '../public/shared/roles.js';
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
  applyAction(s, host.id, 'config', config, now, rng);
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
    assert.equal(totalRoles(c), n + (c.thief ? 2 : 0), `n=${n}`);
    assert.equal(validateRoleCounts(c, n), null, `n=${n}`);
  }
});

test('auto balance brings in Cupid, Thief, Piper and Elder as the village grows', () => {
  const firstAt = (id) => {
    for (let n = 1; n <= 18; n++) if (computeBalancedRoles(n)[id]) return n;
    return null;
  };
  assert.equal(firstAt('cupid'), 7);
  assert.equal(firstAt('thief'), 9);
  assert.equal(firstAt('piper'), 11);
  assert.equal(firstAt('elder'), 12);
  const c = computeBalancedRoles(18);
  for (const id of ['cupid', 'thief', 'piper', 'elder']) assert.equal(c[id], 1, id);
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
  assert.deepEqual(s.game.night.wolfTargets, [P[3].id]);
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
  assert.ok(!s.game.log.some(e => /Thợ Săn|súng/.test(e)), 'the public log does not say it either');
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
  assert.ok(!s.game.log.some(e => /chết theo|người yêu/i.test(e)), 'the public log does not say it either');
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
    for (const [roleId, n] of Object.entries(want)) {
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
      ? { werewolf: 2, wolf_cub: 1, seer: 1, witch: 1, hunter: 1, priest: 1, medium: 1, fool: 1, avenger: 1, villager: 2 }
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
          const pack = ['werewolf', 'wolf_cub'];
          assert.ok(pack.includes(p.role) && pack.includes(o.role), `seed ${seed}: ${p.role} saw a ${o.role}`);
        }
        assert.deepEqual(v.game.lovers, [], 'the couple stays secret');
        assert.ok(!v.game.powersLost, 'the Elder\'s fate stays secret');
        if (v.me.lover) assert.ok(s.game.lovers.includes(p.id));
        if (v.me.charmedWith) assert.ok(s.game.charmed.includes(p.id));
        if (v.me.team) assert.equal(p.role, 'avenger', 'only the Avenger is told a team');
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
  assert.ok(!s.game.log.some(e => /Già Làng|mất chức năng/.test(e)));
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
  assert.ok(!s.game.log.some(e => /Thần Tình Yêu|mũi tên/.test(e)), 'no public trace of Cupid');
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
  assert.deepEqual(s.game.night.wolfTargets, [P[2].id]);
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

test('priest: holy water once per game kills a wolf, does nothing to others', () => {
  const g = setup(['priest', 'werewolf', 'wolf_cub', 'villager', 'villager', 'villager', 'villager', 'villager']);
  g.untilNightRole('priest');
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[0].id }));
  g.act(g.P[0], 'night', { target: g.P[2].id });
  g.untilPhase('MORNING');
  assert.equal(g.P[2].alive, false, 'the cub is a wolf too');
  g.untilNightRole('priest');
  assert.equal(viewFor(g.s, g.P[0].id, 0, 1).me.task.used, true);
  assert.throws(() => g.act(g.P[0], 'night', { target: g.P[1].id }), /đã dùng/);

  const h = setup(['priest', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
  h.untilNightRole('werewolf');
  h.act(h.P[1], 'night', { target: h.P[5].id });
  h.untilNightRole('priest');
  h.act(h.P[0], 'night', { target: h.P[3].id });
  h.untilPhase('MORNING');
  assert.equal(h.P[3].alive, true, 'not a wolf: nothing happens');
  assert.equal(h.s.game.priestUsed, true);
});

test('medium brings one dead player back, once per game', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['medium', 'werewolf', 'seer', 'villager', 'villager', 'villager']);
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[2].id });
  untilNightRole('medium');
  assert.throws(() => act(P[0], 'night', { target: P[3].id }), /đã chết/, 'only the dead');
  untilPhase('MORNING');
  assert.equal(P[2].alive, false);
  untilNightRole('medium');
  assert.deepEqual(viewFor(s, P[0].id, 0, 1).me.task.dead, [P[2].id]);
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, true);
  assert.equal(P[2].role, 'seer', 'back with the same card');
  const keys = s.narration.clips.map(c => c.k);
  assert.ok(keys.includes('revived') && keys.includes(`seat_${P[2].seat}`));
  untilNightRole('medium');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task.used, true);
});

test('the fool wins alone when the village hangs them', () => {
  const { s, P, act, untilPhase } = setup(['fool', 'werewolf', 'villager', 'villager', 'villager']);
  untilPhase('VOTE');
  const voters = P.filter(p => p.alive && p.id !== P[0].id);
  voters.forEach(v => act(v, 'vote', { target: P[0].id }));
  untilPhase('JUDGE');
  voters.forEach(v => act(v, 'judge', { choice: 'kill' }));
  untilPhase('GAME_OVER');
  assert.equal(s.game.winner, 'fool');
  assert.ok(s.narration.clips.some(c => c.k === 'win_fool'));
});

test('avenger: secret team, picks a target from night two, takes it along when bitten or hanged', () => {
  const { s, P, act, untilNightRole, untilPhase } = setup(['avenger', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  assert.ok(['village', 'werewolf'].includes(s.game.avengerTeam));
  s.game.avengerTeam = 'werewolf';
  assert.equal(viewFor(s, P[0].id, 0, 1).me.team, 'werewolf', 'the avenger knows their team');
  assert.equal(viewFor(s, P[1].id, 0, 1).players[0].role, null, 'the wolves do not');
  assert.ok(!s.game.queue.includes('avenger'), 'not called on the first night');
  untilNightRole('seer');
  act(P[2], 'night', { target: P[0].id });
  assert.equal(s.game.night.seerResult, 'werewolf', 'the seer sees the real team');
  untilPhase('DISCUSSION');
  untilNightRole('avenger');
  act(P[0], 'night', { target: P[4].id });
  // The pack is called before the Avenger, so they bite on night three.
  untilNightRole('werewolf');
  act(P[1], 'night', { target: P[0].id });
  untilPhase('MORNING');
  assert.equal(P[0].alive, false);
  assert.equal(P[4].alive, false, 'the target dies with the avenger');
  assert.equal(P[4].deathCause, 'avenger');
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
    for (const [roleId, n] of Object.entries(want)) {
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
  assert.equal(s.game.phaseEndsAt - clock.now, cfg.nightStepTime * 1000);
  // Acting early does not shorten the slot (timing gives nothing away).
  const before = s.game.phaseEndsAt;
  act(P[1], 'night', { target: P[3].id });
  assert.equal(s.game.phaseEndsAt, before);
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

test('a dead role\'s step takes exactly as long as a live one', () => {
  const run = (killSeer) => {
    const g = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
    if (killSeer) g.P[2].alive = false;
    g.untilNightRole('seer');
    const start = g.clock.now;
    if (!killSeer) g.act(g.P[2], 'night', { target: g.P[1].id });
    for (let i = 0; i < 5 && g.s.game.queue[g.s.game.step] === 'seer'; i++) g.endPhase();
    return g.clock.now - start;
  };
  assert.equal(run(true), run(false));
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
  delete s.config.nightStepTime;
  delete s.config.nightPauseTime;
  for (let i = 0; i < 10; i++) {
    clock.advance(Math.max(0, s.game.phaseEndsAt - clock.now));
    assert.ok(Number.isFinite(s.game.phaseEndsAt), 'phase end stays a number');
  }
});

test('the game opens with three lines 5 s apart: welcome, night falls, first call', () => {
  const { s } = setup(['guard', 'werewolf', 'seer', 'villager', 'villager']);
  const clips = s.narration.clips;
  assert.deepEqual(clips.map(c => c.k), ['game_start', 'pause', 'night_start', 'pause', 'guard_wake']);
  assert.equal(clips[1].ms, 5000);
  assert.equal(clips[3].ms, 5000);
});

test('a silent host phone is replaced by a majority vote, with no new secrets', () => {
  const { s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager'], { config: { hostPlays: true } });
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
    const { s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager'], { rng: seeded(seed) });
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
    assert.ok(s.game.log[0].includes('bốc thăm'));
  }
  assert.equal(picks.size, 2, 'either tied player can be drawn');
});

test('a host vote closes after 20 s even if some players never vote', () => {
  const { s, P, clock } = setup(['villager', 'werewolf', 'seer', 'villager', 'villager']);
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
  assert.equal(s.phase, 'NIGHT');
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
