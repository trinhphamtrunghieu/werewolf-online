// The Vercel Function (api/room.js) and the room store (lib/store.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/room.js';
import {
  getStore, setStoreForTests, realtimeClientConfig, supabaseConfig, mutateRoom, createRoomRecord, devEvents,
  StoreError, _supabaseStoreForTests
} from '../lib/store.js';
import { createRoom } from '../lib/engine.js';

const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VERCEL'];

// Run `fn` with these environment variables (and none of the others).
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  ENV_KEYS.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}

const freshMemory = () => {
  globalThis.__masoiRooms = new Map();
  setStoreForTests(undefined);
  return withEnv({}, () => getStore());
};

// Call the handler like Vercel does.
async function call(method, { body, query } = {}) {
  const res = {
    headers: {},
    statusCode: 0,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; }
  };
  await handler({ method, body, query }, res);
  return res;
}

test('API: create, join, act, poll and check a room', async () => {
  await freshMemory();
  const created = await call('POST', { body: JSON.stringify({ action: 'create', name: 'Lan', game: 'avalon' }) });
  assert.equal(created.statusCode, 200);
  assert.match(created.headers['Server-Timing'], /db;desc="\d+ database calls";dur=/);
  assert.equal(created.headers['Cache-Control'], 'no-store');
  const { code, playerId: host, token } = created.body;
  assert.equal(created.body.view.gameId, 'avalon');

  const joined = await call('POST', { body: { action: 'join', code: code.toLowerCase(), name: 'Minh' } });
  assert.equal(joined.statusCode, 200);
  const guest = joined.body;

  const acted = await call('POST', { body: { action: 'act', code, pid: host, token, type: 'selectGame', payload: { gameId: 'werewolf' } } });
  assert.equal(acted.body.view.gameId, 'werewolf');
  // No payload and no type: a bad action, reported as a game error.
  const bad = await call('POST', { body: { action: 'act', code, pid: host, token } });
  assert.equal(bad.statusCode, 400);

  // Poll: a fresh view, then "same" when nothing changed.
  const polled = await call('GET', { query: { code, pid: guest.playerId, token: guest.token } });
  assert.ok(polled.body.view);
  const again = await call('GET', { query: { code, pid: guest.playerId, token: guest.token, since: String(polled.body.view.version) } });
  assert.equal(again.body.same, true);

  const checked = await call('GET', { query: { code, pid: guest.playerId, token: guest.token, check: '1' } });
  assert.deepEqual(checked.body, { exists: true, phase: 'LOBBY', name: 'Minh' });
  const gone = await call('GET', { query: { code: 'ZZZZZ', pid: 'x', token: 'y', check: '1' } });
  assert.equal(gone.statusCode, 400);

  const left = await call('POST', { body: { action: 'act', code, pid: guest.playerId, token: guest.token, type: 'leave' } });
  assert.deepEqual(left.body, { left: true });
});

test('API: the host is seen more often, and coming back cancels a vote to replace them', async () => {
  await freshMemory();
  const created = await call('POST', { body: { action: 'create', name: 'Lan' } });
  const { code, playerId: host, token } = created.body;
  const room = globalThis.__masoiRooms.get(code);
  const state = JSON.parse(room.raw);
  state.players[0].lastSeen = 0;
  state.hostVotes = { someone: host };
  state.hostVoteStartedAt = 1;
  room.raw = JSON.stringify(state);
  const polled = await call('GET', { query: { code, pid: host, token } });
  assert.ok(polled.body.view);
  const saved = JSON.parse(globalThis.__masoiRooms.get(code).raw);
  assert.deepEqual(saved.hostVotes, {});
  assert.ok(saved.players[0].lastSeen > 0);
  // Polled again with no vote going on: nothing to cancel.
  assert.ok((await call('GET', { query: { code, pid: host, token } })).body);
});

