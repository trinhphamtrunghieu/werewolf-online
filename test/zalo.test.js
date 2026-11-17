// The Zalo Bot webhook (api/zalo.js), its helpers (lib/zalo.js) and the
// end-of-game event a bot-opened room sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zaloHandler from '../api/zalo.js';
import roomHandler from '../api/room.js';
import { getStore, setStoreForTests, _supabaseStoreForTests } from '../lib/store.js';
import { createRoom, joinRoom, applyAction } from '../lib/engine.js';
import {
  parseCommand, checkWebhookUrl, sameSecret, zaloConfig, sendMessage, createdMessage, roomUrl, toBase64, cardsAtEnd, eventLog,
  gameOverEvent, notifyGameOver, underRoomLimit, ROOM_LIMIT_MESSAGE, outcome, ZALO_API
} from '../lib/zalo.js';
import { LOCATIONS } from '../public/shared/spyfall.js';

const ENV_KEYS = ['ZALO_WEBHOOK_SECRET', 'ROOM_API_SECRET', 'ZALO_BOT_TOKEN', 'ZALO_EVENT_URL', 'ZALO_EVENT_SECRET', 'APP_URL',
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'VERCEL'];

// Run `fn` with these environment variables (and none of the others) and a
// fake fetch that records every request.
async function withEnv(vars, fn, respond = () => ({ ok: true })) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  ENV_KEYS.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, vars);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url);
  };
  globalThis.__masoiRooms = new Map();
  setStoreForTests(undefined);
  getStore();
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = savedFetch;
    ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}

async function call(handler, method, { body, query, headers = {} } = {}) {
  const res = {
    headers: {},
    statusCode: 0,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; }
  };
  await handler({ method, body, query, headers }, res);
  return res;
}

const SECRET = 'webhook-secret';
const textUpdate = (text, extra = {}) => ({
  event_name: 'message.text.received',
  message: {
    message_id: 'm1',
    message_type: 'CHAT_TEXT',
    date: 1,
    from: { id: 'u1', display_name: 'Ted', is_bot: false },
    chat: { id: 'chat-1', chat_type: 'GROUP' },
    text,
    ...extra
  }
});
const hook = (body, headers = { 'x-bot-api-secret-token': SECRET }) => call(zaloHandler, 'POST', { body, headers });
const fromB64 = (b) => Buffer.from(b, 'base64').toString('utf8');

test('Zalo: parse ">createRoom" commands', () => {
  assert.deepEqual(parseCommand('>createRoom wolf'), { gameId: 'werewolf', webhookUrl: null });
  assert.deepEqual(parseCommand('  > createroom   Ma-Sói '), { gameId: 'werewolf', webhookUrl: null });
  assert.deepEqual(parseCommand('>createRoom'), { gameId: 'werewolf', webhookUrl: null });
  assert.deepEqual(parseCommand('>CREATEROOM spyfall'), { gameId: 'spyfall', webhookUrl: null });
  assert.deepEqual(parseCommand('>createRoom gián điệp'), { gameId: 'spyfall', webhookUrl: null });
  assert.deepEqual(parseCommand('>createRoom undercover'), { gameId: 'undercover', webhookUrl: null });
  assert.deepEqual(parseCommand('>createRoom avalon'), { gameId: 'avalon', webhookUrl: null });
  assert.match(parseCommand('>createRoom cờ vua').error, /Không có trò "cờ vua"/);
  // A webhook anywhere after the command; the rest is the game.
  assert.deepEqual(parseCommand('>createRoom wolf https://bot.vn/hook?room=1'), { gameId: 'werewolf', webhookUrl: 'https://bot.vn/hook?room=1' });
  assert.deepEqual(parseCommand('>createRoom HTTPS://bot.vn/x avalon'), { gameId: 'avalon', webhookUrl: 'HTTPS://bot.vn/x' });
  assert.deepEqual(parseCommand('>createRoom http://localhost:4000/hook'), { gameId: 'werewolf', webhookUrl: 'http://localhost:4000/hook' });
  assert.match(parseCommand('>createRoom chess https://bot.vn').error, /Không có trò "chess"\. Dùng: .*\[webhook URL\]/);
  assert.equal(parseCommand('createRoom wolf'), null);
  assert.equal(parseCommand('>createRoomwolf'), null);
  assert.equal(parseCommand('xin chào'), null);
  assert.equal(parseCommand(undefined), null);
});

test('Zalo: a room webhook must be https on a public host, except when running locally', () => {
  assert.equal(checkWebhookUrl('https://bot.vn/hook?x=1'), 'https://bot.vn/hook?x=1');
  assert.equal(checkWebhookUrl('HTTPS://Bot.VN/h'), 'https://bot.vn/h');
  for (const bad of ['http://bot.vn/h', 'https://localhost/h', 'https://a.localhost/h', 'https://db.internal/h', 'https://printer.local/',
    'https://127.0.0.1/', 'https://10.1.2.3/', 'https://192.168.1.1/', 'https://172.16.0.1/', 'https://172.31.9.9/',
    'https://169.254.169.254/latest', 'https://0.0.0.0/', 'https://[::1]/', 'https://user:pw@bot.vn/', 'ftp://bot.vn/', 'not a url', undefined, '', '   ', 42]) {
    assert.equal(checkWebhookUrl(bad), null, String(bad));
  }
  assert.equal(checkWebhookUrl('https://172.32.0.1/'), 'https://172.32.0.1/');
  // A bare host means https.
  assert.equal(checkWebhookUrl(' webhook.site/abc '), 'https://webhook.site/abc');
  assert.equal(checkWebhookUrl('localhost:4000/h'), null);
  assert.equal(checkWebhookUrl('http://127.0.0.1:4000/hook', { local: true }), 'http://127.0.0.1:4000/hook');
  assert.equal(checkWebhookUrl('https://localhost/h', { local: true }), 'https://localhost/h');
  assert.equal(checkWebhookUrl('ftp://bot.vn/', { local: true }), null);
  assert.equal(checkWebhookUrl('http://u:p@localhost/', { local: true }), null);
});

