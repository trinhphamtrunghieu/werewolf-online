// Authoritative game engine. Pure functions over a plain JSON room state so it can
// be stored in Redis and unit-tested without any I/O.
//
// Every function takes `now` (ms) and `rng` explicitly; nothing reads the clock.

import {
  ROLES, NIGHT_ORDER, MIN_PLAYERS, MAX_PLAYERS,
  computeBalancedRoles, validateRoleCounts, emptyRoleCounts
} from '../public/shared/roles.js';
import { LINES, lineText } from '../public/shared/voice-lines.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

export const DEFAULT_CONFIG = {
  discussionTime: 120,
  voteTime: 30,
  defenseTime: 45,
  judgeTime: 20,
  nightStepTime: 25,
  hostPlays: true,
  revealRoleOnDeath: false
};

const CONFIG_LIMITS = {
  discussionTime: [30, 600],
  voteTime: [10, 120],
  defenseTime: [10, 180],
  judgeTime: [10, 90],
  nightStepTime: [10, 60]
};

const MORNING_MS = 11000;
const VERDICT_MS = 8000;
const HUNTER_MS = 30000;
const MIN_STEP_MS = 7000; // let the narrator finish before moving on
const BOT_DELAY_MS = 2500;
const LOG_LIMIT = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  if (!name) fail('Hãy nhập tên của bạn.');
  return name;
}

function randomId(rng, len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(rng() * chars.length)];
  return out;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const findPlayer = (s, id) => s.players.find(p => p.id === id);
const isParticipant = (s, p) => !(p.id === s.hostId && !s.config.hostPlays);
export const lobbyParticipants = (s) => s.players.filter(p => isParticipant(s, p));
const alivePlayers = (s) => s.players.filter(p => p.inGame && p.alive);
const aliveWithRole = (s, role) => alivePlayers(s).filter(p => p.role === role);
const teamOf = (p) => ROLES[p.role]?.team;

function renumberSeats(s) {
  lobbyParticipants(s).forEach((p, i) => { p.seat = i + 1; });
  s.players.filter(p => !isParticipant(s, p)).forEach(p => { p.seat = null; });
}

function log(s, text) {
  s.game.log.unshift(text);
  if (s.game.log.length > LOG_LIMIT) s.game.log.length = LOG_LIMIT;
}

// Queue narrator lines. Calls that happen within the same request share a `now`
// and are merged into one narration so the host reads them back to back.
function say(s, now, rng, ...keys) {
  const clips = keys.flat().filter(Boolean).map(k => {
    const v = Math.floor(rng() * (LINES[k]?.length || 1));
    return { k, v, t: lineText(k, v) };
  });
  if (!clips.length) return;
  const n = s.narration;
  if (n && n.at === now) {
    n.clips.push(...clips);
  } else {
    s.narration = { seq: (n?.seq || 0) + 1, at: now, clips };
  }
}

const seatKey = (s, id) => {
  const p = findPlayer(s, id);
  return p?.seat ? `seat_${p.seat}` : null;
};

function seatList(s, ids) {
  const keys = [];
  ids.forEach((id, i) => {
    if (i > 0) keys.push('and');
    keys.push(seatKey(s, id));
  });
  return keys;
}

const nameOf = (s, id) => {
  const p = findPlayer(s, id);
  return p ? `${p.name} (số ${p.seat})` : '?';
};

function setPhase(s, phase, now, durationMs) {
  s.phase = phase;
  s.game.phaseStartedAt = now;
  s.game.phaseEndsAt = durationMs == null ? null : now + durationMs;
}

// End the phase soon (but not before the narrator finishes the current line).
function finishEarly(s, now, minMs = 1500) {
  const g = s.game;
  const target = Math.max(now + minMs, g.phaseStartedAt + MIN_STEP_MS);
  g.phaseEndsAt = Math.min(g.phaseEndsAt ?? target, target);
}

