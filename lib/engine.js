// Authoritative game engine. Pure functions over a plain JSON room state so it can
// be stored in Redis and unit-tested without any I/O.
//
// Every function takes `now` (ms) and `rng` explicitly; nothing reads the clock.

import {
  ROLES, NIGHT_STEPS, MIN_PLAYERS, MAX_PLAYERS, PACK_ROLES,
  computeBalancedRoles, validateRoleCounts, emptyRoleCounts, cardsNeeded, totalRoles
} from '../public/shared/roles.js';
import { LINES, lineText, narrationMs, clipMs, pauseClip, PLAYBACK_LEAD_MS } from '../public/shared/voice-lines.js';
import { gameInfo } from '../public/shared/games.js';
import { GAMES } from './games/index.js';
import { makeArtifacts, ART_MIN_LEFT_MS, DRAFT_MS } from './artifacts.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

export const DEFAULT_CONFIG = {
  discussionTime: 120,
  voteTime: 30,
  defenseTime: 45,
  judgeTime: 20,
  nightPauseTime: 1,
  // Before the first night, players may offer to trade cards: a phase the
  // host turns on or off, and how long it lasts.
  swapEnabled: true,
  swapTime: 20,
  // How long everyone looks at their card before the first night falls.
  revealTime: 10,
  // Action time for each night step, in seconds: 15 s for every role (at
  // least 5 s when the host changes it). The pack gets 5 s more for every
  // wolf card beyond the first. A player who needs longer taps "Thêm 5 giây"
  // (see EXTEND_MS).
  ...Object.fromEntries(NIGHT_STEPS.map(st => [`step_${st.id}`, 15])),
  hostPlays: true,
  revealRoleOnDeath: false,
  // No Thần Tình Yêu card: the game pairs two players at random as the first
  // night falls, and they find each other on their cards as usual.
  autoLovers: false,
  // Ultimate Werewolf: Artifacts: one face-down Artifact card for everyone.
  artifacts: false,
  // With the Artifacts: also the homebrew counter cards (Sword, Vial...).
  artifactsHomebrew: true
};

// Rooms saved before a setting existed fall back to its default.
const conf = (s, key) => s.config[key] ?? DEFAULT_CONFIG[key];

const CONFIG_LIMITS = {
  discussionTime: [30, 600],
  voteTime: [10, 120],
  defenseTime: [10, 180],
  judgeTime: [10, 90],
  nightPauseTime: [0, 5],
  swapTime: [5, 60],
  revealTime: [5, 60],
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
// Enough for a long game; the oldest lines go first beyond that.
const LOG_LIMIT = 400;

// The host's phone checks in every few seconds; after this long without a
// sign of life the other players may vote for a new host phone.
export const HOST_TIMEOUT_MS = 12000;
// Other players only check in every ~15 s, so "online" is looser for them.
const PLAYER_ONLINE_MS = 45000;
// A host vote closes this long after the first ballot, even if not everyone voted.
export const HOST_VOTE_MS = 20000;

// Village roles that lose their power if the villagers kill their own Elder.
const VILLAGE_POWERS = ['seer', 'guard', 'witch', 'hunter', 'priest', 'medium', 'detective',
  'aura_seer', 'pi', 'blesser', 'martyr', 'spellcaster', 'old_hag', 'troublemaker'];
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

// Default random source: the operating system's cryptographic generator,
// so the deal, ties and session tokens cannot be predicted. Uniform in [0, 1)
// with 53 bits of precision.
export function secureRandom() {
  const [hi, lo] = globalThis.crypto.getRandomValues(new Uint32Array(2));
  return ((hi >>> 5) * 67108864 + (lo >>> 6)) / 9007199254740992;
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
// The game being played in this room: null for Ma Sói (this file), else the
// module from ./games that runs it.
const gameOf = (s) => (s.gameId && s.gameId !== 'werewolf' ? GAMES[s.gameId] : null);
// Only Ma Sói has a host who may just narrate; in the other games all play.
const wolfParticipant = (s, p) => !(p.id === s.hostId && !s.config.hostPlays);
const isParticipant = (s, p) => (gameOf(s) ? true : wolfParticipant(s, p));
export const lobbyParticipants = (s) => s.players.filter(p => isParticipant(s, p));
const alivePlayers = (s) => s.players.filter(p => p.inGame && p.alive);
const aliveWithRole = (s, role) => alivePlayers(s).filter(p => p.role === role);
// The Wolf Cub and the Avenger belong to the pack: they wake, vote and are
// seen with the wolves.
const inPack = (p) => PACK_ROLES.includes(p?.role) || !!p?.clawed;
const allPackCards = (cards) => cards.length > 0 && cards.every(r => PACK_ROLES.includes(r));
const alivePack = (s) => alivePlayers(s).filter(inPack);
// A player who took the Claw of the Werewolf (or was bitten wearing the
// Skimmer) is on the pack's side, whatever their card.
const teamOf = (s, p) => (p.clawed ? 'werewolf' : ROLES[p.role].team);
// The card that counts for what seers learn: a Drunk who has not sobered up
// yet is seen as their real role.
const trueRole = (p) => (p.drunkRole && !p.sober ? p.drunkRole : p.role);
// What the Seer and the Nhà Ngoại Cảm read as a wolf: the pack, and the
// Người Lai Sói. The Tay Sai and the Pháp Sư Hắc Ám read as villagers.
const looksLikeWolf = (p) => PACK_ROLES.includes(trueRole(p)) || trueRole(p) === 'lycan';
// What the Tiên Tri learns: on the village side or not, by the card. The
// third side, the Tay Sai and the Pháp Sư Hắc Ám are not; the Người Lai Sói
// reads as not, like a wolf.
const seenAsVillager = (p) => ROLES[trueRole(p)]?.team === 'village' && trueRole(p) !== 'lycan';
// "Special" for the Tiên Tri Hào Quang: anything but a plain Villager or Werewolf.
const isSpecial = (p) => !['villager', 'werewolf'].includes(trueRole(p));
// Living players in seat order, and the ones on either side of a player.
function seatNeighbours(s, id) {
  const ring = alivePlayers(s).sort((a, b) => a.seat - b.seat);
  // (Only asked about a living player, with others still alive.)
  const i = ring.findIndex(p => p.id === id);
  return [...new Set([ring[(i - 1 + ring.length) % ring.length], ring[(i + 1) % ring.length]])].filter(p => p.id !== id);
}

// Re-deal the suggested deck for the current table. "auto" uses the default
// roles for the player count; "pick" the roles the host chose. Either way
// the number of Werewolves and Villagers follows the role points. "manual"
// is left alone.
// The deck never balances itself: the host picks every card. It follows the
// room only through Dân Làng cards, one added for each player who joins and
// one taken away for each who leaves (while there is one to take).
function rebalance(s) {
  const n = s.players.filter(p => wolfParticipant(s, p)).length;
  const before = s.deckPlayers;
  s.deckPlayers = n;
  if (n !== before) s.roleCounts.villager = Math.max(0, (s.roleCounts.villager || 0) + n - before);
}

function renumberSeats(s) {
  lobbyParticipants(s).forEach((p, i) => { p.seat = i + 1; });
  s.players.filter(p => !isParticipant(s, p)).forEach(p => { p.seat = null; });
}

// The game log, in the order things happened.
function log(s, text) {
  s.game.log.push(text);
  if (s.game.log.length > LOG_LIMIT) s.game.log.splice(0, s.game.log.length - LOG_LIMIT);
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
    const v = Math.floor(rng() * LINES[k].length);
    return { k, v, t: lineText(k, v) };
  });
  let n = s.narration;
  if (n && n.at === now) {
    n.clips.push(...clips);
  } else {
    n = s.narration = { seq: (n?.seq || 0) + 1, at: now, clips };
  }
  n.endsAt = n.at + narrationMs(n.clips) + SPEECH_SLACK_MS;
  const g = s.game;
  if (g.phaseEndsAt != null) {
    g.phaseEndsAt = Math.max(g.phaseEndsAt, n.endsAt + g.afterSpeechMs);
  }
}

const speechEndsAt = (s) => s.narration?.endsAt ?? 0;

const seatKey = (s, id) => `seat_${findPlayer(s, id).seat}`;

const bySeat = (s, deaths) =>
  [...deaths].sort((a, b) => findPlayer(s, a.id).seat - findPlayer(s, b.id).seat);

function seatList(s, ids) {
  const keys = [];
  ids.forEach((id, i) => {
    if (i > 0) keys.push('and');
    keys.push(seatKey(s, id));
  });
  return keys;
}

// Players are named without their seat number in the log.
const nameOf = (s, id) => findPlayer(s, id).name;

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
  g.phaseEndsAt = Math.min(g.phaseEndsAt, target);
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
    // One-off death effects already spent: a player brought back by the
    // Medium does not get them again (like the potions, holy water…).
    hunterFired: false,
    avengerFired: false,
    cubSpent: false,
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
    log: [],
    // Each player's own night notes: what they did and what they learned.
    notes: {},
    // Ultimate Werewolf roles.
    piUsed: false,          // Nhà Ngoại Cảm: one reading per game
    blessUsed: false,       // Thầy Tu: one blessing per game...
    blessed: null,          // ...on this player, until it saves them once
    martyrUsed: false,
    toughWounded: null,     // { id, day }: the Gã Cứng Cựa dies the night after
    wolvesSick: false,      // the pack ate the Người Bệnh: next bite kills nobody
    banished: null,         // Mụ Già: out of the village for the day
    muted: null,            // Pháp Sư Phong Ấn: silent for the day
    mutedEver: [],
    troubleUsed: false,
    doubleLynch: false,     // Kẻ Gây Rối: a second vote after today's first hanging
    secondVote: false,
    ghostLetter: null,
    doppelTarget: null,
    hoodlumMarks: [],
    princeRevealed: false,
    coWinners: [],
    // Ultimate Werewolf: Artifacts (lib/artifacts.js), null when not used.
    art: null
  };
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

// `gameId`: the game picked on the home page (the host can change it in the lobby).
export function createRoom({ code, hostName, now, rng = secureRandom, debug = false, gameId = 'werewolf' }) {
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
    // Which game the room plays next; each game keeps its own settings.
    gameId: 'werewolf',
    gameConfigs: {},
    config: { ...DEFAULT_CONFIG },
    roleCounts: emptyRoleCounts(),
    deckPlayers: 0,
    players: [host],
    game: freshGame(),
    narration: null
  };
  rebalance(s);
  const info = gameInfo(gameId);
  if (gameId !== 'werewolf' && info.id === gameId && info.ready) {
    s.gameId = gameId;
    renumberSeats(s);
  }
  return { state: s, player: host };
}

export function joinRoom(s, rawName, now, rng = secureRandom, { isBot = false } = {}) {
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
  rebalance(s);
  return player;
}