test('Zalo: config, links and the reply text', async () => {
  await withEnv({}, () => {
    assert.deepEqual(zaloConfig(), { secret: '', roomSecret: '', botToken: '', eventUrl: '', eventSecret: '', appUrl: '' });
  });
  await withEnv({ ZALO_WEBHOOK_SECRET: 'a', ZALO_EVENT_SECRET: 'b', APP_URL: 'https://x.vn//', ZALO_BOT_TOKEN: 't', ZALO_EVENT_URL: 'https://bot' }, () => {
    assert.deepEqual(zaloConfig(), { secret: 'a', roomSecret: 'a', botToken: 't', eventUrl: 'https://bot', eventSecret: 'b', appUrl: 'https://x.vn' });
  });
  await withEnv({ ZALO_WEBHOOK_SECRET: 'a' }, () => assert.equal(zaloConfig().eventSecret, 'a'));
  await withEnv({ ZALO_WEBHOOK_SECRET: 'a', ROOM_API_SECRET: 'r' }, () => assert.equal(zaloConfig().roomSecret, 'r'));
  assert.equal(roomUrl('https://x.vn', 'ABCDE'), 'https://x.vn/?room=ABCDE');
  assert.equal(toBase64('Sói'), Buffer.from('Sói').toString('base64'));
  assert.match(createdMessage('werewolf', 'https://x.vn/?room=ABCDE', 'ABCDE'), /🐺 Đã tạo phòng Ma Sói: ABCDE\nVào chơi: https:\/\/x\.vn\/\?room=ABCDE\nNgười vào phòng đầu tiên/);
});

test('Zalo: sendMessage calls the Bot API and caps the text', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), init }); return { ok: false }; };
  assert.equal(await sendMessage('TOKEN', 'chat-1', 'x'.repeat(2500), fake), false);
  assert.equal(calls[0].url, `${ZALO_API}/botTOKEN/sendMessage`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].body.chat_id, 'chat-1');
  assert.equal(calls[0].body.text.length, 2000);
});

test('Zalo webhook: refuses wrong methods, a missing secret and a wrong secret', async () => {
  await withEnv({}, async () => {
    const get = await call(zaloHandler, 'GET', { headers: {} });
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.Allow, 'POST');
    assert.equal((await hook(textUpdate('>createRoom wolf'))).statusCode, 503);
  });
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET }, async (calls) => {
    assert.equal((await hook(textUpdate('>createRoom wolf'), { 'x-bot-api-secret-token': 'nope' })).statusCode, 403);
    assert.equal((await call(zaloHandler, 'POST', { body: textUpdate('>createRoom wolf') })).statusCode, 403);
    assert.equal(calls.length, 0);
  });
});

test('Zalo webhook: ignores bad JSON, other events and plain messages', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    assert.equal((await hook('{nope')).statusCode, 400);
    assert.equal((await hook({ event_name: 'message.sticker.received', message: { chat: { id: 'c' } } })).body.message, 'Ignored');
    assert.equal((await hook(textUpdate('chào bot'))).body.message, 'Ignored');
    assert.equal((await hook({ event_name: 'message.text.received' })).body.message, 'Ignored');
    assert.equal((await hook(textUpdate('>createRoom wolf', { chat: {} }))).body.message, 'Ignored');
    assert.equal((await hook(undefined)).body.message, 'Ignored');
    assert.equal(calls.length, 0);
  });
});

test('Zalo webhook: an unknown game gets a reply and no room', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    const res = await hook(textUpdate('>createRoom chess'));
    assert.equal(res.body.message, 'Unknown game');
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.text, /Không có trò "chess"/);
    assert.equal(globalThis.__masoiRooms.size, 0);
  });
});

