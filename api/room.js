// Single Vercel Function that hosts every room (Hobby plan allows few functions).
//
//   GET  /api/room?code=ABCDE&pid=...&token=...&since=<version>   poll the room
//   POST /api/room { action: 'create', name }                     create a room
//   POST /api/room { action: 'join', code, name }                 join a room
//   POST /api/room { action: 'act', code, pid, token, type, payload }

import {
  GameError, createRoom, joinRoom, authenticate, applyAction, tick, viewFor
} from '../lib/engine.js';
import { getStore, mutateRoom, createRoomRecord, StoreError } from '../lib/store.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEEN_REFRESH_MS = 10000;

const notFound = () => new GameError('Không tìm thấy phòng. Hãy kiểm tra lại mã phòng.');

function normalizeCode(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) throw new GameError('Mã phòng gồm 5 ký tự.');
  return code;
}

function newCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  return {};
}

async function handleCreate(store, body) {
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    const { state, player } = createRoom({ code, hostName: body.name, now, debug: !!body.debug });
    if (await createRoomRecord(store, code, state)) {
      return { code, playerId: player.id, token: player.token, view: viewFor(state, player.id, now, 1) };
    }
  }
  throw new StoreError('Không tạo được phòng, hãy thử lại.');
}

async function handleJoin(store, body) {
  const code = normalizeCode(body.code);
  const now = Date.now();
  const { state, version, result } = await mutateRoom(store, code, (s) => {
    tick(s, now);
    return { result: joinRoom(s, body.name, now) };
  }, notFound);
  return { code, playerId: result.id, token: result.token, view: viewFor(state, result.id, now, version) };
}

async function handleAct(store, body) {
  const code = normalizeCode(body.code);
  const now = Date.now();
  const { state, version } = await mutateRoom(store, code, (s) => {
    const p = authenticate(s, body.pid, body.token);
    p.lastSeen = now;
    tick(s, now);
    applyAction(s, p.id, String(body.type || ''), body.payload || {}, now);
    tick(s, now);
    return { changed: true };
  }, notFound);
  if (body.type === 'leave') return { left: true };
  return { view: viewFor(state, body.pid, now, version) };
}

async function handlePoll(store, query) {
  const code = normalizeCode(query.code);
  const since = Number(query.since) || 0;
  const now = Date.now();
  const { state, version } = await mutateRoom(store, code, (s) => {
    const p = authenticate(s, query.pid, query.token);
    let changed = tick(s, now);
    if (now - (p.lastSeen || 0) > SEEN_REFRESH_MS) {
      p.lastSeen = now;
      changed = true;
    }
    return { changed };
  }, notFound);
  if (version === since) return { same: true, version, serverNow: now };
  return { view: viewFor(state, query.pid, now, version) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const store = getStore();
    let out;
    if (req.method === 'GET') {
      out = await handlePoll(store, req.query || {});
    } else if (req.method === 'POST') {
      const body = readBody(req);
      if (body.action === 'create') out = await handleCreate(store, body);
      else if (body.action === 'join') out = await handleJoin(store, body);
      else if (body.action === 'act') out = await handleAct(store, body);
      else throw new GameError('Yêu cầu không hợp lệ.');
    } else {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof GameError) return res.status(400).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ.' });
    console.error(err);
    const message = err instanceof StoreError ? err.message : 'Máy chủ gặp lỗi, hãy thử lại.';
    return res.status(503).json({ error: message });
  }
}
