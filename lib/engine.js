// Authoritative game engine. Pure functions over a plain JSON room state so it can
// be stored in Redis and unit-tested without any I/O.
//
// Every function takes `now` (ms) and `rng` explicitly; nothing reads the clock.

import {
  ROLES, NIGHT_STEPS, MIN_PLAYERS, MAX_PLAYERS, PACK_ROLES,
  computeBalancedRoles, validateRoleCounts, emptyRoleCounts
} from '../public/shared/roles.js';
import { LINES, lineText, narrationMs, clipMs, pauseClip, PLAYBACK_LEAD_MS } from '../public/shared/voice-lines.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

export const DEFAULT_CONFIG = {
  discussionTime: 120,
  voteTime: 30,
  defenseTime: 45,
  judgeTime: 20,
  nightPauseTime: 1,
  // Action time for each night step, in seconds. The pack gets 5 s more for
  // every wolf card beyond the first.
  step_thief: 20,
  step_cupid: 25,
  step_guard: 20,
  step_werewolf: 30,
  step_avenger: 15,
  step_seer: 20,
  step_detective: 25,
  step_priest: 20,
  step_witch: 25,
  step_medium: 20,
  step_piper: 25,
  step_elder: 10,
  step_hunter: 20,
  hostPlays: true,
  revealRoleOnDeath: false
};

// Rooms saved before a setting existed fall back to its default.
const conf = (s, key) => s.config[key] ?? DEFAULT_CONFIG[key];

const CONFIG_LIMITS = {
  discussionTime: [30, 600],
  voteTime: [10, 120],
  defenseTime: [10, 180],
  judgeTime: [10, 90],
  nightPauseTime: [0, 5],
  ...Object.fromEntries(NIGHT_STEPS.map(st => [`step_${st.id}`, [5, 120]]))
};
// Settings the host may still change during a game (timers only).
const TIME_KEYS = new Set(Object.keys(CONFIG_LIMITS));

// Announcement phases (morning news, verdict) last as long as the narrator
// takes to read them, plus this pause so people can take it in.
const ANNOUNCE_PAUSE_MS = 2500;
// Phones start reading PLAYBACK_LEAD_MS after a narration is created; the
// rest is room for loading audio.
const SPEECH_SLACK_MS = PLAYBACK_LEAD_MS + 200;
// Silence between the narrator finishing and the next phase starting.
const SPEECH_GAP_MS = 300;
// After the day's verdict the narrator announces the night, then counts down.
const NIGHT_COUNTDOWN_MS = 10000;
// Silence between the opening lines ("welcome", "night falls", first call).
const OPENING_PAUSE_MS = 5000;
const BOT_DELAY_MS = 2500;
const LOG_LIMIT = 80;

// The host's phone checks in every few seconds; after this long without a
// sign of life the other players may vote for a new host phone.
export const HOST_TIMEOUT_MS = 12000;
// Other players only check in every ~15 s, so "online" is looser for them.
const PLAYER_ONLINE_MS = 45000;
// A host vote closes this long after the first ballot, even if not everyone voted.
export const HOST_VOTE_MS = 20000;

// Village roles that lose their power if the villagers kill their own Elder.
const VILLAGE_POWERS = ['seer', 'guard', 'witch', 'hunter', 'priest', 'medium', 'detective'];
const POWERLESS_MSG = 'Già Làng đã chết dưới tay dân làng nên bạn đã mất chức năng.';

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
// The Wolf Cub and the Avenger belong to the pack: they wake, vote and are
// seen with the wolves.
const inPack = (p) => PACK_ROLES.includes(p?.role);
const allPackCards = (cards) => cards.length > 0 && cards.every(r => PACK_ROLES.includes(r));
const alivePack = (s) => alivePlayers(s).filter(inPack);
const teamOf = (s, p) => ROLES[p.role]?.team;

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
//
// The current phase is then held until the narrator has finished: a timed
// phase (night step, discussion, votes...) gets its full duration *after* the
// speech, an announcement phase ends a short pause after it. This is what
// stops the next call from cutting the narrator off mid-sentence.
function say(s, now, rng, ...keys) {
  const clips = keys.flat().filter(Boolean).map(k => {
    if (typeof k === 'object') return k; // e.g. a pause
    const v = Math.floor(rng() * (LINES[k]?.length || 1));
    return { k, v, t: lineText(k, v) };
  });
  if (!clips.length) return;
  let n = s.narration;
  if (n && n.at === now) {
    n.clips.push(...clips);
  } else {
    n = s.narration = { seq: (n?.seq || 0) + 1, at: now, clips };
  }
  n.endsAt = n.at + narrationMs(n.clips) + SPEECH_SLACK_MS;
  const g = s.game;
  if (g.phaseEndsAt != null) {
    g.phaseEndsAt = Math.max(g.phaseEndsAt, n.endsAt + (g.afterSpeechMs ?? SPEECH_GAP_MS));
  }
}

const speechEndsAt = (s) => s.narration?.endsAt ?? 0;

const seatKey = (s, id) => {
  const p = findPlayer(s, id);
  return p?.seat ? `seat_${p.seat}` : null;
};

const bySeat = (s, deaths) =>
  [...deaths].sort((a, b) => (findPlayer(s, a.id)?.seat ?? 0) - (findPlayer(s, b.id)?.seat ?? 0));

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

// `durationMs` is how long players get once the narrator has finished speaking
// (see say()). Announcement phases pass `{ announce: true }` and simply last
// until the narration is over.
//
// `{ window: true }` makes `durationMs` a fixed slot that the narration plays
// inside (stretched only if the speech is longer), used for the night's
// "wake up" and "go to sleep" calls.
function setPhase(s, phase, now, durationMs, { announce = false, window = false } = {}) {
  const g = s.game;
  s.phase = phase;
  g.phaseStartedAt = now;
  if (durationMs == null) {
    g.phaseEndsAt = null;
    g.afterSpeechMs = null;
    return;
  }
  if (window) {
    g.afterSpeechMs = SPEECH_GAP_MS;
    g.phaseEndsAt = Math.max(now + durationMs, speechEndsAt(s) + SPEECH_GAP_MS);
    return;
  }
  g.afterSpeechMs = announce ? ANNOUNCE_PAUSE_MS : durationMs;
  g.phaseEndsAt = Math.max(now, speechEndsAt(s)) + g.afterSpeechMs;
}

