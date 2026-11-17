// Zalo Bot integration (https://docs.zaloplatforms.com/docs/BOT/webhook).
//
//   1. Zalo posts every message the bot receives to /api/zalo. A message
//      ">createRoom wolf" opens an empty room for that game and the bot
//      replies with its link; the first person to join becomes the host.
//   2. The command can name a webhook: ">createRoom wolf https://bot.vn/hook"
//      (or the update carries a "webhook_url" field). When a game in that
//      room ends, the server posts a "room.game_over" event there (or to
//      ZALO_EVENT_URL when the room has none): the game log and the cards
//      everyone held, with the couple (JSON), each base64.
//
// Environment:
//   ZALO_WEBHOOK_SECRET  the secret_token given to setWebhook; Zalo sends it in
//                        X-Bot-Api-Secret-Token and requests without it are refused
//   ROOM_API_SECRET      what POST /api/room must send in X-Bot-Api-Secret-Token
//                        to open a room with a webhook_url (defaults to
//                        ZALO_WEBHOOK_SECRET)
//   ZALO_BOT_TOKEN       the bot's token, to reply in the chat (sendMessage)
//   ZALO_EVENT_URL       where to post the end-of-game event for rooms that
//                        were not given a webhook (optional)
//   ZALO_EVENT_SECRET    sent as X-Bot-Api-Secret-Token with that event
//                        (defaults to ZALO_WEBHOOK_SECRET)
//   APP_URL              the site's address for room links (defaults to the
//                        address the webhook was called on)

import { timingSafeEqual, randomUUID } from 'node:crypto';
import { ROLES, TEAM_LABEL } from '../public/shared/roles.js';
import { AVALON_ROLES } from '../public/shared/avalon.js';
import { LOCATIONS } from '../public/shared/spyfall.js';
import { gameInfo } from '../public/shared/games.js';

export const ZALO_API = 'https://bot-api.zaloplatforms.com';
export const SECRET_HEADER = 'x-bot-api-secret-token';
const TIMEOUT_MS = 5000;

const GAME_ALIASES = {
  wolf: 'werewolf',
  werewolf: 'werewolf',
  masoi: 'werewolf',
  soi: 'werewolf',
  spyfall: 'spyfall',
  spy: 'spyfall',
  giandiep: 'spyfall',
  undercover: 'undercover',
  noigian: 'undercover',
  avalon: 'avalon'
};

const fold = (text) => String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

const USAGE = 'Dùng: >createRoom wolf | spyfall | undercover | avalon [webhook URL]';

// ">createRoom wolf https://bot.vn/hook" -> { gameId: 'werewolf', webhookUrl }.
// No game named means Ma Sói, no URL means none (webhookUrl: null); an
// unknown game gives { error }. Anything else is not a command: null.
export function parseCommand(text) {
  const m = /^\s*>\s*createroom\b\s*(.*)$/i.exec(String(text || ''));
  if (!m) return null;
  const url = /\bhttps?:\/\/\S+/i.exec(m[1]);
  const name = url ? m[1].replace(url[0], ' ') : m[1];
  const gameId = GAME_ALIASES[fold(name) || 'wolf'];
  if (!gameId) return { error: `Không có trò "${name.trim()}". ${USAGE}` };
  return { gameId, webhookUrl: url ? url[0] : null };
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

// A webhook a room may post its results to: https on a public host. Running
// locally (`local`), plain http and this machine are allowed, for testing.
// A bare host ("bot.vn/hook") means https. Returns the normalised URL, or null.
export function checkWebhookUrl(raw, { local = false } = {}) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (local) return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname)) return null;
  return u.href;
}

