// Room storage + change notifications.
//
// Production: Supabase.
//   - Postgres table `rooms` (see supabase/schema.sql) holds each room's JSON
//     state and a version number. Writes are compare-and-set on the version so
//     two players acting at the same moment never overwrite each other.
//   - Supabase Realtime "broadcast" tells every phone in the room that a new
//     version exists. The message carries only the version number: each phone
//     then fetches its own filtered view from the Vercel Function, so roles
//     never travel over the public channel.
//
// Local dev / tests: in-memory map, and notifications on an in-process emitter
// that the dev server forwards to browsers with Server-Sent Events.

import { EventEmitter } from 'node:events';

export class StoreError extends Error {}

// A room nobody has touched for this long is gone. Any connected phone keeps
// its room fresh (it checks in every 15 s or so), so this only removes rooms
// everyone has left.
export const ROOM_IDLE_MS = 30 * 60 * 1000;
const isIdle = (updatedAt) => Date.now() - updatedAt > ROOM_IDLE_MS;

const idleCutoff = () => new Date(Date.now() - ROOM_IDLE_MS).toISOString();

export function realtimeChannel(code) {
  return `room:${code}`;
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST + Realtime REST broadcast, no SDK needed on the server)
// ---------------------------------------------------------------------------

function supabaseStore(url, serviceKey) {
  const base = url.replace(/\/+$/, '');
  const headers = (extra = {}) => ({
    apikey: serviceKey,
    // Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys
    // are sent in the apikey header only.
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
    'Content-Type': 'application/json',
    ...extra
  });

  async function rest(method, path, { body, prefer } = {}) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: headers(prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { res, data };
  }

  return {
    kind: 'supabase',
    async load(code) {
      const { res, data } = await rest('GET', `rooms?code=eq.${encodeURIComponent(code)}&select=state,version,updated_at`);
      if (!res.ok) throw new StoreError(`Supabase: ${data?.message || res.status}`);
      if (!data?.length) return null;
      const row = data[0];
      if (row.updated_at && isIdle(Date.parse(row.updated_at))) {
        // Expired: delete it now (only if still stale) so the code is free again.
        await rest('DELETE', `rooms?code=eq.${encodeURIComponent(code)}&updated_at=lt.${encodeURIComponent(idleCutoff())}`,
          { prefer: 'return=minimal' }).catch(() => {});
        return null;
      }
      return { state: row.state, version: row.version };
    },
    async cas(code, expected, state, next) {
      const now = new Date().toISOString();
      if (expected === 0) {
        const { res, data } = await rest('POST', 'rooms', {
          body: { code, state, version: next, updated_at: now },
          prefer: 'return=minimal'
        });
        if (res.status === 409) return false;
        if (!res.ok) throw new StoreError(`Supabase: ${data?.message || res.status}`);
        return true;
      }
      const { res, data } = await rest('PATCH',
        `rooms?code=eq.${encodeURIComponent(code)}&version=eq.${expected}&select=version`, {
          body: { state, version: next, updated_at: now },
          prefer: 'return=representation'
        });
      if (!res.ok) throw new StoreError(`Supabase: ${data?.message || res.status}`);
      return Array.isArray(data) && data.length === 1;
    },
    async notify(code, version) {
      try {
        await fetch(`${base}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            messages: [{ topic: realtimeChannel(code), event: 'update', payload: { v: version }, private: false }]
          })
        });
      } catch (err) {
        // Phones still refresh on their own timers; a lost ping only adds delay.
        console.warn('Realtime broadcast failed', err);
      }
    },
    async cleanup() {
      await rest('DELETE', `rooms?updated_at=lt.${encodeURIComponent(idleCutoff())}`, { prefer: 'return=minimal' })
        .catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// In-memory (local dev and tests)
// ---------------------------------------------------------------------------

export const devEvents = globalThis.__masoiEvents || (globalThis.__masoiEvents = new EventEmitter());
devEvents.setMaxListeners(0);

function memoryStore() {
  const rooms = globalThis.__masoiRooms || (globalThis.__masoiRooms = new Map());
  return {
    kind: 'memory',
    async load(code) {
      const hit = rooms.get(code);
      if (hit && isIdle(hit.updatedAt)) rooms.delete(code);
      return rooms.has(code) ? { state: JSON.parse(hit.raw), version: hit.version } : null;
    },
    async cas(code, expected, state, next) {
      const cur = rooms.has(code) && !isIdle(rooms.get(code).updatedAt) ? rooms.get(code) : null;
      if ((cur?.version ?? 0) !== expected) return false;
      rooms.set(code, { raw: JSON.stringify(state), version: next, updatedAt: Date.now() });
      return true;
    },
    async notify(code, version) {
      devEvents.emit('update', { code, v: version });
    },
    async cleanup() {
      for (const [code, room] of rooms) if (isIdle(room.updatedAt)) rooms.delete(code);
    }
  };
}

// ---------------------------------------------------------------------------

const env = (...names) => names.map(n => process.env[n]).find(Boolean);

export function supabaseConfig() {
  return {
    url: env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
    publicKey: env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  };
}

let cached;
export function getStore() {
  if (cached) return cached;
  const { url, serviceKey } = supabaseConfig();
  if (url && serviceKey) {
    cached = supabaseStore(url, serviceKey);
  } else if (process.env.VERCEL) {
    // Serverless instances do not share memory, so rooms would randomly vanish.
    throw new StoreError('Chưa cấu hình Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  } else {
    cached = memoryStore();
  }
  return cached;
}

export function setStoreForTests(store) {
  cached = store;
}

// What the browser needs to subscribe to room updates (public values only).
export function realtimeClientConfig() {
  const { url, publicKey } = supabaseConfig();
  if (url && publicKey) return { kind: 'supabase', url, key: publicKey };
  if (!process.env.VERCEL) return { kind: 'dev' };
  return null;
}

// Load a room, let `fn` mutate it, and save with optimistic concurrency.
// `fn` returns { changed, result }. Throws if the room does not exist.
export async function mutateRoom(store, code, fn, notFound) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.load(code);
    if (!current) throw notFound();
    const { changed = true, result } = fn(current.state) || {};
    if (!changed) return { state: current.state, version: current.version, result, saved: false };
    const next = current.version + 1;
    if (await store.cas(code, current.version, current.state, next)) {
      return { state: current.state, version: next, result, saved: true };
    }
    await new Promise(r => setTimeout(r, 15 + Math.random() * 60 * (attempt + 1)));
  }
  throw new StoreError('Phòng đang bận, hãy thử lại.');
}

export async function createRoomRecord(store, code, state) {
  return store.cas(code, 0, state, 1);
}

export { supabaseStore as _supabaseStoreForTests };
