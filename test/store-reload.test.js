// The dev server reloads modules without restarting: the store then keeps
// the rooms and the update emitter it already had (kept on globalThis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

test('a reloaded store keeps the existing rooms and update emitter', async () => {
  const events = new EventEmitter();
  globalThis.__masoiEvents = events;
  const { devEvents } = await import('../lib/store.js');
  assert.equal(devEvents, events);
});

test('the first in-memory store makes the room map', async () => {
  delete globalThis.__masoiRooms;
  const { getStore, setStoreForTests } = await import('../lib/store.js');
  setStoreForTests(undefined);
  assert.equal(getStore().kind, 'memory');
  assert.ok(globalThis.__masoiRooms instanceof Map);
});