// A player whose phone lost its session (another browser, cleared data, a
// chat app's built-in browser) comes back by typing the same name. They get
// their seat and card back with a fresh token, which signs out the old phone.
// Only once that seat has gone quiet, so nobody takes over a player who is
// still connected.
function reclaimSeat(p, now, rng) {
  const idle = now - p.lastSeen;
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
  rebalance(s);
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
  if (s.phase === 'LOBBY') rebalance(s);
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
export function resolveHostVote(s, now, rng = secureRandom) {
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
  // (The first ballot started the clock.)
  const timeUp = now - s.hostVoteStartedAt >= HOST_VOTE_MS;
  if (!majority && !everyoneVoted && !timeUp) return false;
  const winner = findPlayer(s, leaders.length === 1 ? leaders[0] : pick(leaders, rng));
  // (Someone can only vote while the host is still in the room, just silent.)
  const old = findPlayer(s, s.hostId);
  transferHost(s, winner.id);
  const how = leaders.length > 1 ? ' (bốc thăm vì hoà phiếu)' : '';
  log(s, `📢 ${winner.name} trở thành máy chủ phòng mới thay cho ${old.name}${how}.`);
  return true;
}

// Tries for a shuffled deal this many times before settling for the best one.
const DEAL_TRIES = 2000;

// What counts as "the same card again": every wolf card is one family (a
// Werewolf last game should not be a Wolf Cub this game), every other role is
// its own.
const roleFamily = (role) => (PACK_ROLES.includes(role) ? 'wolf' : role);
// How bad a repeat is: playing the pack twice in a row is what players notice
// most, then a special role; another Villager card hardly matters.
const repeatCost = (family) => (family === 'wolf' ? 100 : family === 'villager' ? 1 : 10);

// Everything a player was last game, kept when the room goes back to the
// lobby: the card they were dealt, the one they ended with (the Thief's pick,
// a bitten Sói Nguyền, a Kẻ Song Trùng's copy, an Artifact's new role), a Kẻ
// Say's real role, and the pack for anyone who joined it through an Artifact.
function rememberRoles(p) {
  const held = [p.dealtRole, p.role, p.drunkRole, p.clawed ? 'werewolf' : null].filter(Boolean);
  p.lastFamilies = [...new Set(held.map(roleFamily))];
}

// Deals the cards uniformly at random, never giving anyone a card of a family
// they held last game. Redrawing whole shuffles until no one repeats keeps
// every allowed deal equally likely. When that is impossible (say 3 Villager
// cards among 4 players) the deal with the lowest cost of repeats seen wins,
// so a Villager card comes back before a wolf card does.
function dealCards(players, cards, rng) {
  let best = null;
  for (let i = 0; i < DEAL_TRIES; i++) {
    const deck = shuffle(cards, rng);
    const cost = players.reduce((sum, p, k) => {
      const f = roleFamily(deck[k]);
      return sum + ((p.lastFamilies || []).includes(f) ? repeatCost(f) : 0);
    }, 0);
    if (!best || cost < best.cost) best = { deck, cost };
    if (!cost) break;
  }
  return {
    hands: new Map(players.map((p, k) => [p.id, best.deck[k]])),
    spare: best.deck.slice(players.length)
  };
}

function startGame(s, now, rng) {
  const ps = lobbyParticipants(s);
  if (ps.length < MIN_PLAYERS) fail(`Cần ít nhất ${MIN_PLAYERS} người chơi để bắt đầu.`);
  if (ps.length > MAX_PLAYERS) fail(`Tối đa ${MAX_PLAYERS} người chơi.`);
  rebalance(s);
  const problem = validateRoleCounts(s.roleCounts, ps.length);
  if (problem) fail(problem);

  const { hands, spare } = dealCards(ps, Object.entries(s.roleCounts).flatMap(([id, n]) => Array(n).fill(id)), rng);
  s.players.forEach(p => {
    p.inGame = isParticipant(s, p);
    p.role = p.inGame ? hands.get(p.id) : null;
    p.dealtRole = p.role;
    p.alive = p.inGame;
    delete p.deathCause;
    delete p.turned;
    delete p.swapped;
    delete p.drunkRole;
    delete p.sober;
    delete p.revealed;
    delete p.copied;
    delete p.clawed;
    delete p.diedDay;
  });
  renumberSeats(s);

  s.game = freshGame();
  // Every card in the deck (including the Thief's two spare cards) counts as
  // "in play", so its night step is called and nobody learns what was dealt.
  s.game.rolesInPlay = Object.keys(s.roleCounts).filter(id => s.roleCounts[id] > 0);
  s.game.thiefExtras = spare;
  s.game.thiefId = s.players.find(p => p.inGame && p.role === 'thief')?.id || null;
  s.players.forEach(p => settleDrunk(p, rng));
  if (conf(s, 'artifacts')) A.deal(s, rng, { homebrew: conf(s, 'artifactsHomebrew') });
  s.narration = null;
  log(s, `Ván chơi bắt đầu với ${ps.length} người. Mỗi người hãy xem lá bài của mình.`);
  say(s, now, rng, 'game_start', pauseClip(OPENING_PAUSE_MS));
  // Players look at their card and may offer to trade it (SWAP), then
  // everyone looks at the card they end up with while the narrator counts
  // ten seconds (REVEAL), then the first night falls.
  const swapMs = conf(s, 'swapTime') * 1000;
  if (conf(s, 'swapEnabled') && swapMs > 0) {
    s.game.swap = { pool: [] };
    setPhase(s, 'SWAP', now, swapMs);
  } else {
    beginReveal(s, now, rng);
  }
}


function beginReveal(s, now, rng) {
  // With the Artifacts, everyone first keeps one of their two cards.
  if (A.draftOpen(s)) {
    setPhase(s, 'ARTPICK', now, DRAFT_MS);
    return;
  }
  // "Quản trò tự ghép đôi": the couple is made once the cards are final
  // (after any swap), so they find each other while looking at their card.
  if (conf(s, 'autoLovers') && !s.game.lovers.length) pairLovers(s, rng);
  // The narrator says "ten seconds" only when it is ten seconds.
  const secs = conf(s, 'revealTime');
  say(s, now, rng, secs === 10 ? 'game_soon' : 'game_soon_any');
  setPhase(s, 'REVEAL', now, secs * 1000, { window: true });
}

// ---------------------------------------------------------------------------
// Card swap, before the first night
// ---------------------------------------------------------------------------
// One button: "Trao đổi vai". Pressing it puts your card in a shared pool;
// everyone only sees how many cards are in it, never whose. When time is
// up the cards in the pool are dealt again among those players at random,
// each getting someone else's card. A lone card in the pool stays put.
// Nobody is told who got theirs.

function resolveSwaps(s, rng) {
  const g = s.game;
  const ids = g.swap.pool;
  g.swap = null;
  if (ids.length < 2) {
    ids.forEach(id => addNote(s, id, '🔄 Trao đổi vai: không có ai khác tham gia, bạn giữ nguyên lá bài.'));
    return;
  }
  const players = ids.map(id => findPlayer(s, id));
  const cards = players.map(p => ({ role: p.role, drunkRole: p.drunkRole }));
  // Redraw until nobody gets their own card back: every such deal is
  // equally likely.
  let order;
  do order = shuffle(cards.map((_, i) => i), rng);
  while (order.some((from, to) => from === to));
  log(s, `🔄 Trao đổi vai giữa ${players.map(p => `${p.name} (${ROLES[p.role].name})`).join(', ')}`);
  players.forEach((p, to) => {
    const card = cards[order[to]];
    p.role = card.role;
    // A Kẻ Say card keeps its hidden role when it changes hands.
    p.drunkRole = card.drunkRole;
    p.swapped = true;
    addNote(s, p.id, `🔄 Trao đổi vai: bạn đã nhận lá bài của một người chơi khác. Giờ bạn là ${ROLES[p.role].name}.`);
  });
  log(s, `🔄 Sau khi trao đổi: ${players.map(p => `${p.name} → ${ROLES[p.role].name}`).join(', ')}`);
  g.thiefId = s.players.find(p => p.inGame && p.role === 'thief')?.id || null;
}

function backToLobby(s) {
  s.phase = 'LOBBY';
  s.players.forEach(p => {
    // Only a Ma Sói game deals role cards to remember.
    if (p.inGame && p.role) rememberRoles(p);
    p.role = null;
    p.alive = true;
    p.inGame = false;
    delete p.deathCause;
    delete p.turned;
    delete p.clawed;
  });
  s.game = freshGame();
  s.play = null;
  s.narration = null;
  renumberSeats(s);
  rebalance(s);
}

// ---------------------------------------------------------------------------
// The other games (./games): what they may use from the room.
// ---------------------------------------------------------------------------

const gameApi = {
  fail,
  pick,
  shuffle,
  log,
  setPhase,
  finishEarly,
  nameOf: (s, id) => nameOf(s, id),
  // One finished game on the room's leaderboard for that game: rows of
  // { player, side, won }.
  record(s, gameId, winnerSide, rows) {
    const stats = statsFor(s, gameId);
    stats.games += 1;
    stats.sideWins[winnerSide] = (stats.sideWins[winnerSide] || 0) + 1;
    rows.forEach(({ player: p, side, won }) => {
      const row = stats.players[p.id] ||= { name: p.name, isBot: !!p.isBot, played: 0, wins: 0, sides: {} };
      row.name = p.name;
      const sd = row.sides[side] ||= { played: 0, wins: 0 };
      row.played += 1;
      sd.played += 1;
      if (won) { row.wins += 1; sd.wins += 1; }
    });
  }
};

const emptyStats = () => ({ games: 0, sideWins: {}, players: {} });
// Each of the other games has its own leaderboard (Ma Sói keeps the one it
// always had in s.stats, see recordStats).
function statsFor(s, gameId) {
  return ((s.statsByGame ||= {})[gameId] ||= emptyStats());
}

const gameConfig = (s, gameId) => ({ ...GAMES[gameId].defaults, ...s.gameConfigs[gameId] });

function startOtherGame(s, G, now, rng) {
  const players = lobbyParticipants(s);
  const info = gameInfo(G.id);
  if (players.length < info.min) fail(`${info.name} cần ít nhất ${info.min} người chơi.`);
  if (players.length > info.max) fail(`${info.name} chơi tối đa ${info.max} người.`);
  s.game = freshGame();
  s.narration = null;
  s.players.forEach(p => { p.inGame = players.includes(p); p.alive = true; p.role = null; });
  G.start(s, now, rng, gameApi);
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
    // The one the Mụ Già sent away is out of the village for the day: the
    // Thợ Săn's shot and the Sói Báo Thù's revenge cannot reach them.
    if (s.game.banished === p.id && s.phase !== 'NIGHT' && ['hunter', 'avenger'].includes(d.cause)) {
      log(s, `🧙‍♀️ ${nameOf(s, p.id)} không có mặt trong làng hôm nay nên thoát chết (${DEATH_CAUSE[d.cause]})`);
      continue;
    }
    // Artifacts that keep a player in the game: the Amulet, the Cloak by
    // day, the Shield tonight.
    const shield = A.shielded(s, p, d.cause);
    if (shield) {
      log(s, `🗝️ ${nameOf(s, p.id)} không bị loại (${DEATH_CAUSE[d.cause] || d.cause}): ${shield}`);
      continue;
    }
    // The Thầy Tu's blessing stops the first attempt on this life, whatever it
    // is; leaving as the Hồn Ma or dying of old age are not attacks.
    if (s.game.blessed === p.id && !['ghost', 'age'].includes(d.cause)) {
      s.game.blessed = null;
      log(s, `📿 ${nameOf(s, p.id)} được Thầy Tu ban phước nên không chết (${DEATH_CAUSE[d.cause] || d.cause})`);
      continue;
    }
    // The Rod of Reincarnation and the Scepter of Rebirth turn over by themselves.
    if (A.savedOnDeath(s, p, d.cause, secureRandom)) continue;
    // Whether the role's power still works as they die (Artifacts may take it).
    const power = A.hasPower(s, p);
    p.alive = false;
    p.deathCause = d.cause;
    died.push(d);
    A.onDeath(s, p);
    // Eating the Người Bệnh (or whoever the Blood of the Diseased infected)
    // makes the pack sick: their next bite kills nobody.
    if (d.cause === 'wolf' && ((p.role === 'diseased' && !s.game.powersLost && power) || A.infected(s, p.id))) s.game.wolvesSick = true;
    // The Kẻ Song Trùng secretly takes over the role of the one they chose.
    const dop = s.game.doppelTarget === p.id && s.players.find(x => x.inGame && x.alive && x.role === 'doppelganger' && A.hasPower(s, x));
    if (dop) {
      dop.role = p.role;
      dop.copied = true;
      // A copied Kẻ Say card comes with its hidden role.
      if (p.drunkRole) { dop.drunkRole = p.drunkRole; dop.sober = p.sober; }
      s.game.doppelTarget = null;
      addNote(s, dop.id, `🎭 ${p.name} đã chết: giờ bạn mang vai ${ROLES[p.role].name}.`);
      log(s, `🎭 Kẻ Song Trùng ${nameOf(s, dop.id)} nhận vai ${ROLES[p.role].name} của ${nameOf(s, p.id)}`);
    }
    // The Tiên Tri Tập Sự takes over when the Seer dies.
    if (p.role === 'seer') {
      s.players.filter(x => x.inGame && x.alive && x.role === 'apprentice_seer')
        .forEach(x => addNote(s, x.id, '🔭 Tiên Tri đã chết: từ đêm nay bạn được gọi dậy để soi thay.'));
    }
    // The hunter's gun goes off whatever killed them, taking whoever they
    // aimed at last night.
    const aim = s.game.hunterAim;
    if (p.role === 'hunter' && aim && aim !== p.id && !s.game.powersLost && !s.game.hunterFired && power) {
      s.game.hunterFired = true;
      queue.push({ id: aim, cause: 'hunter' });
    }
    // Classic Elder rule: if the village itself kills the Elder (hanging, the
    // witch's poison or the hunter's gun), every villager loses their power.
    if (p.role === 'elder' && ['lynch', 'poison', 'hunter'].includes(d.cause) && !s.game.powersLost) {
      s.game.powersLost = true;
      log(s, `👴 Già Làng ${nameOf(s, p.id)} chết dưới tay dân làng: phe Dân mất chức năng`);
    }
    // The Avenger, hanged by the village, takes their chosen target along.
    const mark = s.game.avengerTarget;
    if (p.role === 'avenger' && d.cause === 'lynch' && mark && mark !== p.id && !s.game.avengerFired && power) {
      s.game.avengerFired = true;
      queue.push({ id: mark, cause: 'avenger' });
    }
    // A dead Wolf Cub lets the pack bite twice the following night (once a
    // game, even if the cub is brought back and dies again).
    if (p.role === 'wolf_cub' && !s.game.cubSpent && power) {
      s.game.cubSpent = true;
      s.game.cubRevenge = true;
    }
    const lovers = s.game.lovers;
    if (lovers.length === 2 && lovers.includes(p.id)) {
      queue.push({ id: lovers.find(x => x !== p.id), cause: 'heartbreak' });
    }
  }
  return died;
}