test('API: a poll that moves the game on wakes the other phones', async () => {
  await freshMemory();
  const { code, playerId: host, token } = (await call('POST', { body: { action: 'create', name: 'Lan', game: 'spyfall' } })).body;
  await call('POST', { body: { action: 'act', code, pid: host, token, type: 'addBot', payload: { count: 3 } } });
  await call('POST', { body: { action: 'act', code, pid: host, token, type: 'start' } });
  const room = globalThis.__masoiRooms.get(code);
  const state = JSON.parse(room.raw);
  state.game.phaseEndsAt = 1;
  room.raw = JSON.stringify(state);
  const pings = [];
  const listen = (e) => pings.push(e);
  devEvents.on('update', listen);
  await call('GET', { query: { code, pid: host, token } });
  devEvents.off('update', listen);
  assert.equal(pings.length, 1);
});

test('API: bad requests and errors', async () => {
  await freshMemory();
  const put = await call('PUT');
  assert.equal(put.statusCode, 405);
  assert.equal(put.headers.Allow, 'GET, POST');
  assert.equal((await call('POST', { body: { action: 'dance' } })).statusCode, 400);
  assert.equal((await call('POST')).statusCode, 400, 'no body at all');
  const broken = await call('POST', { body: '{oops' });
  assert.deepEqual([broken.statusCode, broken.body.error], [400, 'Dữ liệu gửi lên không hợp lệ.']);
  assert.match((await call('POST', { body: { action: 'join', code: 'AB', name: 'x' } })).body.error, /5 ký tự/);
  assert.equal((await call('GET', { query: { code: 'QQQQQ', pid: 'x', token: 'y' } })).statusCode, 400, 'no such room');
  // No query object at all (a GET without parameters).
  assert.equal((await call('GET')).statusCode, 400);
  const cfg = await withEnv({}, () => call('GET', { query: { config: '1' } }));
  assert.deepEqual(cfg.body, { realtime: { kind: 'dev' } });

  // A store that fails: 503, with its message when it is a StoreError.
  const original = getStore();
  setStoreForTests({ kind: 'x', load: async () => { throw new StoreError('Hỏng'); }, cas: async () => true, notify: async () => {}, cleanup: async () => {} });
  const down = await call('GET', { query: { code: 'ABCDE', pid: 'x', token: 'y' } });
  assert.deepEqual([down.statusCode, down.body.error], [503, 'Hỏng']);
  setStoreForTests({ kind: 'x', load: async () => { throw new Error('boom'); }, cas: async () => true, notify: async () => {}, cleanup: async () => {} });
  const realError = console.error;
  console.error = () => {};
  try {
    const crash = await call('GET', { query: { code: 'ABCDE', pid: 'x', token: 'y' } });
    assert.deepEqual([crash.statusCode, crash.body.error], [503, 'Máy chủ gặp lỗi, hãy thử lại.']);
  } finally {
    console.error = realError;
  }
  // Every code already taken: the room cannot be created.
  setStoreForTests({ kind: 'x', load: async () => null, cas: async () => false, notify: async () => {}, cleanup: async () => {} });
  const full = await call('POST', { body: { action: 'create', name: 'Lan' } });
  assert.deepEqual([full.statusCode, full.body.error], [503, 'Không tạo được phòng, hãy thử lại.']);
  setStoreForTests(original);
});

test('API: creating a room now and then sweeps idle rooms', async () => {
  await freshMemory();
  let swept = 0;
  const store = getStore();
  setStoreForTests({ ...store, cleanup: async () => { swept += 1; } });
  const random = Math.random;
  Math.random = () => 0.1;
  try {
    await call('POST', { body: { action: 'create', name: 'Lan' } });
  } finally {
    Math.random = random;
    setStoreForTests(store);
  }
  assert.equal(swept, 1);
});