// Compare a secret sent by a caller with ours, in constant time.
export function sameSecret(sent, ours) {
  if (typeof sent !== 'string' || !ours) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(ours);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function zaloConfig() {
  const env = process.env;
  return {
    secret: env.ZALO_WEBHOOK_SECRET || '',
    roomSecret: env.ROOM_API_SECRET || env.ZALO_WEBHOOK_SECRET || '',
    botToken: env.ZALO_BOT_TOKEN || '',
    eventUrl: env.ZALO_EVENT_URL || '',
    eventSecret: env.ZALO_EVENT_SECRET || env.ZALO_WEBHOOK_SECRET || '',
    appUrl: (env.APP_URL || '').replace(/\/+$/, '')
  };
}

// The site's address for room links: APP_URL, or the address this request came in on.
export function siteUrl(req, config = zaloConfig()) {
  if (config.appUrl) return config.appUrl;
  const h = req.headers || {};
  const host = h['x-forwarded-host'] || h.host || 'localhost:3000';
  const proto = h['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

// The id a reporting room is given when it is opened: returned to whoever
// opened it, and sent back with every game it reports.
export const newGameId = () => randomUUID();

// The bot and the API open at most this many rooms in this long, across
// everyone (the web page is not limited).
export const ROOM_LIMIT = 10;
export const ROOM_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const ROOM_LIMIT_MESSAGE = `Đã tạo đủ ${ROOM_LIMIT} phòng trong ${ROOM_LIMIT_WINDOW_MS / 60000} phút, hãy thử lại sau ít phút.`;

export async function underRoomLimit(store, now) {
  return await store.countBotRooms(now - ROOM_LIMIT_WINDOW_MS) < ROOM_LIMIT;
}

export const roomUrl = (base, code) => `${base}/?room=${code}`;

export const toBase64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

async function post(url, body, headers = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  return res.ok;
}

// Reply in a Zalo chat. Zalo caps a message at 2000 characters.
export function sendMessage(botToken, chatId, text, fetchImpl) {
  return post(`${ZALO_API}/bot${botToken}/sendMessage`, { chat_id: chatId, text: String(text).slice(0, 2000) }, {}, fetchImpl);
}

export function createdMessage(gameId, url, code) {
  const info = gameInfo(gameId);
  return `${info.icon} Đã tạo phòng ${info.name}: ${code}\n` +
    `Vào chơi: ${url}\n` +
    'Người vào phòng đầu tiên sẽ làm chủ phòng.';
}

// ---------------------------------------------------------------------------
// End of game
// ---------------------------------------------------------------------------

const UNDERCOVER_PART = { civilian: 'Dân thường', undercover: 'Nội gián', white: 'Trắng' };

// The card each player ended the game with, in seat order. In Ma Sói,
// `lover` is the other half of their couple ({ seat, name }), else null.
export function cardsAtEnd(s) {
  const players = s.players.filter(p => p.inGame).sort((a, b) => a.seat - b.seat);
  const lovers = s.gameId === 'werewolf' ? (s.game?.lovers || []).map(id => s.players.find(p => p.id === id)) : [];
  const loverOf = (p) => {
    if (!lovers.includes(p)) return null;
    const other = lovers.find(x => x !== p);
    return { seat: other.seat, name: other.name };
  };
  return players.map(p => {
    const base = { seat: p.seat, name: p.name, alive: p.alive !== false, lover: loverOf(p) };
    if (s.gameId === 'avalon') {
      const r = AVALON_ROLES[s.play.roles[p.id]];
      return { ...base, role: r.name, icon: r.icon, team: r.side, teamLabel: r.side === 'good' ? 'Phe Thiện' : 'Phe Ác' };
    }
    if (s.gameId === 'spyfall') {
      const spy = s.play.spy === p.id;
      return {
        ...base,
        role: spy ? 'Gián điệp' : `Dân thường (${LOCATIONS[s.play.location].name})`,
        icon: spy ? '🕵️' : '🧑',
        team: spy ? 'evil' : 'good',
        teamLabel: spy ? 'Gián điệp' : 'Dân thường'
      };
    }
    if (s.gameId === 'undercover') {
      const part = s.play.roles[p.id];
      const word = part === 'white' ? 'không có từ' : s.play.words[part];
      return {
        ...base,
        role: `${UNDERCOVER_PART[part]} (${word})`,
        icon: { civilian: '🧑', undercover: '🗝️', white: '⬜' }[part],
        team: part === 'civilian' ? 'good' : 'evil',
        teamLabel: UNDERCOVER_PART[part]
      };
    }
    const r = ROLES[p.role];
    const team = r.team === 'village' || r.team === 'werewolf' ? r.team : 'third';
    return { ...base, role: r.name, icon: r.icon, team, teamLabel: TEAM_LABEL[r.team] };
  });
}

// Who won and why: Ma Sói keeps it on s.game, the other games on s.play.result.
export function outcome(s) {
  if (s.game?.winner) return { winner: s.game.winner, reason: s.game.winReason };
  const r = s.play?.result;
  return r ? { winner: r.winner, reason: r.reason } : { winner: null, reason: '' };
}

// The game log for the bot: a blank line before each night after the first,
// so the days stand apart.
export function eventLog(lines) {
  return lines.flatMap((line, i) => (i > 0 && line.startsWith('🌙 Đêm') ? ['', line] : [line])).join('\n');
}

// What the bot's webhook receives when a game in its room ends. The content
// (log, cards) is base64 (UTF-8 inside), the routing fields are plain.
export function gameOverEvent(s, now) {
  const z = s.zalo;
  const cards = cardsAtEnd(s);
  return {
    event_name: 'room.game_over',
    // Given when the room was opened; game_no tells the room's games apart.
    game_id: z.gameId || null,
    // Rooms opened through the Zalo bot know their chat; rooms opened with
    // POST /api/room have null here.
    chat_id: z.chatId || null,
    // The ">createRoom" message this room answers, and which game of the room this was.
    message_id: z.messageId || null,
    game_no: z.games || 1,
    created_by: z.from || null,
    room: { code: s.code, game: s.gameId, url: z.appUrl ? roomUrl(z.appUrl, s.code) : null },
    ended_at: now,
    winner: outcome(s).winner,
    encoding: 'base64',
    log: toBase64(eventLog(s.game?.log || [])),
    roles: toBase64(JSON.stringify(cards.map(({ seat, name, role, teamLabel, alive, lover }) => ({ seat, name, role, team: teamLabel, alive, lover })))),
  };
}

// Post the end-of-game event for a room the bot opened, to the webhook it was
// given (or ZALO_EVENT_URL). Never throws: a missed notice must not break the game.
export async function notifyGameOver(s, now, { config = zaloConfig(), fetchImpl = fetch } = {}) {
  const url = s.zalo?.webhookUrl || config.eventUrl;
  if (!s.zalo || !url) return false;
  try {
    const headers = config.eventSecret ? { 'X-Bot-Api-Secret-Token': config.eventSecret } : {};
    return await post(url, gameOverEvent(s, now), headers, fetchImpl);
  } catch (err) {
    console.warn('Zalo game-over event failed', err);
    return false;
  }
}