test('Zalo webhook: ">createRoom wolf" opens an empty room; the first to join becomes host', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    const res = await call(zaloHandler, 'POST', {
      body: JSON.stringify(textUpdate('>createRoom wolf')),
      headers: { 'x-bot-api-secret-token': SECRET, host: 'masoi.vn', 'x-forwarded-proto': 'https' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    const { code, url, game_id: gameId } = res.body;
    assert.match(gameId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(url, `https://masoi.vn/?room=${code}`);
    assert.equal(calls[0].url, `${ZALO_API}/botT/sendMessage`);
    assert.equal(calls[0].body.chat_id, 'chat-1');
    assert.ok(calls[0].body.text.includes(url));

    const room = await getStore().load(code);
    assert.equal(room.state.hostId, null);
    assert.equal(room.state.players.length, 0);
    assert.equal(room.state.gameId, 'werewolf');
    assert.deepEqual(room.state.zalo, { gameId, chatId: 'chat-1', messageId: 'm1', webhookUrl: null, from: { id: 'u1', display_name: 'Ted' }, appUrl: 'https://masoi.vn' });

    const lan = await call(roomHandler, 'POST', { body: { action: 'join', code, name: 'Lan' } });
    assert.equal(lan.body.view.hostId, lan.body.playerId);
    const minh = await call(roomHandler, 'POST', { body: { action: 'join', code, name: 'Minh' } });
    assert.equal(minh.body.view.hostId, lan.body.playerId);
    const state = (await getStore().load(code)).state;
    assert.equal(state.config.hostPlays, true);
    assert.deepEqual(state.players.map(p => p.seat), [1, 2]);
  });
});

test('Zalo webhook: room links use APP_URL, or the local address; no token means no reply', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, APP_URL: 'https://choi.vn/' }, async (calls) => {
    const res = await hook(textUpdate('>createRoom avalon', { from: undefined }));
    assert.match(res.body.url, /^https:\/\/choi\.vn\/\?room=[A-Z0-9]{5}$/);
    const room = await getStore().load(res.body.code);
    assert.equal(room.state.gameId, 'avalon');
    assert.deepEqual(room.state.zalo.from, { id: null, display_name: null });
    const noId = await hook(textUpdate('>createRoom', { message_id: undefined }));
    assert.equal((await getStore().load(noId.body.code)).state.zalo.messageId, null);
    assert.equal(calls.length, 0);
  });
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET }, async () => {
    const local = await call(zaloHandler, 'POST', { body: textUpdate('>createRoom'), headers: { 'x-bot-api-secret-token': SECRET, host: 'localhost:3000' } });
    assert.match(local.body.url, /^http:\/\/localhost:3000\//);
    const fwd = await call(zaloHandler, 'POST', { body: textUpdate('>createRoom'), headers: { 'x-bot-api-secret-token': SECRET, 'x-forwarded-host': 'a.vn' } });
    assert.match(fwd.body.url, /^https:\/\/a\.vn\//);
    const bare = await call(zaloHandler, 'POST', { body: textUpdate('>createRoom'), headers: { 'x-bot-api-secret-token': SECRET } });
    assert.match(bare.body.url, /^http:\/\/localhost:3000\//);
  });
});

test('Zalo webhook: the room keeps the webhook from the message or from the update', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET }, async () => {
    const inText = await hook(textUpdate('>createRoom wolf https://bot.vn/a'));
    assert.equal(inText.body.webhook_url, 'https://bot.vn/a');
    assert.equal((await getStore().load(inText.body.code)).state.zalo.webhookUrl, 'https://bot.vn/a');
    const inBody = await hook({ ...textUpdate('>createRoom wolf'), webhook_url: 'https://bot.vn/b' });
    assert.equal((await getStore().load(inBody.body.code)).state.zalo.webhookUrl, 'https://bot.vn/b');
    // The message's own webhook wins.
    const both = await hook({ ...textUpdate('>createRoom wolf https://bot.vn/c'), webhook_url: 'https://bot.vn/d' });
    assert.equal(both.body.webhook_url, 'https://bot.vn/c');
    // Running locally, a webhook on this machine is fine.
    const local = await hook(textUpdate('>createRoom wolf http://127.0.0.1:4000/hook'));
    assert.equal(local.body.webhook_url, 'http://127.0.0.1:4000/hook');
  });
});

test('Zalo webhook: a bad webhook gets a reply and no room', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    const bad = await hook({ ...textUpdate('>createRoom wolf'), webhook_url: 'ftp://bot.vn' });
    assert.equal(bad.body.message, 'Invalid webhook URL');
    assert.match(calls[0].body.text, /Webhook URL không hợp lệ/);
    // On Vercel, only https on a public host.
    process.env.VERCEL = '1';
    const internal = await hook(textUpdate('>createRoom wolf http://127.0.0.1:4000/hook'));
    assert.equal(internal.body.message, 'Invalid webhook URL');
    assert.equal(globalThis.__masoiRooms.size, 0);
  });
});

test('Zalo webhook: a failed reply does not lose the room', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const res = await hook(textUpdate('>createRoom wolf'));
      assert.equal(res.statusCode, 200);
      assert.ok(await getStore().load(res.body.code));
    } finally {
      console.warn = warn;
    }
  }, () => { throw new Error('offline'); });
});

test('Zalo webhook: the store failing is reported in the chat', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    const error = console.error;
    console.error = () => {};
    try {
      setStoreForTests({ cas: async () => false, countBotRooms: async () => 0 });
      const busy = await hook(textUpdate('>createRoom wolf'));
      assert.equal(busy.statusCode, 503);
      assert.equal(busy.body.message, 'Không tạo được phòng, hãy thử lại.');
      assert.match(calls.at(-1).body.text, /Không tạo được phòng/);
      setStoreForTests({ cas: async () => { throw new Error('db down'); }, countBotRooms: async () => 0 });
      const down = await hook(textUpdate('>createRoom wolf'));
      assert.equal(down.body.message, 'Server error');
    } finally {
      console.error = error;
      setStoreForTests(undefined);
    }
  });
});

// ---------------------------------------------------------------------------

function wolfRoom() {
  const now = 1000;
  const { state: s } = createRoom({ code: 'WOLF1', now, hostless: true });
  const names = ['Lan', 'Minh', 'An', 'Bình', 'Chi'];
  names.forEach(n => joinRoom(s, n, now));
  const roles = ['werewolf', 'seer', 'villager', 'piper', 'witch'];
  s.players.forEach((p, i) => { p.inGame = true; p.role = roles[i]; });
  s.players[1].alive = false;
  s.players.reverse();
  s.phase = 'GAME_OVER';
  s.game.winner = 'werewolf';
  s.game.winReason = 'Số Sói (1) đã bằng hoặc nhiều hơn số người còn lại (1).';
  const named = (n) => s.players.find(p => p.name === n).id;
  s.game.lovers = [named('Lan'), named('An')]; // Ma Sói and Dân Làng
  s.game.log = ['Ván chơi bắt đầu với 5 người.', '🌙 Đêm 1 buông xuống.', '🐺 Bầy Sói cắn Chi',
    '☀️ Sáng ngày 1, đã chết: Chi.', '🌙 Đêm 2 buông xuống.', '🏆 PHE MA SÓI CHIẾN THẮNG!'];
  s.zalo = { chatId: 'chat-1', messageId: 'm1', games: 2, from: { id: 'u1', display_name: 'Ted' }, appUrl: 'https://masoi.vn' };
  return s;
}