// End the phase soon, but never while the narrator is still talking.
function finishEarly(s, now, minMs = 1500) {
  const g = s.game;
  const target = Math.max(now + minMs, speechEndsAt(s) + SPEECH_GAP_MS);
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
    hunterAim: null,
    thiefId: null,
    thiefExtras: [],
    loversRevealed: false,
    charmed: [],
    charmedKnown: [],
    cubRevenge: false,
    priestUsed: false,
    mediumUsed: false,
    avengerTarget: null,
    revived: null,
    elderShield: true,
    powersLost: false,
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
  const name = cleanName(rawName);
  const same = s.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (same && !same.isBot && !isBot) return reclaimSeat(same, now, rng);
  if (s.phase !== 'LOBBY') fail('Ván chơi đang diễn ra, hãy chờ ván sau nhé.');
  if (s.players.length >= MAX_PLAYERS + 1) fail('Phòng đã đầy.');
  if (same) fail('Tên này đã có người dùng trong phòng, hãy chọn tên khác.');
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

// A player whose phone lost its session (another browser, cleared data, a
// chat app's built-in browser) comes back by typing the same name. They get
// their seat and card back with a fresh token, which signs out the old phone.
// Only once that seat has gone quiet, so nobody takes over a player who is
// still connected.
function reclaimSeat(p, now, rng) {
  const idle = now - (p.lastSeen || 0);
  if (idle < PLAYER_ONLINE_MS) {
    const wait = Math.ceil((PLAYER_ONLINE_MS - idle) / 1000);
    fail(`Tên này đang có người dùng trong phòng. Nếu đó là bạn trên máy cũ, hãy chờ khoảng ${wait} giây rồi vào lại; nếu không, hãy chọn tên khác.`);
  }
  p.token = randomId(rng, 24);
  p.lastSeen = now;
  return p;
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
    if (next) transferHost(s, next.id);
    else s.hostId = null;
  }
  renumberSeats(s);
  if (s.roleMode === 'auto') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
}

// ---------------------------------------------------------------------------
// Host phone failover
//
// The host's phone only plays the narrator, starts games and opens new ones:
// the server runs the clock, so the game carries on if it drops out. When it
// has been silent for HOST_TIMEOUT_MS, players vote for whose phone takes
// over. A new host never gains secret information: they keep their own card,
// and the moderator view only exists for a host who is not playing.
// ---------------------------------------------------------------------------

const isOnline = (p, now) => !p.isBot && now - (p.lastSeen || 0) < PLAYER_ONLINE_MS;

export function isHostOffline(s, now) {
  const host = findPlayer(s, s.hostId);
  return !host || now - (host.lastSeen || 0) > HOST_TIMEOUT_MS;
}

function hostCandidates(s, now) {
  return s.players.filter(p => p.id !== s.hostId && isOnline(p, now));
}

function hostVotesNeeded(s, now) {
  return Math.floor(hostCandidates(s, now).length / 2) + 1;
}

function transferHost(s, id) {
  s.hostId = id;
  s.hostVotes = {};
  s.hostVoteStartedAt = null;
  // The new host is a player; never shut them out of the next game.
  s.config.hostPlays = true;
  renumberSeats(s);
  if (s.roleMode === 'auto' && s.phase === 'LOBBY') s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
}

function voteForHost(s, voter, candidateId, now, rng) {
  if (!isHostOffline(s, now)) {
    s.hostVotes = {};
    s.hostVoteStartedAt = null;
    fail('Máy chủ phòng đã kết nối lại.');
  }
  const candidate = findPlayer(s, candidateId);
  if (!candidate || candidate.id === s.hostId || !isOnline(candidate, now)) fail('Hãy chọn một người đang kết nối.');
  if (!Object.keys(s.hostVotes || {}).length) s.hostVoteStartedAt = now;
  s.hostVotes = { ...(s.hostVotes || {}), [voter.id]: candidate.id };
  resolveHostVote(s, now, rng);
}

// Decide the vote when someone has a majority, when everyone still here has
// voted, or when the voting time is up. A tie for most votes is settled by
// drawing one of the tied players at random. Returns true if a host was picked.
export function resolveHostVote(s, now, rng = Math.random) {
  // Voting at night would show who is awake (and so who holds a role).
  if (s.phase === 'NIGHT' || !isHostOffline(s, now)) return false;
  const voters = hostCandidates(s, now);
  const ballots = Object.entries(s.hostVotes || {})
    .filter(([id, c]) => voters.some(p => p.id === id) && voters.some(p => p.id === c));
  if (!ballots.length) return false;
  const tally = {};
  ballots.forEach(([, c]) => { tally[c] = (tally[c] || 0) + 1; });
  const max = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter(id => tally[id] === max);
  const majority = max >= hostVotesNeeded(s, now);
  const everyoneVoted = voters.every(p => ballots.some(([id]) => id === p.id));
  const timeUp = now - (s.hostVoteStartedAt ?? now) >= HOST_VOTE_MS;
  if (!majority && !everyoneVoted && !timeUp) return false;
  const winner = findPlayer(s, leaders.length === 1 ? leaders[0] : pick(leaders, rng));
  const old = findPlayer(s, s.hostId);
  transferHost(s, winner.id);
  const how = leaders.length > 1 ? ' (bốc thăm vì hoà phiếu)' : '';
  log(s, `📢 ${winner.name} trở thành máy chủ phòng mới${old ? ` thay cho ${old.name}` : ''}${how}.`);
  return true;
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
  // Every card in the deck (including the Thief's two spare cards) counts as
  // "in play", so its night step is called and nobody learns what was dealt.
  s.game.rolesInPlay = Object.keys(s.roleCounts).filter(id => s.roleCounts[id] > 0);
  s.game.thiefExtras = deck;
  s.game.thiefId = s.players.find(p => p.inGame && p.role === 'thief')?.id || null;
  s.narration = null;
  log(s, `Ván chơi bắt đầu với ${ps.length} người. Mỗi người hãy xem lá bài của mình.`);
  say(s, now, rng, 'game_start', pauseClip(OPENING_PAUSE_MS));
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
    // The hunter's gun goes off whatever killed them, taking whoever they
    // aimed at last night.
    const aim = s.game.hunterAim;
    if (p.role === 'hunter' && aim && aim !== p.id && !s.game.powersLost) queue.push({ id: aim, cause: 'hunter' });
    // Classic Elder rule: if the village itself kills the Elder (hanging, the
    // witch's poison or the hunter's gun), every villager loses their power.
    if (p.role === 'elder' && ['lynch', 'poison', 'hunter'].includes(d.cause) && !s.game.powersLost) {
      s.game.powersLost = true;
    }
    // The Avenger, hanged by the village, takes their chosen target along.
    const mark = s.game.avengerTarget;
    if (p.role === 'avenger' && d.cause === 'lynch' && mark && mark !== p.id) {
      queue.push({ id: mark, cause: 'avenger' });
    }
    // A dead Wolf Cub lets the pack bite twice the following night.
    if (p.role === 'wolf_cub') s.game.cubRevenge = true;
    const lovers = s.game.lovers;
    if (lovers.length === 2 && lovers.includes(p.id)) {
      queue.push({ id: lovers.find(x => x !== p.id), cause: 'heartbreak' });
    }
  }
  return died;
}