// Lovers from different sides, both alive, are a side of their own
// (Ultimate Werewolf rules). Returns their ids, or [] if there is no such couple.
function crossCouple(s) {
  const [a, b] = s.game.lovers.map(id => findPlayer(s, id));
  return a && b && a.alive && b.alive && teamOf(s, a) !== teamOf(s, b) ? [a.id, b.id] : [];
}

export function checkWin(s) {
  const alive = alivePlayers(s);
  // A cross-side couple: a wolf in love no longer counts with the pack, and
  // the village has not won while the couple lives.
  const couple = crossCouple(s);
  if (couple.length && alive.length === 2) {
    return { winner: 'lovers', reason: 'Cặp Tình Nhân khác phe là hai người cuối cùng còn sống.' };
  }
  // The pack against everyone else; the Tay Sai and the Pháp Sư Hắc Ám
  // help the wolves but are not wolves themselves.
  const pack = alive.filter(p => inPack(p) && !couple.includes(p.id));
  const wolves = pack.length;
  const others = alive.length - wolves;
  const piper = alive.find(p => p.role === 'piper');
  if (piper && alive.every(p => p.id === piper.id || s.game.charmed.includes(p.id))) {
    return { winner: 'piper', reason: 'Mọi người còn sống đều đã bị tiếng sáo thôi miên.' };
  }
  if (wolves === 0 && !piper && !couple.length) return { winner: 'village', reason: 'Tất cả Ma Sói đã bị tiêu diệt.' };
  if (wolves > 0 && wolves >= others) {
    // The Sói Đơn Độc only wins as the last wolf standing.
    if (wolves === 1 && pack[0].role === 'lone_wolf') {
      return { winner: 'lone_wolf', reason: 'Sói Đơn Độc là con Sói cuối cùng và đã áp đảo dân làng.' };
    }
    return { winner: 'werewolf', reason: `Số Sói (${wolves}) đã bằng hoặc nhiều hơn số người còn lại (${others}).` };
  }
  return null;
}

function finishGame(s, win, now, rng) {
  setPhase(s, 'GAME_OVER', now, null);
  s.game.winner = win.winner;
  s.game.winReason = win.reason;
  const g = s.game;
  // Wins that come on top of the main one, and a wolf who loses with the pack's win.
  const hoodlum = s.players.find(p => p.inGame && p.alive && p.role === 'hoodlum');
  // The Kẻ Côn Đồ needs the village to win too (Ultimate Werewolf rules).
  if (win.winner === 'village' && hoodlum && g.hoodlumMarks.length === 2 && g.hoodlumMarks.every(id => !findPlayer(s, id)?.alive)) {
    g.coWinners.push('hoodlum');
    g.winReason += ' Kẻ Côn Đồ cũng thắng: cả hai mục tiêu đã chết.';
  }
  if (win.winner === 'werewolf' && s.players.some(p => p.inGame && p.role === 'lone_wolf')) {
    g.winReason += ' Riêng Sói Đơn Độc thì thua.';
  }
  recordStats(s, win.winner);
  const label = { village: 'PHE DÂN LÀNG', werewolf: 'PHE MA SÓI', lovers: 'CẶP TÌNH NHÂN', piper: 'NGƯỜI THỔI SÁO', fool: 'KẺ CUỒNG LOẠN', lone_wolf: 'SÓI ĐƠN ĐỘC' }[win.winner];
  log(s, `🏆 ${label} CHIẾN THẮNG! ${g.winReason}`);
  say(s, now, rng, `win_${win.winner}`);
}

// The side a player ended the game on, for the room's leaderboard: the card
// they hold at the end (a turned Sói Nguyền is a Werewolf by then).
export function sideOf(role) {
  const team = ROLES[role]?.team;
  return team === 'village' || team === 'werewolf' ? team : 'third';
}

// Whether a player is among the winners of a finished game.
// A player who joined the pack through an Artifact plays for the wolves.
const playerSide = (p) => (p.clawed ? 'werewolf' : sideOf(p.role));

export function isWinner(s, p) {
  const g = s.game;
  if (g.coWinners.includes(p.role) && !p.clawed) return true;
  switch (g.winner) {
    case 'lovers': return g.lovers.includes(p.id);
    case 'village': return playerSide(p) === 'village';
    // A wolf in love with a villager no longer counts with the pack, and the
    // Sói Đơn Độc loses when the pack wins.
    case 'werewolf': return playerSide(p) === 'werewolf' && p.role !== 'lone_wolf' && !crossCouple(s).includes(p.id);
    default: return p.role === g.winner;
  }
}

// Wins and games per player across the games played in this room, by side.
function recordStats(s, winner) {
  const stats = s.stats ||= { games: 0, sideWins: {}, players: {} };
  stats.games += 1;
  const side = { lovers: 'third', piper: 'third', fool: 'third', lone_wolf: 'werewolf' }[winner] || winner;
  stats.sideWins[side] = (stats.sideWins[side] || 0) + 1;
  s.players.filter(p => p.inGame).forEach(p => {
    const row = stats.players[p.id] ||= { name: p.name, isBot: !!p.isBot, played: 0, wins: 0, sides: {} };
    row.name = p.name;
    const sd = row.sides[playerSide(p)] ||= { played: 0, wins: 0 };
    const won = isWinner(s, p);
    row.played += 1;
    sd.played += 1;
    if (won) { row.wins += 1; sd.wins += 1; }
  });
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
    // Ultimate Werewolf roles
    sick: g.wolvesSick,
    martyrFor: null,
    auraTarget: null,
    auraResult: null,
    piTarget: null,
    piResult: null,
    sorcererTarget: null,
    sorcererResult: null,
    bless: null,
    ghostLetter: null,
    mute: null,
    banish: null,
    trouble: false,
    hoodlum: [],
    doppel: null,
    complete: false
  };
  g.cubRevenge = false;
  g.wolvesSick = false;
  // Yesterday's banishment and silence are over; an unused second vote too.
  g.banished = null;
  g.muted = null;
  g.doubleLynch = false;
  g.secondVote = false;
  g.voteRound = 1;
  g.ghostLetter = null;
  // Whether the dead may watch tonight is settled now, as the night starts,
  // and holds all night. A Thầy Đồng using the power tonight does not open
  // it: the one being brought back is still dead until morning and would
  // come back knowing everything. It opens the next night at the earliest.
  g.watchOpen = !revivalPossible(s);
  // The Kẻ Say sobers up on the third night and learns their real card.
  if (g.day === 3) {
    s.players.filter(p => p.inGame && p.drunkRole && !p.sober).forEach(p => {
      p.sober = true;
      p.role = p.drunkRole;
      addNote(s, p.id, `🍺 Bạn đã tỉnh rượu: vai thật của bạn là ${ROLES[p.role].name}.`);
      log(s, `🍺 Kẻ Say ${nameOf(s, p.id)} tỉnh rượu: vai thật là ${ROLES[p.role].name}`);
    });
  }
  g.votes = {};
  g.defendant = null;
  g.judge = {};
  g.verdict = null;
  // Roles are called even when their holders are dead so the night sounds the
  // same either way and nobody learns who is still alive.
  g.queue = NIGHT_STEPS
    .filter(step => [step.role, ...(step.also || [])].some(r => g.rolesInPlay.includes(r)))
    .filter(step => !step.firstNightOnly || g.day === 1)
    // The Medium is only called while there is someone to bring back and the
    // power is unused. Both are public (deaths are announced, and so is a
    // return), so skipping the call gives nothing away.
    .filter(step => step.id !== 'medium' || (!g.mediumUsed && s.players.some(p => p.inGame && !p.alive && p.role !== 'ghost')))
    .map(step => step.id);
  g.step = 0;
  g.wakeQueued = null;
  log(s, `🌙 Đêm ${g.day} buông xuống.`);
  say(s, now, rng, 'night_start', pauseClip(OPENING_PAUSE_MS));
  startNightStep(s, now, rng);
}

// "Quản trò tự ghép đôi": the game makes the couple at the card reveal, after
// the swap, so the pair is made from the cards as they will be played. The kind of couple is
// drawn first, 4-3-3: two players from different sides (who become a side of
// their own) 40%, two villagers 30%, two wolves 30%. A kind the table cannot
// make is left out and the others share its chance. Then a pair of that kind
// is drawn evenly.
const LOVER_ODDS = { cross: 4, village: 3, werewolf: 3 };
function pairLovers(s, rng) {
  const g = s.game;
  const players = s.players.filter(p => p.inGame);
  const kinds = { cross: [], village: [], werewolf: [] };
  players.forEach((a, i) => players.slice(i + 1).forEach(b => {
    const ta = teamOf(s, a);
    // (Each third-side card is unique, so a same-side pair is village or pack.)
    kinds[ta === teamOf(s, b) ? ta : 'cross'].push([a, b]);
  }));
  // (From 4 players there is always a pair of some kind.)
  const open = Object.keys(kinds).filter(k => kinds[k].length);
  let roll = rng() * open.reduce((sum, k) => sum + LOVER_ODDS[k], 0);
  const kind = open.find(k => (roll -= LOVER_ODDS[k]) < 0);
  const pairs = kinds[kind];
  const [a, b] = shuffle(pairs[Math.floor(rng() * pairs.length)], rng);
  g.lovers = [a.id, b.id];
  g.loversRevealed = true;
  addNote(s, a.id, `💘 Quản trò đã ghép bạn và ${b.name} thành Tình Nhân.`);
  addNote(s, b.id, `💘 Quản trò đã ghép bạn và ${a.name} thành Tình Nhân.`);
  log(s, `💘 Quản trò ghép ${nameOf(s, a.id)} và ${nameOf(s, b.id)} thành Tình Nhân`);
}

// Who opens their eyes during a night step. A player whose role lost its
// power to an Artifact (Brand, Flask) stays asleep, wolves included.
export function stepHolders(s, step) {
  const holders = cardHolders(s, step);
  return A.on(s) ? holders.filter(p => A.hasPower(s, p)) : holders;
}

function cardHolders(s, step) {
  const g = s.game;
  if (step === 'thief') return alivePlayers(s).filter(p => p.id === g.thiefId);
  if (step === 'werewolf') return alivePack(s);
  // Once the Seer is dead, the Tiên Tri Tập Sự takes the turn.
  if (step === 'seer') {
    const seers = aliveWithRole(s, 'seer');
    if (seers.length) return seers;
    return s.players.some(p => p.inGame && p.role === 'seer' && !p.alive) ? aliveWithRole(s, 'apprentice_seer') : [];
  }
  // The Hồn Ma acts from beyond the grave.
  if (step === 'ghost') return s.players.filter(p => p.inGame && p.role === 'ghost');
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
  let secs = conf(s, `step_${step}`);
  if (step === 'werewolf') {
    const pack = PACK_ROLES.reduce((n, id) => n + (s.roleCounts[id] || 0), 0);
    secs += 5 * Math.max(0, pack - 1);
  }
  return secs * 1000;
}

// A night step never ends sooner than this after its choices appear, whether
// the role finished quickly or nobody holds it, so speed gives nothing away.
const MIN_ACT_MS = 5000;
// Time left to read a result (Seer, Detective, the Thief's new card) before
// the step moves on by itself.
const READ_RESULT_MS = 4000;
// A step nobody can play ends at a random moment in this window (capped by
// the role's own time): about as long as a real player takes to decide.
const IDLE_STEP_MAX_MS = 15000;
// "Thêm 5 giây": how much one tap adds, and the most time it can bank.
const EXTEND_MS = 5000;
const EXTEND_MAX_LEFT_MS = 15000;

function startNightAct(s, now, rng) {
  const g = s.game;
  g.nightStage = 'act';
  g.actStartedAt = now;
  let ms = stepTimeMs(s, g.queue[g.step]);
  // A step ends as soon as its role has done its part, and players who need
  // longer extend it. One nobody can play (its holder is dead, or the card is
  // a spare) must look the same, so it ends at a random moment between 5 and
  // 15 s, like a real player deciding (and maybe extending).
  if (!stepHolders(s, g.queue[g.step]).length) {
    ms = Math.round(MIN_ACT_MS + rng() * (IDLE_STEP_MAX_MS - MIN_ACT_MS));
  }
  setPhase(s, 'NIGHT', now, ms);
  // Who opened their eyes tonight, for the Diary of the Insomniac (the Eye
  // of the Beholder wakes with the Seer).
  const role = g.queue[g.step];
  A.markWoke(s, [...stepHolders(s, role), ...(role === 'seer' ? A.beholders(s) : [])].filter(p => p.alive).map(p => p.id));
  // Already done while being called (a quick tap): move on after the
  // minimum (the pack: after a look at what it agreed on).
  if (g.night.complete) finishStepSoon(s, now, g.queue[g.step] === 'werewolf' ? WOLF_AGREE_MS : 0);
}