test('Zalo: the cards at the end of a Ma Sói game, with the couple', () => {
  const s = wolfRoom();
  const cards = cardsAtEnd(s);
  assert.deepEqual(cards.map(c => [c.seat, c.name, c.role, c.team, c.alive, c.lover]), [
    [1, 'Lan', 'Ma Sói', 'werewolf', true, { seat: 3, name: 'An' }],
    [2, 'Minh', 'Tiên Tri', 'village', false, null],
    [3, 'An', 'Dân Làng', 'village', true, { seat: 1, name: 'Lan' }],
    [4, 'Bình', 'Người Thổi Sáo', 'third', true, null],
    [5, 'Chi', 'Phù Thủy', 'village', true, null]
  ]);
  assert.equal(cards[0].teamLabel, 'Phe Ma Sói');
  // No couple: nobody has a lover.
  s.game.lovers = [];
  assert.ok(cardsAtEnd(s).every(c => c.lover === null));
});

test('Zalo: every Artifact card each player held, kept or not', () => {
  const s = wolfRoom();
  const named = (n) => s.players.find(p => p.name === n).id;
  s.game.art = {
    hands: {
      [named('Lan')]: [{ uid: 1, id: 'amulet', revealed: true, day: 1 }, { uid: 2, id: 'claw', revealed: false, day: null }],
      [named('Minh')]: []
    },
    gone: {
      [named('Minh')]: [{ id: 'citrine', revealed: false }],
      [named('Lan')]: [{ id: 'amber', revealed: true }]
    }
  };
  const cards = cardsAtEnd(s);
  assert.deepEqual(cards[0].artifacts, [
    { name: 'Bùa Hộ Mệnh', icon: '🧿', revealed: true, kept: true },
    { name: 'Vuốt Ma Sói', icon: '🐾', revealed: false, kept: true },
    { name: 'Hổ Phách Bình Minh', icon: '🟡', revealed: true, kept: false }
  ]);
  // Died with it face down: back to the deck, still reported.
  assert.deepEqual(cards[1].artifacts, [{ name: 'Thạch Anh Vàng May Mắn', icon: '🟠', revealed: false, kept: false }]);
  // Never dealt one.
  assert.deepEqual(cards[2].artifacts, []);
  // A game from before cards were remembered: only the hands.
  delete s.game.art.gone;
  assert.equal(cardsAtEnd(s)[0].artifacts.length, 2);
  const roles = JSON.parse(fromB64(gameOverEvent(s, 1).roles));
  assert.deepEqual(roles[0].artifacts, cardsAtEnd(s)[0].artifacts);
});

test('Zalo: a third-side role', () => {
  const s = wolfRoom();
  s.players[0].role = 'fool';
  const fool = cardsAtEnd(s).find(c => c.role === 'Kẻ Cuồng Loạn');
  assert.equal(fool.team, 'third');
  assert.ok(fool.teamLabel);
});

test('Zalo: the log for the bot has a blank line between days', () => {
  assert.equal(eventLog(['Bắt đầu.', '🌙 Đêm 1 buông xuống.', 'a', '☀️ Sáng ngày 1', '🌙 Đêm 2 buông xuống.', 'b']),
    'Bắt đầu.\n\n🌙 Đêm 1 buông xuống.\na\n☀️ Sáng ngày 1\n\n🌙 Đêm 2 buông xuống.\nb');
  // The first line never gets one; games without nights are unchanged.
  assert.equal(eventLog(['🌙 Đêm 1 buông xuống.', 'a']), '🌙 Đêm 1 buông xuống.\na');
  assert.equal(eventLog(['🕵️ Ván bắt đầu.', '🏆 Thắng!']), '🕵️ Ván bắt đầu.\n🏆 Thắng!');
  assert.equal(eventLog([]), '');
});

test('Zalo: the cards for Avalon, Spyfall and Undercover', () => {
  const base = (gameId, play) => {
    const { state: s } = createRoom({ code: 'GAME1', hostName: 'A', now: 0, gameId });
    joinRoom(s, 'B', 0);
    joinRoom(s, 'C', 0);
    s.players.forEach(p => { p.inGame = true; });
    s.play = play(s.players.map(p => p.id));
    return s;
  };
  const av = base('avalon', ([a, b, c]) => ({ roles: { [a]: 'merlin', [b]: 'assassin', [c]: 'servant' } }));
  assert.ok(cardsAtEnd(av).every(c => c.lover === null));
  assert.deepEqual(cardsAtEnd(av).map(c => [c.role, c.team, c.teamLabel]), [
    ['Merlin', 'good', 'Phe Thiện'], ['Sát Thủ', 'evil', 'Phe Ác'], ['Hiệp sĩ trung thành', 'good', 'Phe Thiện']
  ]);
  const spy = base('spyfall', ([a]) => ({ spy: a, location: 0 }));
  assert.deepEqual(cardsAtEnd(spy).map(c => [c.role, c.team]), [
    ['Gián điệp', 'evil'], [`Dân thường (${LOCATIONS[0].name})`, 'good'], [`Dân thường (${LOCATIONS[0].name})`, 'good']
  ]);
  const uc = base('undercover', ([a, b, c]) => ({ roles: { [a]: 'civilian', [b]: 'undercover', [c]: 'white' }, words: { civilian: 'Mèo', undercover: 'Hổ' } }));
  assert.deepEqual(cardsAtEnd(uc).map(c => [c.role, c.icon, c.team, c.teamLabel]), [
    ['Dân thường (Mèo)', '🧑', 'good', 'Dân thường'], ['Nội gián (Hổ)', '🗝️', 'evil', 'Nội gián'], ['Trắng (không có từ)', '⬜', 'evil', 'Trắng']
  ]);
});