export function checkWin(s) {
  const alive = alivePlayers(s);
  const wolves = alive.filter(p => teamOf(s, p) === 'werewolf').length;
  const others = alive.length - wolves;
  const [a, b] = s.game.lovers.map(id => findPlayer(s, id));
  if (a && b && a.alive && b.alive && alive.length === 2 && teamOf(s, a) !== teamOf(s, b)) {
    return { winner: 'lovers', reason: 'Cặp Tình Nhân khác phe là hai người cuối cùng còn sống.' };
  }
  const piper = alive.find(p => p.role === 'piper');
  if (piper && alive.every(p => p.id === piper.id || s.game.charmed.includes(p.id))) {
    return { winner: 'piper', reason: 'Mọi người còn sống đều đã bị tiếng sáo thôi miên.' };
  }
  if (wolves === 0 && !piper) return { winner: 'village', reason: 'Tất cả Ma Sói đã bị tiêu diệt.' };
  if (wolves >= others) return { winner: 'werewolf', reason: `Số Sói (${wolves}) đã bằng hoặc nhiều hơn số người còn lại (${others}).` };
  return null;
}

function finishGame(s, win, now, rng) {
  setPhase(s, 'GAME_OVER', now, null);
  s.game.winner = win.winner;
  s.game.winReason = win.reason;
  const label = { village: 'PHE DÂN LÀNG', werewolf: 'PHE MA SÓI', lovers: 'CẶP TÌNH NHÂN', piper: 'NGƯỜI THỔI SÁO', fool: 'KẺ CUỒNG LOẠN' }[win.winner];
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
    thiefDone: false,
    piperPicks: [],
    acks: {},
    cupid: [],
    guard: null,
    hunterAim: null,
    wolfVotes: {},     // wolf id -> the targets that wolf wants
    wolfTargets: [],   // the pack's final choice
    wolfNoKill: false, // the pack agreed to bite nobody
    wolfKills: g.cubRevenge ? 2 : 1,
    holy: null,
    revive: null,
    avengerAim: null,
    detectivePicks: [],
    detectiveResult: null,
    seerTarget: null,
    seerResult: null,
    heal: false,
    poison: null,
    complete: false
  };
  g.cubRevenge = false;
  g.votes = {};
  g.defendant = null;
  g.judge = {};
  g.verdict = null;
  // Roles are called even when their holders are dead so the night sounds the
  // same either way and nobody learns who is still alive.
  g.queue = NIGHT_STEPS
    .filter(step => [step.role, ...(step.also || [])].some(r => g.rolesInPlay.includes(r)))
    .filter(step => (!step.firstNightOnly || g.day === 1) && (!step.notFirstNight || g.day > 1))
    .map(step => step.id);
  g.step = 0;
  g.wakeQueued = null;
  log(s, `🌙 Đêm ${g.day} buông xuống.`);
  say(s, now, rng, 'night_start', pauseClip(OPENING_PAUSE_MS));
  startNightStep(s, now, rng);
}

// Who opens their eyes during a night step.
export function stepHolders(s, step) {
  const g = s.game;
  if (step === 'thief') return alivePlayers(s).filter(p => p.id === g.thiefId);
  if (step === 'werewolf') return alivePack(s);
  return aliveWithRole(s, step);
}

// Each night step runs three fixed slots, the same length whether or not the
// role's holder is alive, so nobody can tell from the timing:
//   call   (as long as the call takes) the narrator wakes the role up
//   act    (nightStepTime)   the role makes its choice on their phone
//   sleep  the narrator sends the role back to sleep, pauses (nightPauseTime)
//          and, in the same breath, wakes the next role
// Actions are accepted during "call" and "act". The action timer starts as soon
// as the call has been read; a call's length depends only on the line, never
// on whether the role is alive, so it gives nothing away. The sleep slot only
// stretches if its line is longer, so the narrator is never cut off.
function startNightStep(s, now, rng) {
  const g = s.game;
  if (g.step >= g.queue.length) {
    endNight(s, now, rng);
    return;
  }
  const role = g.queue[g.step];
  g.night.acks = {};
  g.night.complete = false;
  g.nightStage = 'call';
  setPhase(s, 'NIGHT', now, 0, { window: true });
  // The wake call was usually already queued right behind the previous
  // role's "go to sleep", so the host plays them back to back without
  // waiting for another round trip. The call slot then simply lasts until
  // that narration has finished.
  if (g.wakeQueued === g.step) {
    g.phaseEndsAt = Math.max(now, speechEndsAt(s) + SPEECH_GAP_MS);
  } else {
    say(s, now, rng, `${role}_wake`);
  }
  g.wakeQueued = null;
}