// The role has done everything it can tonight: move on without waiting for
// the timer (after the minimum, and after time to read a result).
function finishStepSoon(s, now, readMs = 0) {
  const g = s.game;
  if (s.phase !== 'NIGHT' || g.nightStage !== 'act' || g.phaseEndsAt == null) return;
  const end = Math.max(now + readMs, g.actStartedAt + MIN_ACT_MS);
  // A result always gets its reading time, even past the step's own time.
  g.phaseEndsAt = readMs ? end : Math.min(g.phaseEndsAt, end);
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
  if (role === 'werewolf') {
    // "Nobody" counts as no vote: the victims are the most voted players
    // (ties drawn at random). Only if no wolf picked anyone is nobody bitten.
    const votes = Object.values(n.wolfVotes).flat().filter(id => id !== NO_KILL);
    n.wolfTargets = pluralityPicks(votes, n.wolfKills, rng);
    n.wolfNoKill = !n.wolfTargets.length;
  }
  if (role === 'avenger' && n.avengerAim) g.avengerTarget = n.avengerAim;
  // The Kẻ Song Trùng must pick (Ultimate Werewolf rules): out of time, the
  // game picks someone else at random.
  if (role === 'doppelganger' && !n.doppel) {
    const dop = s.players.find(p => p.inGame && p.alive && p.role === 'doppelganger');
    const options = s.players.filter(p => p.inGame && p.alive && p.id !== dop?.id);
    if (dop && options.length) {
      n.doppel = options[Math.floor(rng() * options.length)].id;
      n.doppelAuto = true;
      g.doppelTarget = n.doppel;
    }
  }
  if (role === 'thief' && !n.thiefDone && g.thiefId) {
    const thief = findPlayer(s, g.thiefId);
    // Two werewolf cards: the thief must take one.
    if (thief?.alive && allPackCards(g.thiefExtras)) {
      takeThiefCard(s, thief, Math.floor(rng() * g.thiefExtras.length));
    }
  }
  if (role === 'piper') {
    const fresh = n.piperPicks.filter(id => !g.charmed.includes(id));
    g.charmed.push(...fresh);
    g.charmedKnown = [...g.charmed]; // the charmed now see each other on their cards
    fresh.forEach(id => addNote(s, id, 'Bạn đã bị Người Thổi Sáo thôi miên. Xem ai cùng cảnh ngộ trên lá bài của bạn.'));
  }
  if (role === 'guard') g.lastGuarded = n.guard;
  if (role === 'hunter' && n.hunterAim) g.hunterAim = n.hunterAim;
  // The couple now see each other on their cards.
  if (role === 'cupid' && g.lovers.length === 2) {
    g.loversRevealed = true;
    const [a, b] = g.lovers;
    if (a !== b) {
      addNote(s, a, `💘 Bạn và ${findPlayer(s, b)?.name} đã thành Tình Nhân.`);
      addNote(s, b, `💘 Bạn và ${findPlayer(s, a)?.name} đã thành Tình Nhân.`);
    }
  }
  logNightStep(s, role);
  noteNightStep(s, role);
  // The Eye of the Beholder saw what the Seer chose.
  if (role === 'seer' && n.seerTarget) {
    const t = findPlayer(s, n.seerTarget);
    A.beholders(s).forEach(p => addNote(s, p.id, `👁️ Tiên Tri soi ${t.name}: ${A.isWolf(t) ? 'LÀ Sói 🐺' : 'không phải Sói'}.`));
  }
}

// One line in a player's own night notes.
function addNote(s, id, text) {
  (s.game.notes[id] ||= []).push({ night: s.game.day, text });
}

// Writes down, for the players who just acted, what they did and what they
// learned, so they can look back on it later. Only what they already saw on
// their phone (the Witch's heal stays blind).
function noteNightStep(s, role) {
  const g = s.game;
  const n = g.night;
  const name = (id) => nameOf(s, id);
  const names = (ids) => ids.map(name).join(' và ');
  if (g.powersLost && VILLAGE_POWERS.includes(role)) return;
  // Nobody awake for this step (dead, or a spare card): nothing to write.
  const holders = stepHolders(s, role);
  if (!holders.length) return;
  const text = {
    thief: () => n.thiefTook ? `Bạn đổi lấy lá ${ROLES[n.thiefTook].name}` : 'Bạn giữ nguyên lá Ăn Trộm',
    cupid: () => g.lovers.length === 2 ? `Bạn ghép đôi ${names(g.lovers)}` : 'Bạn chưa ghép đôi ai',
    guard: () => n.guard ? `Bạn bảo vệ ${name(n.guard)}` : 'Bạn không bảo vệ ai',
    werewolf: () => n.wolfTargets.length ? `Đàn Sói cắn ${names(n.wolfTargets)}` : 'Đàn Sói không cắn ai',
    avenger: () => g.avengerTarget ? `Người chết theo bạn: ${name(g.avengerTarget)}` : 'Bạn chưa chọn người chết theo',
    seer: () => n.seerTarget ? `Bạn soi ${name(n.seerTarget)}: ${n.seerResult === 'village' ? 'là Dân 🌾' : 'không phải Dân ⚠️'}` : 'Bạn không soi ai',
    detective: () => n.detectiveResult
      ? `Bạn điều tra ${names(n.detectivePicks)}: ${n.detectiveResult === 'same' ? 'cùng phe' : 'khác phe'}`
      : 'Bạn không điều tra ai',
    priest: () => n.holy ? `Bạn vẩy nước thánh vào ${name(n.holy)}` : null,
    witch: () => [n.heal ? 'Bạn dùng bình Cứu' : null, n.poison ? `Bạn đầu độc ${name(n.poison)}` : null].filter(Boolean).join(', ') || 'Bạn không dùng bình nào',
    medium: () => n.revive ? `Bạn hồi sinh ${name(n.revive)}` : null,
    piper: () => n.piperPicks.length ? `Bạn thôi miên ${names(n.piperPicks)}` : 'Bạn không thôi miên ai',
    hunter: () => g.hunterFired ? null : g.hunterAim ? `Súng chĩa vào ${name(g.hunterAim)}` : 'Bạn chưa chĩa súng vào ai',
    aura_seer: () => n.auraTarget ? `Bạn soi ${name(n.auraTarget)}: ${n.auraResult === 'special' ? 'có vai đặc biệt ✨' : 'Dân Làng hoặc Ma Sói thường'}` : 'Bạn không soi ai',
    pi: () => n.piTarget ? `Bạn dò quanh ${name(n.piTarget)}: ${n.piResult === 'wolf' ? 'CÓ Sói 🐺 (người đó hoặc người ngồi cạnh)' : 'không có Sói'}` : null,
    sorcerer: () => n.sorcererTarget ? `Bạn tìm Tiên Tri ở ${name(n.sorcererTarget)}: ${n.sorcererResult === 'seer' ? 'ĐÚNG là Tiên Tri 🔮' : 'không phải'}` : 'Bạn không chọn ai',
    blesser: () => n.bless ? `Bạn ban phước cho ${name(n.bless)}` : null,
    martyr: () => n.martyrFor ? `Bạn chết thay ${name(n.martyrFor)}` : null,
    spellcaster: () => n.mute ? `Bạn phong ấn ${name(n.mute)}` : null,
    old_hag: () => n.banish ? `Bạn đuổi ${name(n.banish)} khỏi làng` : null,
    // A living Kẻ Song Trùng always ends up with someone (picked for them if need be).
    doppelganger: () => `${n.doppelAuto ? 'Bạn không chọn kịp, quản trò chọn giúp: b' : 'B'}ạn theo bóng ${name(n.doppel)}`,
    hoodlum: () => g.hoodlumMarks.length === 2 ? `Hai mục tiêu của bạn: ${names(g.hoodlumMarks)}` : null,
    troublemaker: () => n.trouble ? 'Bạn gây rối: hôm sau làng treo cổ 2 lần' : null,
    ghost: () => n.ghostLetter ? `Bạn để lại chữ "${n.ghostLetter}"` : null
  }[role]?.();
  if (!text) return;
  for (const p of holders) addNote(s, p.id, text);
}

// Who holds a card, for the log: "Tiên Tri (Lan)".
function holderOf(s, role) {
  const ids = alivePlayers(s).filter(p => (role === 'werewolf' ? inPack(p) : p.role === role)).map(p => p.id);
  return ids.length ? ` (${ids.map(id => nameOf(s, id)).join(', ')})` : '';
}

// What each role did tonight. The log is private (a non-playing moderator,
// or the host after the game), so it can say everything.
function logNightStep(s, role) {
  if (role === 'werewolf') {
    const votes = packVotesText(s);
    if (votes) log(s, votes);
  }
  const text = nightStepText(s, role);
  if (text) log(s, text);
}

// Each wolf's pick, for the log and for those watching.
function packVotesText(s) {
  const n = s.game.night;
  const pack = s.players.filter(p => p.inGame && inPack(p) && p.alive);
  return pack.length ? `🐺 Phiếu Sói: ${pack.map(w => `${nameOf(s, w.id)} → ${wolfPickText(s, n.wolfVotes[w.id])}`).join('; ')}` : null;
}

// What a role did tonight, in one line (null if nothing yet).
function nightStepText(s, role) {
  const g = s.game;
  const n = g.night;
  const names = (ids) => ids.map(id => nameOf(s, id)).join(' và ');
  const by = (r) => `${ROLES[r].icon} ${ROLES[r].name}${holderOf(s, r)}`;
  const lines = {
    thief: n.thiefTook ? `${by('thief')} đổi lấy lá ${ROLES[n.thiefTook].name}` : n.thiefDone ? `${by('thief')} giữ nguyên lá bài` : null,
    cupid: g.lovers.length === 2 ? `${by('cupid')} ghép đôi ${names(g.lovers)}` : null,
    guard: n.guard ? `${by('guard')} bảo vệ ${nameOf(s, n.guard)}` : null,
    werewolf: n.wolfNoKill ? '🐺 Bầy Sói không cắn ai'
      : n.wolfTargets.length ? `🐺 Bầy Sói${holderOf(s, 'werewolf')} cắn ${names(n.wolfTargets)}` : null,
    avenger: n.avengerAim ? `${by('avenger')} chọn người chết theo: ${nameOf(s, n.avengerAim)}` : null,
    seer: n.seerTarget ? `${by('seer')} soi ${nameOf(s, n.seerTarget)}: ${n.seerResult === 'village' ? 'là Dân' : 'không phải Dân'}` : null,
    detective: n.detectiveResult ? `${by('detective')} điều tra ${names(n.detectivePicks)}: ${n.detectiveResult === 'same' ? 'cùng phe' : 'khác phe'}` : null,
    priest: n.holy ? `${by('priest')} vẩy nước thánh vào ${nameOf(s, n.holy)}` : null,
    witch: [n.heal ? `${by('witch')} dùng bình Cứu` : null, n.poison ? `${by('witch')} đầu độc ${nameOf(s, n.poison)}` : null].filter(Boolean).join('; ') || null,
    medium: n.revive ? `${by('medium')} hồi sinh ${nameOf(s, n.revive)}` : null,
    piper: n.piperPicks.length ? `${by('piper')} thôi miên ${names(n.piperPicks)}` : null,
    hunter: n.hunterAim ? `${by('hunter')} chĩa súng vào ${nameOf(s, n.hunterAim)}` : null,
    aura_seer: n.auraTarget ? `${by('aura_seer')} soi ${nameOf(s, n.auraTarget)}: ${n.auraResult === 'special' ? 'có vai đặc biệt' : 'vai thường'}` : null,
    pi: n.piTarget ? `${by('pi')} dò quanh ${nameOf(s, n.piTarget)}: ${n.piResult === 'wolf' ? 'có Sói' : 'không có Sói'}` : null,
    sorcerer: n.sorcererTarget ? `${by('sorcerer')} tìm Tiên Tri ở ${nameOf(s, n.sorcererTarget)}: ${n.sorcererResult === 'seer' ? 'đúng' : 'sai'}` : null,
    blesser: n.bless ? `${by('blesser')} ban phước cho ${nameOf(s, n.bless)}` : null,
    martyr: n.martyrFor ? `${by('martyr')} chết thay ${nameOf(s, n.martyrFor)}` : null,
    spellcaster: n.mute ? `${by('spellcaster')} phong ấn ${nameOf(s, n.mute)}` : null,
    old_hag: n.banish ? `${by('old_hag')} đuổi ${nameOf(s, n.banish)} khỏi làng` : null,
    doppelganger: n.doppel ? `${by('doppelganger')} theo bóng ${nameOf(s, n.doppel)}${n.doppelAuto ? ' (hết giờ, chọn ngẫu nhiên)' : ''}` : null,
    hoodlum: g.hoodlumMarks.length === 2 ? `${by('hoodlum')} chọn ${names(g.hoodlumMarks)}` : null,
    troublemaker: n.trouble ? `${by('troublemaker')} gây rối: hôm sau treo cổ 2 lần` : null,
    ghost: n.ghostLetter ? `👻 Hồn Ma để lại chữ "${n.ghostLetter}"` : null
  };
  return lines[role] || null;
}