test('Zalo: the outcome comes from Ma Sói or from the other games', () => {
  assert.deepEqual(outcome({ game: { winner: 'village', winReason: 'Hết Sói.' } }), { winner: 'village', reason: 'Hết Sói.' });
  assert.deepEqual(outcome({ game: {}, play: { result: { winner: 'good', reason: 'Ba nhiệm vụ.' } } }), { winner: 'good', reason: 'Ba nhiệm vụ.' });
  assert.deepEqual(outcome({ game: {}, play: { result: null } }), { winner: null, reason: '' });
  assert.deepEqual(outcome({}), { winner: null, reason: '' });
});

test('Zalo: the end-of-game event carries the log and the cards (with the couple) in base64', () => {
  const s = wolfRoom();
  const ev = gameOverEvent(s, 5000);
  assert.equal(ev.event_name, 'room.game_over');
  assert.equal(ev.game_id, null); // a room from before game ids
  assert.equal(gameOverEvent({ ...s, zalo: { ...s.zalo, gameId: 'g-1' } }, 5000).game_id, 'g-1');
  assert.equal(ev.chat_id, 'chat-1');
  assert.equal(ev.message_id, 'm1');
  assert.equal(ev.game_no, 2);
  assert.deepEqual(ev.created_by, { id: 'u1', display_name: 'Ted' });
  assert.deepEqual(ev.room, { code: 'WOLF1', game: 'werewolf', url: 'https://masoi.vn/?room=WOLF1' });
  assert.equal(ev.ended_at, 5000);
  assert.equal(ev.winner, 'werewolf');
  assert.equal(ev.encoding, 'base64');
  assert.equal(fromB64(ev.log), 'Ván chơi bắt đầu với 5 người.\n\n🌙 Đêm 1 buông xuống.\n🐺 Bầy Sói cắn Chi\n' +
    '☀️ Sáng ngày 1, đã chết: Chi.\n\n🌙 Đêm 2 buông xuống.\n🏆 PHE MA SÓI CHIẾN THẮNG!');
  const roles = JSON.parse(fromB64(ev.roles));
  assert.deepEqual(roles[0], { seat: 1, name: 'Lan', role: 'Ma Sói', icon: '🐺', team: 'Phe Ma Sói', alive: true, lover: { seat: 3, name: 'An' }, artifacts: [] });
  assert.deepEqual(roles[1], { seat: 2, name: 'Minh', role: 'Tiên Tri', icon: '🔮', team: 'Phe Dân Làng', alive: false, lover: null, artifacts: [] });
  // No picture any more.
  assert.equal('roles_image' in ev, false);
  assert.equal('roles_image_mime' in ev, false);
  // Without a site address, a game record or a winner.
  s.zalo = { chatId: 'chat-1', from: null, appUrl: '' };
  const bare = gameOverEvent({ ...s, game: undefined, players: [] }, 1);
  assert.equal(bare.room.url, null);
  assert.equal(bare.winner, null);
  assert.equal(bare.message_id, null);
  assert.equal(bare.game_no, 1);
  assert.equal(fromB64(bare.log), '');
});

test('Zalo: notifyGameOver posts the event only for bot rooms with a target, and never throws', async () => {
  const s = wolfRoom();
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const config = { eventUrl: 'https://bot.vn/hook', eventSecret: 'sss' };
  assert.equal(await notifyGameOver({ ...s, zalo: undefined }, 1, { config, fetchImpl: fake }), false);
  assert.equal(await notifyGameOver(s, 1, { config: { eventUrl: '' }, fetchImpl: fake }), false);
  assert.equal(calls.length, 0);
  assert.equal(await notifyGameOver(s, 1, { config, fetchImpl: fake }), true);
  assert.equal(calls[0].url, 'https://bot.vn/hook');
  assert.equal(calls[0].init.headers['X-Bot-Api-Secret-Token'], 'sss');
  assert.equal(JSON.parse(calls[0].init.body).event_name, 'room.game_over');
  await notifyGameOver(s, 1, { config: { eventUrl: 'https://bot.vn/hook', eventSecret: '' }, fetchImpl: fake });
  assert.equal(calls[1].init.headers['X-Bot-Api-Secret-Token'], undefined);
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    assert.equal(await notifyGameOver(s, 1, { config, fetchImpl: async () => { throw new Error('down'); } }), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned, 1);
  // The room's own webhook wins over ZALO_EVENT_URL.
  await notifyGameOver({ ...s, zalo: { ...s.zalo, webhookUrl: 'https://room.vn/h' } }, 1, { config, fetchImpl: fake });
  assert.equal(calls.at(-1).url, 'https://room.vn/h');
  assert.equal(await notifyGameOver({ ...s, zalo: { ...s.zalo, webhookUrl: 'https://room.vn/h' } }, 1, { config: { eventUrl: '' }, fetchImpl: fake }), true);
  assert.equal(calls.at(-1).url, 'https://room.vn/h');
  // Defaults: the environment and the global fetch.
  await withEnv({ ZALO_EVENT_URL: 'https://env.vn/e' }, async (envCalls) => {
    assert.equal(await notifyGameOver(s, 1), true);
    assert.equal(envCalls[0].url, 'https://env.vn/e');
  });
});