// Action time of a night step. Depends only on the deck (public), never on
// who is still alive.
export function stepTimeMs(s, step) {
  let secs = conf(s, `step_${step}`) ?? 20;
  if (step === 'werewolf') {
    const pack = PACK_ROLES.reduce((n, id) => n + (s.roleCounts[id] || 0), 0);
    secs += 5 * Math.max(0, pack - 1);
  }
  return secs * 1000;
}

function startNightAct(s, now, rng) {
  const g = s.game;
  g.nightStage = 'act';
  let ms = stepTimeMs(s, g.queue[g.step]);
  // Players end their turn early with "Xong". A step nobody can play (its
  // holder is dead, or the card is a spare) must not run longer than a real
  // one, or the timing would give that away: it ends at a random moment.
  if (!stepHolders(s, g.queue[g.step]).length) {
    ms = Math.round(Math.min(ms, 5000 + rng() * Math.max(0, ms - 5000)));
  }
  setPhase(s, 'NIGHT', now, ms);
}

// Said right after these roles go back to sleep.
const NOTE_AFTER = { cupid: 'lovers_note', piper: 'charmed_note' };

function startNightSleep(s, now, rng) {
  const g = s.game;
  const role = g.queue[g.step];
  finalizeNightStep(s, rng);
  g.nightStage = 'sleep';
  setPhase(s, 'NIGHT', now, 0, { window: true });
  const pause = pauseClip(conf(s, 'nightPauseTime') * 1000);
  const next = g.queue[g.step + 1];
  // Instead of waking the couple / the charmed, tell them where to look.
  const note = NOTE_AFTER[role];
  if (next) {
    say(s, now, rng, `${role}_sleep`, note, pause, `${next}_wake`);
    g.wakeQueued = g.step + 1;
    // The sleep slot ends when the next call starts playing, not when the
    // whole chained narration does.
    const clips = s.narration.clips;
    const before = clips.slice(clips.findLastIndex(c => c.k === `${role}_sleep`), clips.findLastIndex(c => c.k === `${next}_wake`));
    g.phaseEndsAt = s.narration.at + narrationMs(before) + SPEECH_SLACK_MS;
  } else {
    say(s, now, rng, `${role}_sleep`, note, pause);
  }
}

function onNightTimeout(s, now, rng) {
  const g = s.game;
  if (g.nightStage === 'call') return startNightAct(s, now, rng);
  if (g.nightStage === 'act') return startNightSleep(s, now, rng);
  g.step += 1;
  startNightStep(s, now, rng);
}

// Lock in what the role chose (or the defaults) when its time is up.
function finalizeNightStep(s, rng) {
  const g = s.game;
  const role = g.queue[g.step];
  const n = g.night;
  n.complete = true;
  if (role === 'werewolf' && !n.wolfTargets.length && !n.wolfNoKill) {
    // The most voted choices; if "nobody" leads, nobody is bitten.
    const picks = pluralityPicks(Object.values(n.wolfVotes).flat(), n.wolfKills, rng);
    n.wolfTargets = picks[0] === NO_KILL ? [] : picks.filter(id => id !== NO_KILL);
  }
  if (role === 'avenger' && n.avengerAim) g.avengerTarget = n.avengerAim;
  if (role === 'thief' && !n.thiefDone && g.thiefId) {
    const thief = findPlayer(s, g.thiefId);
    // Two werewolf cards: the thief must take one.
    if (thief?.alive && allPackCards(g.thiefExtras)) {
      takeThiefCard(s, thief, Math.floor(rng() * g.thiefExtras.length));
    }
  }
  if (role === 'piper') {
    g.charmed.push(...n.piperPicks.filter(id => !g.charmed.includes(id)));
    g.charmedKnown = [...g.charmed]; // the charmed now see each other on their cards
  }
  if (role === 'guard') g.lastGuarded = n.guard;
  if (role === 'hunter' && n.hunterAim) g.hunterAim = n.hunterAim;
  // The couple now see each other on their cards. Nothing goes in the public
  // log: it would show whether anyone holds the Cupid card.
  if (role === 'cupid' && g.lovers.length === 2) g.loversRevealed = true;
}

function takeThiefCard(s, thief, index) {
  const g = s.game;
  const taken = g.thiefExtras[index];
  g.thiefExtras[index] = 'thief';
  thief.role = taken;
  g.night.thiefDone = true;
  g.night.thiefTook = taken;
}

// A wolf's vote for biting nobody tonight.
const NO_KILL = 'none';

// The pack has decided once every living wolf picked the same thing: the
// same victims (as many as tonight allows), or nobody.
function settlePack(s) {
  const n = s.game.night;
  const pack = alivePack(s);
  const sets = pack.map(w => [...(n.wolfVotes[w.id] || [])].sort().join(','));
  if (!sets.length || sets.some(x => x !== sets[0])) return;
  const choice = n.wolfVotes[pack[0].id] || [];
  if (choice[0] === NO_KILL) {
    n.wolfNoKill = true;
    n.complete = true;
    return;
  }
  const need = Math.min(n.wolfKills, alivePlayers(s).length - 1);
  if (choice.length === need) {
    n.wolfTargets = [...choice];
    n.complete = true;
  }
}

// The `k` most voted targets (ties broken at random).
function pluralityPicks(targets, k, rng) {
  const picks = [];
  let rest = targets.filter(Boolean);
  while (picks.length < k) {
    const next = pluralityPick(rest, rng);
    if (!next) break;
    picks.push(next);
    rest = rest.filter(t => t !== next);
  }
  return picks;
}

function pluralityPick(targets, rng) {
  const tally = {};
  targets.filter(Boolean).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  if (!max) return null;
  return pick(Object.keys(tally).filter(id => tally[id] === max), rng);
}

