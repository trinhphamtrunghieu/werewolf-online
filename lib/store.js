// Room storage. Uses the Upstash Redis REST API (no SDK needed) when configured,
// otherwise an in-memory map for local development and tests.
//
// Each room is two keys: the JSON state and a version counter. Writes go through
// a Lua compare-and-set so two players acting at the same moment never overwrite
// each other: the loser simply retries on the fresh state.

const ROOM_TTL_SECONDS = 6 * 60 * 60;

const CAS_SCRIPT = `
local v = redis.call('GET', KEYS[2])
if (v == false and ARGV[1] == '0') or v == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
  return 1
end
return 0`;

const keys = (code) => [`masoi:room:${code}`, `masoi:room:${code}:v`];

export class StoreError extends Error {}

function upstashStore(url, token) {
  async function command(args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new StoreError(body.error || `Upstash HTTP ${res.status}`);
    return body.result;
  }
  return {
    kind: 'upstash',
    async load(code) {
      const [raw, version] = await command(['MGET', ...keys(code)]);
      if (!raw) return null;
      return { state: JSON.parse(raw), version: Number(version) || 0 };
    },
    async cas(code, expected, state, next) {
      const [k, kv] = keys(code);
      const ok = await command([
        'EVAL', CAS_SCRIPT, '2', k, kv,
        String(expected), JSON.stringify(state), String(next), String(ROOM_TTL_SECONDS)
      ]);
      return ok === 1;
    }
  };
}

function memoryStore() {
  const rooms = globalThis.__masoiRooms || (globalThis.__masoiRooms = new Map());
  return {
    kind: 'memory',
    async load(code) {
      const hit = rooms.get(code);
      return hit ? { state: JSON.parse(hit.raw), version: hit.version } : null;
    },
    async cas(code, expected, state, next) {
      const cur = rooms.get(code);
      if ((cur?.version ?? 0) !== expected) return false;
      rooms.set(code, { raw: JSON.stringify(state), version: next });
      return true;
    }
  };
}

let cached;
export function getStore() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    cached = upstashStore(url, token);
  } else if (process.env.VERCEL) {
    // Serverless instances do not share memory, so rooms would randomly vanish.
    throw new StoreError('Chưa cấu hình Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).');
  } else {
    cached = memoryStore();
  }
  return cached;
}

export function setStoreForTests(store) {
  cached = store;
}

// Load a room, let `fn` mutate it, and save with optimistic concurrency.
// `fn` returns { changed, result }. Throws if the room does not exist.
export async function mutateRoom(store, code, fn, notFound) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.load(code);
    if (!current) throw notFound();
    const { changed = true, result } = fn(current.state) || {};
    if (!changed) return { state: current.state, version: current.version, result };
    const next = current.version + 1;
    if (await store.cas(code, current.version, current.state, next)) {
      return { state: current.state, version: next, result };
    }
    await new Promise(r => setTimeout(r, 15 + Math.random() * 60 * (attempt + 1)));
  }
  throw new StoreError('Phòng đang bận, hãy thử lại.');
}

export async function createRoomRecord(store, code, state) {
  return store.cas(code, 0, state, 1);
}