test('Zalo: a game ending in a bot room posts the event once', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_EVENT_URL: 'https://bot.vn/hook' }, async (calls) => {
    const { code } = (await hook(textUpdate('>createRoom spyfall'))).body;
    const seats = [];
    for (const name of ['Lan', 'Minh', 'An']) seats.push((await call(roomHandler, 'POST', { body: { action: 'join', code, name } })).body);
    const host = seats[0];
    const act = (p, type, payload) => call(roomHandler, 'POST', { body: { action: 'act', code, pid: p.playerId, token: p.token, type, payload } });
    await act(host, 'start', {});
    const s = (await getStore().load(code)).state;
    const spy = seats.find(p => p.playerId === s.play.spy);
    // A poll that changes nothing does not report.
    await call(roomHandler, 'GET', { query: { code, pid: host.playerId, token: host.token } });
    assert.equal(calls.length, 0);
    const res = await act(spy, 'guess', { location: s.play.location });
    assert.equal(res.body.view.phase, 'GAME_OVER');
    assert.equal(calls.length, 1);
    const ev = calls[0].body;
    assert.equal(ev.room.code, code);
    assert.equal(ev.room.game, 'spyfall');
    assert.equal(JSON.parse(fromB64(ev.roles)).length, 3);
    assert.match(fromB64(ev.log), /Gián điệp .* đoán đúng địa điểm/);
    assert.equal(ev.message_id, 'm1');
    assert.equal(ev.game_no, 1);
    assert.equal(ev.winner, 'spy');
    assert.equal(JSON.parse(fromB64(ev.roles))[0].lover, null);
    // Games other than Ma Sói have no Artifacts.
    assert.ok(JSON.parse(fromB64(ev.roles)).every(r => r.artifacts.length === 0));
    // Each card carries its emoji: the spy's, or a villager's.
    assert.ok(JSON.parse(fromB64(ev.roles)).every(r => ['🕵️', '🧑'].includes(r.icon)));
    // Later requests in the finished game do not report again.
    await call(roomHandler, 'GET', { query: { code, pid: host.playerId, token: host.token } });
    await act(host, 'restart', {});
    assert.equal(calls.length, 1);
    // The room's next game is game 2.
    await act(host, 'start', {});
    const next = (await getStore().load(code)).state;
    const spy2 = seats.find(p => p.playerId === next.play.spy);
    await act(spy2, 'guess', { location: next.play.location });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.game_no, 2);
    assert.equal(calls[1].body.game_id, calls[0].body.game_id);
    assert.equal(calls[1].body.room.code, code);
  });
});

test('Zalo: rooms opened from different chats at once each report to their own webhook', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET }, async (calls) => {
    const open = (chat, mid) => hook(textUpdate(`>createRoom spyfall https://bot.vn/${mid}`, { chat: { id: chat }, message_id: mid }));
    const opened = (await Promise.all([open('chat-A', 'mA'), open('chat-B', 'mB'), open('chat-A', 'mA2')])).map(r => r.body);
    const [a, b, a2] = opened.map(r => r.code);
    const id = Object.fromEntries(opened.map(r => [r.code, r.game_id]));
    assert.equal(new Set(Object.values(id)).size, 3);
    assert.equal(new Set([a, b, a2]).size, 3);
    // End them in a different order from the one they were opened in.
    for (const code of [b, a2, a]) {
      const seats = [];
      for (const name of ['Lan', 'Minh', 'An']) seats.push((await call(roomHandler, 'POST', { body: { action: 'join', code, name } })).body);
      const act = (p, type, payload) => call(roomHandler, 'POST', { body: { action: 'act', code, pid: p.playerId, token: p.token, type, payload } });
      await act(seats[0], 'start', {});
      const s = (await getStore().load(code)).state;
      await act(seats.find(p => p.playerId === s.play.spy), 'guess', { location: s.play.location });
    }
    assert.deepEqual(calls.map(c => [c.url, c.body.game_id, c.body.room.code, c.body.chat_id, c.body.message_id, c.body.game_no]), [
      ['https://bot.vn/mB', id[b], b, 'chat-B', 'mB', 1],
      ['https://bot.vn/mA2', id[a2], a2, 'chat-A', 'mA2', 1],
      ['https://bot.vn/mA', id[a], a, 'chat-A', 'mA', 1]
    ]);
  });
});