function freshGame() {
  return {
    day: 1,
    phaseStartedAt: null,
    phaseEndsAt: null,
    rolesInPlay: [],
    queue: [],
    step: 0,
    night: null,
    lovers: [],
    lastGuarded: null,
    potions: { heal: true, poison: true },
    lastNightDeaths: [],
    pendingHunters: [],
    hunter: null,
    votes: {},
    defendant: null,
    judge: {},
    verdict: null,
    winner: null,
    winReason: '',
    log: []
  };
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export function createRoom({ code, hostName, now, rng = Math.random, debug = false }) {
  const host = {
    id: 'p_' + randomId(rng),
    token: randomId(rng, 24),
    name: cleanName(hostName),
    seat: 1,
    isBot: false,
    lastSeen: now,
    role: null,
    alive: true,
    inGame: false
  };
  const s = {
    code,
    createdAt: now,
    debug: !!debug,
    hostId: host.id,
    phase: 'LOBBY',
    config: { ...DEFAULT_CONFIG },
    roleMode: 'auto',
    roleCounts: emptyRoleCounts(),
    players: [host],
    game: freshGame(),
    narration: null
  };
  s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
  return { state: s, player: host };
}

export function joinRoom(s, rawName, now, rng = Math.random, { isBot = false } = {}) {
  if (s.phase !== 'LOBBY') fail('Ván chơi đang diễn ra, hãy chờ ván sau nhé.');
  if (s.players.length >= MAX_PLAYERS + 1) fail('Phòng đã đầy.');
  const name = cleanName(rawName);
  if (s.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    fail('Tên này đã có người dùng trong phòng, hãy chọn tên khác.');
  }
  const player = {
    id: 'p_' + randomId(rng),
    token: randomId(rng, 24),
    name,
    seat: null,
    isBot,
    lastSeen: now,
    role: null,
    alive: true,
    inGame: false
  };
  s.players.push(player);
  renumberSeats(s);
  if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
  return player;
}

export function authenticate(s, playerId, token) {
  const p = findPlayer(s, playerId);
  if (!p || p.isBot || p.token !== token) fail('Phiên chơi không hợp lệ, hãy vào lại phòng.');
  return p;
}

function removePlayer(s, id) {
  s.players = s.players.filter(p => p.id !== id);
  if (s.hostId === id) {
    const next = s.players.find(p => !p.isBot);
    s.hostId = next ? next.id : null;
  }
  renumberSeats(s);
  if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
}

function startGame(s, now, rng) {
  const ps = lobbyParticipants(s);
  if (ps.length < MIN_PLAYERS) fail(`Cần ít nhất ${MIN_PLAYERS} người chơi để bắt đầu.`);
  if (ps.length > MAX_PLAYERS) fail(`Tối đa ${MAX_PLAYERS} người chơi.`);
  if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(ps.length);
  const problem = validateRoleCounts(s.roleCounts, ps.length);
  if (problem) fail(problem);

  const deck = shuffle(Object.entries(s.roleCounts).flatMap(([id, n]) => Array(n).fill(id)), rng);
  s.players.forEach(p => {
    p.inGame = isParticipant(s, p);
    p.role = p.inGame ? deck.pop() : null;
    p.alive = p.inGame;
    delete p.deathCause;
  });
  renumberSeats(s);

  s.game = freshGame();
  s.game.rolesInPlay = Object.keys(s.roleCounts).filter(id => s.roleCounts[id] > 0);
  s.narration = null;
  log(s, `Ván chơi bắt đầu với ${ps.length} người. Mỗi người hãy xem lá bài của mình.`);
  say(s, now, rng, 'game_start');
  beginNight(s, now, rng);
}

function backToLobby(s) {
  s.phase = 'LOBBY';
  s.players.forEach(p => {
    p.role = null;
    p.alive = true;
    p.inGame = false;
    delete p.deathCause;
  });
  s.game = freshGame();
  s.narration = null;
  renumberSeats(s);
  if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
}

// ---------------------------------------------------------------------------
// Deaths & win conditions
// ---------------------------------------------------------------------------

function killPlayers(s, list) {
  const died = [];
  const queue = [...list];
  while (queue.length) {
    const d = queue.shift();
    const p = findPlayer(s, d.id);
    if (!p || !p.inGame || !p.alive) continue;
    p.alive = false;
    p.deathCause = d.cause;
    died.push(d);
    if (p.role === 'hunter' && d.cause !== 'poison') s.game.pendingHunters.push(p.id);
    const lovers = s.game.lovers;
    if (lovers.length === 2 && lovers.includes(p.id)) {
      queue.push({ id: lovers.find(x => x !== p.id), cause: 'heartbreak' });
    }
  }
  return died;
}

export function checkWin(s) {
  const alive = alivePlayers(s);
  const wolves = alive.filter(p => p.role === 'werewolf').length;
  const others = alive.length - wolves;
  const [a, b] = s.game.lovers.map(id => findPlayer(s, id));
  if (a && b && a.alive && b.alive && alive.length === 2 && teamOf(a) !== teamOf(b)) {
    return { winner: 'lovers', reason: 'Cặp Tình Nhân khác phe là hai người cuối cùng còn sống.' };
  }
  if (wolves === 0) return { winner: 'village', reason: 'Tất cả Ma Sói đã bị tiêu diệt.' };
  if (wolves >= others) return { winner: 'werewolf', reason: `Số Sói (${wolves}) đã bằng hoặc nhiều hơn số người còn lại (${others}).` };
  return null;
}

function finishGame(s, win, now, rng) {
  setPhase(s, 'GAME_OVER', now, null);
  s.game.winner = win.winner;
  s.game.winReason = win.reason;
  const label = { village: 'PHE DÂN LÀNG', werewolf: 'PHE MA SÓI', lovers: 'CẶP TÌNH NHÂN' }[win.winner];
  log(s, `🏆 ${label} CHIẾN THẮNG! ${win.reason}`);
  say(s, now, rng, `win_${win.winner}`);
}

// Returns true if the game ended.
function endIfWon(s, now, rng) {
  const win = checkWin(s);
  if (!win) return false;
  finishGame(s, win, now, rng);
  return true;
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

function beginNight(s, now, rng) {
  const g = s.game;
  g.night = {
    cupid: [],
    guard: null,
    wolfVotes: {},
    wolfTarget: null,
    seerTarget: null,
    seerResult: null,
    heal: false,
    poison: null,
    complete: false
  };
  g.votes = {};
  g.defendant = null;
  g.judge = {};
  g.verdict = null;
  // Roles are called even when their holders are dead so the night sounds the
  // same either way and nobody learns who is still alive.
  g.queue = NIGHT_ORDER.filter(r => g.rolesInPlay.includes(r) && (r !== 'cupid' || g.day === 1));
  g.step = 0;
  log(s, `🌙 Đêm ${g.day} buông xuống.`);
  say(s, now, rng, 'night_start');
  startNightStep(s, now, rng, null);
}

function startNightStep(s, now, rng, prevRole) {
  const g = s.game;
  if (g.step >= g.queue.length) {
    endNight(s, now, rng, prevRole);
    return;
  }
  const role = g.queue[g.step];
  const holders = aliveWithRole(s, role);
  const ms = holders.length
    ? s.config.nightStepTime * 1000
    : (6 + Math.floor(rng() * 5)) * 1000;
  g.night.complete = false;
  setPhase(s, 'NIGHT', now, ms);
  say(s, now, rng, prevRole && `${prevRole}_sleep`, `${role}_wake`);
}

function endNightStep(s, now, rng) {
  const g = s.game;
  const role = g.queue[g.step];
  const n = g.night;
  if (role === 'werewolf' && !n.wolfTarget) {
    n.wolfTarget = pluralityPick(Object.values(n.wolfVotes), rng);
  }
  if (role === 'guard') g.lastGuarded = n.guard;
  if (role === 'cupid' && g.lovers.length === 2) {
    log(s, '💘 Thần Tình Yêu đã bắn mũi tên.');
  }
  g.step += 1;
  startNightStep(s, now, rng, role);
}

function pluralityPick(targets, rng) {
  const tally = {};
  targets.filter(Boolean).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  if (!max) return null;
  return pick(Object.keys(tally).filter(id => tally[id] === max), rng);
}

function endNight(s, now, rng, lastRole) {
  const g = s.game;
  const n = g.night;
  const deaths = [];
  if (n.wolfTarget && n.wolfTarget !== n.guard && !n.heal) deaths.push({ id: n.wolfTarget, cause: 'wolf' });
  if (n.poison && !deaths.some(d => d.id === n.poison)) deaths.push({ id: n.poison, cause: 'poison' });
  const died = killPlayers(s, deaths);
  g.lastNightDeaths = died.map(d => d.id);

  setPhase(s, 'MORNING', now, MORNING_MS);
  const keys = [lastRole && `${lastRole}_sleep`];
  if (died.length) {
    keys.push('morning_deaths', ...seatList(s, died.map(d => d.id)));
    if (died.some(d => d.cause === 'heartbreak')) keys.push('lover_death');
    log(s, `☀️ Sáng ngày ${g.day}: ${died.map(d => nameOf(s, d.id)).join(', ')} đã chết.`);
  } else {
    keys.push('morning_peace');
    log(s, `☀️ Sáng ngày ${g.day}: đêm qua bình yên, không ai chết.`);
  }
  say(s, now, rng, keys);
  if (!g.pendingHunters.length) endIfWon(s, now, rng);
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

function beginDiscussion(s, now, rng) {
  setPhase(s, 'DISCUSSION', now, s.config.discussionTime * 1000);
  say(s, now, rng, 'discussion_start');
}

function beginVote(s, now, rng) {
  s.game.votes = {};
  setPhase(s, 'VOTE', now, s.config.voteTime * 1000);
  say(s, now, rng, 'vote_start');
}

function resolveVote(s, now, rng) {
  const g = s.game;
  const tally = {};
  Object.values(g.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).filter(id => tally[id] === max);
  if (!max || leaders.length !== 1) {
    g.verdict = { type: 'none' };
    log(s, max ? '🗳️ Phiếu bầu hoà, không ai phải lên bục.' : '🗳️ Không ai bỏ phiếu, không ai phải lên bục.');
    setPhase(s, 'VERDICT', now, VERDICT_MS);
    say(s, now, rng, 'no_defendant');
    return;
  }
  g.defendant = leaders[0];
  log(s, `🗳️ ${nameOf(s, g.defendant)} bị nghi ngờ nhiều nhất (${max} phiếu) và lên bục biện hộ.`);
  setPhase(s, 'DEFENSE', now, s.config.defenseTime * 1000);
  say(s, now, rng, 'defense_intro', seatKey(s, g.defendant), 'defense_outro');
}

function beginJudge(s, now, rng) {
  s.game.judge = {};
  setPhase(s, 'JUDGE', now, s.config.judgeTime * 1000);
  say(s, now, rng, 'judge_start');
}

function resolveJudge(s, now, rng) {
  const g = s.game;
  const votes = Object.values(g.judge);
  const kill = votes.filter(v => v === 'kill').length;
  const spare = votes.filter(v => v === 'spare').length;
  setPhase(s, 'VERDICT', now, VERDICT_MS);
  if (kill > spare) {
    const died = killPlayers(s, [{ id: g.defendant, cause: 'lynch' }]);
    g.verdict = { type: 'kill', ids: died.map(d => d.id), kill, spare };
    log(s, `⚖️ ${nameOf(s, g.defendant)} bị treo cổ (${kill} treo / ${spare} tha).`);
    const keys = [seatKey(s, g.defendant), 'verdict_kill'];
    if (died.some(d => d.cause === 'heartbreak')) keys.push('lover_death');
    say(s, now, rng, keys);
    if (!g.pendingHunters.length) endIfWon(s, now, rng);
  } else {
    g.verdict = { type: 'spare', ids: [g.defendant], kill, spare };
    log(s, `⚖️ ${nameOf(s, g.defendant)} được tha (${kill} treo / ${spare} tha).`);
    say(s, now, rng, seatKey(s, g.defendant), 'verdict_spare');
  }
}

function beginHunter(s, now, rng, next) {
  const g = s.game;
  const id = g.pendingHunters.shift();
  g.hunter = { id, next };
  setPhase(s, 'HUNTER', now, HUNTER_MS);
  say(s, now, rng, 'hunter_wake');
}

function resolveHunter(s, now, rng, targetId) {
  const g = s.game;
  const { id, next } = g.hunter;
  if (targetId) {
    const died = killPlayers(s, [{ id: targetId, cause: 'hunter' }]);
    log(s, `🎯 Thợ Săn ${nameOf(s, id)} đã bắn ${nameOf(s, targetId)}.`);
    const keys = [seatKey(s, targetId), 'hunter_shot'];
    if (died.some(d => d.cause === 'heartbreak')) keys.push('lover_death');
    say(s, now, rng, keys);
  } else {
    log(s, `🎯 Thợ Săn ${nameOf(s, id)} không bắn ai.`);
    say(s, now, rng, 'hunter_miss');
  }
  g.hunter = null;
  continueAfterDeaths(s, now, rng, next);
}

function continueAfterDeaths(s, now, rng, next) {
  const g = s.game;
  if (g.pendingHunters.length) {
    beginHunter(s, now, rng, next);
    return;
  }
  if (endIfWon(s, now, rng)) return;
  if (next === 'DISCUSSION') {
    beginDiscussion(s, now, rng);
  } else {
    g.day += 1;
    beginNight(s, now, rng);
  }
}

// ---------------------------------------------------------------------------
// Timeouts & bots
// ---------------------------------------------------------------------------

function onPhaseTimeout(s, now, rng) {
  switch (s.phase) {
    case 'NIGHT': return endNightStep(s, now, rng);
    case 'MORNING': return continueAfterDeaths(s, now, rng, 'DISCUSSION');
    case 'DISCUSSION': return beginVote(s, now, rng);
    case 'VOTE': return resolveVote(s, now, rng);
    case 'DEFENSE': return beginJudge(s, now, rng);
    case 'JUDGE': return resolveJudge(s, now, rng);
    case 'VERDICT': return continueAfterDeaths(s, now, rng, 'NIGHT');
    case 'HUNTER': return resolveHunter(s, now, rng, null);
    default: s.game.phaseEndsAt = null;
  }
}

function runBots(s, now, rng) {
  const g = s.game;
  if (!g.phaseStartedAt || now - g.phaseStartedAt < BOT_DELAY_MS) return false;
  const bots = alivePlayers(s).filter(p => p.isBot);
  if (!bots.length) return false;
  let changed = false;
  const act = (bot, type, payload) => {
    try {
      applyPlayerAction(s, bot, type, payload, now, rng);
      changed = true;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
    }
  };
  const others = (bot) => alivePlayers(s).filter(p => p.id !== bot.id);

  if (s.phase === 'NIGHT' && !g.night.complete) {
    const role = g.queue[g.step];
    const n = g.night;
    bots.filter(b => b.role === role).forEach(bot => {
      if (role === 'cupid' && n.cupid.length < 2) {
        shuffle(alivePlayers(s), rng).slice(0, 2 - n.cupid.length)
          .forEach(p => act(bot, 'night', { target: p.id }));
      } else if (role === 'guard' && !n.guard) {
        const options = alivePlayers(s).filter(p => p.id !== g.lastGuarded);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'werewolf' && !n.wolfVotes[bot.id]) {
        const humanVote = Object.entries(n.wolfVotes).find(([id]) => !findPlayer(s, id)?.isBot);
        const prey = alivePlayers(s).filter(p => p.role !== 'werewolf');
        const target = humanVote ? humanVote[1] : (prey.length ? pick(prey, rng).id : null);
        if (target) act(bot, 'night', { target });
      } else if (role === 'seer') {
        if (!n.seerTarget) {
          const options = others(bot);
          if (options.length) act(bot, 'night', { target: pick(options, rng).id });
        }
        act(bot, 'seerDone', {});
      } else if (role === 'witch') {
        if (n.wolfTarget && g.potions.heal && rng() < 0.4) act(bot, 'witch', { use: 'heal' });
        act(bot, 'witch', { use: 'done' });
      }
    });
  } else if (s.phase === 'VOTE') {
    bots.filter(b => !g.votes[b.id]).forEach(bot => {
      const options = others(bot);
      if (options.length) act(bot, 'vote', { target: pick(options, rng).id });
    });
  } else if (s.phase === 'JUDGE') {
    bots.filter(b => b.id !== g.defendant && !g.judge[b.id])
      .forEach(bot => act(bot, 'judge', { choice: rng() < 0.6 ? 'kill' : 'spare' }));
  } else if (s.phase === 'HUNTER' && g.hunter) {
    const hunter = findPlayer(s, g.hunter.id);
    if (hunter?.isBot) {
      const options = alivePlayers(s);
      act(hunter, 'shoot', { target: options.length ? pick(options, rng).id : null });
    }
  }
  return changed;
}

// Advance the game clock. Returns true when the state changed.
export function tick(s, now, rng = Math.random) {
  if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER') return false;
  let changed = runBots(s, now, rng);
  for (let i = 0; i < 25; i++) {
    const end = s.game.phaseEndsAt;
    if (end == null || now < end) break;
    onPhaseTimeout(s, now, rng);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

const HOST_LOBBY_ACTIONS = new Set(['config', 'role', 'autoBalance', 'kick', 'start', 'addBot']);
const HOST_GAME_ACTIONS = new Set(['skip', 'endGame']);

export function applyAction(s, playerId, type, payload = {}, now, rng = Math.random) {
  const player = findPlayer(s, playerId);
  if (!player) fail('Bạn không còn ở trong phòng này.');
  const isHost = s.hostId === player.id;

  if (type === 'leave') {
    if (s.phase === 'LOBBY') removePlayer(s, player.id);
    return;
  }

  if (HOST_LOBBY_ACTIONS.has(type) || HOST_GAME_ACTIONS.has(type)) {
    if (!isHost) fail('Chỉ Chủ phòng mới làm được việc này.');
    if (HOST_LOBBY_ACTIONS.has(type) && s.phase !== 'LOBBY') fail('Chỉ chỉnh được khi đang ở phòng chờ.');
    return applyHostAction(s, type, payload, now, rng);
  }

  if (type === 'restart') {
    if (!isHost) fail('Chỉ Chủ phòng mới làm được việc này.');
    if (s.phase !== 'GAME_OVER') fail('Ván chơi chưa kết thúc.');
    backToLobby(s);
    return;
  }

  applyPlayerAction(s, player, type, payload, now, rng);
}

function applyHostAction(s, type, payload, now, rng) {
  switch (type) {
    case 'config': {
      for (const [key, [min, max]] of Object.entries(CONFIG_LIMITS)) {
        if (payload[key] !== undefined) {
          const v = Math.round(Number(payload[key]));
          if (!Number.isFinite(v)) fail('Giá trị không hợp lệ.');
          s.config[key] = Math.min(max, Math.max(min, v));
        }
      }
      for (const key of ['hostPlays', 'revealRoleOnDeath']) {
        if (payload[key] !== undefined) s.config[key] = !!payload[key];
      }
      renumberSeats(s);
      if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
      return;
    }
    case 'role': {
      const { roleId, delta } = payload;
      if (!ROLES[roleId] || ![1, -1].includes(delta)) fail('Vai trò không hợp lệ.');
      s.roleMode = 'manual';
      s.roleCounts[roleId] = Math.max(0, Math.min(MAX_PLAYERS, (s.roleCounts[roleId] || 0) + delta));
      return;
    }
    case 'autoBalance':
      s.roleMode = 'auto';
      s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
      return;
    case 'kick': {
      if (payload.id === s.hostId) fail('Không thể mời chính mình ra khỏi phòng.');
      if (!findPlayer(s, payload.id)) fail('Người chơi không tồn tại.');
      removePlayer(s, payload.id);
      return;
    }
    case 'addBot': {
      if (!s.debug) fail('Chỉ dùng được trong chế độ thử nghiệm.');
      const names = ['Hương', 'Tuấn', 'Ngọc', 'Hoàng', 'Linh', 'Đức', 'Phương', 'Khánh', 'Trang', 'Bảo', 'Vy', 'Tùng', 'Mai', 'Long', 'Nhi', 'Quân', 'Hà'];
      const used = new Set(s.players.map(p => p.name));
      const name = names.find(n => !used.has(`🤖 ${n}`)) || `Bot ${s.players.length + 1}`;
      joinRoom(s, `🤖 ${name}`, now, rng, { isBot: true });
      return;
    }
    case 'start':
      return startGame(s, now, rng);
    case 'skip':
      if (s.game.phaseEndsAt != null) s.game.phaseEndsAt = now;
      return;
    case 'endGame':
      backToLobby(s);
      return;
  }
}

function applyPlayerAction(s, player, type, payload, now, rng) {
  const g = s.game;
  const target = payload.target != null ? findPlayer(s, payload.target) : null;
  const requireAliveTarget = () => {
    if (!target || !target.inGame || !target.alive) fail('Người được chọn không hợp lệ.');
  };
  if (!player.inGame || !player.alive) {
    if (!(type === 'shoot' && g.hunter?.id === player.id)) fail('Bạn đã bị loại, chỉ có thể theo dõi.');
  }

  switch (type) {
    case 'night': {
      if (s.phase !== 'NIGHT') fail('Chưa đến lượt ban đêm.');
      const role = g.queue[g.step];
      if (player.role !== role) fail('Chưa đến lượt của bạn.');
      const n = g.night;
      requireAliveTarget();
      if (role === 'cupid') {
        if (n.complete) fail('Bạn đã ghép đôi xong.');
        n.cupid = n.cupid.includes(target.id)
          ? n.cupid.filter(id => id !== target.id)
          : [...n.cupid, target.id].slice(0, 2);
        if (n.cupid.length === 2) {
          g.lovers = [...n.cupid];
          n.complete = true;
          finishEarly(s, now);
        }
      } else if (role === 'guard') {
        if (target.id === g.lastGuarded) fail('Không được bảo vệ cùng một người 2 đêm liên tiếp.');
        n.guard = target.id;
        n.complete = true;
        finishEarly(s, now);
      } else if (role === 'werewolf') {
        if (target.role === 'werewolf') fail('Không thể cắn đồng bọn.');
        if (n.wolfTarget) fail('Đàn Sói đã chốt mục tiêu.');
        n.wolfVotes[player.id] = target.id;
        const wolves = aliveWithRole(s, 'werewolf');
        const picks = wolves.map(w => n.wolfVotes[w.id]);
        if (picks.every(t => t && t === picks[0])) {
          n.wolfTarget = picks[0];
          n.complete = true;
          finishEarly(s, now);
        }
      } else if (role === 'seer') {
        if (n.seerTarget) fail('Mỗi đêm chỉ được soi 1 người.');
        if (target.id === player.id) fail('Hãy soi người khác.');
        n.seerTarget = target.id;
        n.seerResult = teamOf(target);
      } else {
        fail('Vai trò này không có hành động ban đêm.');
      }
      return;
    }
    case 'seerDone': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'seer' || player.role !== 'seer') fail('Chưa đến lượt của bạn.');
      g.night.complete = true;
      finishEarly(s, now);
      return;
    }
    case 'witch': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'witch' || player.role !== 'witch') fail('Chưa đến lượt của bạn.');
      const n = g.night;
      if (n.complete) fail('Bạn đã xong lượt.');
      if (payload.use === 'heal') {
        if (!g.potions.heal) fail('Bình Cứu đã dùng hết.');
        if (!n.wolfTarget) fail('Đêm nay không có ai bị Sói cắn.');
        n.heal = true;
        g.potions.heal = false;
      } else if (payload.use === 'poison') {
        if (!g.potions.poison) fail('Bình Độc đã dùng hết.');
        requireAliveTarget();
        if (target.id === player.id) fail('Không thể tự đầu độc mình.');
        n.poison = target.id;
        g.potions.poison = false;
      } else if (payload.use === 'done') {
        n.complete = true;
        finishEarly(s, now);
      } else {
        fail('Hành động không hợp lệ.');
      }
      return;
    }
    case 'vote': {
      if (s.phase !== 'VOTE') fail('Chưa đến lúc bỏ phiếu.');
      requireAliveTarget();
      if (target.id === player.id) fail('Không thể tự bỏ phiếu cho mình.');
      g.votes[player.id] = target.id;
      if (alivePlayers(s).every(p => g.votes[p.id])) finishEarly(s, now, 2500);
      return;
    }
    case 'judge': {
      if (s.phase !== 'JUDGE') fail('Chưa đến lúc phán quyết.');
      if (player.id === g.defendant) fail('Người đang biện hộ không được bỏ phiếu.');
      if (!['kill', 'spare'].includes(payload.choice)) fail('Lựa chọn không hợp lệ.');
      g.judge[player.id] = payload.choice;
      if (alivePlayers(s).filter(p => p.id !== g.defendant).every(p => g.judge[p.id])) finishEarly(s, now, 2500);
      return;
    }
    case 'shoot': {
      if (s.phase !== 'HUNTER' || g.hunter?.id !== player.id) fail('Chưa đến lượt Thợ Săn.');
      if (payload.target != null) {
        requireAliveTarget();
        if (target.id === player.id) fail('Hãy chọn người khác.');
      }
      resolveHunter(s, now, rng, payload.target ?? null);
      return;
    }
    default:
      fail('Hành động không hợp lệ.');
  }
}

// ---------------------------------------------------------------------------
// Per-player view: only what this player is allowed to know.
// ---------------------------------------------------------------------------

export function viewFor(s, viewerId, now, version) {
  const g = s.game;
  const me = findPlayer(s, viewerId);
  const isHost = s.hostId === viewerId;
  const gameOver = s.phase === 'GAME_OVER';
  const moderator = isHost && !me?.inGame && s.phase !== 'LOBBY';
  const meIsWolf = me?.inGame && me.role === 'werewolf';

  const roleVisible = (p) => {
    if (!p.inGame || !p.role) return false;
    if (gameOver || moderator || p.id === viewerId) return true;
    if (meIsWolf && p.role === 'werewolf') return true;
    if (!p.alive && s.config.revealRoleOnDeath) return true;
    if (s.phase === 'HUNTER' && g.hunter?.id === p.id) return true;
    return false;
  };

  const players = s.players.map(p => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: p.isBot,
    isHost: p.id === s.hostId,
    inGame: p.inGame,
    alive: p.alive,
    online: p.isBot || now - (p.lastSeen || 0) < 20000,
    role: roleVisible(p) ? p.role : null
  }));

  const activeRole = s.phase === 'NIGHT' ? g.queue[g.step] : null;
  const view = {
    version,
    serverNow: now,
    code: s.code,
    debug: s.debug,
    phase: s.phase,
    hostId: s.hostId,
    config: s.config,
    roleMode: s.roleMode,
    roleCounts: s.roleCounts,
    players,
    narration: s.narration ? { seq: s.narration.seq, clips: s.narration.clips } : null,
    game: {
      day: g.day,
      phaseStartedAt: g.phaseStartedAt,
      phaseEndsAt: g.phaseEndsAt,
      activeRole,
      step: g.step,
      steps: g.queue.length,
      lastNightDeaths: ['MORNING', 'HUNTER', 'DISCUSSION', 'VOTE', 'DEFENSE', 'JUDGE', 'VERDICT', 'GAME_OVER'].includes(s.phase) ? g.lastNightDeaths : [],
      votes: s.phase === 'VOTE' || s.phase === 'DEFENSE' ? g.votes : {},
      defendant: g.defendant,
      judge: ['JUDGE', 'VERDICT'].includes(s.phase) ? g.judge : {},
      verdict: g.verdict,
      hunterId: g.hunter?.id || null,
      winner: g.winner,
      winReason: g.winReason,
      lovers: gameOver ? g.lovers : [],
      log: g.log
    },
    me: null
  };

  if (!me) return view;

  const mine = {
    id: me.id,
    isHost,
    inGame: me.inGame,
    alive: me.alive,
    role: me.role,
    seat: me.seat,
    lover: null,
    wolves: [],
    task: null
  };
  if (me.inGame && g.lovers.includes(me.id)) mine.lover = g.lovers.find(id => id !== me.id);
  if (meIsWolf) mine.wolves = s.players.filter(p => p.inGame && p.role === 'werewolf' && p.id !== me.id).map(p => p.id);

  if (s.phase === 'NIGHT' && me.inGame && me.alive && me.role === activeRole) {
    const n = g.night;
    const task = { role: activeRole, complete: n.complete };
    if (activeRole === 'cupid') task.picks = n.cupid;
    if (activeRole === 'guard') { task.pick = n.guard; task.lastGuarded = g.lastGuarded; }
    if (activeRole === 'werewolf') { task.votes = n.wolfVotes; task.target = n.wolfTarget; }
    if (activeRole === 'seer') { task.target = n.seerTarget; task.result = n.seerResult; }
    if (activeRole === 'witch') {
      task.victim = n.wolfTarget;
      task.healAvailable = g.potions.heal;
      task.poisonAvailable = g.potions.poison;
      task.healed = n.heal;
      task.poisoned = n.poison;
    }
    mine.task = task;
  }
  if (s.phase === 'HUNTER' && g.hunter?.id === me.id) mine.task = { role: 'hunter' };

  // A moderator who does not play sees the whole night, like a real game master.
  if (moderator && s.phase === 'NIGHT') {
    const n = g.night;
    mine.moderatorNight = {
      lovers: g.lovers,
      guard: n.guard,
      wolfTarget: n.wolfTarget,
      wolfVotes: n.wolfVotes,
      seerTarget: n.seerTarget,
      heal: n.heal,
      poison: n.poison
    };
  }

  view.me = mine;
  return view;
}