function endNight(s, now, rng) {
  const g = s.game;
  const n = g.night;
  const deaths = [];
  // The Medium's chosen one comes back before anything else happens.
  g.revived = null;
  const back = n.revive && findPlayer(s, n.revive);
  if (back && !back.alive) {
    back.alive = true;
    delete back.deathCause;
    g.revived = back.id;
  }
  // The heal is blind: it saves whoever the pack bit tonight (both, on the
  // night after the Wolf Cub died).
  for (const id of n.heal ? [] : n.wolfTargets) {
    if (id === n.guard) continue;
    // The Elder survives the first bite.
    if (findPlayer(s, id)?.role === 'elder' && g.elderShield) {
      g.elderShield = false;
      continue;
    }
    deaths.push({ id, cause: 'wolf' });
  }
  if (n.poison && !deaths.some(d => d.id === n.poison)) deaths.push({ id: n.poison, cause: 'poison' });
  // Holy water: a wolf dies; hitting a villager costs the Priest their life;
  // a third-party player is unharmed.
  const holy = n.holy && findPlayer(s, n.holy);
  const priest = s.players.find(p => p.inGame && p.role === 'priest');
  const victim = !holy ? null : inPack(holy) ? holy : teamOf(s, holy) === 'village' ? priest : null;
  if (victim?.alive && !deaths.some(d => d.id === victim.id)) deaths.push({ id: victim.id, cause: 'holy' });
  // Read out by seat: the order they happened in (bite, poison, a partner or
  // the Hunter's target dying along) would tell how each one died.
  const died = bySeat(s, killPlayers(s, deaths));
  g.lastNightDeaths = died.map(d => d.id);

  setPhase(s, 'MORNING', now, 0, { announce: true });
  const keys = [];
  if (died.length) {
    // Deaths are announced without causes: a gunshot or a broken heart would
    // expose the Hunter or the couple.
    keys.push('morning_deaths', ...seatList(s, died.map(d => d.id)));
    log(s, `☀️ Sáng ngày ${g.day}: ${died.map(d => nameOf(s, d.id)).join(', ')} đã chết.`);
  } else {
    keys.push('morning_peace');
    log(s, `☀️ Sáng ngày ${g.day}: đêm qua bình yên, không ai chết.`);
  }
  if (g.revived && findPlayer(s, g.revived)?.alive) {
    keys.push('revived', seatKey(s, g.revived));
    log(s, `🕯️ ${nameOf(s, g.revived)} đã được Thầy Đồng hồi sinh.`);
  }
  say(s, now, rng, keys);
  endIfWon(s, now, rng);
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
    setPhase(s, 'VERDICT', now, NIGHT_COUNTDOWN_MS);
    say(s, now, rng, 'no_defendant', 'night_soon');
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
  setPhase(s, 'VERDICT', now, NIGHT_COUNTDOWN_MS);
  if (kill > spare) {
    const fool = findPlayer(s, g.defendant)?.role === 'fool';
    const died = killPlayers(s, [{ id: g.defendant, cause: 'lynch' }]);
    g.verdict = { type: 'kill', ids: died.map(d => d.id), kill, spare };
    log(s, `⚖️ ${nameOf(s, g.defendant)} bị treo cổ (${kill} treo / ${spare} tha).`);
    // Hanging the Fool is exactly what the Fool wanted: game over.
    if (fool) {
      say(s, now, rng, seatKey(s, g.defendant), 'verdict_kill');
      finishGame(s, { winner: 'fool', reason: 'Dân làng đã treo cổ Kẻ Cuồng Loạn, đúng như ý muốn của hắn.' }, now, rng);
      return;
    }
    const others = bySeat(s, died.filter(d => d.id !== g.defendant));
    const keys = [seatKey(s, g.defendant), 'verdict_kill'];
    if (others.length) {
      keys.push('also_died', ...seatList(s, others.map(d => d.id)));
      log(s, `💀 Cũng đã chết: ${others.map(d => nameOf(s, d.id)).join(', ')}.`);
    }
    say(s, now, rng, keys);
    if (!endIfWon(s, now, rng)) say(s, now, rng, 'night_soon');
  } else {
    g.verdict = { type: 'spare', ids: [g.defendant], kill, spare };
    log(s, `⚖️ ${nameOf(s, g.defendant)} được tha (${kill} treo / ${spare} tha).`);
    say(s, now, rng, seatKey(s, g.defendant), 'verdict_spare', 'night_soon');
  }
}

function continueAfterDeaths(s, now, rng, next) {
  const g = s.game;
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
    case 'NIGHT': return onNightTimeout(s, now, rng);
    case 'MORNING': return continueAfterDeaths(s, now, rng, 'DISCUSSION');
    case 'DISCUSSION': return beginVote(s, now, rng);
    case 'VOTE': return resolveVote(s, now, rng);
    case 'DEFENSE': return beginJudge(s, now, rng);
    case 'JUDGE': return resolveJudge(s, now, rng);
    case 'VERDICT': return continueAfterDeaths(s, now, rng, 'NIGHT');
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

  if (s.phase === 'NIGHT' && g.nightStage === 'act' && !g.night.complete) {
    const role = g.queue[g.step];
    const n = g.night;
    const holders = stepHolders(s, role);
    holders.filter(b => b.isBot).forEach(bot => {
      if (role === 'thief' && !n.thiefDone) {
        const mustTake = allPackCards(g.thiefExtras);
        act(bot, 'thief', { pick: mustTake || rng() < 0.5 ? Math.floor(rng() * g.thiefExtras.length) : null });
      } else if (role === 'elder' && !n.acks[bot.id]) {
        act(bot, 'ack', {});
      } else if (role === 'piper' && n.piperPicks.length < 2) {
        const options = shuffle(alivePlayers(s).filter(p => p.id !== bot.id && !g.charmed.includes(p.id) && !n.piperPicks.includes(p.id)), rng);
        options.slice(0, 2 - n.piperPicks.length).forEach(p => act(bot, 'night', { target: p.id }));
      } else if (role === 'cupid' && n.cupid.length < 2) {
        shuffle(alivePlayers(s), rng).slice(0, 2 - n.cupid.length)
          .forEach(p => act(bot, 'night', { target: p.id }));
      } else if (role === 'guard' && !n.guard) {
        const options = alivePlayers(s).filter(p => p.id !== g.lastGuarded && !(g.day === 1 && p.id === bot.id));
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'werewolf' && !n.wolfVotes[bot.id]?.length) {
        // Follow a human wolf's choice if there is one, else pick at random.
        const humanVote = Object.entries(n.wolfVotes).find(([id, v]) => !findPlayer(s, id)?.isBot && v.length);
        const prey = shuffle(alivePlayers(s).filter(p => !inPack(p)), rng).map(p => p.id);
        const targets = humanVote ? humanVote[1] : prey.slice(0, n.wolfKills);
        targets.forEach(target => act(bot, 'night', { target }));
      } else if (role === 'priest' && !g.priestUsed && rng() < 0.3) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'medium' && !g.mediumUsed) {
        const dead = s.players.filter(p => p.inGame && !p.alive);
        if (dead.length && rng() < 0.5) act(bot, 'night', { target: pick(dead, rng).id });
      } else if (role === 'detective') {
        const options = shuffle(others(bot), rng).slice(0, 2 - n.detectivePicks.length);
        if (!n.detectiveResult) options.forEach(p => act(bot, 'night', { target: p.id }));
        act(bot, 'detectiveDone', {});
      } else if (role === 'avenger' && !n.avengerAim) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'seer') {
        if (!n.seerTarget) {
          const options = others(bot);
          if (options.length) act(bot, 'night', { target: pick(options, rng).id });
        }
        act(bot, 'seerDone', {});
      } else if (role === 'hunter' && !n.hunterAim) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'witch') {
        if (g.potions.heal && rng() < 0.3) act(bot, 'witch', { use: 'heal' });
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
  }
  return changed;
}