test('API create: a webhook_url and no name opens an empty room that reports to it', async () => {
  await withEnv({ ROOM_API_SECRET: 'room-secret' }, async (calls) => {
    const res = await call(roomHandler, 'POST', {
      body: { action: 'create', webhook_url: 'http://127.0.0.1:4000/hook', game: 'spyfall', debug: false },
      headers: { host: 'localhost:3000', 'x-bot-api-secret-token': 'room-secret' }
    });
    assert.equal(res.statusCode, 200);
    const { code } = res.body;
    const gameId = res.body.game_id;
    assert.match(gameId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(res.body, { code, url: `http://localhost:3000/?room=${code}`, webhook_url: 'http://127.0.0.1:4000/hook', game_id: gameId });
    const state = (await getStore().load(code)).state;
    assert.equal(state.hostId, null);
    assert.equal(state.players.length, 0);
    assert.equal(state.gameId, 'spyfall');
    assert.equal(state.debug, false);
    assert.deepEqual(state.zalo, { gameId, chatId: null, messageId: null, from: null, webhookUrl: 'http://127.0.0.1:4000/hook', appUrl: 'http://localhost:3000' });

    // The first to join hosts the room; a finished game goes to the webhook.
    const seats = [];
    for (const name of ['Lan', 'Minh', 'An']) seats.push((await call(roomHandler, 'POST', { body: { action: 'join', code, name } })).body);
    assert.equal(seats[0].view.hostId, seats[0].playerId);
    const act = (p, type, payload) => call(roomHandler, 'POST', { body: { action: 'act', code, pid: p.playerId, token: p.token, type, payload } });
    await act(seats[0], 'start', {});
    const s = (await getStore().load(code)).state;
    await act(seats.find(p => p.playerId === s.play.spy), 'guess', { location: s.play.location });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:4000/hook');
    const ev = calls[0].body;
    assert.equal(ev.event_name, 'room.game_over');
    assert.equal(ev.game_id, gameId);
    assert.equal(ev.chat_id, null);
    assert.equal(ev.message_id, null);
    assert.equal(ev.created_by, null);
    assert.equal(ev.game_no, 1);
    assert.equal(ev.winner, 'spy');
    assert.deepEqual(ev.room, { code, game: 'spyfall', url: `http://localhost:3000/?room=${code}` });
  });
});

test('API create: a webhook_url with a name makes that player the host; a bare host means https', async () => {
  await withEnv({ APP_URL: 'https://masoi.vn', ZALO_WEBHOOK_SECRET: SECRET }, async () => {
    process.env.VERCEL = '1'; // after the in-memory store is set up
    const headers = { 'x-bot-api-secret-token': SECRET }; // ROOM_API_SECRET falls back to ZALO_WEBHOOK_SECRET
    const res = await call(roomHandler, 'POST', { body: { action: 'create', name: 'Lan', webhook_url: 'webhook.site/abc' }, headers });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.webhook_url, 'https://webhook.site/abc');
    assert.equal(res.body.url, `https://masoi.vn/?room=${res.body.code}`);
    assert.equal(res.body.view.hostId, res.body.playerId);
    assert.ok(res.body.token);
    const state = (await getStore().load(res.body.code)).state;
    assert.equal(state.zalo.webhookUrl, 'https://webhook.site/abc');
    assert.equal(state.gameId, 'werewolf');
    // On Vercel: no plain http, nothing on this machine.
    for (const bad of ['http://bot.vn/h', 'https://127.0.0.1/h', 'ftp://bot.vn']) {
      const no = await call(roomHandler, 'POST', { body: { action: 'create', webhook_url: bad }, headers });
      assert.equal(no.statusCode, 400);
      assert.match(no.body.error, /Webhook URL không hợp lệ/);
    }
  });
});

test('API create: a webhook_url needs the secret header', async () => {
  const body = { action: 'create', webhook_url: 'https://bot.vn/hook', game: 'werewolf' };
  await withEnv({}, async () => {
    const off = await call(roomHandler, 'POST', { body, headers: { 'x-bot-api-secret-token': 'anything' } });
    assert.equal(off.statusCode, 503);
    assert.match(off.body.error, /ROOM_API_SECRET/);
  });
  await withEnv({ ROOM_API_SECRET: 'room-secret', ZALO_WEBHOOK_SECRET: SECRET }, async () => {
    for (const headers of [{}, { 'x-bot-api-secret-token': 'wrong' }, { 'x-bot-api-secret-token': SECRET }, { 'x-bot-api-secret-token': 'room-secret!' }]) {
      const no = await call(roomHandler, 'POST', { body, headers });
      assert.equal(no.statusCode, 403);
      assert.deepEqual(no.body, { error: 'Unauthorized' });
    }
    // Without headers at all (as some callers send).
    const bare = await call(roomHandler, 'POST', { body, headers: undefined });
    assert.equal(bare.statusCode, 403);
    assert.equal(globalThis.__masoiRooms.size, 0);
    const ok = await call(roomHandler, 'POST', { body, headers: { 'x-bot-api-secret-token': 'room-secret' } });
    assert.equal(ok.statusCode, 200);
    // Rooms without a webhook (the web page) need no secret.
    const web = await call(roomHandler, 'POST', { body: { action: 'create', name: 'Lan' } });
    assert.equal(web.statusCode, 200);
  });
});

test('Zalo: secrets are compared exactly', () => {
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abd', 'abc'), false);
  assert.equal(sameSecret('abcd', 'abc'), false);
  assert.equal(sameSecret(undefined, 'abc'), false);
  assert.equal(sameSecret('', ''), false);
});

test('Rate limit: the bot and the API open at most 10 rooms in 5 minutes, together', async () => {
  await withEnv({ ROOM_API_SECRET: 's', ZALO_WEBHOOK_SECRET: SECRET, ZALO_BOT_TOKEN: 'T' }, async (calls) => {
    const realNow = Date.now;
    const start = realNow();
    const at = (minutes) => { Date.now = () => start + minutes * 60 * 1000; };
    const api = () => call(roomHandler, 'POST', { body: { action: 'create', webhook_url: 'https://bot.vn/h' }, headers: { 'x-bot-api-secret-token': 's' } });
    try {
      at(0);
      for (let i = 0; i < 6; i++) assert.equal((await api()).statusCode, 200);
      at(1);
      for (let i = 0; i < 4; i++) assert.equal((await hook(textUpdate('>createRoom wolf'))).body.message, 'Success');
      // The 11th, by either way in, is refused.
      const no = await api();
      assert.equal(no.statusCode, 429);
      assert.equal(no.body.error, ROOM_LIMIT_MESSAGE);
      const zalo = await hook(textUpdate('>createRoom wolf'));
      assert.equal(zalo.statusCode, 200);
      assert.equal(zalo.body.message, 'Rate limited');
      assert.equal(calls.at(-1).body.text, ROOM_LIMIT_MESSAGE);
      assert.equal(globalThis.__masoiRooms.size, 10);
      // Rooms from the web page are not counted or limited.
      assert.equal((await call(roomHandler, 'POST', { body: { action: 'create', name: 'Lan' } })).statusCode, 200);
      // Once the first six are more than 5 minutes old, six more fit.
      at(5.01);
      for (let i = 0; i < 6; i++) assert.equal((await api()).statusCode, 200);
      assert.equal((await api()).statusCode, 429);
    } finally {
      Date.now = realNow;
    }
  });
});