// Someone can still come back while a living Thầy Đồng has the power: not
// used yet, and not lost with the Elder. (A Kẻ Song Trùng who chose the
// Thầy Đồng becomes one the moment the Thầy Đồng dies, so is covered.)
const revivalPossible = (s) => !s.game.mediumUsed && !s.game.powersLost
  && s.players.some(p => p.inGame && p.alive && p.role === 'medium');

// For those who watch the whole night (a moderator who does not play, and
// the dead once nobody can come back): what happened so far tonight, and
// what the role awake right now is doing.
function watchNight(s) {
  const g = s.game;
  const start = g.log.findLastIndex(l => l.startsWith('🌙 Đêm'));
  const role = g.queue[g.step];
  const info = role && ROLES[role];
  let live = null;
  if (info && g.nightStage !== 'sleep') {
    const holders = stepHolders(s, role);
    const who = holders.length ? holders.map(p => p.name).join(', ') : 'không ai (đã chết hoặc là lá dư)';
    const doing = role === 'werewolf' ? packVotesText(s) : nightStepText(s, role);
    live = `${info.icon} ${info.name} (${who}): ${doing || (holders.length ? 'đang chọn…' : 'chỉ gọi cho có')}`;
  }
  return { lines: g.log.slice(start + 1), live, thiefExtras: g.day === 1 ? g.thiefExtras : [] };
}

// Why someone died, for the private log.
const DEATH_CAUSE = {
  wolf: 'bị Sói cắn',
  poison: 'trúng độc',
  hunter: 'trúng súng Thợ Săn',
  heartbreak: 'chết theo người yêu',
  holy: 'trúng nước thánh',
  avenger: 'bị Sói Báo Thù kéo theo',
  lynch: 'bị treo cổ',
  wound: 'chết vì vết Sói cắn đêm trước',
  age: 'chết vì tuổi già',
  ghost: 'trở thành Hồn Ma',
  // Artifacts
  spear: 'trúng Giáo Cuồng Nộ',
  orb: 'đoán sai bằng Quả Cầu Phán Đoán',
  breath: 'hết Hơi Thở Ông Lão',
  sword: 'trúng Kiếm Công Lý',
  vial: 'trúng Lọ Độc',
  silver: 'trúng Cung Bạc'
};
const withCause = (s, deaths) => deaths.map(d => {
  const p = findPlayer(s, d.id);
  const why = d.cause === 'holy' && p.role === 'priest' ? 'Mục Sư vẩy nhầm người phe Dân' : DEATH_CAUSE[d.cause];
  return `${nameOf(s, d.id)} (${why})`;
}).join(', ');

// What a Kẻ Say really is, drawn when the card is dealt (or taken): a
// Werewolf, a Villager or a role with nothing to do at night, so no step is
// called for it before they sober up.
const DRUNK_ROLES = ['werewolf', 'villager', 'lycan', 'mayor', 'prince', 'tough_guy', 'diseased', 'idiot', 'pacifist', 'old_man'];
function settleDrunk(p, rng) {
  if (p.role === 'drunk' && !p.drunkRole) p.drunkRole = pick(DRUNK_ROLES, rng);
}

function takeThiefCard(s, thief, index) {
  const g = s.game;
  const taken = g.thiefExtras[index];
  g.thiefExtras[index] = 'thief';
  thief.role = taken;
  settleDrunk(thief, secureRandom);
  g.night.thiefDone = true;
  g.night.thiefTook = taken;
}

// A wolf's vote for biting nobody tonight.
const NO_KILL = 'none';

// The pack has decided once every living wolf picked the same thing: the
// same victims (as many as tonight allows), or nobody.
// The pack decides together. Every living wolf picks (a victim, or
// "nobody", which is worth no vote); the step only ends early once they
// agree: every wolf who picked someone picked the same victims. Then the
// pack has a few seconds to see the choice and change their mind; if one
// does, the agreement is off and the clock goes back to where it was. If
// time runs out first, the most voted victim is bitten (ties drawn).
const WOLF_AGREE_MS = 3000;

function packAgrees(s) {
  const n = s.game.night;
  const need = Math.min(n.wolfKills, alivePlayers(s).length);
  const votes = alivePack(s).map(w => n.wolfVotes[w.id] || []);
  if (!votes.length || votes.some(v => v[0] !== NO_KILL && v.length < need)) return false;
  const picks = votes.filter(v => v[0] !== NO_KILL).map(v => [...v].sort().join());
  return picks.every(p => p === picks[0]);
}

function settlePack(s, now) {
  const g = s.game;
  const n = g.night;
  const agreed = packAgrees(s);
  const acting = s.phase === 'NIGHT' && g.nightStage === 'act';
  if (agreed && !n.complete) {
    n.endsBeforeAgree = g.phaseEndsAt;
    if (acting) g.phaseEndsAt = Math.max(now + WOLF_AGREE_MS, g.actStartedAt + MIN_ACT_MS);
  } else if (!agreed && n.complete && acting) {
    g.phaseEndsAt = Math.max(n.endsBeforeAgree ?? 0, now + EXTEND_MS);
  }
  n.complete = agreed;
}

// What one wolf picked, in words.
function wolfPickText(s, vote) {
  if (!vote?.length) return 'chưa chọn';
  if (vote[0] === NO_KILL) return 'không cắn ai';
  return vote.map(id => nameOf(s, id)).join(' và ');
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
  if (n.heal && n.wolfTargets.length) log(s, `🧪 Bình Cứu đã cứu ${n.wolfTargets.map(id => nameOf(s, id)).join(' và ')}`);
  // Holy water: a wolf dies; hitting a villager costs the Priest their life;
  // a third-party player is unharmed. Judged on the cards as they were during
  // the night, before a bite turns the Cursed.
  const holy = n.holy && findPlayer(s, n.holy);
  const priest = s.players.find(p => p.inGame && p.role === 'priest');
  const holyTeam = holy && ROLES[trueRole(holy)]?.team;
  const victim = !holy ? null : PACK_ROLES.includes(trueRole(holy)) ? holy : holyTeam === 'village' ? priest : null;
  // The pack is sick after eating the Người Bệnh: tonight's bite kills nobody.
  if (n.sick && n.wolfTargets.length) log(s, `🤒 Bầy Sói đang ốm: cắn ${n.wolfTargets.map(id => nameOf(s, id)).join(' và ')} nhưng không ai chết`);
  // Yesterday's wound catches up with the Gã Cứng Cựa.
  const wounded = g.toughWounded;
  if (wounded && wounded.day < g.day) {
    g.toughWounded = null;
    deaths.push({ id: wounded.id, cause: 'wound' });
  }
  // The Breath of the Old Man runs out; the Vial and the Silver Bow strike.
  A.doomedTonight(s).forEach(id => deaths.push({ id, cause: 'breath' }));
  A.nightShots(s).forEach(d => deaths.push(d));
  for (const id of n.heal || n.sick ? [] : n.wolfTargets) {
    if (id === n.guard) {
      log(s, `🛡️ ${nameOf(s, id)} được Bảo Vệ che chở, Sói cắn hụt`);
      continue;
    }
    // The Cursed does not die from a bite: they wake as a Werewolf from the
    // next night on. Nobody is told but them and the pack, who see them join.
    const bitten = findPlayer(s, id);
    // Wearing the Skimmer of the Cursed: the same, by Artifact.
    if (bitten?.alive && A.cursedBite(s, bitten)) continue;
    if (bitten?.role === 'cursed' && bitten.alive) {
      bitten.role = 'werewolf';
      bitten.turned = true;
      addNote(s, id, '🌑 Bạn bị Sói cắn và đã hoá Sói. Từ đêm sau bạn thức dậy cùng đàn Sói.');
      log(s, `🌑 Sói Nguyền ${nameOf(s, id)} bị cắn và hoá Sói`);
      continue;
    }
    // The Gã Cứng Cựa lives through the day and dies the next night.
    if (bitten?.role === 'tough_guy' && !g.toughWounded && bitten.alive && !g.powersLost && A.hasPower(s, bitten)) {
      g.toughWounded = { id, day: g.day };
      addNote(s, id, '💪 Bạn bị Sói cắn. Bạn còn sống được hết ngày mai, rồi sẽ chết vào đêm tới.');
      log(s, `💪 Gã Cứng Cựa ${nameOf(s, id)} bị cắn, sẽ chết vào đêm sau`);
      continue;
    }
    // The Elder survives the first bite.
    if (bitten?.role === 'elder' && g.elderShield && A.hasPower(s, bitten)) {
      g.elderShield = false;
      log(s, `👴 Già Làng ${nameOf(s, id)} bị cắn nhưng sống sót (lần duy nhất)`);
      continue;
    }
    deaths.push({ id, cause: 'wolf' });
  }
  if (n.poison && !deaths.some(d => d.id === n.poison)) deaths.push({ id: n.poison, cause: 'poison' });
  if (victim?.alive && !deaths.some(d => d.id === victim.id)) deaths.push({ id: victim.id, cause: 'holy' });
  // The Hồn Ma leaves the living on the first night.
  if (g.day === 1) {
    s.players.filter(p => p.inGame && p.alive && p.role === 'ghost' && !deaths.some(d => d.id === p.id))
      .forEach(p => deaths.push({ id: p.id, cause: 'ghost' }));
  }
  // The Ông Lão dies of old age on night (living wolves + 1).
  s.players.filter(p => p.inGame && p.alive && p.role === 'old_man' && g.day >= alivePack(s).length + 1 && !deaths.some(d => d.id === p.id))
    .forEach(p => deaths.push({ id: p.id, cause: 'age' }));
  // Read out by seat: the order they happened in (bite, poison, a partner or
  // the Hunter's target dying along) would tell how each one died.
  const died = bySeat(s, killPlayers(s, deaths));
  g.lastNightDeaths = died.map(d => d.id);
  A.morning(s);

  setPhase(s, 'MORNING', now, 0, { announce: true });
  const keys = [];
  if (died.length) {
    // Deaths are announced without causes: a gunshot or a broken heart would
    // expose the Hunter or the couple.
    keys.push('morning_deaths', ...seatList(s, died.map(d => d.id)));
    log(s, `☀️ Sáng ngày ${g.day}, đã chết: ${withCause(s, died)}.`);
  } else {
    keys.push('morning_peace');
    log(s, `☀️ Sáng ngày ${g.day}: đêm qua bình yên, không ai chết.`);
  }
  if (g.revived && findPlayer(s, g.revived)?.alive) {
    keys.push('revived', seatKey(s, g.revived));
    log(s, `🕯️ ${nameOf(s, g.revived)} đã được Thầy Đồng hồi sinh.`);
  }
  // Night choices that shape the day, announced to everyone.
  if (n.ghostLetter) {
    g.ghostLetter = n.ghostLetter;
    keys.push('ghost_letter');
    log(s, `👻 Hồn Ma để lại chữ "${n.ghostLetter}"`);
  }
  if (n.banish && findPlayer(s, n.banish)?.alive) {
    g.banished = n.banish;
    keys.push('banished', seatKey(s, n.banish));
    log(s, `🧙‍♀️ ${nameOf(s, n.banish)} bị Mụ Già đuổi khỏi làng hôm nay`);
  }
  if (n.mute && findPlayer(s, n.mute)?.alive) {
    g.muted = n.mute;
    keys.push('muted', seatKey(s, n.mute));
    log(s, `🤐 ${nameOf(s, n.mute)} bị phong ấn, không được nói hôm nay`);
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
  // Artifact choices still waiting are settled before anyone votes.
  if (A.on(s)) {
    A.settle(s, rng);
    if (afterArtifacts(s, now, rng)) return;
  }
  s.game.votes = {};
  s.game.endsBeforeAllVoted = null;
  s.game.defendant = null;
  s.game.judge = {};
  setPhase(s, 'VOTE', now, s.config.voteTime * 1000);
  say(s, now, rng, 'vote_start');
}

// The Trưởng Làng's vote secretly counts twice.
// Like every village power, it is gone once the village has killed its Elder.
// The Mark of the Mayor does the same.
const voteWeight = (s, id) => {
  const p = findPlayer(s, id);
  return (p?.role === 'mayor' && !s.game.powersLost && A.hasPower(s, p)) || A.extraVote(s, id) ? 2 : 1;
};
// Out of the village today: sent away by the Mụ Già or the Cudgel of the Old Hag.
const isAway = (s, id) => s.game.banished === id || A.away(s, id);
// Who may vote today: the living, except the one sent away and the one the
// Heart of Indifference picked.
const canVote = (s, p) => p.inGame && p.alive && !isAway(s, p.id) && !A.noVote(s, p.id);
const voters = (s) => s.players.filter(p => canVote(s, p));
// The Gã Khờ always votes to hang, the Người Hoà Bình always to spare; the
// Cap of Idiocy and the Wreath of Peace overrule any role.
const fixedJudge = (s, p) => A.fixedJudge(s, p.id)
  || (A.hasPower(s, p) && (p.role === 'idiot' ? 'kill' : p.role === 'pacifist' ? 'spare' : null));

function resolveVote(s, now, rng) {
  const g = s.game;
  const tally = {};
  Object.entries(g.votes).forEach(([voter, t]) => { tally[t] = (tally[t] || 0) + voteWeight(s, voter); });
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
  voters(s).filter(p => p.id !== s.game.defendant).forEach(p => {
    const fixed = fixedJudge(s, p);
    if (fixed) s.game.judge[p.id] = fixed;
  });
  setPhase(s, 'JUDGE', now, s.config.judgeTime * 1000);
  say(s, now, rng, 'judge_start');
}

function resolveJudge(s, now, rng) {
  const g = s.game;
  const count = (choice) => Object.entries(g.judge).filter(([, v]) => v === choice).reduce((n, [id]) => n + voteWeight(s, id), 0);
  const kill = count('kill');
  const spare = count('spare');
  setPhase(s, 'VERDICT', now, NIGHT_COUNTDOWN_MS);
  const defendant = findPlayer(s, g.defendant);
  // The first time the village hangs the Hoàng Tử, he shows his card and lives.
  if (kill > spare && defendant?.role === 'prince' && !g.princeRevealed && !g.powersLost && A.hasPower(s, defendant)) {
    g.princeRevealed = true;
    defendant.revealed = true;
    g.verdict = { type: 'prince', ids: [g.defendant], kill, spare };
    log(s, `🤴 ${nameOf(s, g.defendant)} bị biểu quyết treo cổ nhưng lộ ra là Hoàng Tử nên được tha (${kill} treo / ${spare} tha).`);
    say(s, now, rng, seatKey(s, g.defendant), 'prince_revealed', 'night_soon');
    return;
  }
  if (kill > spare) {
    const fool = findPlayer(s, g.defendant)?.role === 'fool';
    const died = killPlayers(s, [{ id: g.defendant, cause: 'lynch' }]);
    // Saved by the Thầy Tu's blessing: hanged, but alive.
    if (!died.some(d => d.id === g.defendant)) {
      g.verdict = { type: 'spare', ids: [g.defendant], kill, spare };
      say(s, now, rng, seatKey(s, g.defendant), 'verdict_spare', 'night_soon');
      return;
    }
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
      log(s, `💀 Cũng đã chết: ${withCause(s, others)}.`);
    }
    say(s, now, rng, keys);
    if (endIfWon(s, now, rng)) return;
    // The Kẻ Gây Rối stirred things up last night: a second vote today.
    if (g.doubleLynch) {
      g.doubleLynch = false;
      g.secondVote = true;
      log(s, g.art?.talismanDay === g.day ? '🧨 Bùa Rắc Rối: cả làng bỏ phiếu thêm một lần.' : '🔥 Kẻ Gây Rối đã ra tay: cả làng bỏ phiếu thêm một lần.');
      say(s, now, rng, 'second_lynch');
      return;
    }
    say(s, now, rng, 'night_soon');
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
    case 'SWAP':
      resolveSwaps(s, rng);
      return beginReveal(s, now, rng);
    case 'ARTPICK':
      A.finishDraft(s, rng);
      return beginReveal(s, now, rng);
    case 'REVEAL': return beginNight(s, now, rng);
    case 'NIGHT': return onNightTimeout(s, now, rng);
    case 'MORNING': return continueAfterDeaths(s, now, rng, 'DISCUSSION');
    case 'DISCUSSION': return beginVote(s, now, rng);
    case 'VOTE': return resolveVote(s, now, rng);
    case 'DEFENSE': return beginJudge(s, now, rng);
    case 'JUDGE': return resolveJudge(s, now, rng);
    case 'VERDICT':
      if (s.game.secondVote) {
        s.game.secondVote = false;
        s.game.voteRound = 2;
        if (endIfWon(s, now, rng)) return;
        return beginVote(s, now, rng);
      }
      return continueAfterDeaths(s, now, rng, 'NIGHT');
    default: s.game.phaseEndsAt = null;
  }
}