// When the state will next change on its own (phase timeout, or debug bots
// about to act). Clients ask the server for a fresh state at that moment.
export function nextWake(s, now) {
  const g = s.game;
  if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER' || g.phaseEndsAt == null) return null;
  const botsAt = g.phaseStartedAt + BOT_DELAY_MS;
  if (now < botsAt && alivePlayers(s).some(p => p.isBot)) return Math.min(botsAt, g.phaseEndsAt);
  return g.phaseEndsAt;
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

const NIGHT_ACTIONS = new Set(['night', 'thief', 'ack', 'seerDone', 'detectiveDone', 'witch', 'endTurn']);
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

  // Anyone still in the room, alive or not, can help pick a new host phone.
  if (type === 'hostVote') {
    if (isHost) fail('Bạn đang là máy chủ phòng.');
    return voteForHost(s, player, payload.candidate, now, rng);
  }

  if (HOST_LOBBY_ACTIONS.has(type) || HOST_GAME_ACTIONS.has(type)) {
    if (!isHost) fail('Chỉ Chủ phòng mới làm được việc này.');
    const timersOnly = type === 'config' && Object.keys(payload).every(k => TIME_KEYS.has(k));
    if (HOST_LOBBY_ACTIONS.has(type) && s.phase !== 'LOBBY' && !timersOnly) fail('Chỉ chỉnh được khi đang ở phòng chờ.');
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
      if (s.phase !== 'LOBBY') return; // mid-game: timers only
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
      const free = MAX_PLAYERS + 1 - s.players.length;
      if (free <= 0) fail('Phòng đã đầy.');
      // Add as many as asked, but never more than the seats left.
      const count = Math.min(free, Math.max(1, Math.floor(Number(payload.count) || 1)));
      const names = ['Hương', 'Tuấn', 'Ngọc', 'Hoàng', 'Linh', 'Đức', 'Phương', 'Khánh', 'Trang', 'Bảo', 'Vy', 'Tùng', 'Mai', 'Long', 'Nhi', 'Quân', 'Hà'];
      for (let i = 0; i < count; i++) {
        const used = new Set(s.players.map(p => p.name));
        const name = names.find(n => !used.has(`🤖 ${n}`)) || `Bot ${s.players.length + 1}`;
        joinRoom(s, `🤖 ${name}`, now, rng, { isBot: true });
      }
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
  if (!player.inGame || !player.alive) fail('Bạn đã bị loại, chỉ có thể theo dõi.');
  if (NIGHT_ACTIONS.has(type) && s.phase === 'NIGHT' && g.nightStage === 'sleep') fail('Đã hết lượt của bạn, hãy nhắm mắt lại.');

  switch (type) {
    case 'night': {
      if (s.phase !== 'NIGHT') fail('Chưa đến lượt ban đêm.');
      const role = g.queue[g.step];
      if (!stepHolders(s, role).some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      const n = g.night;
      if (g.powersLost && VILLAGE_POWERS.includes(role)) fail(POWERLESS_MSG);
      if (role === 'medium') {
        // The Medium picks among the dead.
        if (g.mediumUsed || n.revive) fail('Bạn đã dùng năng lực hồi sinh rồi.');
        if (!target || !target.inGame || target.alive) fail('Hãy chọn một người đã chết.');
        n.revive = target.id;
        g.mediumUsed = true;
        n.complete = true;
        return;
      }
      // The pack may also agree to bite nobody tonight.
      if (role === 'werewolf' && payload.noKill) {
        if (n.wolfTargets.length || n.wolfNoKill) fail('Đàn Sói đã chốt.');
        n.wolfVotes[player.id] = [NO_KILL];
        settlePack(s);
        return;
      }
      requireAliveTarget();
      if (role === 'piper') {
        if (n.complete) fail('Bạn đã thôi miên xong.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        if (g.charmed.includes(target.id)) fail('Người này đã bị thôi miên rồi.');
        n.piperPicks = n.piperPicks.includes(target.id)
          ? n.piperPicks.filter(id => id !== target.id)
          : [...n.piperPicks, target.id].slice(0, 2);
        const eligible = alivePlayers(s).filter(p => p.id !== player.id && !g.charmed.includes(p.id)).length;
        if (n.piperPicks.length >= Math.min(2, eligible)) {
          n.complete = true;
        }
      } else if (role === 'cupid') {
        if (n.complete) fail('Bạn đã ghép đôi xong.');
        n.cupid = n.cupid.includes(target.id)
          ? n.cupid.filter(id => id !== target.id)
          : [...n.cupid, target.id].slice(0, 2);
        if (n.cupid.length === 2) {
          g.lovers = [...n.cupid];
          n.complete = true;
        }
      } else if (role === 'guard') {
        if (target.id === player.id && g.day === 1) fail('Đêm đầu không được tự bảo vệ mình.');
        if (target.id === g.lastGuarded) fail('Không được bảo vệ cùng một người 2 đêm liên tiếp.');
        n.guard = target.id;
        n.complete = true;
      } else if (role === 'werewolf') {
        // Wolves may bite anyone but themselves, pack mates included.
        if (target.id === player.id) fail('Không thể tự cắn chính mình.');
        if (n.wolfTargets.length || n.wolfNoKill) fail('Đàn Sói đã chốt.');
        // Tap to pick, tap again to drop. Usually one victim; two on the night
        // after the Wolf Cub died (the oldest pick makes room for a new one).
        const mine = (n.wolfVotes[player.id] || []).filter(id => id !== NO_KILL);
        n.wolfVotes[player.id] = mine.includes(target.id)
          ? mine.filter(id => id !== target.id)
          : [...mine, target.id].slice(-n.wolfKills);
        settlePack(s);
      } else if (role === 'priest') {
        if (g.priestUsed) fail('Bạn đã dùng nước thánh rồi.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.holy = target.id;
        g.priestUsed = true;
        n.complete = true;
      } else if (role === 'detective') {
        if (n.detectiveResult) fail('Bạn đã kiểm tra xong đêm nay.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.detectivePicks = n.detectivePicks.includes(target.id)
          ? n.detectivePicks.filter(id => id !== target.id)
          : [...n.detectivePicks, target.id];
        if (n.detectivePicks.length === 2) {
          const [a, b] = n.detectivePicks.map(id => findPlayer(s, id));
          n.detectiveResult = teamOf(s, a) === teamOf(s, b) ? 'same' : 'different';
        }
      } else if (role === 'avenger') {
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.avengerAim = target.id;
        n.complete = true;
      } else if (role === 'hunter') {
        if (target.id === player.id) fail('Hãy chĩa súng vào người khác.');
        n.hunterAim = target.id;
        n.complete = true;
      } else if (role === 'seer') {
        if (n.seerTarget) fail('Mỗi đêm chỉ được soi 1 người.');
        if (target.id === player.id) fail('Hãy soi người khác.');
        n.seerTarget = target.id;
        // Only wolf or not: the Piper and the madman read as villagers.
        n.seerResult = teamOf(s, target) === 'werewolf' ? 'werewolf' : 'village';
      } else {
        fail('Vai trò này không có hành động ban đêm.');
      }
      return;
    }
    case 'thief': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'thief' || player.id !== g.thiefId) fail('Chưa đến lượt của bạn.');
      const n = g.night;
      if (n.thiefDone) fail('Bạn đã chọn xong.');
      const pickIndex = payload.pick;
      if (pickIndex === null || pickIndex === undefined) {
        if (allPackCards(g.thiefExtras)) fail('Cả 2 lá đều là Sói, bạn bắt buộc phải lấy 1 lá.');
        n.thiefDone = true;
        n.thiefTook = null;
      } else {
        if (![0, 1].includes(pickIndex) || !g.thiefExtras[pickIndex]) fail('Lá bài không hợp lệ.');
        takeThiefCard(s, player, pickIndex);
      }
      n.complete = true;
      return;
    }
    case 'ack': {
      const step = g.queue[g.step];
      if (s.phase !== 'NIGHT' || step !== 'elder') fail('Chưa đến lượt của bạn.');
      const holders = stepHolders(s, step);
      if (!holders.some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      g.night.acks[player.id] = true;
      if (holders.every(p => g.night.acks[p.id])) {
        g.night.complete = true;
      }
      return;
    }
    case 'endTurn': {
      const step = g.queue[g.step];
      if (s.phase !== 'NIGHT' || g.nightStage !== 'act' || !stepHolders(s, step).some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      g.phaseEndsAt = now; // the next tick sends the role back to sleep
      return;
    }
    case 'detectiveDone': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'detective' || player.role !== 'detective') fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      g.night.complete = true;
      return;
    }
    case 'seerDone': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'seer' || player.role !== 'seer') fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      g.night.complete = true;
      return;
    }
    case 'witch': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'witch' || player.role !== 'witch') fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      const n = g.night;
      if (n.complete) fail('Bạn đã xong lượt.');
      if (payload.use === 'heal') {
        // Blind heal: the witch never learns who was bitten. The potion saves
        // the wolves' victim if there is one, and is spent either way.
        if (!g.potions.heal) fail('Bình Cứu đã dùng hết.');
        if (n.heal || n.poison) fail('Mỗi đêm chỉ được dùng một bình.');
        n.heal = true;
        g.potions.heal = false;
      } else if (payload.use === 'poison') {
        if (!g.potions.poison) fail('Bình Độc đã dùng hết.');
        if (n.heal || n.poison) fail('Mỗi đêm chỉ được dùng một bình.');
        requireAliveTarget();
        if (target.id === player.id) fail('Không thể tự đầu độc mình.');
        n.poison = target.id;
        g.potions.poison = false;
      } else if (payload.use === 'done') {
        n.complete = true;
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
  const meIsWolf = me?.inGame && inPack(me);

  const roleVisible = (p) => {
    if (!p.inGame || !p.role) return false;
    if (gameOver || moderator || p.id === viewerId) return true;
    if (meIsWolf && inPack(p)) return true;
    if (!p.alive && s.config.revealRoleOnDeath) return true;
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
    // At night only the role being called holds a phone, so showing who is
    // connected would point at them: everyone reads as connected until dawn.
    online: s.phase === 'NIGHT' || p.isBot || now - (p.lastSeen || 0) < PLAYER_ONLINE_MS,
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
    hostOffline: s.phase !== 'NIGHT' && isHostOffline(s, now) ? {
      votes: Object.fromEntries(Object.entries(s.hostVotes || {}).filter(([id]) => {
        const p = findPlayer(s, id);
        return p && isOnline(p, now);
      })),
      needed: hostVotesNeeded(s, now),
      endsAt: s.hostVoteStartedAt ? s.hostVoteStartedAt + HOST_VOTE_MS : null,
      candidates: hostCandidates(s, now).map(p => p.id)
    } : null,
    config: { ...DEFAULT_CONFIG, ...s.config },
    roleMode: s.roleMode,
    roleCounts: s.roleCounts,
    players,
    narration: s.narration ? { seq: s.narration.seq, at: s.narration.at, endsAt: s.narration.endsAt, clips: s.narration.clips } : null,
    game: {
      day: g.day,
      phaseStartedAt: g.phaseStartedAt,
      phaseEndsAt: g.phaseEndsAt,
      wakeAt: nextWake(s, now),
      activeRole,
      nightStage: s.phase === 'NIGHT' ? g.nightStage : null,
      step: g.step,
      steps: g.queue.length,
      lastNightDeaths: ['MORNING', 'DISCUSSION', 'VOTE', 'DEFENSE', 'JUDGE', 'VERDICT', 'GAME_OVER'].includes(s.phase) ? g.lastNightDeaths : [],
      votes: s.phase === 'VOTE' || s.phase === 'DEFENSE' ? g.votes : {},
      defendant: g.defendant,
      judge: ['JUDGE', 'VERDICT'].includes(s.phase) ? g.judge : {},
      verdict: g.verdict,
      winner: g.winner,
      winReason: g.winReason,
      // Secret: telling everyone would reveal that the dead player was the Elder.
      powersLost: (gameOver || moderator) && g.powersLost,
      lovers: gameOver ? g.lovers : [],
      // The log tells who died how and when: only a moderator who is not
      // playing reads it, like a real game master's notes.
      log: moderator ? g.log : []
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
  if (me.inGame && g.loversRevealed && g.lovers.includes(me.id)) mine.lover = g.lovers.find(id => id !== me.id);
  mine.charmed = me.inGame && g.charmedKnown.includes(me.id);
  // Like wolves and lovers, the charmed keep knowing each other (the ones
  // they have seen at night and who are still alive).
  if (mine.charmed) {
    mine.charmedWith = g.charmedKnown.filter(id => id !== me.id && findPlayer(s, id)?.alive);
  }
  if (me.inGame && me.role === 'piper') mine.charmedList = g.charmed;
  mine.wasThief = me.inGame && g.thiefId === me.id;
  // Only the players who lost a power are told (on their card).
  mine.powerless = me.inGame && g.powersLost && VILLAGE_POWERS.includes(me.role);
  if (meIsWolf) mine.wolves = s.players.filter(p => p.inGame && inPack(p) && p.id !== me.id).map(p => p.id);
  if (me.inGame && me.role === 'avenger') mine.avengerTarget = g.avengerTarget;

  // The choices appear once the narrator has finished calling the role.
  if (s.phase === 'NIGHT' && g.nightStage === 'act' && me.inGame && me.alive && stepHolders(s, activeRole).some(p => p.id === me.id)) {
    const n = g.night;
    const task = { role: activeRole, complete: n.complete, acked: !!n.acks[me.id] };
    if (g.powersLost && VILLAGE_POWERS.includes(activeRole)) task.powerless = true;
    if (activeRole === 'thief') { task.extras = g.thiefExtras; task.done = n.thiefDone; task.took = n.thiefTook ?? null; }
    if (activeRole === 'piper') { task.picks = n.piperPicks; task.charmed = g.charmed; }
    if (activeRole === 'cupid') task.picks = n.cupid;
    if (activeRole === 'guard') { task.pick = n.guard; task.lastGuarded = g.lastGuarded; }
    if (activeRole === 'hunter') { task.aim = n.hunterAim; task.lastAim = g.hunterAim; }
    if (activeRole === 'werewolf') { task.votes = n.wolfVotes; task.targets = n.wolfTargets; task.kills = n.wolfKills; task.noKill = n.wolfNoKill; }
    if (activeRole === 'priest') { task.used = g.priestUsed; task.pick = n.holy; }
    if (activeRole === 'medium') {
      task.used = g.mediumUsed;
      task.pick = n.revive;
      task.dead = s.players.filter(p => p.inGame && !p.alive).map(p => p.id);
    }
    if (activeRole === 'avenger') { task.aim = n.avengerAim; task.lastAim = g.avengerTarget; }
    if (activeRole === 'detective') { task.picks = n.detectivePicks; task.result = n.detectiveResult; }
    if (activeRole === 'seer') { task.target = n.seerTarget; task.result = n.seerResult; }
    if (activeRole === 'witch') {
      // One bottle per night: using one locks the other until tomorrow.
      task.healAvailable = g.potions.heal && !n.poison;
      task.poisonAvailable = g.potions.poison && !n.heal;
      task.healed = n.heal;
      task.poisoned = n.poison;
    }
    mine.task = task;
  }

  // A moderator who does not play sees the whole night, like a real game master.
  if (moderator && s.phase === 'NIGHT') {
    const n = g.night;
    mine.moderatorNight = {
      thiefTook: n.thiefTook ?? null,
      thiefExtras: g.thiefExtras,
      piperPicks: n.piperPicks,
      charmed: g.charmed,
      elderShield: g.elderShield,
      lovers: g.lovers,
      guard: n.guard,
      hunterAim: n.hunterAim || g.hunterAim,
      wolfTargets: n.wolfTargets,
      wolfKills: n.wolfKills,
      wolfVotes: n.wolfVotes,
      holy: n.holy,
      revive: n.revive,
      avengerAim: n.avengerAim || g.avengerTarget,
      detectivePicks: n.detectivePicks,
      detectiveResult: n.detectiveResult,
      seerTarget: n.seerTarget,
      heal: n.heal,
      poison: n.poison
    };
  }

  view.me = mine;
  return view;
}