test('Rate limit: Supabase counts recent bot rooms with one HEAD request', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  const reply = { range: '*/7', ok: true };
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: reply.ok, status: reply.ok ? 200 : 500, headers: new Headers(reply.range ? { 'content-range': reply.range } : {}) };
  };
  try {
    const store = _supabaseStoreForTests('https://demo.supabase.co', 'sb_secret_x');
    assert.equal(await store.countBotRooms(1700000000000), 7);
    assert.equal(seen[0].url, 'https://demo.supabase.co/rest/v1/rooms?select=code&state->zalo=not.is.null&state->>createdAt=gte.1700000000000');
    assert.equal(seen[0].init.method, 'HEAD');
    assert.equal(seen[0].init.headers.Prefer, 'count=exact');
    assert.equal(await underRoomLimit(store, 1700000300000), true);
    reply.range = '0-9/10';
    assert.equal(await underRoomLimit(store, 1700000300000), false);
    reply.range = null;
    assert.equal(await store.countBotRooms(0), 0);
    reply.ok = false;
    await assert.rejects(store.countBotRooms(0), /Supabase: 500/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('API create: an empty room waits a day for its first player', async () => {
  await withEnv({ ROOM_API_SECRET: 's' }, async () => {
    const realNow = Date.now;
    const open = async () => (await call(roomHandler, 'POST', {
      body: { action: 'create', webhook_url: 'https://bot.vn/h' }, headers: { 'x-bot-api-secret-token': 's' }
    })).body.code;
    const at = (hours) => { Date.now = () => realNow() + hours * 3600 * 1000; };
    try {
      const early = await open();
      const late = await open();
      at(23.9);
      const lan = await call(roomHandler, 'POST', { body: { action: 'join', code: early, name: 'Lan' } });
      assert.equal(lan.statusCode, 200);
      assert.equal(lan.body.view.hostId, lan.body.playerId);
      at(24.1);
      const gone = await call(roomHandler, 'POST', { body: { action: 'join', code: late, name: 'Lan' } });
      assert.equal(gone.statusCode, 400);
      // Once someone has come in, the usual 30 minutes apply.
      assert.ok(await getStore().load(early));
      at(23.9 + 0.55);
      assert.equal(await getStore().load(early), null);
    } finally {
      Date.now = realNow;
    }
  });
});

test('API create: without a webhook or a name, a name is still needed', async () => {
  await withEnv({}, async () => {
    const res = await call(roomHandler, 'POST', { body: { action: 'create', game: 'werewolf' } });
    assert.equal(res.statusCode, 400);
    const plain = await call(roomHandler, 'POST', { body: { action: 'create', name: 'Lan', webhook_url: '' } });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.body.webhook_url, null);
    assert.equal(plain.body.game_id, null);
    assert.equal((await getStore().load(plain.body.code)).state.zalo, undefined);
  });
});

test('Zalo: a game ending on its clock in a bot room is reported by the poll', async () => {
  await withEnv({ ZALO_WEBHOOK_SECRET: SECRET, ZALO_EVENT_URL: 'https://bot.vn/hook' }, async (calls) => {
    const { code } = (await hook(textUpdate('>createRoom spyfall'))).body;
    const seats = [];
    for (const name of ['Lan', 'Minh', 'An']) seats.push((await call(roomHandler, 'POST', { body: { action: 'join', code, name } })).body);
    const host = seats[0];
    await call(roomHandler, 'POST', { body: { action: 'act', code, pid: host.playerId, token: host.token, type: 'start' } });
    // Wind the clock: every phase's end is moved into the past until the game is over.
    for (let i = 0; i < 6; i++) {
      const store = getStore();
      const room = await store.load(code);
      if (room.state.phase === 'GAME_OVER') break;
      room.state.game.phaseEndsAt = 0;
      await store.cas(code, room.version, room.state, room.version + 1);
      await call(roomHandler, 'GET', { query: { code, pid: host.playerId, token: host.token } });
    }
    assert.equal((await getStore().load(code)).state.phase, 'GAME_OVER');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.event_name, 'room.game_over');
  });
});

test('Engine: a room opened for the bot has no host until someone real joins', () => {
  const { state: s, player } = createRoom({ code: 'BOT01', now: 0, hostless: true });
  assert.equal(player, null);
  assert.equal(s.hostId, null);
  assert.deepEqual(s.players, []);
  const bot = joinRoom(s, 'Máy', 0, undefined, { isBot: true });
  assert.equal(s.hostId, null);
  const lan = joinRoom(s, 'Lan', 0);
  assert.equal(s.hostId, lan.id);
  assert.notEqual(s.hostId, bot.id);
  // When everyone real leaves, the next person in takes the room.
  applyAction(s, lan.id, 'leave', {}, 0);
  assert.equal(s.hostId, null);
  const minh = joinRoom(s, 'Minh', 0);
  assert.equal(s.hostId, minh.id);
});