function runBots(s, now, rng) {
  const g = s.game;
  if (!g.phaseStartedAt || now - g.phaseStartedAt < BOT_DELAY_MS) return false;
  const bots = alivePlayers(s).filter(p => p.isBot);
  // A dead bot may still owe the Sheet of the Ghost a letter.
  if (!s.players.some(p => p.isBot && p.inGame)) return false;
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

  if (s.phase === 'NIGHT' && g.nightStage === 'act' && (!g.night.complete || g.queue[g.step] === 'werewolf')) {
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
      } else if (role === 'werewolf') {
        // With a human in the pack, bots back the human's pick (and follow
        // when it changes); the step ends once everyone has picked. An
        // all-bot pack picks at random.
        const humans = holders.filter(p => !p.isBot);
        const humanVote = humans.map(p => n.wolfVotes[p.id]).find(v => v?.length);
        const mine = n.wolfVotes[bot.id] || [];
        if (humanVote) {
          const follow = humanVote;
          if ([...mine].sort().join() !== [...follow].sort().join()) {
            if (follow[0] === NO_KILL) act(bot, 'night', { noKill: true });
            else {
              n.wolfVotes[bot.id] = [];
              follow.forEach(target => act(bot, 'night', { target }));
            }
          }
        } else if (!humans.length && !mine.length) {
          const allowed = A.wolfOptions(s);
          const prey = shuffle(alivePlayers(s).filter(p => !inPack(p) && (!allowed || allowed.includes(p.id))), rng).map(p => p.id);
          if (!prey.length) act(bot, 'night', { noKill: true });
          prey.slice(0, n.wolfKills).forEach(target => act(bot, 'night', { target }));
        }
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
      } else if (role === 'avenger' && !n.avengerAim && !g.avengerFired) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'seer') {
        if (!n.seerTarget) {
          const options = others(bot);
          if (options.length) act(bot, 'night', { target: pick(options, rng).id });
        }
        act(bot, 'seerDone', {});
      } else if (role === 'hunter' && !n.hunterAim && !g.hunterFired) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'witch') {
        if (g.potions.heal && rng() < 0.3) act(bot, 'witch', { use: 'heal' });
        act(bot, 'witch', { use: 'done' });
      } else if (['aura_seer', 'sorcerer', 'old_hag', 'doppelganger'].includes(role)) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'pi' && !g.piUsed && rng() < 0.3) {
        act(bot, 'night', { target: pick(alivePlayers(s), rng).id });
      } else if (role === 'blesser' && !g.blessUsed && rng() < 0.3) {
        const options = others(bot);
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'spellcaster' && rng() < 0.5) {
        const options = alivePlayers(s).filter(p => !g.mutedEver.includes(p.id));
        if (options.length) act(bot, 'night', { target: pick(options, rng).id });
      } else if (role === 'hoodlum') {
        shuffle(others(bot), rng).slice(0, 2 - n.hoodlum.length).forEach(p => act(bot, 'night', { target: p.id }));
      } else if (role === 'troublemaker' && !g.troubleUsed && rng() < 0.2) {
        act(bot, 'troublemaker', {});
      } else if (role === 'ghost') {
        act(bot, 'ghost', { letter: pick([...'ABCDEGHIKLMNOPQRSTUVXY'], rng) });
      }
      // Like a person, a bot with nothing more to do passes the rest of its
      // turn (also when its power is lost), so its step is no longer.
      if (role !== 'werewolf' && !g.night.complete) act(bot, 'endTurn', {});
    });
  } else if (s.phase === 'SWAP') {
    // Bots never ask, but sometimes take up someone's offer.
    // Bots never start a trade, but sometimes join one a person started.
    const sw = g.swap;
    const personIn = sw?.pool.some(id => !findPlayer(s, id)?.isBot);
    if (personIn && !g.swapBotsDone) {
      g.swapBotsDone = true;
      bots.filter(b => !sw.pool.includes(b.id) && rng() < 0.3).forEach(bot => act(bot, 'swapJoin', {}));
    }
  } else if (s.phase === 'VOTE') {
    voters(s).filter(b => b.isBot && !g.votes[b.id]).forEach(bot => {
      const options = others(bot).filter(p => !isAway(s, p.id));
      if (options.length) act(bot, 'vote', { target: pick(options, rng).id });
    });
  } else if (s.phase === 'JUDGE') {
    voters(s).filter(b => b.isBot && b.id !== g.defendant && !g.judge[b.id])
      .forEach(bot => act(bot, 'judge', { choice: rng() < 0.6 ? 'kill' : 'spare' }));
  } else if ((s.phase === 'DISCUSSION' || s.phase === 'ARTPICK') && A.on(s)) {
    if (A.bots(s, rng, (bot, type, payload) => artifactAction(s, bot, type, payload, now, rng))) changed = true;
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
export function tick(s, now, rng = secureRandom) {
  if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER') return false;
  const G = gameOf(s);
  let changed = G ? G.bots(s, now, rng, gameApi) : runBots(s, now, rng);
  for (let i = 0; i < 25; i++) {
    const end = s.game.phaseEndsAt;
    if (end == null || now < end) break;
    if (G) G.onTimeout(s, now, rng, gameApi);
    else onPhaseTimeout(s, now, rng);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Artifacts (lib/artifacts.js)
// ---------------------------------------------------------------------------

// The rules of the Artifacts, with what they need from this file.
const A = makeArtifacts({
  fail, GameError, log, addNote, pick, shuffle, seatNeighbours,
  nameOf: (s, id) => nameOf(s, id),
  findPlayer: (s, id) => findPlayer(s, id),
  inPack: (p) => inPack(p),
  trueRole: (p) => trueRole(p),
  isSpecial: (p) => isSpecial(p),
  killPlayers: (s, list) => killPlayers(s, list)
});

// A tap on an Artifact (or a bot's), then what it changed: someone died or
// the Orb found two wolves (the game may be over), and the village gets
// time to take it in before the vote.
function artifactAction(s, player, type, payload, now, rng) {
  A.action(s, player, type, payload, now, rng);
  if (s.phase === 'ARTPICK') {
    // Everyone has chosen: on to the card reveal.
    if (!A.draftOpen(s)) finishEarly(s, now);
    return;
  }
  if (afterArtifacts(s, now, rng)) return;
  if (s.phase === 'DISCUSSION' && type !== 'artDawn' && s.game.phaseEndsAt != null) {
    s.game.phaseEndsAt = Math.max(s.game.phaseEndsAt, now + ART_MIN_LEFT_MS);
  }
}

// Returns true if the game ended.
function afterArtifacts(s, now, rng) {
  const g = s.game;
  if (g.art?.villageWins) {
    finishGame(s, { winner: 'village', reason: g.art.villageWins }, now, rng);
    return true;
  }
  return endIfWon(s, now, rng);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

const NIGHT_ACTIONS = new Set(['night', 'thief', 'ack', 'seerDone', 'detectiveDone', 'witch', 'endTurn', 'extend', 'ghost', 'troublemaker']);
const NO_CUPID = 'Đang bật "Quản trò tự ghép đôi", nên ván này không dùng lá Thần Tình Yêu.';
const HOST_LOBBY_ACTIONS = new Set(['config', 'role', 'autoBalance', 'pickRole', 'fitDeck', 'kick', 'start', 'addBot', 'selectGame', 'gameConfig']);
const HOST_GAME_ACTIONS = new Set(['skip', 'endGame']);

export function applyAction(s, playerId, type, payload = {}, now, rng = secureRandom) {
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

  const G = gameOf(s);
  if (G) {
    if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER') fail('Ván chơi chưa bắt đầu.');
    return G.action(s, player, type, payload, now, rng, gameApi);
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
      for (const key of ['hostPlays', 'revealRoleOnDeath', 'swapEnabled', 'autoLovers', 'artifacts', 'artifactsHomebrew']) {
        if (payload[key] !== undefined) s.config[key] = !!payload[key];
      }
      // The game makes the couple itself: the Thần Tình Yêu card gives way
      // to a Dân Làng, so the deck keeps its size.
      if (payload.autoLovers && s.roleCounts.cupid) {
        s.roleCounts.villager = (s.roleCounts.villager || 0) + s.roleCounts.cupid;
        s.roleCounts.cupid = 0;
      }
      renumberSeats(s);
      rebalance(s);
      return;
    }
    case 'role': {
      const { roleId, delta } = payload;
      if (!ROLES[roleId] || ![1, -1].includes(delta)) fail('Vai trò không hợp lệ.');
      if (roleId === 'cupid' && delta > 0 && conf(s, 'autoLovers')) fail(NO_CUPID);
      s.roleCounts[roleId] = Math.max(0, Math.min(MAX_PLAYERS, (s.roleCounts[roleId] || 0) + delta));
      return;
    }
    case 'autoBalance':
      // Only when the host asks: a suggested deck for the players in the room.
      s.roleCounts = computeBalancedRoles(lobbyParticipants(s).length);
      s.deckPlayers = lobbyParticipants(s).length;
      if (conf(s, 'autoLovers') && s.roleCounts.cupid) {
        s.roleCounts.villager += s.roleCounts.cupid;
        s.roleCounts.cupid = 0;
      }
      return;
    case 'fitDeck': {
      // The host's shortcut: make up the count with Dân Làng cards.
      const c = s.roleCounts;
      c.villager = Math.max(0, (c.villager || 0) + cardsNeeded(c, lobbyParticipants(s).length) - totalRoles(c));
      return;
    }
    case 'pickRole': {
      // Put a role in the deck or take it out: that card only (the Masons
      // as a pair). Nothing else changes; the lobby says if the count is off.
      const { roleId } = payload;
      if (!ROLES[roleId] || roleId === 'werewolf' || roleId === 'villager') fail('Vai trò không hợp lệ.');
      if (roleId === 'cupid' && !s.roleCounts.cupid && conf(s, 'autoLovers')) fail(NO_CUPID);
      s.roleCounts[roleId] = s.roleCounts[roleId] > 0 ? 0 : roleId === 'mason' ? 2 : 1;
      return;
    }
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
    case 'selectGame': {
      const info = gameInfo(payload.gameId);
      if (info.id !== payload.gameId || !info.ready) fail('Trò chơi này chưa có.');
      s.gameId = info.id;
      renumberSeats(s);
      return;
    }
    case 'gameConfig': {
      const G = gameOf(s);
      if (!G) fail('Hãy dùng cài đặt của Ma Sói.');
      G.configure((s.gameConfigs ||= {})[G.id] ||= {}, payload, gameApi);
      return;
    }
    case 'start': {
      const G = gameOf(s);
      return G ? startOtherGame(s, G, now, rng) : startGame(s, now, rng);
    }
    case 'skip':
      // While a role is being called, skipping would show it its choices
      // before the narrator is done (and before everyone has closed their
      // eyes). That slot ends by itself as soon as the call has been read.
      if (gameOf(s)) return gameOf(s).skip(s, now);
      if (s.phase === 'NIGHT' && s.game.nightStage === 'call') return;
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
  // The Hồn Ma keeps acting at night after death; everyone else just watches.
  const ghostTurn = player.role === 'ghost' && s.phase === 'NIGHT' && g.queue?.[g.step] === 'ghost'
    && ['ghost', 'endTurn', 'extend'].includes(type);
  // The dead may still give the Sheet of the Ghost its letter.
  if (type.startsWith('art')) {
    if (!player.inGame) fail('Bạn không chơi ván này.');
    return artifactAction(s, player, type, payload, now, rng);
  }
  if (!player.inGame || (!player.alive && !ghostTurn)) fail('Bạn đã bị loại, chỉ có thể theo dõi.');
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
        if (target.role === 'ghost') fail('Hồn Ma không thể được hồi sinh.');
        n.revive = target.id;
        g.mediumUsed = true;
        n.complete = true;
        finishStepSoon(s, now);
        return;
      }
      // The pack may also agree to bite nobody tonight.
      if (role === 'werewolf' && payload.noKill) {
        n.wolfVotes[player.id] = [NO_KILL];
        settlePack(s, now);
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
        // The Prism of Power: tonight only one of its three players.
        const allowed = A.wolfOptions(s);
        if (allowed && !allowed.includes(target.id)) fail(allowed.length ? 'Đêm nay Lăng Kính Quyền Năng chỉ cho cắn một trong ba người đã chọn.' : 'Đêm nay không cắn được ai (Lăng Kính Quyền Năng).');
        // Wolves may bite anyone, pack mates and themselves included.
        // Tap to pick, tap again to drop. Usually one victim; two on the night
        // after the Wolf Cub died (the oldest pick makes room for a new one).
        const mine = (n.wolfVotes[player.id] || []).filter(id => id !== NO_KILL);
        n.wolfVotes[player.id] = mine.includes(target.id)
          ? mine.filter(id => id !== target.id)
          : [...mine, target.id].slice(-n.wolfKills);
        settlePack(s, now);
        return;
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
          // By the side printed on each card, like the Tiên Tri: a couple in
          // love does not count, and each third-side role (Piper, madman,
          // Hoodlum) is a side of its own. A Kẻ Say is read by their real
          // card; a Sói Nguyền who was bitten holds a Werewolf card by now.
          const side = (p) => ROLES[trueRole(p)]?.team;
          n.detectiveResult = side(a) === side(b) ? 'same' : 'different';
          n.complete = true;
        }
      } else if (role === 'avenger') {
        if (g.avengerFired) fail('Bạn đã kéo theo một người rồi.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.avengerAim = target.id;
        n.complete = true;
      } else if (role === 'hunter') {
        if (g.hunterFired) fail('Súng của bạn đã nổ rồi.');
        if (target.id === player.id) fail('Hãy chĩa súng vào người khác.');
        n.hunterAim = target.id;
        n.complete = true;
      } else if (role === 'seer') {
        if (n.seerTarget) fail('Mỗi đêm chỉ được soi 1 người.');
        if (target.id === player.id) fail('Hãy soi người khác.');
        n.seerTarget = target.id;
        // Only villager or not (see seenAsVillager).
        n.seerResult = seenAsVillager(target) ? 'village' : 'not_village';
        n.complete = true;
      } else if (role === 'aura_seer') {
        if (n.auraTarget) fail('Mỗi đêm chỉ được soi 1 người.');
        if (target.id === player.id) fail('Hãy soi người khác.');
        n.auraTarget = target.id;
        n.auraResult = isSpecial(target) ? 'special' : 'plain';
        n.complete = true;
      } else if (role === 'pi') {
        if (g.piUsed) fail('Bạn đã dùng năng lực rồi.');
        n.piTarget = target.id;
        n.piResult = [target, ...seatNeighbours(s, target.id)].some(looksLikeWolf) ? 'wolf' : 'clear';
        g.piUsed = true;
        n.complete = true;
      } else if (role === 'sorcerer') {
        if (n.sorcererTarget) fail('Mỗi đêm chỉ được chọn 1 người.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.sorcererTarget = target.id;
        // The Tiên Tri Tập Sự counts once they have taken the Seer's place.
        n.sorcererResult = trueRole(target) === 'seer' || (target.role === 'apprentice_seer' && stepHolders(s, 'seer').includes(target)) ? 'seer' : 'not';
        n.complete = true;
      } else if (role === 'blesser') {
        if (g.blessUsed) fail('Bạn đã ban phước rồi.');
        if (target.id === player.id) fail('Không thể tự ban phước cho mình.');
        n.bless = target.id;
        g.blessUsed = true;
        g.blessed = target.id;
        n.complete = true;
      } else if (role === 'martyr') {
        if (g.martyrUsed) fail('Bạn đã hy sinh rồi.');
        if (!n.wolfTargets.includes(target.id) || target.id === player.id) fail('Chỉ có thể chết thay người bị Sói cắn.');
        n.martyrFor = target.id;
        n.wolfTargets = n.wolfTargets.map(id => (id === target.id ? player.id : id));
        g.martyrUsed = true;
        n.complete = true;
      } else if (role === 'spellcaster') {
        if (g.mutedEver.includes(target.id)) fail('Người này đã bị phong ấn một lần rồi.');
        n.mute = target.id;
        g.mutedEver.push(target.id);
        n.complete = true;
      } else if (role === 'old_hag') {
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.banish = target.id;
        n.complete = true;
      } else if (role === 'doppelganger') {
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.doppel = target.id;
        g.doppelTarget = target.id;
        n.complete = true;
      } else if (role === 'hoodlum') {
        if (n.complete) fail('Bạn đã chọn xong.');
        if (target.id === player.id) fail('Hãy chọn người khác.');
        n.hoodlum = n.hoodlum.includes(target.id)
          ? n.hoodlum.filter(id => id !== target.id)
          : [...n.hoodlum, target.id].slice(0, 2);
        if (n.hoodlum.length === 2) {
          g.hoodlumMarks = [...n.hoodlum];
          n.complete = true;
        }
      } else {
        fail('Vai trò này không có hành động ban đêm.');
      }
      if (n.complete) finishStepSoon(s, now, ['seer', 'detective', 'aura_seer', 'pi', 'sorcerer'].includes(role) ? READ_RESULT_MS : 0);
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
      // The same pause whether the thief swapped or kept, or the length of
      // the step would tell which.
      finishStepSoon(s, now, READ_RESULT_MS);
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
        finishStepSoon(s, now);
      }
      return;
    }
    case 'endTurn': {
      const step = g.queue[g.step];
      if (s.phase !== 'NIGHT' || g.nightStage !== 'act' || !stepHolders(s, step).some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      // "Bỏ qua": the role passes on what is left of its turn. The pack has
      // no pass: a wolf picks "nobody" instead.
      if (step === 'werewolf') fail('Hãy chọn người để cắn, hoặc "Không cắn ai".');
      if (step === 'doppelganger' && !g.night.doppel) fail('Kẻ Song Trùng phải chọn 1 người.');
      g.night.complete = true;
      finishStepSoon(s, now);
      return;
    }
    case 'extend': {
      const step = g.queue[g.step];
      if (s.phase !== 'NIGHT' || g.nightStage !== 'act' || !stepHolders(s, step).some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      if (g.night.complete) fail('Bạn đã xong lượt.');
      g.phaseEndsAt = Math.min(Math.max(g.phaseEndsAt, now) + EXTEND_MS, now + EXTEND_MAX_LEFT_MS);
      return;
    }
    case 'detectiveDone': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'detective' || player.role !== 'detective') fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      g.night.complete = true;
      finishStepSoon(s, now);
      return;
    }
    case 'seerDone': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'seer' || !stepHolders(s, 'seer').some(p => p.id === player.id)) fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      g.night.complete = true;
      finishStepSoon(s, now);
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
        if (n.heal) fail('Bạn đã dùng bình Cứu đêm nay.');
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
      } else {
        fail('Hành động không hợp lệ.');
      }
      // Nothing left to use tonight: the turn is over.
      if (!g.potions.heal && !g.potions.poison) n.complete = true;
      if (n.complete) finishStepSoon(s, now);
      return;
    }
    case 'swapJoin': {
      if (s.phase !== 'SWAP') fail('Chỉ trao đổi vai được trước đêm đầu tiên.');
      const sw = g.swap;
      sw.pool = sw.pool.includes(player.id) ? sw.pool.filter(id => id !== player.id) : [...sw.pool, player.id];
      return;
    }
    case 'ghost': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'ghost' || player.role !== 'ghost') fail('Chưa đến lượt của bạn.');
      const letter = String(payload.letter || '').trim().toUpperCase();
      if (!/^[A-ZĐ]$/.test(letter)) fail('Hãy chọn một chữ cái.');
      g.night.ghostLetter = letter;
      g.night.complete = true;
      finishStepSoon(s, now);
      return;
    }
    case 'troublemaker': {
      if (s.phase !== 'NIGHT' || g.queue[g.step] !== 'troublemaker' || player.role !== 'troublemaker') fail('Chưa đến lượt của bạn.');
      if (g.powersLost) fail(POWERLESS_MSG);
      if (g.troubleUsed) fail('Bạn đã gây rối rồi.');
      g.troubleUsed = true;
      g.doubleLynch = true;
      g.night.trouble = true;
      g.night.complete = true;
      finishStepSoon(s, now);
      return;
    }
    case 'vote': {
      if (s.phase !== 'VOTE') fail('Chưa đến lúc bỏ phiếu.');
      if (isAway(s, player.id)) fail('Hôm nay bạn bị đuổi khỏi làng, không được bỏ phiếu.');
      if (!canVote(s, player)) fail('Hôm nay bạn không được bỏ phiếu.');
      requireAliveTarget();
      if (target.id === player.id) fail('Không thể tự bỏ phiếu cho mình.');
      if (isAway(s, target.id)) fail('Người này hôm nay không có mặt trong làng.');
      g.votes[player.id] = target.id;
      if (voters(s).every(p => g.votes[p.id])) {
        g.endsBeforeAllVoted ??= g.phaseEndsAt;
        finishEarly(s, now, 2500);
      }
      return;
    }
    case 'unvote': {
      // Tapping your pick again takes the vote back. If everyone had voted and
      // the vote was about to close, it gets its time back.
      if (s.phase !== 'VOTE') fail('Chưa đến lúc bỏ phiếu.');
      if (!g.votes[player.id]) return;
      delete g.votes[player.id];
      if (g.endsBeforeAllVoted != null) {
        g.phaseEndsAt = Math.max(g.phaseEndsAt, g.endsBeforeAllVoted);
        g.endsBeforeAllVoted = null;
      }
      return;
    }
    case 'judge': {
      if (s.phase !== 'JUDGE') fail('Chưa đến lúc phán quyết.');
      if (player.id === g.defendant) fail('Người đang biện hộ không được bỏ phiếu.');
      if (isAway(s, player.id)) fail('Hôm nay bạn bị đuổi khỏi làng, không được bỏ phiếu.');
      if (!canVote(s, player)) fail('Hôm nay bạn không được bỏ phiếu.');
      if (!['kill', 'spare'].includes(payload.choice)) fail('Lựa chọn không hợp lệ.');
      // The Gã Khờ and the Người Hoà Bình (and the Cap, the Wreath) cannot change their vote.
      if (fixedJudge(s, player)) fail('Phiếu của bạn đã cố định.');
      g.judge[player.id] = payload.choice;
      if (voters(s).filter(p => p.id !== g.defendant).every(p => g.judge[p.id])) finishEarly(s, now, 2500);
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
  // The dead watch everything once nobody can bring them back (the Hồn Ma,
  // who still speaks to the village, does not).
  const spectator = !!me?.inGame && !me.alive && me.role !== 'ghost' && !['LOBBY', 'GAME_OVER'].includes(s.phase)
    && !!g.watchOpen && !revivalPossible(s);
  // The dead watch by night only: by day their screen shows no roles, so a
  // neighbour glancing at it during the discussion learns nothing.
  const watcher = moderator || (spectator && s.phase === 'NIGHT');
  const meIsWolf = me?.inGame && inPack(me);

  // The card this viewer may see for a player, or null.
  // While cards can still be traded, nobody learns who their teammates are:
  // a wolf who saw the pack and then traded away (or a pack that changes
  // after the trade) would show who holds which card.
  const swapping = s.phase === 'SWAP';
  const shownRole = (p) => {
    if (!p.inGame || !p.role) return null;
    if (gameOver || watcher || p.id === viewerId) return p.role;
    // (A player who joined the pack through an Artifact keeps their card to
    // themselves: the pack knows them as a wolf, not their role.)
    if (meIsWolf && inPack(p) && !p.clawed && !swapping) return p.role;
    // The Tay Sai knows the pack.
    if (me?.inGame && me.role === 'minion' && inPack(p) && !p.clawed && !swapping) return p.role;
    // The couple see each other's card once Cupid has paired them.
    if (me?.inGame && g.loversRevealed && g.lovers.includes(me.id) && g.lovers.includes(p.id)) return p.role;
    // The Hoàng Tử showed his card to save himself (and the Spear of Fury
    // shows its owner's card to all).
    if (p.revealed) return p.role;
    // Shown in secret through the Pendant of Pride or the Staff of the Seer.
    if (me?.inGame && A.seenBy(s, viewerId, p.id)) return p.role;
    // Cards turned over on death: a Kẻ Song Trùng shows its own card, not
    // the role it copied (two Seers would give it away).
    if (!p.alive && s.config.revealRoleOnDeath) return p.copied ? 'doppelganger' : p.role;
    return null;
  };

  const seesConnections = isHost && (moderator || s.phase !== 'NIGHT');
  const players = s.players.map(p => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: p.isBot,
    isHost: p.id === s.hostId,
    inGame: p.inGame,
    alive: p.alive,
    // Only the host sees who is connected. A playing host does not see it at
    // night: only the role being called holds a phone, so it would show who
    // just acted. Everyone else always reads as connected.
    online: !seesConnections || p.isBot || now - (p.lastSeen || 0) < PLAYER_ONLINE_MS,
    role: shownRole(p),
    // A Werewolf that was dealt the Cursed card.
    turned: shownRole(p) === p.role && !!p.turned,
    // Artifacts turned face up (public), and the Amulet.
    art: A.seatView(s, p)
  }));

  const activeRole = s.phase === 'NIGHT' ? g.queue[g.step] : null;
  const view = {
    version,
    serverNow: now,
    code: s.code,
    debug: s.debug,
    phase: s.phase,
    hostId: s.hostId,
    // Whether this phone may show who is connected (the host only, and a
    // playing host not at night). Phones must not use Realtime presence to
    // work it out themselves.
    seesConnections,
    // Everyone is told once the host has been gone too long. At night that is
    // just a notice: the vote (whose candidates show who is awake) waits for day.
    hostOffline: !isHostOffline(s, now) ? null : s.phase === 'NIGHT' ? { night: true } : {
      votes: Object.fromEntries(Object.entries(s.hostVotes || {}).filter(([id]) => {
        const p = findPlayer(s, id);
        return p && isOnline(p, now);
      })),
      needed: hostVotesNeeded(s, now),
      endsAt: s.hostVoteStartedAt ? s.hostVoteStartedAt + HOST_VOTE_MS : null,
      candidates: hostCandidates(s, now).map(p => p.id)
    },
    config: { ...DEFAULT_CONFIG, ...s.config },
    roleCounts: s.roleCounts,
    // The room's leaderboard: finished games only, so it shows nothing about
    // the game being played.
    stats: s.gameId && s.gameId !== 'werewolf' ? (s.statsByGame?.[s.gameId] || emptyStats()) : (s.stats || emptyStats()),
    // The game this room plays, its settings, and (while it runs) what this
    // player may see of it.
    gameId: s.gameId,
    gameConfig: gameOf(s) ? gameConfig(s, s.gameId) : null,
    play: gameOf(s) && s.play ? gameOf(s).view(s, me) : null,
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
      // Public news for the day: the Hồn Ma's letter, who the Mụ Già sent
      // away, who the Pháp Sư Phong Ấn silenced, a second vote coming.
      ghostLetter: s.phase !== 'NIGHT' ? g.ghostLetter : null,
      banished: s.phase !== 'NIGHT' ? g.banished : null,
      muted: s.phase !== 'NIGHT' ? g.muted : null,
      secondVote: !!g.secondVote,
      voteRound: g.voteRound || 1,
      coWinners: gameOver ? g.coWinners : [],
      // Artifacts: the public news and what is being resolved.
      art: A.publicView(s),
      talisman: !!g.art && g.art.talismanDay === g.day,
      winner: g.winner,
      winReason: g.winReason,
      // Secret: telling everyone would reveal that the dead player was the Elder.
      powersLost: (gameOver || watcher) && g.powersLost,
      lovers: gameOver || watcher ? g.lovers : [],
      // The log tells who died how and when: only a moderator who is not
      // playing reads it, like a real game master's notes.
      // Who did what each night: for a moderator who is not playing, or for
      // the host once the game is over.
      log: watcher || (isHost && gameOver) ? g.log : []
    },
    me: null
  };

  if (!me) return view;

  const mine = {
    id: me.id,
    isHost,
    inGame: me.inGame,
    alive: me.alive,
    // The Kẻ Say believes they are a Villager until they sober up.
    role: me.role === 'drunk' && !me.sober ? 'villager' : me.role,
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
  mine.turned = me.inGame && !!me.turned;
  mine.swapped = me.inGame && !!me.swapped;
  // Only how many cards are in the pool, never whose.
  if (s.phase === 'SWAP' && g.swap) {
    mine.swap = { pool: g.swap.pool.length, joined: g.swap.pool.includes(me.id) };
  }
  mine.notes = (me.inGame && g.notes?.[me.id]) || [];
  // Only the players who lost a power are told (on their card).
  mine.powerless = me.inGame && g.powersLost && VILLAGE_POWERS.includes(me.role);
  if (meIsWolf && !swapping) mine.wolves = s.players.filter(p => p.inGame && inPack(p) && p.id !== me.id).map(p => p.id);
  if (me.inGame && me.role === 'avenger') mine.avengerTarget = g.avengerTarget;
  // The Tay Sai knows the pack; the Masons know each other.
  if (me.inGame && me.role === 'minion' && !swapping) mine.wolves = s.players.filter(p => p.inGame && inPack(p)).map(p => p.id);
  if (me.inGame && me.role === 'mason' && !swapping) mine.masons = s.players.filter(p => p.inGame && p.role === 'mason' && p.id !== me.id).map(p => p.id);
  if (me.inGame && me.role === 'hoodlum') mine.hoodlumMarks = g.hoodlumMarks;
  if (me.inGame && me.role === 'doppelganger') mine.doppelTarget = g.doppelTarget;
  if (me.inGame && me.copied) mine.copied = true;
  if (me.inGame && g.toughWounded?.id === me.id) mine.wounded = true;
  mine.art = A.myView(s, me);
  // A player on the pack's side through an Artifact.
  if (me.inGame && me.clawed) mine.clawed = true;
  // The Eye of the Beholder watches the Seer's turn.
  if (s.phase === 'NIGHT' && activeRole === 'seer' && g.nightStage === 'act' && A.beholders(s).some(p => p.id === me.id)) {
    const t = g.night.seerTarget && findPlayer(s, g.night.seerTarget);
    mine.beholder = { target: t ? t.id : null, wolf: t ? A.isWolf(t) : null };
  }

  // The choices appear once the narrator has finished calling the role.
  if (s.phase === 'NIGHT' && g.nightStage === 'act' && me.inGame && (me.alive || activeRole === 'ghost') && stepHolders(s, activeRole).some(p => p.id === me.id)) {
    const n = g.night;
    const task = { role: activeRole, complete: n.complete, acked: !!n.acks[me.id] };
    if (g.powersLost && VILLAGE_POWERS.includes(activeRole)) task.powerless = true;
    if (activeRole === 'thief') { task.extras = g.thiefExtras; task.done = n.thiefDone; task.took = n.thiefTook ?? null; }
    if (activeRole === 'piper') { task.picks = n.piperPicks; task.charmed = g.charmed; }
    if (activeRole === 'cupid') task.picks = n.cupid;
    if (activeRole === 'guard') { task.pick = n.guard; task.lastGuarded = g.lastGuarded; }
    if (activeRole === 'hunter') { task.aim = n.hunterAim; task.lastAim = g.hunterAim; task.spent = g.hunterFired; }
    if (activeRole === 'werewolf') {
      task.votes = n.wolfVotes; task.targets = n.wolfTargets; task.kills = n.wolfKills; task.noKill = n.wolfNoKill;
      task.allowed = A.wolfOptions(s);
    }
    if (activeRole === 'priest') { task.used = g.priestUsed; task.pick = n.holy; }
    if (activeRole === 'medium') {
      task.used = g.mediumUsed;
      task.pick = n.revive;
      task.dead = s.players.filter(p => p.inGame && !p.alive && p.role !== 'ghost').map(p => p.id);
    }
    if (activeRole === 'avenger') { task.aim = n.avengerAim; task.lastAim = g.avengerTarget; task.spent = g.avengerFired; }
    if (activeRole === 'detective') { task.picks = n.detectivePicks; task.result = n.detectiveResult; }
    if (activeRole === 'seer') { task.target = n.seerTarget; task.result = n.seerResult; task.apprentice = me.role === 'apprentice_seer'; }
    if (activeRole === 'aura_seer') { task.target = n.auraTarget; task.result = n.auraResult; }
    if (activeRole === 'pi') { task.used = g.piUsed; task.target = n.piTarget; task.result = n.piResult; }
    if (activeRole === 'sorcerer') { task.target = n.sorcererTarget; task.result = n.sorcererResult; }
    if (activeRole === 'blesser') { task.used = g.blessUsed; task.pick = n.bless; }
    if (activeRole === 'martyr') { task.used = g.martyrUsed; task.targets = n.wolfTargets; task.pick = n.martyrFor; }
    if (activeRole === 'spellcaster') { task.pick = n.mute; task.mutedEver = g.mutedEver; }
    if (activeRole === 'old_hag') task.pick = n.banish;
    if (activeRole === 'doppelganger') task.pick = n.doppel;
    if (activeRole === 'hoodlum') task.picks = n.hoodlum;
    if (activeRole === 'troublemaker') { task.used = g.troubleUsed; task.stirred = n.trouble; }
    if (activeRole === 'ghost') task.letter = n.ghostLetter;
    if (activeRole === 'witch') {
      task.healAvailable = g.potions.heal;
      task.poisonAvailable = g.potions.poison;
      task.healed = n.heal;
      task.poisoned = n.poison;
    }
    mine.task = task;
  }

  // A moderator who does not play sees the whole night, like a real game master.
  mine.spectator = spectator;
  if (watcher && s.phase === 'NIGHT') mine.watch = watchNight(s);

  view.me = mine;
  return view;
}