test('store: which store and which realtime settings, from the environment', async () => {
  setStoreForTests(undefined);
  await withEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_1', SUPABASE_PUBLISHABLE_KEY: 'pub' }, () => {
    assert.equal(getStore().kind, 'supabase');
    assert.equal(getStore(), getStore(), 'kept once made');
    assert.deepEqual(realtimeClientConfig(), { kind: 'supabase', url: 'https://x.supabase.co', key: 'pub' });
    assert.equal(supabaseConfig().serviceKey, 'sb_secret_1');
  });
  setStoreForTests(undefined);
  await withEnv({ VERCEL: '1' }, () => {
    assert.throws(() => getStore(), StoreError);
    assert.equal(realtimeClientConfig(), null);
  });
  setStoreForTests(undefined);
  await withEnv({}, () => {
    assert.equal(getStore().kind, 'memory');
    assert.deepEqual(realtimeClientConfig(), { kind: 'dev' });
  });
});

test('memory store: notifications, cleanup, and giving up after too many conflicts', async () => {
  const store = await freshMemory();
  const seen = [];
  const listen = (e) => seen.push(e);
  devEvents.on('update', listen);
  await store.notify('ABCDE', 3);
  devEvents.off('update', listen);
  assert.deepEqual(seen, [{ code: 'ABCDE', v: 3 }]);

  const { state } = createRoom({ code: 'OLD01', hostName: 'Host', now: 0 });
  await createRoomRecord(store, 'OLD01', state);
  await createRoomRecord(store, 'NEW01', state);
  globalThis.__masoiRooms.get('OLD01').updatedAt = 0;
  await store.cleanup();
  assert.deepEqual([...globalThis.__masoiRooms.keys()], ['NEW01']);

  // Nothing changed: not saved.
  const same = await mutateRoom(store, 'NEW01', () => ({ changed: false, result: 7 }), () => new Error('x'));
  assert.deepEqual([same.saved, same.result, same.version], [false, 7, 1]);
  // A callback returning nothing counts as a change.
  assert.equal((await mutateRoom(store, 'NEW01', () => undefined, () => new Error('x'))).version, 2);

  const random = Math.random;
  Math.random = () => 0;
  try {
    const busy = { load: async () => ({ state: {}, version: 1 }), cas: async () => false };
    await assert.rejects(mutateRoom(busy, 'NEW01', () => ({}), () => new Error('x')), /Phòng đang bận/);
  } finally {
    Math.random = random;
  }
});

test('supabase store: legacy JWT keys, errors, and a failed broadcast', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  let mode = 'error';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (mode === 'throw') throw new Error('offline');
    if (mode === 'error') return new Response(JSON.stringify({ message: 'nope' }), { status: 500 });
    return new Response('', { status: 500 });
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const store = _supabaseStoreForTests('https://demo.supabase.co', 'eyJlegacy');
    await assert.rejects(store.load('ABCDE'), /Supabase: nope/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer eyJlegacy');
    await assert.rejects(store.cas('ABCDE', 0, {}, 1), /Supabase: nope/);
    await assert.rejects(store.cas('ABCDE', 1, {}, 2), /Supabase: nope/);
    mode = 'empty';
    await assert.rejects(store.load('ABCDE'), /Supabase: 500/);
    await assert.rejects(store.cas('ABCDE', 0, {}, 1), /Supabase: 500/);
    await assert.rejects(store.cas('ABCDE', 1, {}, 2), /Supabase: 500/);
    mode = 'throw';
    await store.notify('ABCDE', 2);
    await store.cleanup();
    // An expired room whose delete fails is still reported as gone.
    let deleted = false;
    globalThis.fetch = async (url, init) => {
      if (init.method === 'DELETE') { deleted = true; throw new Error('offline'); }
      return new Response(JSON.stringify([{ state: {}, version: 1, updated_at: '2000-01-01T00:00:00Z' }]), { status: 200 });
    };
    assert.equal(await store.load('ABCDE'), null);
    assert.ok(deleted);
    // A row without a timestamp is never treated as expired.
    globalThis.fetch = async () => new Response(JSON.stringify([{ state: { a: 1 }, version: 4 }]), { status: 200 });
    assert.deepEqual(await store.load('ABCDE'), { state: { a: 1 }, version: 4 });
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
});
