import {
  ROLES, ROLE_IDS, TEAM_LABEL, MIN_PLAYERS, MAX_PLAYERS, NIGHT_STEPS, PACK_ROLES, totalRoles, validateRoleCounts, cardsNeeded, stepInfo,
  balanceScore, balanceLabel
} from '/shared/roles.js';
import { Narrator } from './narrator.js';
import { connectRealtime } from './realtime.js';
import { moodForPhase, THEMES, THEME_IDS } from './ambience.js';
import { clipMs, gapAfter, lineText } from '/shared/voice-lines.js';
import { GAMES_INFO, gameInfo } from '/shared/games.js';
import { GAME_UI } from './games/index.js';
import { ARTIFACTS, ARTIFACT_RULES } from '/shared/artifacts.js';

// The browser side of the game on the table, unless it is Ma Sói.
const gameUI = () => (view && view.gameId !== 'werewolf' ? GAME_UI[view.gameId] : null);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const SESSION_KEY = 'masoi_session_v2';
const NAME_KEY = 'masoi_name';
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

const narrator = new Narrator();
const app = document.getElementById('app');

let session = loadSession();
// A saved room the player hasn't gone back into yet (opened the plain home
// page rather than reloading the room's link): offered, not entered.
let savedRoom = null;
let view = null;
let clockOffset = 0;
let clockRtt = Infinity;
let clockSampledAt = 0;
let lastRtt = null;
let heartbeatTimer = null;
let wakeTimer = null;
let failures = 0;
let fetching = null;
let refetch = false;
let realtime = null;
let realtimeConfig;
let live = false;
let presence = null;
let screen = null;
let homeTab = params.get('room') ? 'join' : 'create';
// The game a new room starts with, picked on the home page.
let homeGame = GAMES_INFO.some(g => g.id === read('hub_game') && g.ready) ? read('hub_game') : 'werewolf';
let lastTaskKey = null;
let lastPhaseKey = null;
let wakeLock = null;
let ambienceOn = read('masoi_ambience') === 'on';
let ambienceVolume = Number(read('masoi_ambience_volume') || 60);
let ambienceTheme = THEME_IDS.includes(read('masoi_ambience_theme')) ? read('masoi_ambience_theme') : 'village';
let settingsOpen = false;
// Lobby: the host's "Chuẩn bị ván" step, and the deck editor.
let setupOpen = false;
let deckEdit = false;
// Players can also hear the narrator on their own phone (off by default).
let localAudio = read('masoi_local_audio') === 'on';
let botCount = 1; // how many computer players the host's next tap adds
// The players picked so far for the Artifact waiting on this player.
let artPicks = [];
// Which side of the card sheet is open (your role, or your Artifacts), the
// cards turned face up in it, and the open tab of the rules.
let cardTab = 'role';
const flipped = new Set();
let rulesTab = 'roles';
let hostMissingTimer = null;
const audioOn = () => isHost() || localAudio;
// Vibration only exists on (Android) phones; iPhones' browsers don't allow it.
const canVibrate = 'vibrate' in navigator && matchMedia('(pointer: coarse)').matches;
let vibrateOn = read('masoi_vibrate') === 'on';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {}
}
function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function loadSession() {
  try { return JSON.parse(read(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(s) {
  session = s;
  store(SESSION_KEY, s);
}

function toast(message, kind = 'info') {
  const zone = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

const serverNow = () => Date.now() + clockOffset;
const me = () => view?.players.find(p => p.id === view.me?.id);
const player = (id) => view?.players.find(p => p.id === id);
const isHost = () => view?.me?.isHost;
const seatName = (id) => {
  const p = player(id);
  return p ? `${p.name} (số ${p.seat})` : '';
};
// Just the name, for lists where seat numbers would only add clutter.
const nameOnly = (id) => player(id)?.name || '';
const shareUrl = () => `${location.origin}/?room=${view?.code || ''}`;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, body, query) {
  const url = '/api/room' + (query ? '?' + new URLSearchParams(query) : '');
  const sent = Date.now();
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  const received = Date.now();
  lastRtt = received - sent;
  const stamp = data.view?.serverNow ?? data.serverNow;
  if (stamp) syncClock(stamp, sent, received);
  if (!res.ok) {
    const err = new Error(data.error || 'Không kết nối được máy chủ.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Estimate the server clock assuming the reply was stamped half-way through the
// round trip. Keep the sample from the fastest recent request: a slow request
// says little about when the server actually stamped it.
function syncClock(serverStamp, sent, received) {
  const rtt = received - sent;
  const stale = received - clockSampledAt > 30000;
  if (rtt <= clockRtt * 1.5 || stale) {
    clockOffset = serverStamp - (sent + received) / 2;
    clockRtt = rtt;
    clockSampledAt = received;
  }
}

async function act(type, payload = {}) {
  if (!session) return;
  try {
    const data = await api('POST', { action: 'act', code: session.code, pid: session.playerId, token: session.token, type, payload });
    if (data.view) applyView(data.view);
    return true;
  } catch (e) {
    handleApiError(e);
    return false;
  }
}

function handleApiError(e) {
  if (e.status === 400 && /Phiên chơi|Không tìm thấy phòng|không còn ở trong phòng/.test(e.message)) {
    toast(e.message, 'error');
    leaveLocal();
    return;
  }
  toast(e.message, 'error');
}

// ---------------------------------------------------------------------------
// Sync: the server is the source of truth. A phone asks for its view when
//   1. a Realtime ping says the room changed (another player acted),
//   2. the current phase is due to end (wakeAt), so the server can advance it,
//   3. a slow heartbeat fires (safety net; fast polling if Realtime is down).
// ---------------------------------------------------------------------------

async function sync() {
  if (!session) return;
  if (fetching) {
    refetch = true;
    return fetching;
  }
  fetching = (async () => {
    try {
      const data = await api('GET', null, { code: session.code, pid: session.playerId, token: session.token, since: view?.version || 0 });
      failures = 0;
      if (data.view) applyView(data.view);
      setConnection(true);
    } catch (e) {
      failures++;
      if (e.status === 400) {
        handleApiError(e);
        return;
      }
      setConnection(false);
    } finally {
      fetching = null;
    }
    scheduleHeartbeat();
    scheduleWake();
    if (refetch) {
      refetch = false;
      sync();
    }
  })();
  return fetching;
}

function scheduleHeartbeat() {
  clearTimeout(heartbeatTimer);
  if (!session) return;
  const hidden = document.visibilityState === 'hidden';
  let delay;
  if (isHost() && view?.phase !== undefined) delay = 4000; // let the room know the speaker is still here
  else if (view?.hostOffline) delay = 3000;               // follow the vote for a new host closely
  else if (live) delay = 15000;
  else if (hidden) delay = 5000;
  else delay = Math.min((isHost() ? 1000 : 1500) * (1 + failures), 8000);
  heartbeatTimer = setTimeout(sync, delay);
}

// Ask the server for the next phase the moment the current one ends. Every
// phone does this itself (a little spread out) instead of waiting for the
// host's phone to advance it and a Realtime ping to come back, which added a
// whole extra round trip. Whichever request lands first advances the game;
// the others just read the new state.
function scheduleWake() {
  clearTimeout(wakeTimer);
  const at = view?.game?.wakeAt;
  if (!session || !at) return;
  const overdue = serverNow() - at;
  // If we already asked and the server said "not yet" (our clock runs a little
  // ahead of the server's), ask again shortly instead of waiting for the slow
  // heartbeat. Stop after a while: by then someone else has moved the game on.
  if (overdue > 10000) return;
  const grace = isHost() ? 60 : 120 + Math.random() * 250;
  const delay = overdue >= 0 ? 250 : -overdue + grace;
  const version = view.version;
  wakeTimer = setTimeout(() => {
    if (view?.version === version) sync();
  }, delay);
}

async function startRealtime() {
  stopRealtime();
  if (!session) return;
  if (realtimeConfig === undefined) {
    try {
      realtimeConfig = (await api('GET', null, { config: 1 })).realtime;
    } catch {
      realtimeConfig = null;
    }
  }
  const code = session.code;
  try {
    realtime = await connectRealtime(realtimeConfig, {
      code,
      playerId: session.playerId,
      onUpdate: (v) => {
        if (session?.code === code && (!view || !v || v > view.version)) setTimeout(sync, Math.random() * 60);
      },
      onPresence: (ids) => {
        presence = ids;
        watchHostPresence();
        if (view) render();
      },
      onStatus: (ok) => {
        const was = live;
        live = ok;
        setConnection(true);
        // Catch up on anything missed while disconnected.
        if (ok && !was) sync();
        else scheduleHeartbeat();
      }
    });
  } catch (err) {
    console.warn('Realtime unavailable, falling back to polling', err);
  }
}

// Realtime presence notices a vanished host phone within seconds; ask the
// server (which decides) once its timeout has passed.
function watchHostPresence() {
  const gone = presence?.size && view?.hostId && !presence.has(view.hostId);
  if (!gone) {
    clearTimeout(hostMissingTimer);
    hostMissingTimer = null;
  } else if (!hostMissingTimer) {
    hostMissingTimer = setTimeout(() => { hostMissingTimer = null; sync(); }, 12500);
  }
}

function stopRealtime() {
  realtime?.close();
  realtime = null;
  live = false;
  presence = null;
}

// Online if Realtime presence says so; otherwise trust the server's last-seen.
// Connection status is shown only where the server allows it (the host);
// everyone else always sees players as connected. Live presence only makes
// it fresher for the host, it never decides on its own.
const isOnline = (p) => p.isBot || !view?.seesConnections || (presence?.size ? presence.has(p.id) : p.online);

let connected = true;

function connectionHtml() {
  const timing = DEBUG && lastRtt != null ? ` (${lastRtt} ms)` : '';
  if (!connected) return '<span class="status-dot off"></span>Mất kết nối, đang thử lại…';
  return live
    ? `<span class="status-dot"></span>Đã kết nối, đồng bộ tức thì${timing}`
    : `<span class="status-dot"></span>Đã kết nối, đồng bộ định kỳ vì Realtime chưa chạy${timing}`;
}

function setConnection(ok) {
  connected = ok;
  const el = document.getElementById('conn');
  if (el) el.innerHTML = connectionHtml();
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function createRoom(name) {
  try {
    const data = await api('POST', { action: 'create', name, debug: DEBUG });
    enterRoom(data);
    // The game picked on the home page (rooms open on Ma Sói).
    if (homeGame !== 'werewolf') act('selectGame', { gameId: homeGame });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function joinRoom(code, name) {
  try {
    const data = await api('POST', { action: 'join', code, name });
    enterRoom(data);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function resumeBanner() {
  if (!savedRoom) return '';
  return `
    <section class="panel stack" style="margin-top:16px">
      <p>Bạn đang ở trong phòng <strong>${esc(savedRoom.code)}</strong>.</p>
      <div class="row">
        <button class="btn btn-primary" data-act="resumeRoom">Quay lại phòng</button>
        <button class="btn btn-ghost" data-act="forgetRoom">Bỏ qua</button>
      </div>
    </section>`;
}

async function checkSavedRoom(saved) {
  try {
    await api('GET', null, { code: saved.code, pid: saved.playerId, token: saved.token, check: 1 });
  } catch (e) {
    // Room gone, or we are no longer in it (unless we joined another meanwhile).
    if (e.status === 400 && !session) saveSession(null);
    return; // offline: say nothing, try again on the next visit
  }
  if (session || view) return; // created or joined another room meanwhile
  savedRoom = saved;
  const slot = document.getElementById('resumeSlot');
  if (slot) slot.innerHTML = resumeBanner();
}

function resumeRoom() {
  session = savedRoom;
  savedRoom = null;
  history.replaceState(null, '', `/?room=${session.code}${DEBUG ? '&debug=1' : ''}`);
  render();
  startRealtime();
  sync();
}

function enterRoom(data) {
  savedRoom = null;
  saveSession({ code: data.code, playerId: data.playerId, token: data.token });
  history.replaceState(null, '', `/?room=${data.code}${DEBUG ? '&debug=1' : ''}`);
  applyView(data.view);
  startRealtime();
  scheduleHeartbeat();
}

async function leaveRoom() {
  if (!confirm('Rời khỏi phòng này?')) return;
  if (view?.phase === 'LOBBY') await act('leave');
  leaveLocal();
}

function leaveLocal() {
  clearTimeout(heartbeatTimer);
  clearTimeout(wakeTimer);
  stopRealtime();
  saveSession(null);
  view = null;
  narrator.stop();
  narrator.setAmbience(false);
  releaseWakeLock();
  history.replaceState(null, '', DEBUG ? '/?debug=1' : '/');
  render();
}

function applyView(next) {
  const prev = view;
  view = next;
  if (prev && prev.version === next.version && screen === screenFor(next)) return;
  scheduleWake();
  onTransitions(prev, next);
  render();
}

function screenFor(v) {
  if (!v) return 'home';
  return v.phase === 'LOBBY' ? 'lobby' : 'game';
}

// Side effects when the game moves on: narrator, sounds, vibration.
function onTransitions(prev, next) {
  const phaseKey = `${next.phase}:${next.game.day}:${next.game.step}`;
  const phaseChanged = phaseKey !== lastPhaseKey;
  lastPhaseKey = phaseKey;

  const wasHost = prev?.me?.isHost;
  if (prev && !wasHost && next.me?.isHost) {
    toast(narrator.unlocked
      ? 'Máy bạn giờ là máy chủ phòng: quản trò sẽ đọc từ máy này.'
      : 'Máy bạn giờ là máy chủ phòng. Bấm “Bật giọng quản trò” để phát âm thanh.');
  }
  if (wasHost && !next.me?.isHost) {
    toast('Một máy khác đã trở thành máy chủ phòng.');
  }

  if (next.me?.isHost || localAudio) {
    if (phaseChanged && prev && narrator.unlocked) {
      if (next.phase === 'NIGHT' && prev.phase !== 'NIGHT') narrator.sfx('night');
      if (next.phase === 'MORNING') narrator.sfx('morning');
      if (next.phase === 'VERDICT' || next.phase === 'JUDGE') narrator.sfx('gavel');
    }
    narrator.handle(next.narration, { serverNow: serverNow() });
  }
  watchHostPresence();

  // Background music is a per-phone choice: any player can turn it on.
  narrator.setAmbienceTheme(ambienceTheme);
  narrator.setAmbienceVolume(ambienceVolume / 100);
  narrator.setAmbience(ambienceOn, moodForPhase(next.phase));
  if (next.me?.isHost && next.phase !== 'LOBBY') requestWakeLock();

  const task = next.me?.task;
  const taskKey = task ? `${phaseKey}:${task.role}` : null;
  if (taskKey && taskKey !== lastTaskKey && canVibrate && vibrateOn) navigator.vibrate([120, 80, 120]);
  // A sheet left open (the card, the notes…) covers the whole screen: close
  // it when the game starts and when it is your turn, so the choices can be
  // tapped straight away.
  const gameStarts = prev && ((['SWAP', 'REVEAL'].includes(prev.phase) && next.phase === 'NIGHT')
    || (prev.phase === 'LOBBY' && next.phase !== 'LOBBY' && next.gameId !== 'werewolf'));
  if (gameStarts || (taskKey && taskKey !== lastTaskKey)) {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
  }
  lastTaskKey = taskKey;

  if (prev && prev.phase === 'LOBBY' && next.phase !== 'LOBBY' && !['MORNING', 'REVEAL'].includes(next.phase) && next.me?.inGame) {
    toast('Ván chơi bắt đầu. Bấm “Lá bài của tôi” để xem vai trò.');
  }
  document.body.dataset.time = ['NIGHT', 'LOBBY', 'SWAP'].includes(next.phase) ? 'night' : 'day';
}

async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const next = screenFor(view);
  if (next !== screen) {
    screen = next;
    setupOpen = false;
    deckEdit = false;
    window.scrollTo(0, 0);
  }
  if (screen === 'home') renderHome();
  else if (screen === 'lobby') renderLobby();
  else renderGame();
}

function topbar(extra = '') {
  return `
    <header class="topbar">
      <a class="brand" href="/" data-act="home-link">Bàn Chơi</a>
      <div class="topbar-actions">
        ${extra}
        <button class="btn btn-ghost btn-small" data-act="rules">Luật chơi</button>
      </div>
    </header>`;
}

// The phase timer: a brass ring that empties clockwise from the top.
// fraction 1 = full ring, 0 = time is up.
function dialSvg(fraction, day = false) {
  const f = Math.max(0, Math.min(1, fraction));
  const stroke = day ? '#e8b85a' : 'var(--brass)';
  const a = (f * 360 - 90) * Math.PI / 180;
  const x = (28 + 25 * Math.cos(a)).toFixed(1);
  const y = (28 + 25 * Math.sin(a)).toFixed(1);
  const arc = f >= 0.999
    ? `<circle cx="28" cy="28" r="25" fill="none" stroke="${stroke}" stroke-width="3"/>`
    : f > 0 ? `<path d="M28 3 A25 25 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>` : '';
  return `
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="25" fill="var(--felt-3)" stroke="var(--brass)" stroke-opacity="0.35" stroke-width="2"/>
      ${arc}
    </svg>`;
}

// A crescent moon on a card back.
function crescentSvg() {
  return `<svg viewBox="0 0 92 92" aria-hidden="true">
    <circle cx="46" cy="46" r="40" fill="var(--face)" stroke="var(--brass)" stroke-width="2"/>
    <path d="M58 22a26 26 0 1 0 10 40a22 22 0 1 1-10-40z" fill="var(--token)"/>
  </svg>`;
}

// ---------- Home ----------

function renderHome() {
  document.body.dataset.time = 'night';
  if (session) {
    app.innerHTML = `${topbar()}<p class="muted" style="margin-top:40px">Đang vào lại phòng ${esc(session.code)}…</p>`;
    return;
  }
  const savedName = read(NAME_KEY) || '';
  const code = (params.get('room') || '').toUpperCase();
  app.innerHTML = `
    ${topbar()}
    <div id="resumeSlot">${resumeBanner()}</div>
    <section class="hero">
      <div class="hero-card" aria-hidden="true">${crescentSvg()}</div>
      <h1>Bàn Chơi</h1>
      <p>Trò chơi nhóm ngồi chung bàn: mỗi người một điện thoại, một lá bài bí mật. Tạo phòng một lần, chơi bao nhiêu ván, đổi trò bao nhiêu lần cũng được.</p>
    </section>

    <section class="shelf" aria-label="Các trò chơi">
      ${GAMES_INFO.map(g => `
        <button class="shelf-game ${homeGame === g.id && homeTab === 'create' ? 'on' : ''}" data-act="homeGame" data-game="${g.id}" ${g.ready ? '' : 'disabled'} aria-pressed="${homeGame === g.id}">
          <span class="ic" aria-hidden="true">${g.icon}</span>
          <span class="txt"><strong>${g.name}</strong><span class="meta">${g.min}–${g.max} người · ${g.time}</span><span class="blurb">${g.blurb}</span></span>
          ${g.ready ? '' : '<span class="soon">Sắp có</span>'}
        </button>`).join('')}
    </section>

    <div class="stack-lg" style="margin-top:24px">
      <div class="segmented" role="group" aria-label="Chọn cách vào chơi">
        <button data-act="tab" data-tab="create" aria-pressed="${homeTab === 'create'}">Tạo phòng mới</button>
        <button data-act="tab" data-tab="join" aria-pressed="${homeTab === 'join'}">Vào phòng</button>
      </div>

      <form class="panel stack" id="homeForm" autocomplete="off">
        <div class="field">
          <label for="nameInput">Tên của bạn</label>
          <input class="input" id="nameInput" maxlength="20" required value="${esc(savedName)}" placeholder="Ví dụ: Minh" enterkeyhint="go" />
        </div>
        ${homeTab === 'join' ? `
          <div class="field">
            <label for="codeInput">Mã phòng</label>
            <input class="input input-code" id="codeInput" maxlength="5" required value="${esc(code)}" placeholder="ABCDE" autocapitalize="characters" spellcheck="false" />
            <p class="hint">Chủ phòng sẽ gửi cho bạn mã 5 ký tự hoặc một đường link.</p>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Vào phòng</button>
        ` : `
          <p class="muted small">Bạn sẽ là chủ phòng và chơi <strong>${esc(gameInfo(homeGame).name)}</strong> trước (đổi được trong phòng chờ).</p>
          <button class="btn btn-primary btn-block" type="submit">Tạo phòng</button>
        `}
      </form>
    </div>`;

  document.getElementById('homeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return toast('Hãy nhập tên của bạn.', 'error');
    store(NAME_KEY, name);
    if (homeTab === 'join') {
      const c = document.getElementById('codeInput').value.trim().toUpperCase();
      if (c.length !== 5) return toast('Mã phòng gồm 5 ký tự.', 'error');
      joinRoom(c, name);
    } else {
      createRoom(name);
    }
  });
}

// ---------- Lobby ----------

// Pick how many computer players to add, then add them in one go.
function botAdder() {
  const free = MAX_PLAYERS + 1 - view.players.length;
  botCount = Math.max(1, Math.min(botCount, free));
  return `<div class="stack" style="margin-bottom:8px">
    <div class="row" style="flex-wrap:wrap">
      <span class="small">🤖 Người chơi máy</span>
      <div class="stepper">
        <button data-act="botCount" data-delta="-1" ${botCount > 1 ? '' : 'disabled'} aria-label="Bớt một">−</button>
        <output>${botCount}</output>
        <button data-act="botCount" data-delta="1" ${botCount < free ? '' : 'disabled'} aria-label="Thêm một">+</button>
      </div>
      <button class="btn btn-ghost btn-small" data-act="addBot" ${free > 0 ? '' : 'disabled'}>Thêm ${botCount}</button>
    </div>
    <span class="muted small">${free > 0
      ? 'Máy tự chọn và bỏ phiếu ngẫu nhiên. Bấm “Mời ra” để bớt.'
      : 'Phòng đã đầy.'}</span>
  </div>`;
}

function renderLobby() {
  const host = isHost();
  // The host goes through "Chuẩn bị ván" (voice, rules, times) before dealing.
  const mode = host && setupOpen ? 'setup' : 'lobby';
  const root = document.getElementById('lobbyRoot');
  const focusInSettings = document.activeElement?.closest?.('#rulesStep, #timesStep');
  if (!root || root.dataset.mode !== mode) {
    app.innerHTML = mode === 'setup' ? `
      ${topbar('<button class="btn btn-ghost btn-small" data-act="leave">Rời phòng</button>')}
      <div id="lobbyRoot" data-mode="setup" class="stack-lg">
        <div id="hostAlert"></div>
        <header>
          <h1 style="font-size:2.3rem">Chuẩn bị ván</h1>
          <p class="muted small" style="margin-top:6px">Bước cuối trước khi chia bài. Chỉ chủ phòng thấy màn hình này, mọi người đang chờ.</p>
        </header>
        <ol class="setup-steps">
          <li class="panel current">
            <div class="step-head"><span class="step-num">1</span><h2>Giọng quản trò</h2></div>
            <div id="hostVoice" class="stack"></div>
          </li>
          <li class="panel" id="rulesStep"></li>
          <li class="panel" id="timesStep"></li>
        </ol>
      </div>
      <div class="bottom-bar"><div class="bottom-bar-inner" id="lobbyFooter"></div></div>` : `
      ${topbar('<button class="btn btn-ghost btn-small" data-act="leave">Rời phòng</button>')}
      <div id="lobbyRoot" data-mode="lobby" class="stack-lg">
        <div id="hostAlert"></div>
        <header id="roomInfo"></header>
        <section id="gamePick"></section>
        <section id="players"></section>
        <section class="panel" id="roles"></section>
        <section id="hostVoice"></section>
        <section class="panel" id="board"></section>
      </div>
      <div class="bottom-bar"><div class="bottom-bar-inner" id="lobbyFooter"></div></div>`;
  }

  renderHostAlert();
  const wolf = view.gameId === 'werewolf';
  const info = gameInfo(view.gameId);
  // Only Ma Sói has a host who may just narrate; in the other games all play.
  const participants = wolf ? view.players.filter(p => !(p.isHost && !view.config.hostPlays)) : view.players;
  const problem = participants.length < info.min
    ? `Cần thêm ${info.min - participants.length} người nữa để bắt đầu.`
    : participants.length > info.max ? `${info.name} chơi tối đa ${info.max} người.`
    : wolf ? validateRoleCounts(view.roleCounts, participants.length) : null;
  renderVoicePanel(host);

  if (mode === 'setup') {
    if (!focusInSettings) {
      document.getElementById('rulesStep').innerHTML = setupRules();
      document.getElementById('timesStep').innerHTML = setupTimes();
    }
    document.getElementById('lobbyFooter').innerHTML = `
      ${problem ? `<p class="note">${esc(problem)}</p>` : ''}
      <div class="bar-row">
        <button class="btn btn-ghost btn-big btn-back" data-act="setupClose">Quay lại</button>
        <button class="btn btn-primary btn-big btn-go" data-act="start" ${problem ? 'disabled' : ''}>Chia bài và bắt đầu</button>
      </div>`;
    return;
  }

  document.getElementById('roomInfo').innerHTML = `
    <div class="lobby-head">
      <div>
        <p class="muted small">Mã phòng</p>
        <h1 class="room-code">${esc(view.code)}</h1>
      </div>
      <button class="btn btn-ghost" data-act="share">Mời bạn</button>
    </div>
    <p class="muted small" id="conn" style="margin-top:6px">${connectionHtml()}</p>`;

  document.getElementById('gamePick').innerHTML = gamePicker(host);

  document.getElementById('players').innerHTML = `
    <div class="section-head">
      <p class="muted small">Người chơi đã vào: ${participants.length}</p>
    </div>
    ${host ? botAdder() : ''}
    <ul class="tokens">
      ${view.players.map(p => `
        <li class="${p.id === view.me.id ? 'me' : ''}">
          <span class="token ${isOnline(p) ? '' : 'off'}">${p.seat ?? '★'}</span>
          <span class="name">${esc(p.name)}</span>
          ${p.isHost ? `<span class="tag tag-host">${!wolf || view.config.hostPlays ? 'Chủ phòng' : 'Quản trò'}</span>` : ''}
          ${!isOnline(p) ? '<span class="tag tag-off">Mất kết nối</span>' : ''}
          ${host && !p.isHost ? `<button class="kick" data-act="kick" data-id="${esc(p.id)}" aria-label="Mời ${esc(p.name)} ra khỏi phòng">✕</button>` : ''}
        </li>`).join('')}
    </ul>
    ${participants.length < info.min ? `<p class="hint">${info.name} cần ít nhất ${info.min} người chơi. Hãy gửi link mời cho bạn bè.</p>` : ''}`;

  // Each game's own panel: the deck for Ma Sói, settings for the others.
  const roles = document.getElementById('roles');
  if (!wolf) {
    if (!roles.contains(document.activeElement)) roles.innerHTML = gameUI().lobby(helpers());
  } else {
    roles.innerHTML = host && deckEdit ? deckEditor(participants.length) : deckPanel(participants.length, host);
  }

  const board = document.getElementById('board');
  board.hidden = !view.stats?.games;
  if (!board.hidden) board.innerHTML = leaderboard();

  document.getElementById('lobbyFooter').innerHTML = !host
    ? `<p class="note">Đang chờ chủ phòng bắt đầu ván ${esc(info.name)}…</p>`
    : wolf
    ? `<p class="note">${esc(problem || 'Tiếp theo: thử giọng quản trò, chỉnh luật và thời gian')}</p>
       <button class="btn btn-primary btn-block btn-big" data-act="setupOpen" ${problem ? 'disabled' : ''}>Tiếp tục</button>`
    : `${problem ? `<p class="note">${esc(problem)}</p>` : ''}
       <button class="btn btn-primary btn-block btn-big" data-act="start" ${problem ? 'disabled' : ''}>Bắt đầu ${esc(info.name)}</button>`;
}

// The games on the table: the host picks the next one, everyone sees which.
function gamePicker(host) {
  const current = gameInfo(view.gameId);
  if (!host) {
    return `<div class="game-now"><span class="ic" aria-hidden="true">${current.icon}</span><span><span class="muted small">Ván tiếp theo</span><strong>${current.name}</strong></span></div>`;
  }
  return `
    <p class="muted small" style="margin-bottom:8px">Chọn trò chơi cho ván tiếp theo</p>
    <div class="game-pick" role="group" aria-label="Trò chơi">
      ${GAMES_INFO.map(g => `
        <button class="pick-game ${g.id === view.gameId ? 'on' : ''}" data-act="selectGame" data-game="${g.id}" aria-pressed="${g.id === view.gameId}" ${g.ready ? '' : 'disabled'}>
          <span class="ic" aria-hidden="true">${g.icon}</span><span class="nm">${g.name}</span>${g.ready ? '' : '<span class="soon">Sắp có</span>'}
        </button>`).join('')}
    </div>`;
}

// What the other games' modules may use from here.
function helpers() {
  return {
    view, esc, nameOnly, roundTable, voteList, fmtSeconds, isHost, act, toast,
    render: () => render(),
    renderCard: () => renderCard(false)
  };
}

// The host's deck editor, kept to what is needed: one status line (count or
// what is wrong, with the fix), −/+ for the cards that come in numbers, the
// balance, then the roles to tap, one side at a time. Nothing balances
// itself: a tap puts that card in or takes it out.
let editTab = 'village';
let roleInfo = null;
const EDIT_TABS = [['village', 'Phe Dân', ['village']], ['werewolf', 'Phe Sói', ['werewolf']], ['third', 'Thứ ba', ['piper', 'fool', 'hoodlum']]];
function deckEditor(count) {
  const counts = view.roleCounts;
  const needed = cardsNeeded(counts, count);
  const total = totalRoles(counts);
  const score = balanceScore(counts);
  const pos = 50 + Math.max(-20, Math.min(20, score)) * 2.5;
  const special = (id) => id !== 'werewolf' && id !== 'villager';
  const stepper = (id, label, canDown) => `<span class="mini-step">
      <button data-act="roleStep" data-role="${id}" data-delta="-1" ${canDown ? '' : 'disabled'} aria-label="Bớt một ${label}">−</button>
      <output>${counts[id] || 0}</output>
      <button data-act="roleStep" data-role="${id}" data-delta="1" aria-label="Thêm một ${label}">+</button>
    </span>`;

  // One line says where the deck stands.
  let status;
  if (total !== needed) {
    const fix = total < needed || counts.villager >= total - needed
      ? `<button class="btn btn-small btn-primary" data-act="fitDeck">${total < needed ? `Thêm ${needed - total} Dân Làng` : `Bớt ${total - needed} Dân Làng`}</button>` : '';
    status = `<div class="deck-count off"><span><strong>${total}/${needed} lá</strong>${counts.thief ? ' (Ăn Trộm cần dư 2 lá)' : ''}</span>${fix}</div>`;
  } else {
    const problem = count >= MIN_PLAYERS ? validateRoleCounts(counts, count) : `Cần ít nhất ${MIN_PLAYERS} người chơi.`;
    status = problem
      ? `<div class="deck-count off"><span>${esc(problem)}</span></div>`
      : `<div class="deck-count ok"><span><strong>${total}/${needed} lá</strong>, sẵn sàng chia bài</span></div>`;
  }

  const tab = EDIT_TABS.find(x => x[0] === editTab);
  const tiles = ROLE_IDS
    .filter(id => special(id) && tab[2].includes(ROLES[id].team))
    .sort(tab[0] === 'werewolf' ? (a, b) => -byPoints(a, b) : byPoints)
    .map(id => {
      const r = ROLES[id];
      const on = counts[id] > 0;
      // With "Quản trò tự ghép đôi" the game makes the couple: no Cupid card.
      if (id === 'cupid' && view.config.autoLovers && !on) {
        return `<button class="role-tile" disabled aria-disabled="true">
          <span class="ic" aria-hidden="true">${r.icon}</span>
          <span class="nm">${r.name}</span>
          <span class="tile-note">Quản trò tự ghép đôi</span>
        </button>`;
      }
      return `<button class="role-tile ${on ? 'on' : ''}" data-act="pickRole" data-role="${id}" aria-pressed="${on}">
          ${counts[id] > 1 ? `<span class="badge">×${counts[id]}</span>` : ''}
          <span class="ic" aria-hidden="true">${r.icon}</span>
          <span class="nm">${r.name}</span>
        </button>`;
    }).join('');
  const inTab = (ids) => ROLE_IDS.filter(id => special(id) && ids.includes(ROLES[id].team) && counts[id] > 0).length;
  const info = roleInfo && ROLES[roleInfo];
  return `
    <div class="section-head">
      <h2>Sửa bộ bài</h2>
      <button class="btn btn-ghost btn-small" data-act="autoBalance">Gợi ý bộ bài</button>
    </div>
    ${status}
    <div class="deck-steps">
      <div class="step-row w"><span>Ma Sói</span>${stepper('werewolf', 'Ma Sói', counts.werewolf > 0)}</div>
      <div class="step-row v"><span>Dân Làng</span>${stepper('villager', 'Dân Làng', counts.villager > 0)}</div>
      ${counts.mason ? `<div class="step-row"><span>Hội Kín</span>${stepper('mason', 'Hội Kín', counts.mason > 2)}</div>` : ''}
    </div>
    <div class="balance-track" role="img" aria-label="Điểm cân bằng ${score}: ${balanceLabel(score)}"><span style="left:${pos}%"></span></div>
    <p class="balance-legend"><span>Sói</span><strong>${balanceLabel(score)[0].toUpperCase() + balanceLabel(score).slice(1)}</strong><span>Dân</span></p>

    <div class="board-tabs edit-tabs" role="group" aria-label="Phe">
      ${EDIT_TABS.map(([id, label, teams]) => {
        const n = inTab(teams);
        return `<button data-act="editTab" data-tab="${id}" aria-pressed="${editTab === id}">${label}${n ? ` (${n})` : ''}</button>`;
      }).join('')}
    </div>
    <div class="role-tiles">${tiles}</div>
    ${info ? `<p class="role-info" aria-live="polite"><strong>${info.name}</strong>: ${info.short}</p>` : ''}
    <button class="btn btn-primary btn-block btn-big" style="margin-top:14px" data-act="deckEdit">Xong</button>`;
}

// The deck as a hand of small cards, wolves first, with the balance above.
function deckPanel(count, host) {
  const counts = view.roleCounts;
  const total = totalRoles(counts);
  const score = balanceScore(counts);
  const pos = 50 + Math.max(-20, Math.min(20, score)) * 2.5;
  const groups = [ROLE_GROUPS[1], ROLE_GROUPS[0], ROLE_GROUPS[2]];
  const cards = groups.flatMap(group => ROLE_IDS
    .filter(id => group.teams.includes(ROLES[id].team) && counts[id] > 0)
    .sort(group.order)
    .map(id => `<li class="${group.cls}"><span class="ic" aria-hidden="true">${ROLES[id].icon}</span><span class="nm">${ROLES[id].name}</span><span class="n">${counts[id]}</span></li>`));
  return `
    <div class="section-head">
      <h2>Bộ bài</h2>
      <p class="muted small">${total} lá cho ${count} người${counts.thief ? ' (dư 2 lá cho Ăn Trộm)' : ''}</p>
    </div>
    <div class="balance-track" role="img" aria-label="Điểm cân bằng ${score}: ${balanceLabel(score)}"><span style="left:${pos}%"></span></div>
    <p class="balance-legend"><span>← Sói</span><strong>${balanceLabel(score)[0].toUpperCase() + balanceLabel(score).slice(1)} (${score > 0 ? '+' : ''}${score})</strong><span>Dân →</span></p>
    ${view.config.autoLovers ? '<p class="deck-note">💘 Không có lá Thần Tình Yêu: quản trò tự ghép một cặp Tình Nhân trước đêm đầu.</p>' : ''}
    ${view.config.artifacts ? '<p class="deck-note">🗝️ Có Artifact: mỗi người nhận thêm 1 lá Artifact úp.</p>' : ''}
    <ul class="deck-mini">
      ${cards.join('')}
      <li class="edit-slot"><button class="edit" data-act="${host ? 'deckEdit' : 'deck'}">${host ? 'Sửa bộ bài' : 'Xem mô tả vai'}</button></li>
    </ul>`;
}

// "Chuẩn bị ván", step 2: the house rules for this game.
function setupRules() {
  const c = view.config;
  const row = (key, title, desc) => `
    <label class="toggle-row">
      <span><strong>${title}</strong><span class="muted">${desc}</span></span>
      <input type="checkbox" data-config="${key}" ${c[key] ? 'checked' : ''} />
    </label>`;
  return `
    <div class="step-head"><span class="step-num">2</span><h2>Luật ván này</h2></div>
    ${row('hostPlays', 'Tôi cũng nhận bài và chơi', 'Bỏ chọn nếu bạn chỉ làm quản trò. Khi đó bạn thấy được mọi vai trò.')}
    ${row('swapEnabled', 'Cho phép trao đổi vai', 'Sau khi chia bài, ai không thích vai của mình có thể bấm “Trao đổi vai”; hết giờ các lá được chia lại ngẫu nhiên, ẩn danh.')}
    ${row('revealRoleOnDeath', 'Lật bài người chết', 'Cả làng thấy vai trò của người vừa bị loại.')}
    ${row('autoLovers', 'Quản trò tự ghép đôi', 'Không dùng lá Thần Tình Yêu: lúc xem lá bài trước đêm đầu (sau khi trao đổi vai), game chọn ngẫu nhiên 2 người làm Tình Nhân. Hai người thấy nhau trên lá bài.')}
    ${row('artifacts', '🗝️ Chơi với Artifact', 'Luật mở rộng Ultimate Werewolf: Artifacts. Mỗi người nhận thêm 1 lá Artifact úp có sức mạnh riêng, được lật ra dùng trong lúc thảo luận ban ngày. Xem luật trong “Luật chơi”. Nên dùng khi cả bàn đã quen Ma Sói.')}`;
}

// "Chuẩn bị ván", step 3: how long each part lasts. The day's main steps
// up front, the rest (each night role, defence, verdict) folded away.
function setupTimes() {
  const main = ['discussionTime', 'voteTime', ...(view.config.swapEnabled ? ['swapTime'] : [])];
  const all = [...SLIDERS, ...stepSliders()];
  return `
    <div class="step-head"><span class="step-num">3</span><h2>Thời gian</h2></div>
    ${sliderRows(all.filter(s => main.includes(s[0])))}
    <details class="section" id="settingsBox" ${settingsOpen ? 'open' : ''}>
      <summary><span class="btn-link">Chỉnh từng vai ban đêm, biện hộ, phán quyết</span></summary>
      ${sliderRows(all.filter(s => !main.includes(s[0])))}
    </details>`;
}

// Don't redraw under the host's finger (e.g. while dragging the volume).
function renderVoicePanel(host) {
  const el = document.getElementById('hostVoice');
  if (!el || document.activeElement?.matches?.('#hostVoice input[type=range], #hostVoice select')) return;
  // The host tests the voice in "Chuẩn bị ván"; other phones get their own options.
  el.innerHTML = host ? (setupOpen ? voicePanel() + deviceRows() : '') : deviceOptions(true);
}

// Per-phone options, stored on this phone only.
function deviceRows() {
  const items = [];
  if (!isHost()) {
    items.push(`<label class="check" style="padding:0"><input type="checkbox" data-act="localAudio" ${localAudio ? 'checked' : ''} /> <span>Phát âm thanh trên máy này</span></label>`);
  }
  if (canVibrate) {
    items.push(`<label class="check" style="padding:0"><input type="checkbox" data-act="vibrate" ${vibrateOn ? 'checked' : ''} /> <span>Rung khi đến lượt</span></label>`);
  }
  return `${items.length ? `<div class="row" style="flex-wrap:wrap;gap:16px">${items.join('')}</div>` : ''}${musicControls()}`;
}

function deviceOptions(panel = false) {
  return panel
    ? `<div class="panel stack"><h3>Trên máy này</h3><p class="muted small">Chỉ áp dụng cho điện thoại của bạn.</p>${deviceRows()}</div>`
    : `<div class="stack">${deviceRows()}</div>`;
}

// Shown to everyone while the host phone is unreachable.
function renderHostAlert() {
  const box = document.getElementById('hostAlert');
  if (!box) return;
  const h = view.hostOffline;
  if (!h) {
    box.innerHTML = '';
    return;
  }
  const oldHost = player(view.hostId);
  if (h.night) {
    // At night only a notice: voting would show who is awake.
    box.innerHTML = `
      <section class="panel stack" style="border-color:rgba(233,162,59,.6)">
        <h3>Máy chủ phòng mất kết nối</h3>
        <p class="small">${esc(oldHost?.name || 'Máy chủ phòng')} không còn kết nối, nên tạm thời không có tiếng quản trò. Ván vẫn tiếp tục; khi trời sáng cả làng sẽ chọn máy làm loa mới.</p>
      </section>`;
    return;
  }
  const counts = {};
  Object.values(h.votes).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const mine = h.votes[view.me.id];
  const isOldHost = view.me.id === view.hostId;
  box.innerHTML = `
    <section class="panel stack" style="border-color:rgba(233,162,59,.6)">
      <h3>Máy chủ phòng mất kết nối</h3>
      <p class="small">${esc(oldHost?.name || 'Máy chủ phòng')} không còn kết nối, nên tạm thời không có tiếng quản trò. Ván vẫn tiếp tục. Hãy chọn máy sẽ làm loa mới (nên đặt giữa bàn).</p>
      ${isOldHost ? '<p class="small muted">Đang kết nối lại máy của bạn…</p>' : `
      <div class="village">${h.candidates.map(id => player(id)).filter(Boolean).map(p => seat(p, {
        selectable: true, act: 'hostVote', pressed: mine === p.id, count: counts[p.id] || 0,
        sub: p.id === view.me.id ? 'Máy của tôi' : ''
      })).join('')}</div>`}
      <p class="muted small">Cần ${h.needed} phiếu, hoặc chờ mọi người bầu xong. Hoà phiếu thì bốc thăm. ${h.endsAt ? 'Tự chốt sau 20 giây kể từ phiếu đầu tiên.' : ''}</p>
    </section>`;
}

function voicePanel() {
  const status = narrator.hasRecordedVoice
    ? 'Đang dùng giọng đọc thu sẵn.'
    : narrator.voice
      ? `Đang dùng giọng của trình duyệt: ${esc(narrator.voice.name)}.`
      : 'Máy này chưa có giọng tiếng Việt. Hãy dùng Chrome hoặc Edge, hoặc tạo file giọng đọc (xem README).';
  return `
    <p class="small" style="color:var(--soft)">Máy này sẽ đọc lời dẫn. Đặt máy giữa bàn, bật âm lượng to.</p>
    <p class="muted small">${status}</p>
    <button class="btn btn-block ${narrator.unlocked ? 'btn-ghost' : 'btn-primary'}" data-act="testVoice">${narrator.unlocked ? 'Nghe thử lại' : 'Bật âm thanh và nghe thử'}</button>`;
}

// Background music: on/off, theme and volume, stored on this phone only.
function musicControls() {
  return `
    <div class="stack music-controls">
      <div class="row" style="flex-wrap:wrap;gap:16px;align-items:center">
        <label class="check" style="padding:0"><input type="checkbox" data-act="ambience" ${ambienceOn ? 'checked' : ''} /> <span>Nhạc nền</span></label>
        <label class="small" style="display:flex;gap:8px;align-items:center">Chủ đề
          <select class="input input-small" id="ambienceTheme">${THEME_IDS.map(id => `<option value="${id}" ${id === ambienceTheme ? 'selected' : ''}>${THEMES[id].name}</option>`).join('')}</select>
        </label>
      </div>
      <div class="slider">
        <div class="row-between"><label for="ambienceVolume">Âm lượng nhạc nền</label><span class="slider-value" id="ambienceVolumeValue">${ambienceVolume}%</span></div>
        <input type="range" id="ambienceVolume" min="0" max="100" step="5" value="${ambienceVolume}" />
      </div>
    </div>`;
}

const SLIDERS = [
  ['swapTime', 'Thời gian trao đổi vai', 5, 60, 5],
  ['discussionTime', 'Thảo luận', 30, 600, 15],
  ['voteTime', 'Bỏ phiếu nghi phạm', 10, 120, 5],
  ['defenseTime', 'Biện hộ', 10, 180, 5],
  ['judgeTime', 'Phán quyết treo cổ', 10, 90, 5],
  ['nightPauseTime', 'Ban đêm: nghỉ giữa hai lượt', 0, 5, 1]
];

// One action-time slider per night step whose card is in the deck.
function stepSliders() {
  const counts = view.roleCounts || {};
  return NIGHT_STEPS
    .filter(st => [st.role, ...(st.also || [])].some(id => counts[id] > 0))
    .map(st => [`step_${st.id}`, `Lượt ${stepInfo(st.id).name}${st.id === 'werewolf' ? ' (+5 giây mỗi lá Sói thêm)' : ''}`, 5, 120, 5]);
}

function timeSliders() {
  return sliderRows([...SLIDERS, ...stepSliders()]);
}

function sliderRows(list) {
  const c = view.config;
  return list.map(([key, label, min, max, step]) => `
    <div class="slider">
      <div class="row-between"><label for="cfg-${key}">${label}</label><span class="slider-value" id="val-${key}">${fmtSeconds(c[key])}</span></div>
      <input type="range" id="cfg-${key}" data-config="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}" />
    </div>`).join('');
}

// During the game the host can still retime every step.
let timersOpen = false;
function hostTimers() {
  return `<details class="panel section" id="timersBox" ${timersOpen ? 'open' : ''}>
    <summary><h3>⏱️ Chỉnh thời gian</h3></summary>
    <p class="muted small">Áp dụng từ lượt tiếp theo.</p>
    ${timeSliders()}
  </details>`;
}

const fmtSeconds = (s) => s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${s % 60} giây` : ''}` : `${s} giây`;

// The role list is grouped by side, each sorted by the role's points: the
// village's strongest helpers first, the most dangerous wolves first.
const byPoints = (a, b) => ROLES[b].points - ROLES[a].points;
const ROLE_GROUPS = [
  { title: 'Phe Dân', cls: 'v', teams: ['village'], order: byPoints },
  { title: 'Phe Sói', cls: 'w', teams: ['werewolf'], order: (a, b) => -byPoints(a, b) },
  { title: 'Phe thứ ba', cls: 't', teams: ['piper', 'fool', 'hoodlum'], order: byPoints }
];

// ---------- Game ----------

const PHASE_TITLE = {
  NIGHT: (g) => `Đêm ${g.day}`,
  MORNING: (g) => `Sáng ngày ${g.day}`,
  SWAP: () => 'Trao đổi vai',
  REVEAL: () => 'Xem lá bài',
  DISCUSSION: (g) => `Ngày ${g.day}: thảo luận`,
  VOTE: (g) => `Ngày ${g.day}: bỏ phiếu`,
  DEFENSE: (g) => `Ngày ${g.day}: biện hộ`,
  JUDGE: (g) => `Ngày ${g.day}: phán quyết`,
  VERDICT: (g) => `Ngày ${g.day}: kết quả`,
  GAME_OVER: () => 'Ván chơi kết thúc'
};

// Votes are public, like hands raised around the table: who picked whom.
function voteList(votes) {
  const byTarget = {};
  Object.entries(votes || {}).forEach(([voter, target]) => { (byTarget[target] ||= []).push(voter); });
  const rows = Object.entries(byTarget).sort((a, b) => b[1].length - a[1].length);
  if (!rows.length) return '';
  return `<ul class="vote-list">${rows.map(([target, voters]) => `
    <li><strong>${esc(nameOnly(target))}</strong> ← ${esc(voters.map(nameOnly).join(', '))}</li>`).join('')}</ul>`;
}

function judgeList(judge) {
  const names = (choice) => Object.keys(judge || {}).filter(id => judge[id] === choice).map(nameOnly).join(', ');
  const kill = names('kill');
  const spare = names('spare');
  if (!kill && !spare) return '';
  return `<ul class="vote-list">
    ${kill ? `<li>🪢 <strong>Treo cổ</strong> ← ${esc(kill)}</li>` : ''}
    ${spare ? `<li>🕊️ <strong>Tha mạng</strong> ← ${esc(spare)}</li>` : ''}
  </ul>`;
}

// The one "done" button. For the pack it marks this wolf as ready; the turn
// ends when every living wolf is.
// A turn ends by itself once the role has done its part. Below the choices:
// "Thêm 5 giây" for a player who needs longer, and a button to pass on what
// is left (not guarding anyone, keeping the gun where it is…). The pack has
// no pass: a wolf picks "Không cắn ai" instead.
function endTurnButton(m) {
  const t = m.task;
  if (t.complete) return '';
  const extend = '<button class="btn btn-primary end-turn" data-act="extend">⏳ Thêm 5 giây</button>';
  let pass = '';
  if (t.powerless) pass = 'Đã hiểu';
  else if (t.role !== 'werewolf' && t.role !== 'thief' && t.role !== 'doppelganger') {
    const keepAim = ['hunter', 'avenger'].includes(t.role) && !t.spent && t.lastAim && player(t.lastAim)?.alive;
    pass = t.role === 'elder' ? 'Đã hiểu'
      : keepAim ? 'Giữ nguyên mục tiêu'
      : t.role === 'witch' && (t.healed || t.poisoned) ? 'Xong, không dùng thêm'
      : t.role === 'witch' ? 'Không dùng bình nào'
      : 'Bỏ qua lượt này';
  }
  const passBtn = pass ? `<button class="btn btn-ghost end-turn" data-act="endTurn">${pass}</button>` : '';
  // Nothing to decide (elder, lost power): just the one button.
  if (t.powerless || t.role === 'elder') return `<div class="footer-row turn-row">${passBtn}</div>`;
  return `<div class="footer-row turn-row">${extend}${passBtn}</div>`;
}

function renderGame() {
  // Ma Sói is drawn here; the other games draw their stage and card through
  // their module, inside the same room shell.
  const wolf = view.gameId === 'werewolf';
  const root = document.getElementById('gameRoot');
  if (!root || root.dataset.game !== view.gameId) {
    app.innerHTML = `
      ${topbar(`${wolf ? '<button class="btn btn-ghost btn-small" data-act="deck">Bộ bài</button>' : ''}<button class="btn btn-ghost btn-small" data-act="leave">Rời</button>`)}
      <div id="gameRoot" class="stack-lg" data-game="${esc(view.gameId)}">
        <header class="ribbon" id="sky"></header>
        <ol class="night-strip" id="nightStrip" aria-label="Thứ tự gọi đêm nay"></ol>
        <div id="hostAlert"></div>
        <div id="narration"></div>
        <section class="stage" id="stage"></section>
        <section id="villageBox" aria-label="Bàn tròn"></section>
        <section class="panel" id="boardBox"></section>
        <details class="drawer section" id="drawer">
          <summary><h3 id="drawerTitle"></h3></summary>
          <div id="hostBar"></div>
          <div id="hostTimers"></div>
        </details>
        <details class="panel section" id="logBox">
          <summary><h3>Nhật ký ván chơi</h3></summary>
          <div class="row" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-small" data-act="exportLog">Tải nhật ký (.txt)</button>
            <button class="btn btn-ghost btn-small" data-act="copyLog">Sao chép nhật ký</button>
          </div>
          <ul class="log" id="log"></ul>
        </details>
        <p class="muted small" id="conn">${connectionHtml()}</p>
      </div>
      <div class="bottom-bar with-hand"><div class="bottom-bar-inner" id="gameFooter"></div></div>`;
  }
  const g = view.game;
  document.getElementById('sky').innerHTML = `
    <div class="dial" id="moon">${dialSvg(1)}<span class="time" id="timeLeft"></span></div>
    <div>
      <h1>${wolf ? PHASE_TITLE[view.phase](g) : gameUI().title(view)}</h1>
      <p class="phase-sub">${wolf ? phaseSubtitle() : gameUI().subtitle(view, helpers())}</p>
    </div>`;
  updateClock();
  const strip = nightStrip();
  const stripEl = document.getElementById('nightStrip');
  stripEl.innerHTML = strip;
  stripEl.hidden = !strip;

  // Before the first night (swap, then a look at the cards) the screen is
  // kept to the card and the swap: the rest appears when the game starts.
  const opening = ['SWAP', 'REVEAL'].includes(view.phase);
  document.getElementById('narration').hidden = opening;
  renderNarration();
  // The host's tools and this phone's sound options, folded under the table.
  // Leave them alone while a control in them is in use (dragging the volume,
  // choosing a theme).
  const drawer = document.getElementById('drawer');
  // The host's table sits up top, right under the calling order; a player's
  // sound options stay out of the way below.
  const slot = isHost() ? document.getElementById('nightStrip') : document.getElementById('boardBox');
  if (slot.nextElementSibling !== drawer) slot.after(drawer);
  document.getElementById('drawerTitle').textContent = isHost() ? 'Bàn quản trò' : 'Âm thanh trên máy này';
  const bar = document.getElementById('hostBar');
  if (!bar.contains(document.activeElement) || !document.activeElement.matches('input[type=range], select')) {
    bar.innerHTML = (isHost() ? hostBar() : '') + deviceOptions();
  }
  const timers = document.getElementById('hostTimers');
  if (!timers.contains(document.activeElement)) timers.innerHTML = wolf && isHost() && view.phase !== 'GAME_OVER' && !opening ? hostTimers() : '';
  drawer.hidden = opening && !isHost();
  renderHostAlert();
  // Leave the stage alone while a place list is open under the finger.
  const stageEl = document.getElementById('stage');
  const openIds = [...stageEl.querySelectorAll('details[open][id]')].map(d => d.id);
  // Never redraw under someone typing (Trắng's guess).
  if (!stageEl.contains(document.activeElement) || !document.activeElement.matches('input[type=text], input:not([type])')) {
    stageEl.innerHTML = wolf ? stage() : gameUI().stage(helpers());
    openIds.forEach(id => document.getElementById(id)?.setAttribute('open', ''));
  }

  // The round table, by day. At night a sleeping player sees only the back
  // of a card; while voting the table is the ballot itself.
  const box = document.getElementById('villageBox');
  const night = view.phase === 'NIGHT';
  box.hidden = !wolf || opening || view.phase === 'VOTE' || (night && !view.me?.watch);
  if (!box.hidden) {
    const seated = view.players.filter(p => p.inGame);
    const alive = seated.filter(p => p.alive).length;
    box.innerHTML = roundTable(seated, { center: `<span><strong>${alive}/${seated.length}</strong>còn sống</span>` });
  }
  const boardBox = document.getElementById('boardBox');
  boardBox.hidden = view.phase !== 'GAME_OVER';
  if (!boardBox.hidden) boardBox.innerHTML = leaderboard();
  // The log reaches a moderator who does not play, or the host once the game
  // is over (then it opens by itself).
  const logBox = document.getElementById('logBox');
  logBox.hidden = !g.log.length || opening;
  if (view.phase === 'GAME_OVER' && g.log.length && !logBox.dataset.opened) {
    logBox.open = true;
    logBox.dataset.opened = '1';
  }
  // Nights and mornings start a new block, so the game reads in order.
  document.getElementById('log').innerHTML = g.log.map(l => `<li class="${isLogHead(l) ? 'log-head' : ''}">${esc(l)}</li>`).join('');

  const m = view.me;
  const myTurn = view.phase === 'NIGHT' && m.task;
  // Your card and your notes, held at the bottom of the screen. On the
  // look-at-your-card screen the card is the screen itself.
  document.getElementById('gameFooter').innerHTML = m.inGame && view.phase !== 'REVEAL'
    ? `${myTurn ? endTurnButton(m) : ''}
      <nav class="hand ${wolf && m.art ? 'three' : ''}" aria-label="Bài trên tay">
        <button class="hand-card ${myTurn ? 'quiet' : ''}" data-act="card">
          <span class="plate"><span class="ttl">${m.art ? 'Vai trò' : 'Lá bài của tôi'}</span><span class="hint">${wolf ? (m.art ? 'Vai, đồng đội' : 'Vai, đồng đội, người yêu') : gameUI().handHint}</span></span>
        </button>
        ${wolf && m.art ? `<button class="hand-card art ${myTurn ? 'quiet' : ''}" data-act="artCard">
          <span class="plate"><span class="ttl">Artifact</span><span class="hint">${artHint(m.art)}</span></span>
        </button>` : ''}
        ${wolf ? `<button class="hand-card notes" data-act="notes">
          <span class="plate"><span class="ttl">Nhật ký</span><span class="hint">Việc đã làm</span></span>
        </button>` : ''}
      </nav>`
    : '';
  if (document.getElementById('cardSheet').open) renderCard(false);
  if (document.getElementById('notesSheet').open) renderNotes();
}

// Tonight's calling order, from the cards in the deck (public), as a strip
// of bars: called, being called, still to come. Long nights show a window
// around the role being called.
function nightStrip() {
  if (view.phase !== 'NIGHT') return '';
  const g = view.game;
  const counts = view.roleCounts || {};
  let steps = NIGHT_STEPS
    .filter(st => [st.role, ...(st.also || [])].some(id => counts[id] > 0))
    .filter(st => (!st.firstNightOnly || g.day === 1) && (!st.notFirstNight || g.day > 1));
  // The Medium is left out of the night once there is nobody to bring back
  // or the power is spent: the server's step count tells.
  if (steps.length > g.steps) steps = steps.filter(st => st.id !== 'medium');
  if (!steps.length) return '';
  const now = steps.findIndex(st => st.id === g.activeRole);
  const size = 5;
  const from = Math.max(0, Math.min(now - 1, steps.length - size));
  return steps.slice(from, from + size).map((st, i) => {
    const at = from + i;
    const cls = now < 0 ? '' : at < now ? 'done' : at === now ? 'now' : '';
    return `<li class="${cls}" ${at === now ? 'aria-current="step"' : ''}><span class="bar"></span><span class="nm">${esc(stepInfo(st.id).name)}</span></li>`;
  }).join('');
}

// Seats around a felt table, the first seat at the top, clockwise. Big rooms
// fall back to a grid.
function roundTable(pool, { center = '', ...opts } = {}) {
  const n = pool.length;
  if (n > 14) return `<div class="village">${pool.map(p => seat(p, opts.seatOpts?.(p) || {})).join('')}</div>`;
  const r = n > 10 ? 41 : 39;
  return `<div class="table ${n > 10 ? 'crowded' : ''}">
    <div class="table-felt">${center}</div>
    ${pool.map((p, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      const style = `left:${(50 + r * Math.cos(a)).toFixed(2)}%;top:${(50 + r * Math.sin(a)).toFixed(2)}%`;
      return seat(p, { ...(opts.seatOpts?.(p) || {}), style });
    }).join('')}
  </div>`;
}

// The room's leaderboard: games won by each player, overall or on one side.
let boardSide = 'all';
// The sides each game's leaderboard is split by: [id, tab label, dot class, "X thắng" label].
const WOLF_SIDES = [['village', 'Phe Dân', 'v'], ['werewolf', 'Phe Sói', 'w'], ['third', 'Thứ ba', 't']];
const boardSides = () => gameUI()?.sides || WOLF_SIDES;
const boardTabs = () => [['all', 'Tổng'], ...boardSides()];
function leaderboard() {
  const st = view.stats || { games: 0, sideWins: {}, players: {} };
  const head = `<div class="section-head"><h3>Bảng xếp hạng</h3><span class="muted small">${st.games} ván đã chơi</span></div>`;
  if (!st.games) return `${head}<p class="muted small">Chưa có ván nào kết thúc trong phòng này. Thắng thua của từng người sẽ được ghi ở đây.</p>`;
  const sides = boardSides();
  if (!boardTabs().some(([id]) => id === boardSide)) boardSide = 'all';
  const sideWins = `<p class="side-wins">${sides
    .filter(([id], i) => i < 2 || st.sideWins[id])
    .map(([id, label, dot]) => `<span><i class="dot ${dot}"></i>${label} thắng <strong>${st.sideWins[id] || 0}</strong></span>`).join('')}</p>`;
  const rows = Object.entries(st.players).map(([id, p]) => {
    const s = boardSide === 'all' ? p : (p.sides[boardSide] || { played: 0, wins: 0 });
    return { id, name: p.name, isBot: p.isBot, wins: s.wins, played: s.played };
  }).filter(r => r.played > 0)
    .sort((a, b) => b.wins - a.wins || (b.wins / b.played) - (a.wins / a.played) || a.name.localeCompare(b.name, 'vi'));
  const tabs = `<div class="board-tabs" role="group" aria-label="Xếp theo phe" style="grid-template-columns:repeat(${boardTabs().length},1fr)">${boardTabs().map(([id, label]) =>
    `<button data-act="boardSide" data-side="${id}" aria-pressed="${boardSide === id}">${label}</button>`).join('')}</div>`;
  // Ties share a rank.
  let rank = 0;
  const list = rows.map((r, i) => {
    if (i === 0 || r.wins !== rows[i - 1].wins) rank = i + 1;
    return `<li>
      <span class="rank">${rank}</span>
      <span class="who">${esc(r.name)}${r.id === view.me?.id ? ' (bạn)' : ''}</span>
      <span class="score"><strong>${r.wins}</strong> thắng<span class="muted">${r.played} ván · ${Math.round((r.wins / r.played) * 100)}%</span></span>
    </li>`;
  }).join('');
  return `${head}${sideWins}${tabs}${rows.length
    ? `<ol class="leaderboard">${list}</ol>`
    : '<p class="muted small">Chưa ai chơi ở phe này.</p>'}`;
}

// Seat clips ("Người chơi số ba") have no punctuation of their own; end the
// sentence when the next clip starts a new one.
// Split a narration into frames at its pauses, with each frame's timing
// (ms from the narration's start) so the one being read can be highlighted.
function narrationFrames(narration) {
  const clips = narration?.clips || [];
  const frames = [];
  let current = null;
  let t = 0;
  clips.forEach((clip, i) => {
    const length = clipMs(clip) + gapAfter(clip, clips[i + 1]);
    if (clip.k === 'pause') {
      current = null;
    } else {
      if (!current) frames.push(current = { clips: [], start: t, end: t });
      current.clips.push(clip);
      current.end = t + clipMs(clip);
    }
    t += length;
  });
  return frames.map(f => ({ ...f, text: narrationText(f.clips) }));
}

let shownNarration = null;
function renderNarration() {
  const box = document.getElementById('narration');
  if (!box) return;
  const n = view.narration;
  const key = n ? `${n.at}:${n.clips.length}` : '';
  if (key !== shownNarration) {
    shownNarration = key;
    const frames = narrationFrames(n);
    box.className = frames.length > 1 ? 'narration-list' : '';
    box.innerHTML = frames.map((f, i) =>
      `<blockquote class="narration" data-frame="${i}" data-start="${f.start}" data-end="${f.end}">${esc(f.text)}</blockquote>`
    ).join('');
  }
  highlightNarration();
}

// Mark frames as read / being read / coming up, following the server clock.
function highlightNarration() {
  const n = view?.narration;
  const frames = document.querySelectorAll('#narration [data-frame]');
  if (!n || frames.length < 2) return;
  const elapsed = serverNow() - n.at;
  frames.forEach(el => {
    const start = Number(el.dataset.start);
    const end = Number(el.dataset.end);
    el.dataset.state = elapsed < start ? 'next' : elapsed > end + 400 ? 'done' : 'now';
  });
}

function narrationText(clips) {
  clips = clips.filter(c => c.t);
  return clips.map((c, i) => {
    const first = clips[i + 1]?.t?.[0] || '';
    const startsSentence = !first || (first === first.toUpperCase() && first !== first.toLowerCase());
    const endsSentence = c.k.startsWith('seat_') && startsSentence;
    return c.t + (endsSentence ? '.' : '');
  }).join(' ');
}

function phaseSubtitle() {
  const g = view.game;
  switch (view.phase) {
    case 'NIGHT': {
      const r = stepInfo(g.activeRole);
      if (!r) return 'Cả làng đang ngủ.';
      if (g.nightStage === 'act') return `${r.name} đang thao tác.`;
      if (g.nightStage === 'sleep') return `${r.name} đang nhắm mắt lại.`;
      return `Quản trò đang gọi ${r.name} thức dậy.`;
    }
    case 'MORNING': return g.lastNightDeaths.length ? 'Một đêm đẫm máu.' : 'Một đêm bình yên.';
    case 'SWAP': return 'Bấm “Trao đổi vai” nếu muốn nhận lá bài khác trước đêm đầu tiên.';
    case 'REVEAL': return 'Trò chơi sẽ bắt đầu sau 10 giây.';
    case 'DISCUSSION': return 'Nói chuyện, nghi ngờ, và tìm ra Sói.';
    case 'VOTE': return 'Chọn người bạn nghi ngờ nhất.';
    case 'DEFENSE': return `${esc(player(g.defendant)?.name || '')} đang tự bào chữa.`;
    case 'JUDGE': return 'Treo cổ hay tha mạng?';
    case 'VERDICT': return 'Cả làng đã quyết định.';
    case 'GAME_OVER': return esc(g.winReason);
    default: return '';
  }
}

function hostBar() {
  const over = view.phase === 'GAME_OVER';
  return `
    <div class="host-bar">
      ${narrator.unlocked
        ? `<button class="btn btn-ghost btn-small" data-act="replay">Đọc lại</button>`
        : `<button class="btn btn-primary btn-small" data-act="unlock">Bật giọng quản trò</button>`}
      <button class="btn btn-ghost btn-small" data-act="toggleAmbience" aria-pressed="${ambienceOn}">${ambienceOn ? 'Tắt nhạc nền' : 'Bật nhạc nền'}</button>
      ${over ? '' : view.phase === 'NIGHT' && view.game.nightStage === 'call'
        ? '<button class="btn btn-ghost btn-small" disabled title="Đợi quản trò gọi xong">Đang gọi vai…</button>'
        : '<button class="btn btn-ghost btn-small" data-act="skip">Sang bước tiếp</button>'}
      <button class="btn btn-ghost btn-small" data-act="endGame">Kết thúc ván</button>
    </div>`;
}

function seat(p, opts = {}) {
  const { selectable = false, pressed = false, disabled = false, count = 0, sub = '', act = '', style = '' } = opts;
  // Keep roles off the village grid while playing, even a wolf's dead pack
  // mates (a neighbour could glance at it): your own role and wolf mates live
  // in the card sheet and night panel. Shown at the end, to a moderator who
  // is not playing, and for the dead when the host turned that on. The dead
  // who watch the night see roles only at night: by day the table looks the
  // same as everyone else's (no pack mates, no lover, not even their own).
  const watching = view.me?.spectator && view.phase === 'NIGHT';
  const showRole = view.phase === 'GAME_OVER' || !view.me?.inGame || watching || (!p.alive && view.config.revealRoleOnDeath);
  const role = p.role && showRole ? ROLES[p.role] : null;
  const roleName = role && (p.turned ? 'Sói Nguyền (đã hoá Sói)' : role.name);
  const isMe = p.id === view.me?.id;
  // The couple's mark stays off the table by day, when the phone lies on
  // the table among the players: at night (for those watching) and at the end.
  const showLove = view.phase === 'GAME_OVER' || view.phase === 'NIGHT';
  const lover = showLove && (view.me?.lover === p.id || (view.game.lovers || []).includes(p.id));
  // Connection status lives in the lobby list only, never on this board.
  const inner = `
    ${count ? `<span class="count">${count}</span>` : ''}
    ${role
      ? `<span class="disc disc-role" title="${esc(roleName)}" style="--role:${role.color}">${p.turned ? ROLES.cursed.icon : role.icon}</span>`
      : `<span class="disc">${p.seat ?? ''}</span>`}
    <span class="label">${esc(p.name)}</span>
    <span class="sub">${sub || [isMe ? 'Bạn' : '', lover ? '💘' : '', role ? roleName : '', !p.alive ? 'Đã chết' : '',
      p.alive && view.game.banished === p.id ? '🚪 Rời làng' : '', p.alive && view.game.muted === p.id ? '🤐 Bị câm' : '',
      ...artMarks(p)].filter(Boolean).join(' · ')}</span>`;
  const cls = `seat ${p.alive ? '' : 'dead'} ${isMe ? 'me' : ''}`;
  const at = style ? ` style="${style}"` : '';
  if (!selectable) return `<div class="${cls}"${at}>${inner}</div>`;
  return `<button class="${cls}"${at} data-act="${act}" data-id="${esc(p.id)}" aria-pressed="${pressed}" ${disabled ? 'disabled' : ''}>${inner}</button>`;
}

const alivePlayers = () => view.players.filter(p => p.inGame && p.alive);

// ---------- Artifacts ----------
// What everyone can see on a seat: the Artifacts turned face up, the
// Amulet, and today's Artifact choices that concern this player.
const artLabel = (id) => `${ARTIFACTS[id].icon} ${ARTIFACTS[id].name}`;
function artMarks(p) {
  if (!p.art) return [];
  const a = view.game.art || {};
  const day = view.phase !== 'NIGHT';
  return [
    p.art.shown.map(id => ARTIFACTS[id].icon).join(''),
    p.art.amulet ? '🧿 Giữ Bùa' : '',
    day && a.away?.includes(p.id) ? '🪵 Rời làng' : '',
    day && a.noVote?.includes(p.id) ? '🖤 Không bỏ phiếu' : '',
    day && a.shield === p.id ? '🔰 Được che đêm nay' : ''
  ];
}
// Out of the village or not allowed to vote today (Old Hag, Artifacts).
const isAwayToday = (id) => view.game.banished === id || !!view.game.art?.away?.includes(id);
const mayVoteToday = (p) => p && p.inGame && p.alive
  && !isAwayToday(p.id) && !view.game.art?.noVote?.includes(p.id);

// The day's Artifact panel: the news, what is being resolved, and this
// player's own part in it (a choice to make, a morning choice).
function artPanel() {
  const a = view.game.art;
  const mine = view.me?.art;
  if (!a) return '';
  const today = a.feed.filter(f => f.day === view.game.day);
  const w = a.waiting;
  const parts = [];
  if (mine?.pending) parts.push(artPending(mine.pending));
  else if (w) {
    const who = esc(nameOnly(w.owner));
    const what = w.type === 'choose' ? `${who} đang chọn người cho ${esc(artLabel(w.id))}`
      : w.type === 'decide' ? `${who} đang quyết định có bắt lật lá Artifact không`
      : w.type === 'letter' ? `${who} đang chọn một chữ cái cho ${esc(nameOnly(w.by))}`
      : 'Đang dùng một lá Artifact';
    parts.push(`<p class="result">⏳ ${what}…</p>`);
  }
  (mine?.dawn || []).forEach(d => parts.push(artDawn(d)));
  if (mine && view.phase === 'DISCUSSION' && view.me.alive && mine.hand.some(c => !c.revealed)) {
    parts.push(`<p class="muted small">Bạn có lá Artifact chưa lật: bấm <strong>Artifact</strong> ở dưới cùng để xem và lật.${w ? ' (Đợi lá đang dùng xong.)' : ''}</p>`);
  }
  if (!today.length && !parts.length) return '';
  return `<div class="panel stack art-panel">
    <h3>🗝️ Artifact hôm nay</h3>
    ${today.length ? `<ul class="art-feed">${today.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}
    ${parts.join('')}
  </div>`;
}

function artPending(pd) {
  if (pd.type === 'choose') {
    const picks = artPicks.filter(id => pd.options.includes(id));
    const ordered = pd.ordered ? ' theo thứ tự (người chọn trước lật trước)' : '';
    return `<div class="stack"><h3>${esc(artLabel(pd.id))}</h3>
      <p class="lead">${esc(ARTIFACTS[pd.id].desc)}</p>
      <p>Chọn ${pd.n} người${ordered}: ${picks.length}/${pd.n}${picks.length ? ` (${esc(picks.map(nameOnly).join(', '))})` : ''}</p>
      ${pickGrid('artPick', { pool: view.players.filter(p => pd.options.includes(p.id)), selected: picks,
        subs: pd.ordered ? Object.fromEntries(picks.map((id, i) => [id, `Thứ ${i + 1}`])) : {} })}
      <button class="btn btn-primary btn-block" data-act="artChoose" ${picks.length === pd.n ? '' : 'disabled'}>Xác nhận</button></div>`;
  }
  if (pd.type === 'decide') {
    return `<div class="stack"><h3>${esc(artLabel('amethyst'))}</h3>
      <details class="secret"><summary>Chạm để xem lá của ${esc(nameOnly(pd.target))} (che màn hình)</summary>
        <p class="result">${esc(artLabel(pd.seen))}: ${esc(ARTIFACTS[pd.seen].desc)}</p></details>
      <p class="lead">Bắt ${esc(nameOnly(pd.target))} lật lá này ngay bây giờ?</p>
      <div class="footer-row"><button class="btn btn-primary" data-act="artDecide" data-force="1">Bắt lật ngay</button>
      <button class="btn btn-ghost" data-act="artDecide" data-force="0">Không</button></div></div>`;
  }
  if (pd.type === 'letter') {
    const letters = [...'ABCDĐEGHIKLMNOPQRSTUVXY'];
    return `<div class="stack"><h3>${esc(artLabel('sheet'))}</h3>
      <p class="lead">${esc(nameOnly(pd.by))} hỏi bạn một chữ cái. Chọn một chữ:</p>
      <div class="letters">${letters.map(l => `<button class="btn btn-ghost" data-act="artLetter" data-letter="${l}">${l}</button>`).join('')}</div></div>`;
  }
  return '';
}

function artDawn(d) {
  const lead = {
    amulet: 'Sáng nay bạn phải trao Bùa Hộ Mệnh cho một người chưa từng giữ nó.',
    cudgel: 'Chọn 1 người phải rời làng hôm nay (không ai được bỏ phiếu cho họ).',
    heart: 'Chọn 1 người không được bỏ phiếu hôm nay.',
    shield: 'Chọn 1 người không thể bị loại đêm nay.'
  }[d.kind];
  return `<div class="stack"><h3>☀️ ${esc(artLabel(d.id))}</h3><p class="lead">${lead}</p>
    ${pickGrid('artDawn', { pool: view.players.filter(p => d.options.includes(p.id)) }).replace(/data-act="artDawn"/g, `data-act="artDawn" data-uid="${d.uid}"`)}</div>`;
}

// The label on the Artifact card in the hand.
function artHint(a) {
  const down = a.hand.filter(c => !c.revealed).length;
  if (a.pending || a.dawn.length) return '⚡ Tới lượt bạn';
  if (down && a.canReveal) return 'Có thể lật';
  if (down) return 'Đang úp';
  return a.hand.length ? 'Đã lật' : 'Không còn lá';
}

// One Artifact card, drawn like the role card: face down until tapped
// (it is secret until turned over in front of everyone).
function artCardHtml(c, canReveal) {
  const a = ARTIFACTS[c.id];
  const key = `art-${c.uid}`;
  const up = c.revealed || flipped.has(key);
  return `<div class="art-slot">
    <button class="card art-big ${up ? 'revealed' : ''}" ${c.revealed ? 'tabindex="-1"' : `data-act="flip" data-key="${key}"`} aria-label="Lá Artifact">
      <div class="card-inner">
        <div class="card-face card-back art-back"><span class="art-key" aria-hidden="true">🗝️</span><p>Artifact<br><span class="small muted">Chạm để xem. Che màn hình khỏi người bên cạnh</span></p></div>
        <div class="card-face card-front">
          <p class="card-top"><span>${a.gem ? '💠 Đá quý · ' : ''}${a.once ? 'Dùng 1 lần' : 'Luôn có tác dụng'}</span><span class="pts">${a.once ? '1' : '∞'}</span></p>
          <div class="art-icon" aria-hidden="true">${a.icon}</div>
          <h3>${esc(a.name)}</h3>
          <p class="art-en">${esc(a.en)}</p>
          <p class="desc">${esc(a.desc)}</p>
          <p class="art-state">${c.revealed ? (c.copy ? '✨ Dùng nhờ Lam Ngọc Số Phận' : '👁️ Đã lật: cả làng đều thấy') : '🤫 Đang úp: chỉ mình bạn biết'}</p>
        </div>
      </div>
    </button>
    ${!c.revealed && canReveal ? `<button class="btn btn-primary btn-block art-use" data-act="artReveal" data-uid="${c.uid}">Lật cho cả làng xem và dùng</button>` : ''}
  </div>`;
}

function artTab() {
  const mine = view.me.art;
  const down = mine.hand.filter(c => !c.revealed);
  // Face-down cards first: those are the ones you may still play.
  const cards = [...down, ...mine.hand.filter(c => c.revealed)];
  const when = !down.length ? ''
    : mine.canReveal ? '<p class="art-when ok">Bạn có thể lật lá ngay bây giờ.</p>'
    : view.phase === 'DISCUSSION' && view.me.alive ? '<p class="art-when">Đợi lá Artifact đang dùng xong rồi mới lật được.</p>'
    : view.me.alive ? '<p class="art-when">Chỉ lật được trong lúc cả làng thảo luận ban ngày.</p>' : '';
  return `${when}${cards.length ? cards.map(c => artCardHtml(c, mine.canReveal)).join('') : '<p class="muted art-when">Bạn không còn lá Artifact nào.</p>'}`;
}

function pickGrid(act, { exclude = [], disabled = [], selected = [], counts = {}, subs = {}, pool = alivePlayers() } = {}) {
  return `<div class="village" style="margin-top:14px">${pool
    .filter(p => !exclude.includes(p.id))
    .map(p => seat(p, {
      selectable: true,
      act,
      pressed: selected.includes(p.id),
      disabled: disabled.includes(p.id),
      count: counts[p.id] || 0,
      sub: subs[p.id]
    })).join('')}</div>`;
}

// What everyone learned at dawn that shapes the day.
function dayNews() {
  const g = view.game;
  const items = [];
  if (g.ghostLetter) items.push(`<p>👻 Hồn Ma để lại chữ: <span class="ghost-letter">${esc(g.ghostLetter)}</span></p>`);
  if (g.banished) items.push(`<p>🧙‍♀️ <strong>${esc(nameOnly(g.banished))}</strong> bị đuổi khỏi làng hôm nay: không thảo luận, không bỏ phiếu, không bị bỏ phiếu.</p>`);
  if (g.muted) items.push(`<p>🤐 <strong>${esc(nameOnly(g.muted))}</strong> bị phong ấn: không được nói hôm nay (vẫn bỏ phiếu được).</p>`);
  const a = g.art;
  if (a) {
    a.away.forEach(id => items.push(`<p>🪵 <strong>${esc(nameOnly(id))}</strong> rời làng hôm nay: không ai được bỏ phiếu cho người này, người này cũng không bỏ phiếu.</p>`));
    a.noVote.forEach(id => items.push(`<p>🖤 <strong>${esc(nameOnly(id))}</strong> không được bỏ phiếu hôm nay.</p>`));
    if (a.shield) items.push(`<p>🔰 <strong>${esc(nameOnly(a.shield))}</strong> không thể bị loại đêm nay.</p>`);
  }
  if (view.me?.spectator) items.push('<p class="muted small">👁️ Bạn đã chết và không còn ai hồi sinh được: ban đêm bạn được theo dõi diễn biến và vai của mọi người. Ban ngày màn hình không hiện vai của ai; hãy giữ im lặng.</p>');
  return items.length ? `<div class="day-news panel">${items.join('')}</div>` : '';
}

function stage() {
  const g = view.game;
  const m = view.me;
  const task = m.task;

  if (view.phase === 'NIGHT') {
    if (task) return nightTask(task);
    // The Eye of the Beholder, awake with the Seer.
    if (m.beholder) {
      const b = m.beholder;
      return `<div class="panel stack"><p class="card-kicker"><span>Mắt Người Quan Sát</span><span class="icon" aria-hidden="true">👁️</span></p>
        <h2>Bạn thức dậy cùng Tiên Tri</h2>
        <p class="lead">Đừng ra hiệu cho nhau. Bạn thấy Tiên Tri soi ai và người đó có phải Sói không.</p>
        ${b.target ? `<p class="result ${b.wolf ? 'result-wolf' : 'result-village'}">Tiên Tri soi ${esc(seatName(b.target))}: ${b.wolf ? 'LÀ Sói 🐺' : 'không phải Sói'}</p>` : '<p class="muted">Tiên Tri đang chọn…</p>'}</div>`;
    }
    if (m.watch) return watchNight();
    return `
      <div class="sleep-card" role="img" aria-label="${m.inGame && m.alive ? 'Bạn đang ngủ' : 'Màn đêm đang trôi qua'}">
        ${crescentSvg()}
        <h2>${m.inGame && m.alive ? 'Nhắm mắt lại' : 'Màn đêm đang trôi qua'}</h2>
      </div>
      <p class="sleep-note">${m.inGame && m.alive
        ? `${canVibrate && vibrateOn ? 'Điện thoại sẽ rung khi tới lượt bạn. ' : ''}Úp máy xuống bàn để không ai nhìn thấy.`
        : 'Giữ im lặng cho tới sáng.'}</p>`;
  }

  if (view.phase === 'MORNING') {
    const deaths = g.lastNightDeaths;
    return `
      <div class="panel stack">
        <h2>${deaths.length ? 'Đêm qua có người đã chết' : 'Đêm qua không ai chết'}</h2>
        ${deaths.length ? `<div class="village">${deaths.map(id => seat(player(id))).join('')}</div>` : '<p class="lead">Bảo Vệ hoặc Phù Thủy đã làm tốt việc của mình… hoặc bầy Sói đang toan tính điều gì đó.</p>'}
      </div>${dayNews()}${artPanel()}`;
  }

  if (view.phase === 'REVEAL') {
    return `
      <div class="panel stack reveal-panel">
        <h2>Xem lá bài của bạn</h2>
        <p class="lead">Trò chơi sẽ bắt đầu sau 10 giây. Che màn hình khỏi người bên cạnh.</p>
        ${view.config.autoLovers && m.inGame ? '<p class="small muted">💘 Quản trò đã ghép một cặp Tình Nhân: nếu là bạn, tên và vai người yêu ghi trên lá bài.</p>' : ''}
        ${m.inGame
          ? '<button class="btn btn-primary btn-block card-button reveal-card" data-act="card"><span><span aria-hidden="true">🂠</span> Xem lá bài của tôi</span></button>'
          : '<p class="muted">Mọi người đang xem lá bài của mình.</p>'}
      </div>`;
  }

  if (view.phase === 'SWAP') {
    const sw = m.swap;
    const hostSkip = isHost() ? '<button class="btn btn-ghost" data-act="skip">Bắt đầu đêm đầu tiên</button>' : '';
    if (!sw) {
      return `<div class="panel stack"><h2>Mọi người đang xem bài</h2>
        <p class="lead">Người chơi có thể bấm “Trao đổi vai” trước đêm đầu tiên.</p>${hostSkip}</div>`;
    }
    return `
      <div class="panel stack">
        <h2>Xem lá bài của bạn</h2>
        <p class="lead">Không thích vai của mình? Bấm “Trao đổi vai”: lá bài của bạn được đưa vào nhóm trao đổi. Hết giờ, các lá trong nhóm được chia lại ngẫu nhiên, mỗi người nhận lá của một người khác. Không ai biết ai trao đổi vai, cũng không biết vai gì.</p>
        ${sw.pool ? `<p class="result">🔄 Đã có ${sw.pool} người bấm “Trao đổi vai”.</p>` : '<p class="muted small">Chưa có ai bấm “Trao đổi vai”.</p>'}
        <button class="btn ${sw.joined ? 'btn-good' : 'btn-primary'} btn-block" data-act="swapJoin" aria-pressed="${sw.joined}">${sw.joined ? '✅ Đã chọn trao đổi vai (bấm để huỷ)' : '🔄 Trao đổi vai'}</button>
        ${sw.joined ? `<p class="muted small">${sw.pool > 1 ? 'Hết giờ bạn sẽ nhận lá bài của một người khác trong nhóm.' : 'Cần ít nhất một người nữa thì mới trao đổi được.'}</p>` : ''}
        <p class="muted small">Sau khi trao đổi vai, xem lại lá bài và 📜 Nhật ký.</p>
        ${hostSkip}
      </div>`;
  }

  if (view.phase === 'DISCUSSION') {
    const deaths = g.lastNightDeaths.map(seatName).filter(Boolean);
    return `
      <div class="panel stack">
        <h2>Cả làng thảo luận</h2>
        <p class="lead">${deaths.length ? `Đêm qua ${esc(deaths.join(', '))} đã chết.` : 'Đêm qua không ai chết.'} Ai đang nói dối?</p>
        ${isHost() ? '<button class="btn btn-ghost" data-act="skip">Kết thúc thảo luận và bỏ phiếu</button>' : ''}
      </div>${artPanel()}${dayNews()}`;
  }

  if (view.phase === 'VOTE') {
    const counts = {};
    Object.values(g.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const voted = Object.keys(g.votes).length;
    const mine = g.votes[m.id];
    const banishedMe = isAwayToday(m.id);
    const canVote = mayVoteToday(me());
    const voters = view.players.filter(mayVoteToday).length;
    // The table stays put while votes come in: the text above it keeps its
    // length, and who voted for whom goes below it.
    const list = voteList(g.votes);
    return `
      <div class="panel">
        <h2>${g.voteRound === 2 ? 'Bỏ phiếu lần hai' : 'Bỏ phiếu nghi phạm'}</h2>
        <p class="lead">${canVote
          ? `Chạm vào người bạn nghi là Sói. Chạm người khác để đổi, chạm lại để huỷ phiếu.`
          : banishedMe ? 'Hôm nay bạn bị đuổi khỏi làng, không được bỏ phiếu.'
          : m.alive && m.inGame ? 'Hôm nay bạn không được bỏ phiếu.' : 'Bạn đang theo dõi, không bỏ phiếu.'}</p>
        <p class="muted small" style="margin-top:6px">Đã bỏ phiếu: ${voted}/${voters}</p>
      </div>
      ${roundTable(view.players.filter(p => p.inGame), {
        center: canVote
          ? (mine ? `<span>Bạn chọn<strong>${esc(nameOnly(mine))}</strong>chạm lại để huỷ</span>` : 'Chạm vào người bạn nghi là Sói')
          : `<span><strong>${voted}/${voters}</strong>đã bỏ phiếu</span>`,
        seatOpts: (p) => {
          const pickable = canVote && p.alive && p.id !== m.id && !isAwayToday(p.id);
          return { selectable: pickable, act: 'vote', pressed: mine === p.id, count: counts[p.id] || 0 };
        }
      })}
      ${list ? `<div class="panel" style="margin-top:12px"><h3>Ai bầu ai</h3>${list}</div>` : ''}`;
  }

  if (view.phase === 'DEFENSE') {
    const d = player(g.defendant);
    return `
      <div class="panel stack" style="text-align:center">
        <div class="village" style="grid-template-columns:110px;justify-content:center">${seat(d)}</div>
        <h2>${d.id === m.id ? 'Bạn đang trên bục biện hộ' : `${esc(d.name)} đang biện hộ`}</h2>
        <p class="lead">${d.id === m.id ? 'Hãy thuyết phục cả làng rằng bạn vô tội.' : 'Hãy lắng nghe. Khi hết giờ, cả làng sẽ quyết định.'}</p>
        ${voteList(g.votes)}
        ${isHost() ? '<button class="btn btn-ghost" data-act="skip">Kết thúc biện hộ</button>' : ''}
      </div>`;
  }

  if (view.phase === 'JUDGE') {
    const d = player(g.defendant);
    const votes = Object.values(g.judge);
    const kill = votes.filter(v => v === 'kill').length;
    const spare = votes.length - kill;
    const mine = g.judge[m.id];
    // The Gã Khờ always hangs and the Người Hoà Bình always spares: their vote is cast for them.
    // So do the Cap of Idiocy and the Wreath of Peace, whatever the role.
    const shown = me()?.art?.shown || [];
    const fixed = shown.includes('cap') ? 'treo cổ' : shown.includes('wreath') ? 'tha'
      : m.art?.lostPower ? null : m.role === 'idiot' ? 'treo cổ' : m.role === 'pacifist' ? 'tha' : null;
    const canVote = mayVoteToday(me()) && m.id !== d.id && !fixed;
    return `
      <div class="panel stack">
        <h2>Số phận của ${esc(d.name)}</h2>
        <p class="lead">${canVote ? 'Treo cổ nếu phiếu treo nhiều hơn phiếu tha.'
          : d.id === m.id ? 'Bạn không được tự bỏ phiếu cho mình.'
          : isAwayToday(m.id) ? 'Hôm nay bạn bị đuổi khỏi làng, không được bỏ phiếu.'
          : fixed && mayVoteToday(me()) ? `Phiếu của bạn luôn là “${fixed}”.`
          : m.alive && m.inGame ? 'Hôm nay bạn không được bỏ phiếu.' : 'Bạn đang theo dõi.'}</p>
        <div class="judge">
          <button class="kill" data-act="judge" data-choice="kill" aria-pressed="${mine === 'kill'}" ${canVote ? '' : 'disabled'}>
            <span class="big" aria-hidden="true">🪢</span>Treo cổ<span class="n">${kill} phiếu</span>
          </button>
          <button class="spare" data-act="judge" data-choice="spare" aria-pressed="${mine === 'spare'}" ${canVote ? '' : 'disabled'}>
            <span class="big" aria-hidden="true">🕊️</span>Tha mạng<span class="n">${spare} phiếu</span>
          </button>
        </div>
        ${judgeList(g.judge)}
      </div>`;
  }

  if (view.phase === 'VERDICT') {
    const v = g.verdict || {};
    let body = '<h2>Hôm nay không ai lên bục</h2><p class="lead">Phiếu bầu chưa thống nhất. Màn đêm sắp buông xuống.</p>';
    if (v.type === 'kill') body = `<h2>${esc(v.ids.map(seatName).join(' và '))} đã bị loại</h2><p class="lead">${v.kill} phiếu treo, ${v.spare} phiếu tha.</p>`;
    if (v.type === 'spare') body = `<h2>${esc(seatName(v.ids[0]))} được tha</h2><p class="lead">${v.kill} phiếu treo, ${v.spare} phiếu tha.</p>`;
    if (v.type === 'prince') body = `<h2>🤴 ${esc(seatName(v.ids[0]))} là Hoàng Tử!</h2><p class="lead">Dân làng biểu quyết treo cổ (${v.kill} treo, ${v.spare} tha), nhưng Hoàng Tử lật bài và không bị treo.</p>`;
    if (g.secondVote) body += g.talisman ? '<p class="result">🧨 Bùa Rắc Rối: cả làng sẽ bỏ phiếu thêm một lần nữa.</p>' : '<p class="result">🔥 Kẻ Gây Rối đã ra tay: cả làng sẽ bỏ phiếu thêm một lần nữa.</p>';
    return `<div class="panel stack">${body}${v.type ? judgeList(g.judge) : ''}</div>`;
  }

  if (view.phase === 'GAME_OVER') {
    const w = g.winner;
    const icon = { village: '🌾', werewolf: '🐺', lovers: '💘', piper: '🪈', fool: '🤡', lone_wolf: '🌕' }[w];
    const title = { village: 'Phe Dân Làng chiến thắng', werewolf: 'Phe Ma Sói chiến thắng', lovers: 'Cặp Tình Nhân chiến thắng', piper: 'Người Thổi Sáo chiến thắng', fool: 'Kẻ Cuồng Loạn chiến thắng', lone_wolf: 'Sói Đơn Độc chiến thắng' }[w];
    return `
      <div class="panel winner">
        <div class="big" aria-hidden="true">${icon}</div>
        <h2>${title}</h2>
        <p class="lead">${esc(g.winReason)}</p>
        <p class="muted small" style="margin-top:10px">Vai trò của mọi người đã được lật ở bên dưới.</p>
        ${isHost() ? '<button class="btn btn-primary btn-block" style="margin-top:16px" data-act="restart">Về phòng chờ, chơi ván mới</button>' : '<p class="muted small" style="margin-top:12px">Chờ chủ phòng mở ván mới.</p>'}
      </div>`;
  }
  return '';
}

function nightTask(task) {
  const m = view.me;
  const head = (step, title, lead) => {
    const info = stepInfo(step);
    return `
    <p class="card-kicker"><span>Lượt của ${info.name}</span><span class="icon" aria-hidden="true">${info.icon}</span></p>
    <h2>${title}</h2>
    <p class="lead">${lead}</p>`;
  };
  // Every role finishes with the one green "Xong lượt" button at the bottom.
  const autoHint = '<p class="muted small" style="margin-top:12px">Tự sang lượt tiếp sau vài giây. Xem lại trong 📜 Nhật ký.</p>';

  if (task.powerless) {
    return `<div class="panel">${head(task.role, 'Bạn đã mất chức năng', 'Già Làng đã chết dưới tay dân làng, nên từ giờ bạn không còn dùng được chức năng nữa. Bấm "Đã hiểu" ở dưới cùng, giữ im lặng và nhắm mắt.')}</div>`;
  }
  if (task.role === 'thief') {
    if (task.done) {
      return `<div class="panel">${head('thief', task.took ? `Bạn đã trở thành ${ROLES[task.took].name}` : 'Bạn giữ nguyên lá Ăn Trộm',
        task.took ? 'Bạn sẽ chơi theo vai trò mới, kể cả các lượt còn lại của đêm nay.' : 'Bạn chơi như một Dân Làng.')}</div>`;
    }
    const mustTake = task.extras.every(r => PACK_ROLES.includes(r));
    return `<div class="panel stack">${head('thief', 'Hai lá bài dư', mustTake ? 'Cả 2 lá đều là Sói: bạn bắt buộc phải lấy 1 lá.' : 'Đổi lấy 1 lá, hoặc giữ nguyên lá Ăn Trộm.')}
      <div class="judge">${task.extras.map((r, i) => `
        <button data-act="thiefPick" data-pick="${i}">
          <span class="big" aria-hidden="true">${ROLES[r].icon}</span>${ROLES[r].name}<span class="n">Lấy lá này</span>
        </button>`).join('')}</div>
      ${mustTake ? '' : '<button class="btn btn-ghost btn-block" data-act="thiefKeep">Giữ nguyên, không đổi</button>'}</div>`;
  }
  if (task.role === 'elder') {
    return `<div class="panel">${head('elder', 'Bạn là Già Làng', 'Quản trò đã biết bạn. Lần đầu bị Sói cắn bạn sẽ không chết. Bấm "Đã hiểu" ở dưới cùng.')}</div>`;
  }
  if (task.role === 'piper') {
    return `<div class="panel">${head('piper', 'Thôi miên 2 người', `Đã chọn ${task.picks.length}/2. Người đã bị thôi miên không chọn lại được.`)}
      ${task.complete
        ? `<p class="result" style="margin-top:12px">Đã thôi miên ${esc(task.picks.map(seatName).join(' và '))}.</p>`
        : pickGrid('night', { exclude: [m.id], disabled: task.charmed, selected: task.picks, subs: Object.fromEntries(task.charmed.map(id => [id, 'Đã bị thôi miên'])) })}</div>`;
  }

  if (task.role === 'cupid') {
    return `<div class="panel">${head('cupid', 'Chọn 2 người làm Tình Nhân', `Đã chọn ${task.picks.length}/2. Có thể chọn cả chính mình.`)}
      ${task.complete ? '<p class="result" style="margin-top:12px">Đã se duyên xong. Nhắm mắt lại nhé.</p>' : pickGrid('night', { selected: task.picks })}</div>`;
  }
  if (task.role === 'guard') {
    const subs = task.lastGuarded ? { [task.lastGuarded]: 'Đã bảo vệ đêm trước' } : {};
    const firstNight = view.game.day === 1;
    if (firstNight) subs[m.id] = 'Đêm đầu không tự bảo vệ';
    const disabled = [task.lastGuarded, firstNight ? m.id : null].filter(Boolean);
    return `<div class="panel">${head('guard', 'Bảo vệ ai đêm nay?', 'Người được bảo vệ sẽ không chết nếu bị Sói cắn.')}
      ${task.complete
        ? `<p class="result" style="margin-top:12px">Bạn đang bảo vệ ${esc(seatName(task.pick))}.</p>`
        : pickGrid('night', { disabled, subs })}</div>`;
  }
  if (task.spent && ['hunter', 'avenger'].includes(task.role)) {
    return `<div class="panel">${head(task.role, task.role === 'hunter' ? 'Súng đã nổ' : 'Đã kéo theo một người',
      'Bạn đã dùng kỹ năng này trước khi được hồi sinh, nên không dùng lại được. Bấm “Bỏ qua lượt này” ở dưới cùng.')}</div>`;
  }
  if (task.role === 'hunter') {
    const lastAim = task.lastAim && player(task.lastAim)?.alive ? task.lastAim : null;
    const subs = lastAim ? { [lastAim]: 'Đang chĩa súng' } : {};
    return `<div class="panel">${head('hunter', 'Chĩa súng vào ai đêm nay?', lastAim
      ? `Súng đang chĩa vào ${esc(seatName(lastAim))}. Chọn lại, hoặc bấm “Giữ nguyên mục tiêu”.`
      : 'Nếu bạn chết, người này sẽ chết theo. Bạn không biết ai bị Sói cắn.')}
      ${task.complete
        ? `<p class="result" style="margin-top:12px">Súng đang chĩa vào ${esc(seatName(task.aim))}.</p>`
        : pickGrid('night', { exclude: [m.id], selected: lastAim ? [lastAim] : [], subs })}</div>`;
  }
  if (task.role === 'werewolf') {
    const counts = {};
    Object.values(task.votes).flat().filter(t => t !== 'none').forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const noKillVotes = Object.values(task.votes).filter(v => v[0] === 'none').length;
    const mineNone = task.votes[m.id]?.[0] === 'none';
    const mates = view.me.wolves.filter(id => player(id)?.alive).map(seatName);
    const two = task.kills === 2;
    // What every living wolf picked so far, so the pack can agree.
    const pack = [m.id, ...view.me.wolves].filter(id => player(id)?.alive);
    const pickOf = (id) => {
      const v = task.votes[id] || [];
      return !v.length ? '<span class="muted">chưa chọn</span>'
        : v[0] === 'none' ? '🚫 Không cắn ai'
        : `🐺 ${esc(v.map(seatName).join(' và '))}`;
    };
    const packList = pack.length > 1 ? `<ul class="vote-list">${pack.map(id => `
      <li><strong>${esc(seatName(id))}${id === m.id ? ' (bạn)' : ''}</strong> → ${pickOf(id)}</li>`).join('')}</ul>` : '';
    // Where the pack stands: agreed (a few seconds to look), split, or still choosing.
    const picked = pack.filter(id => task.votes[id]?.length);
    const leaders = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const agreedOn = task.complete
      ? (Object.keys(counts).length ? esc(Object.keys(counts).map(seatName).join(' và ')) : 'không cắn ai')
      : null;
    const status = task.complete
      ? `<p class="result result-wolf" style="margin-top:12px">✅ Cả đàn đã thống nhất: <strong>${agreedOn}</strong>. Còn vài giây để đổi ý, nếu không sẽ nhắm mắt.</p>`
      : picked.length === pack.length && pack.length > 1
      ? `<p class="result" style="margin-top:12px">⚠️ Đàn chưa thống nhất${leaders.length ? ` (nhiều phiếu nhất: <strong>${esc(seatName(leaders[0][0]))}</strong>, ${leaders[0][1]} phiếu)` : ''}. Hãy chọn lại cho trùng nhau. Hết giờ mà vẫn chưa thống nhất thì người nhiều phiếu nhất bị cắn (hoà thì bốc thăm).</p>`
      : pack.length > 1 ? `<p class="muted small" style="margin-top:12px">Đã chọn: ${picked.length}/${pack.length} con Sói.</p>` : '';
    return `<div class="panel">${head('werewolf', two ? 'Sói Con đã chết: đêm nay cắn 2 người' : 'Chọn con mồi', mates.length
      ? `Chọn ${two ? 'hai người' : 'một người'} để cắn (cắn cả đồng bọn hay chính mình cũng được). Lượt chỉ kết thúc sớm khi cả đàn chọn trùng nhau; "Không cắn ai" không tính là phiếu.`
      : `Bạn là con Sói duy nhất. Chọn ${two ? 'hai người' : 'một người'} để cắn, hoặc không cắn ai.`)}
      ${packList}
      ${status}
      ${task.allowed ? `<p class="result" style="margin-top:12px">🔺 Lăng Kính Quyền Năng: ${task.allowed.length ? `đêm nay chỉ được cắn ${esc(task.allowed.map(seatName).join(', '))}.` : 'đêm nay không cắn được ai.'}</p>` : ''}
      ${pickGrid('night', { selected: mineNone ? [] : task.votes[m.id] || [], counts, disabled: task.allowed ? alivePlayers().map(p => p.id).filter(id => !task.allowed.includes(id)) : [], subs: { ...Object.fromEntries(view.me.wolves.map(id => [id, 'Đồng bọn'])), [m.id]: 'Bạn' } })}
      <button class="btn ${mineNone ? 'btn-primary' : 'btn-ghost'} btn-block" style="margin-top:12px" data-act="noKill" aria-pressed="${mineNone}">🚫 Không cắn ai${noKillVotes ? ` (${noKillVotes})` : ''}</button></div>`;
  }
  if (task.role === 'detective') {
    if (task.result) {
      const same = task.result === 'same';
      return `<div class="panel stack">${head('detective', 'Kết quả điều tra', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${same ? 'result-village' : 'result-wolf'}">${esc(task.picks.map(seatName).join(' và '))} ${same ? 'cùng phe 🤝' : 'khác phe ⚔️'}</p>
        ${autoHint}</div>`;
    }
    return `<div class="panel">${head('detective', 'Điều tra 2 người', `Đã chọn ${task.picks.length}/2. Bạn sẽ biết họ có cùng phe hay không.`)}
      ${pickGrid('night', { exclude: [m.id], selected: task.picks })}</div>`;
  }
  if (task.role === 'priest') {
    if (task.used && !task.pick) return `<div class="panel">${head('priest', 'Nước thánh đã dùng hết', 'Bạn đã dùng nước thánh. Hãy nhắm mắt lại.')}</div>`;
    return `<div class="panel">${head('priest', 'Vẩy nước thánh?', 'Chỉ được dùng 1 lần cả ván. Trúng Sói thì Sói chết vào sáng mai; trúng người phe Dân thì chính bạn chết. Không muốn dùng thì bấm “Bỏ qua lượt này”.')}
      ${task.pick
        ? `<p class="result" style="margin-top:12px">Bạn đã vẩy nước thánh vào ${esc(seatName(task.pick))}.</p>`
        : pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'medium') {
    if (task.used && !task.pick) return `<div class="panel">${head('medium', 'Đã dùng năng lực', 'Bạn đã hồi sinh một người. Hãy nhắm mắt lại.')}</div>`;
    if (task.pick) return `<div class="panel">${head('medium', 'Đã chọn', `${esc(seatName(task.pick))} sẽ sống lại vào sáng mai.`)}</div>`;
    const dead = task.dead.map(player).filter(Boolean);
    return `<div class="panel">${head('medium', 'Hồi sinh ai?', dead.length
      ? 'Chỉ được dùng 1 lần cả ván. Người được chọn sẽ sống lại vào sáng mai. Không muốn dùng thì bấm “Bỏ qua lượt này”.'
      : 'Chưa có ai chết. Hãy nhắm mắt lại.')}
      ${dead.length ? pickGrid('night', { pool: dead }) : ''}</div>`;
  }
  if (task.role === 'avenger') {
    const lastAim = task.lastAim && player(task.lastAim)?.alive ? task.lastAim : null;
    const subs = lastAim ? { [lastAim]: 'Mục tiêu hiện tại' } : {};
    return `<div class="panel">${head('avenger', 'Chọn người chết theo', lastAim
      ? `Đang chọn ${esc(seatName(lastAim))}. Chọn lại, hoặc bấm “Giữ nguyên mục tiêu”.`
      : 'Nếu bạn bị dân làng treo cổ, người này chết theo.')}
      ${task.aim
        ? `<p class="result" style="margin-top:12px">Mục tiêu: ${esc(seatName(task.aim))}.</p>`
        : pickGrid('night', { exclude: [m.id], selected: lastAim ? [lastAim] : [], subs })}</div>`;
  }
  if (task.role === 'seer') {
    if (task.result) {
      const villager = task.result === 'village';
      return `<div class="panel stack">${head('seer', 'Kết quả soi', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${villager ? 'result-village' : 'result-wolf'}">${esc(seatName(task.target))} ${villager ? 'là người phe Dân 🌾' : 'không phải người phe Dân ⚠️'}</p>
        ${autoHint}</div>`;
    }
    return `<div class="panel">${head('seer', 'Soi ai đêm nay?', task.apprentice
      ? 'Tiên Tri đã chết, bạn soi thay. Bạn chỉ biết người đó có phải phe Dân hay không.'
      : 'Bạn chỉ biết người đó có phải phe Dân hay không.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'aura_seer') {
    if (task.result) {
      const special = task.result === 'special';
      return `<div class="panel stack">${head('aura_seer', 'Kết quả soi', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${special ? 'result-wolf' : 'result-village'}">${esc(seatName(task.target))} ${special ? 'có vai đặc biệt ✨' : 'là Dân Làng hoặc Ma Sói thường'}</p>
        ${autoHint}</div>`;
    }
    return `<div class="panel">${head('aura_seer', 'Soi hào quang ai?', 'Bạn biết người đó có vai đặc biệt hay chỉ là Dân Làng / Ma Sói thường.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'pi') {
    if (task.result) {
      const wolf = task.result === 'wolf';
      return `<div class="panel stack">${head('pi', 'Kết quả dò tìm', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${wolf ? 'result-wolf' : 'result-village'}">${wolf ? `Có Sói trong ${esc(seatName(task.target))} hoặc người ngồi cạnh 🐺` : `Không có Sói quanh ${esc(seatName(task.target))}`}</p>
        ${autoHint}</div>`;
    }
    if (task.used) return `<div class="panel">${head('pi', 'Đã dùng năng lực', 'Bạn chỉ được dò một lần cả ván. Bấm “Bỏ qua lượt này”.')}</div>`;
    return `<div class="panel">${head('pi', 'Dò tìm quanh ai?', 'Một lần cả ván. Bạn biết trong người đó và 2 người ngồi cạnh có Sói hay không. Chưa muốn dùng thì bấm “Bỏ qua lượt này”.')}
      ${pickGrid('night')}</div>`;
  }
  if (task.role === 'sorcerer') {
    if (task.result) {
      const seer = task.result === 'seer';
      return `<div class="panel stack">${head('sorcerer', 'Kết quả', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${seer ? 'result-wolf' : 'result-village'}">${esc(seatName(task.target))} ${seer ? 'CHÍNH LÀ Tiên Tri 🔮' : 'không phải Tiên Tri'}</p>
        ${autoHint}</div>`;
    }
    return `<div class="panel">${head('sorcerer', 'Ai là Tiên Tri?', 'Chọn 1 người để biết người đó có phải Tiên Tri không.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'blesser') {
    if (task.pick) return `<div class="panel">${head('blesser', 'Đã ban phước', `${esc(seatName(task.pick))} sẽ sống sót lần đầu bị giết.`)}</div>`;
    if (task.used) return `<div class="panel">${head('blesser', 'Đã ban phước', 'Bạn đã dùng phước lành rồi. Bấm “Bỏ qua lượt này”.')}</div>`;
    return `<div class="panel">${head('blesser', 'Ban phước cho ai?', 'Một lần cả ván. Lần đầu người đó bị giết thì không chết. Chưa muốn dùng thì bấm “Bỏ qua lượt này”.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'martyr') {
    if (task.pick) return `<div class="panel">${head('martyr', 'Bạn đã chọn hy sinh', `Bạn sẽ chết thay ${esc(seatName(task.pick))}.`)}</div>`;
    if (task.used) return `<div class="panel">${head('martyr', 'Đã hy sinh', 'Bạn chỉ hy sinh được một lần. Bấm “Bỏ qua lượt này”.')}</div>`;
    const targets = (task.targets || []).filter(id => id !== m.id).map(player).filter(Boolean);
    if (!targets.length) return `<div class="panel">${head('martyr', 'Đêm nay không ai cần bạn', 'Sói không cắn ai khác. Bấm “Bỏ qua lượt này”.')}</div>`;
    return `<div class="panel">${head('martyr', 'Chết thay người bị cắn?', 'Sói vừa cắn người dưới đây. Chạm vào để chết thay họ (chỉ một lần cả ván), hoặc bấm “Bỏ qua lượt này”.')}
      ${pickGrid('night', { pool: targets, subs: Object.fromEntries(targets.map(p => [p.id, 'Bị Sói cắn'])) })}</div>`;
  }
  if (task.role === 'spellcaster') {
    if (task.pick) return `<div class="panel">${head('spellcaster', 'Đã phong ấn', `${esc(seatName(task.pick))} sẽ không được nói vào ngày mai.`)}</div>`;
    return `<div class="panel">${head('spellcaster', 'Phong ấn ai?', 'Người đó không được nói vào ngày mai (vẫn bỏ phiếu được). Mỗi người chỉ bị một lần cả ván.')}
      ${pickGrid('night', { disabled: task.mutedEver, subs: Object.fromEntries(task.mutedEver.map(id => [id, 'Đã bị câm'])) })}</div>`;
  }
  if (task.role === 'old_hag') {
    if (task.pick) return `<div class="panel">${head('old_hag', 'Đã chọn', `${esc(seatName(task.pick))} sẽ phải rời làng vào ngày mai.`)}</div>`;
    return `<div class="panel">${head('old_hag', 'Đuổi ai khỏi làng?', 'Ngày mai người đó không được thảo luận, không bỏ phiếu và không bị bỏ phiếu.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'doppelganger') {
    if (task.pick) return `<div class="panel">${head('doppelganger', 'Đã chọn', `Khi ${esc(seatName(task.pick))} chết, bạn sẽ nhận vai của họ.`)}</div>`;
    return `<div class="panel">${head('doppelganger', 'Theo bóng ai?', 'Bắt buộc chọn 1 người: khi người này chết, bạn bí mật nhận vai và phe của họ. Hết giờ mà chưa chọn thì quản trò chọn ngẫu nhiên giúp bạn.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
  }
  if (task.role === 'hoodlum') {
    return `<div class="panel">${head('hoodlum', 'Chọn 2 mục tiêu', `Đã chọn ${task.picks.length}/2. Bạn thắng nếu cả hai chết mà bạn còn sống.`)}
      ${task.complete ? `<p class="result" style="margin-top:12px">Mục tiêu: ${esc(task.picks.map(seatName).join(' và '))}.</p>` : pickGrid('night', { exclude: [m.id], selected: task.picks })}</div>`;
  }
  if (task.role === 'troublemaker') {
    if (task.stirred) return `<div class="panel">${head('troublemaker', 'Đã gây rối', 'Ngày mai, sau lần treo cổ đầu tiên, cả làng sẽ bỏ phiếu thêm một lần.')}</div>`;
    if (task.used) return `<div class="panel">${head('troublemaker', 'Đã gây rối rồi', 'Bạn chỉ gây rối được một lần. Bấm “Bỏ qua lượt này”.')}</div>`;
    return `<div class="panel stack">${head('troublemaker', 'Gây rối ngày mai?', 'Một lần cả ván: ngày mai sẽ có 2 lần treo cổ.')}
      <button class="btn btn-primary btn-block" data-act="stir">🔥 Gây rối</button></div>`;
  }
  if (task.role === 'ghost') {
    if (task.letter) return `<div class="panel">${head('ghost', 'Đã gửi', `Sáng mai cả làng sẽ thấy chữ “${esc(task.letter)}”.`)}</div>`;
    const letters = [...'AĂÂBCDĐEÊGHIKLMNOÔƠPQRSTUƯVXY'].filter(l => /^[A-ZĐ]$/.test(l));
    return `<div class="panel">${head('ghost', 'Để lại một chữ cái', 'Sáng mai cả làng sẽ thấy chữ này. Không dùng chữ để chỉ thẳng tên ai.')}
      <div class="letters">${letters.map(l => `<button class="btn btn-ghost" data-act="ghostLetter" data-letter="${l}">${l}</button>`).join('')}</div></div>`;
  }
  if (task.role === 'witch') {
    if (task.complete) return `<div class="panel">${head('witch', 'Xong lượt', 'Nhắm mắt lại nhé.')}</div>`;
    return `<div class="panel stack">${head('witch', 'Bình cứu hay bình độc?', 'Bạn không biết ai bị Sói cắn. Bình Cứu sẽ cứu người bị cắn đêm nay, nếu có.')}
      ${task.healed ? '<p class="result result-village">Bạn đã dùng bình Cứu đêm nay.</p>'
        : task.healAvailable ? '<button class="btn btn-good btn-block" data-act="heal">Dùng bình Cứu</button>'
        : '<p class="muted small">Bình Cứu đã dùng hết.</p>'}
      ${task.poisoned ? `<p class="result result-wolf">Bạn đã đầu độc ${esc(seatName(task.poisoned))}.</p>`
        : task.poisonAvailable ? `<div><p class="field-label">Hoặc chọn người để dùng bình Độc</p>${pickGrid('poison', { exclude: [m.id] })}</div>`
        : '<p class="muted small">Bình Độc đã dùng hết.</p>'}
    </div>`;
  }
  return '';
}

// The whole night as it happens, for a moderator who does not play and for
// the dead once nobody can bring them back.
function watchNight() {
  const w = view.me.watch;
  const lead = view.me.spectator
    ? 'Bạn đã chết và không còn ai hồi sinh được, nên bạn được xem toàn bộ diễn biến. Hãy giữ im lặng, đừng để lộ cho người còn sống.'
    : 'Chỉ bạn thấy được bảng này.';
  return `
    <div class="panel stack">
      <h2>${view.me.spectator ? '👁️ Theo dõi đêm nay' : 'Bảng quản trò'}</h2>
      <p class="lead">${lead}</p>
      ${w.live ? `<p class="result">${esc(w.live)}</p>` : ''}
      ${w.thiefExtras?.length ? `<p class="small">Lá dư của Ăn Trộm: <strong>${w.thiefExtras.map(id => ROLES[id]?.name || id).join(', ')}</strong></p>` : ''}
      ${w.lines.length
        ? `<ul class="log">${w.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        : '<p class="muted small">Đêm nay chưa có gì xảy ra.</p>'}
    </div>`;
}

// ---------- Role card ----------

function renderCard(reset = true) {
  if (view.gameId !== 'werewolf') {
    document.getElementById('cardSheetBody').innerHTML = `
      <h3 id="cardSheetTitle" class="hidden">Lá bài của bạn</h3>
      ${gameUI().card(helpers())}
      <button class="btn btn-ghost btn-big sheet-close" data-act="closeSheet">Úp bài xuống</button>`;
    return;
  }
  const m = view.me;
  const r = ROLES[m.role];
  const body = document.getElementById('cardSheetBody');
  if (!r) return;
  if (reset) flipped.clear();
  if (!m.art) cardTab = 'role';
  const revealed = flipped.has('role');
  const tabs = m.art ? `<div class="board-tabs sheet-tabs" role="group" aria-label="Bài trên tay">
      <button data-act="cardTab" data-tab="role" aria-pressed="${cardTab === 'role'}">🂠 Vai trò</button>
      <button data-act="cardTab" data-tab="art" aria-pressed="${cardTab === 'art'}">🗝️ Artifact${m.art.hand.some(c => !c.revealed) ? ` (${m.art.hand.filter(c => !c.revealed).length})` : ''}</button>
    </div>` : '';
  if (cardTab === 'art') {
    body.innerHTML = `<h3 id="cardSheetTitle" class="hidden">Artifact của bạn</h3>${tabs}${artTab()}
      <button class="btn btn-ghost btn-big sheet-close" data-act="closeSheet">Úp bài xuống</button>`;
    return;
  }
  const extra = [];
  if (m.wolves.length) extra.push(`${m.role === 'minion' ? 'Các con Sói (bạn là Tay Sai của chúng)' : 'Đồng bọn Sói'}: ${m.wolves.map(id => `${seatName(id)}${player(id)?.turned ? ' (Sói Nguyền)' : ['wolf_cub', 'avenger'].includes(player(id)?.role) ? ` (${ROLES[player(id).role].name})` : ''}`).join(', ')}`);
  if (view.phase === 'SWAP' && (PACK_ROLES.includes(m.role) || ['minion', 'mason'].includes(m.role))) {
    extra.push('🤫 Đồng đội của bạn sẽ hiện ở đây khi hết giờ trao đổi vai (vai có thể còn đổi).');
  }
  if (m.masons?.length) extra.push(`🤝 Hội Kín cùng bạn: ${m.masons.map(seatName).join(', ')}`);
  if (m.hoodlumMarks?.length) extra.push(`🔪 Hai mục tiêu của bạn: ${m.hoodlumMarks.map(seatName).join(' và ')}`);
  if (m.doppelTarget) extra.push(`🎭 Bạn đang theo bóng ${seatName(m.doppelTarget)}.`);
  if (m.copied) extra.push('🎭 Bạn là Kẻ Song Trùng và đã nhận vai này từ người bạn theo bóng.');
  if (m.wounded) extra.push('💪 Bạn đã bị Sói cắn: hết ngày hôm nay bạn sẽ chết vào đêm tới.');
  if (m.avengerTarget) extra.push(`🗡️ Nếu bạn bị treo cổ, ${seatName(m.avengerTarget)} sẽ chết theo.`);
  if (m.lover) {
    const lr = player(m.lover)?.role;
    extra.push(`💘 Người yêu của bạn: ${seatName(m.lover)}${lr ? ` (${player(m.lover).turned ? 'Sói Nguyền đã hoá Sói' : ROLES[lr].name})` : ''}`);
  }
  if (m.swapped) extra.push('🔄 Bạn đã trao đổi vai: lá bài này là của một người chơi khác.');
  if (m.turned) extra.push('🌑 Bạn là Sói Nguyền và đã bị Sói cắn: giờ bạn là Ma Sói, thức dậy và thắng cùng đàn Sói.');
  if (m.wasThief && m.role !== 'thief') extra.push(`🦝 Bạn là Ăn Trộm và đã đổi sang lá ${r.name}.`);
  if (m.charmed) {
    extra.push(m.charmedWith?.length
      ? `🎶 Bạn đã bị Người Thổi Sáo thôi miên, cùng với: ${m.charmedWith.map(seatName).join(', ')}`
      : '🎶 Bạn đã bị Người Thổi Sáo thôi miên.');
  }
  if (m.charmedList?.length) extra.push(`🎶 Đã thôi miên: ${m.charmedList.map(seatName).join(', ')}`);
  if (m.powerless) extra.push('👴 Già Làng đã chết dưới tay dân làng: bạn đã mất chức năng đến hết ván. Hãy giữ bí mật điều này.');
  if (m.clawed) extra.push('🐾 Nhờ Artifact, bạn đã thành Sói: thức dậy cùng đàn Sói và thắng thua cùng phe Sói (vẫn giữ chức năng của vai này).');
  if (m.art?.lostPower) extra.push('🗝️ Một lá Artifact đã lấy mất chức năng của vai này (xem 📜 Nhật ký).');
  if (!m.alive) extra.push('Bạn đã bị loại, hãy giữ im lặng nhé.');
  const teamColor = { village: 'var(--village)', werewolf: '#e0766b' }[r.team] || 'var(--third)';
  body.innerHTML = `
    <h3 id="cardSheetTitle" class="hidden">Lá bài của bạn</h3>
    ${tabs}
    <button class="card ${revealed ? 'revealed' : ''}" data-act="flip" data-key="role" aria-label="Lật lá bài">
      <div class="card-inner">
        <div class="card-face card-back">${crescentSvg()}<p>Chạm để lật bài<br><span class="small muted">Che màn hình khỏi người bên cạnh</span></p></div>
        <div class="card-face card-front">
          <p class="card-top" style="color:${teamColor}"><span>${TEAM_LABEL[r.team]}</span><span class="pts">${r.points > 0 ? '+' : ''}${r.points}</span></p>
          <div class="art">${r.art}</div>
          <h3>${r.name}</h3>
          <p class="desc">${r.description}</p>
        </div>
      </div>
    </button>
    ${extra.length ? `<div class="card-notes">${extra.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    <button class="btn btn-ghost btn-big sheet-close" data-act="closeSheet">Úp bài xuống</button>`;
}

// The cards in this game, by team. Everyone saw these counts in the lobby,
// so showing them again reveals nothing about who holds what.
// What you did each night and what you learned, newest first.
function renderNotes() {
  const notes = view.me?.notes || [];
  const nights = [...new Set(notes.map(n => n.night))].sort((a, b) => b - a);
  document.getElementById('notesBody').innerHTML = `
    <div class="sheet-head"><h3 id="notesTitle">Nhật ký đêm của bạn</h3><button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button></div>
    ${nights.length ? nights.map(night => `
      <h4 class="notes-night">Đêm ${night}</h4>
      <ul class="notes-list">${notes.filter(n => n.night === night).map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>`).join('')
      : '<p class="muted">Chưa có gì. Những việc bạn làm ban đêm sẽ được ghi lại ở đây.</p>'}
    <p class="muted small" style="margin-top:12px">Chỉ mình bạn xem được. Che màn hình khỏi người bên cạnh.</p>`;
}

function renderDeck() {
  const counts = view.roleCounts || {};
  const teamOfRole = (id) => (['village', 'werewolf'].includes(ROLES[id].team) ? ROLES[id].team : 'third');
  const groups = [
    ['werewolf', '🐺 Phe Sói', 'w'],
    ['village', '🌾 Phe Dân', 'v'],
    ['third', '🎭 Phe thứ ba', 't']
  ];
  const total = ROLE_IDS.reduce((n, id) => n + (counts[id] || 0), 0);
  const players = view.phase === 'LOBBY'
    ? view.players.filter(p => !(p.isHost && !view.config.hostPlays)).length
    : view.players.filter(p => p.inGame).length;
  document.getElementById('deckBody').innerHTML = `
    <div class="sheet-head"><h3 id="deckTitle">Vai trò trong ván</h3><button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button></div>
    <p class="muted small">${total} lá bài cho ${players} người${counts.thief ? ' (có Ăn Trộm nên chia dư 2 lá; 2 lá dư không thuộc về ai)' : ''}.</p>
    ${groups.map(([team, label, cls]) => {
      const ids = ROLE_IDS.filter(id => counts[id] > 0 && teamOfRole(id) === team);
      if (!ids.length) return '';
      const n = ids.reduce((sum, id) => sum + counts[id], 0);
      return `<section class="deck-group">
        <h3 class="deck-team"><i class="dot ${cls}"></i>${label}: ${n}</h3>
        ${ids.map(id => `<div class="deck-row">
          <span class="deck-icon" aria-hidden="true">${ROLES[id].icon}</span>
          <span class="deck-name"><strong>${ROLES[id].name}</strong><span class="muted small">${ROLES[id].short}</span></span>
          <span class="deck-count">×${counts[id]}</span>
        </div>`).join('')}
      </section>`;
    }).join('')}`;
}

function renderRules() {
  // The rules of the game on the table (or picked on the home page).
  const gameId = view ? view.gameId : homeGame;
  if (GAME_UI[gameId]) {
    document.getElementById('rulesBody').innerHTML = `
      <div class="sheet-head"><h3 id="rulesTitle">Luật chơi: ${esc(gameInfo(gameId).name)}</h3><button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button></div>
      <div class="stack small">${GAME_UI[gameId].rules}</div>`;
    return;
  }
  const tabs = `<div class="board-tabs sheet-tabs" role="group" aria-label="Phần luật">
      <button data-act="rulesTab" data-tab="roles" aria-pressed="${rulesTab === 'roles'}">🐺 Vai trò</button>
      <button data-act="rulesTab" data-tab="art" aria-pressed="${rulesTab === 'art'}">🗝️ Artifact${view?.config?.artifacts ? ' · đang bật' : ''}</button>
    </div>`;
  const head = `<div class="sheet-head"><h3 id="rulesTitle">Luật chơi</h3><button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button></div>${tabs}`;
  const body = document.getElementById('rulesBody');
  if (rulesTab === 'art') {
    const group = (title, ids) => ids.length ? `<h3 class="rules-group">${title} <span class="muted">(${ids.length})</span></h3>
      <div class="rules-arts">${ids.map(id => { const a = ARTIFACTS[id]; return `<div class="rules-art">
        <span class="ic" aria-hidden="true">${a.icon}</span>
        <span><strong>${esc(a.name)}</strong> <span class="pts">${a.once ? '1' : '∞'}</span><br><span class="muted en">${esc(a.en)}</span><br>${esc(a.desc)}</span></div>`; }).join('')}</div>` : '';
    const ids = Object.keys(ARTIFACTS);
    body.innerHTML = `${head}
      <div class="stack small">
        <p class="lead">${view?.config?.artifacts ? 'Ván này có Artifact.' : 'Chủ phòng bật Artifact trong “Luật ván này” ở phòng chờ.'} Mỗi người nhận thêm 1 lá Artifact úp, ngoài lá vai trò.</p>
        <details class="section rules-how"><summary><span class="btn-link">📖 Cách dùng Artifact (${ARTIFACT_RULES.length - 1} điều)</span></summary>
          <ul class="rules-list">${ARTIFACT_RULES.slice(1).map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>
        ${group('💠 Đá quý (tác động lên Artifact khác)', ids.filter(id => ARTIFACTS[id].gem))}
        ${group('1 · Dùng một lần khi lật', ids.filter(id => !ARTIFACTS[id].gem && ARTIFACTS[id].once))}
        ${group('∞ · Luôn có tác dụng sau khi lật', ids.filter(id => !ARTIFACTS[id].gem && !ARTIFACTS[id].once))}
      </div>`;
    return;
  }
  body.innerHTML = `${head}
    <div class="stack small">
      <p>Mỗi đêm, quản trò gọi dậy theo thứ tự dưới đây. Người được gọi thao tác trên điện thoại của mình.</p>
      <ol class="rules-steps">${NIGHT_STEPS.map(st => `<li>${stepInfo(st.id).icon} ${stepInfo(st.id).name}${st.also ? ` (cùng ${st.also.map(id => ROLES[id].name).join(', ')})` : ''}${st.firstNightOnly ? ' (đêm đầu)' : ''}${st.notFirstNight ? ' (từ đêm thứ hai)' : ''}</li>`).join('')}</ol>
      <p>Cặp đôi và những người bị thôi miên không bị gọi dậy: tên của người kia hiện trên lá bài của họ, hãy xem lá bài khi trời sáng.</p>
      <p>Nếu chủ phòng bật "Quản trò tự ghép đôi", ván không có lá Thần Tình Yêu: lúc xem lá bài trước đêm đầu, game chọn ngẫu nhiên 2 người làm Tình Nhân, và họ thấy nhau trên lá bài như bình thường.</p>
      <p>Ban ngày: công bố người chết, thảo luận, bỏ phiếu chọn nghi phạm, nghi phạm biện hộ, rồi cả làng chọn treo cổ hay tha.</p>
      <p>Phe Dân thắng khi hết Sói (và Người Thổi Sáo, nếu có, đã chết). Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại. Người Thổi Sáo thắng khi mọi người còn sống đều đã bị thôi miên.</p>
      <h3 style="margin-top:8px">Vai trò</h3>
      <div class="rules-roles">${ROLE_IDS.map(id => `<p><strong>${ROLES[id].icon} ${ROLES[id].name}</strong>: ${ROLES[id].description}</p>`).join('')}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Clock (moon timer)
// ---------------------------------------------------------------------------

function updateClock() {
  const moon = document.getElementById('moon');
  const label = document.getElementById('timeLeft');
  if (!moon || !view || view.phase === 'LOBBY') return;
  const g = view.game;
  const day = view.phase !== 'NIGHT';
  if (!g.phaseEndsAt) {
    moon.querySelector('svg').outerHTML = dialSvg(1, day);
    label.textContent = '';
    return;
  }
  const total = Math.max(1, g.phaseEndsAt - g.phaseStartedAt);
  const left = Math.max(0, g.phaseEndsAt - serverNow());
  const secs = Math.ceil(left / 1000);
  moon.querySelector('svg').outerHTML = dialSvg(left / total, day);
  label.textContent = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}`;
  moon.classList.toggle('urgent', secs <= 5);
  moon.setAttribute('aria-label', `Còn ${secs} giây`);
  highlightNarration();
}

setInterval(updateClock, 250);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  const id = el.dataset.id;
  if (gameUI()?.click(a, el, helpers())) return;

  switch (a) {
    case 'home-link':
      if (session) { e.preventDefault(); }
      return;
    case 'tab': homeTab = el.dataset.tab; return renderHome();
    case 'selectGame': return act('selectGame', { gameId: el.dataset.game });
    case 'homeGame':
      homeGame = el.dataset.game;
      homeTab = 'create';
      store('hub_game', homeGame);
      return renderHome();
    case 'resumeRoom': return resumeRoom();
    case 'forgetRoom':
      savedRoom = null;
      saveSession(null);
      return renderHome();
    case 'rules': renderRules(); return document.getElementById('rulesSheet').showModal();
    case 'deck': renderDeck(); return document.getElementById('deckSheet').showModal();
    case 'exportLog': return exportLog();
    case 'copyLog': return copyLog();
    case 'boardSide':
      boardSide = el.dataset.side;
      return render();
    case 'notes': renderNotes(); return document.getElementById('notesSheet').showModal();
    case 'closeSheet': return el.closest('dialog').close();
    case 'leave': return leaveRoom();
    case 'share': return share();
    case 'kick': {
      const p = player(id);
      if (p && confirm(`Mời ${p.name} ra khỏi phòng?`)) act('kick', { id });
      return;
    }
    case 'setupOpen':
      setupOpen = true;
      window.scrollTo(0, 0);
      return render();
    case 'setupClose':
      setupOpen = false;
      return render();
    case 'deckEdit':
      deckEdit = !deckEdit;
      return render();
    case 'botCount':
      botCount += Number(el.dataset.delta);
      return render();
    case 'addBot': return act('addBot', { count: botCount });
    case 'autoBalance': return act('autoBalance');
    case 'role': return act('role', { roleId: el.dataset.role, delta: Number(el.dataset.delta) });
    case 'pickRole':
      roleInfo = el.dataset.role;
      return act('pickRole', { roleId: el.dataset.role });
    case 'editTab':
      editTab = el.dataset.tab;
      return render();
    case 'roleStep': return act('role', { roleId: el.dataset.role, delta: Number(el.dataset.delta) });
    case 'fitDeck': return act('fitDeck');
    case 'swapJoin': return act('swapJoin');
    case 'start':
      narrator.unlock();
      return act('start');
    case 'testVoice':
      narrator.unlock();
      narrator.sfx('night');
      narrator.play([
        { k: 'night_start', v: 0, t: 'Màn đêm buông xuống... Cả làng hãy nhắm mắt lại, và chìm vào giấc ngủ.' },
        { k: 'werewolf_wake', v: 0, t: lineText('werewolf_wake', 0) }
      ]);
      return renderLobby();
    case 'hostVote':
      // The chosen phone will play sound: unlock audio on this tap in case it's us.
      if (id === view?.me?.id) narrator.unlock();
      return act('hostVote', { candidate: id });
    case 'localAudio':
      localAudio = el.checked;
      store('masoi_local_audio', localAudio ? 'on' : 'off');
      if (localAudio) {
        narrator.unlock();
        toast('Máy này sẽ phát lời quản trò từ câu tiếp theo.');
      } else {
        narrator.stop();
      }
      return;
    case 'vibrate':
      vibrateOn = el.checked;
      store('masoi_vibrate', vibrateOn ? 'on' : 'off');
      if (vibrateOn) navigator.vibrate?.(80);
      return;
    case 'ambience':
      return setAmbience(el.checked);
    case 'toggleAmbience':
      setAmbience(!ambienceOn);
      return renderGame();
    case 'unlock':
      narrator.unlock();
      if (view?.narration) narrator.handle(view.narration, { replay: true });
      return renderGame();
    case 'replay':
      return narrator.handle(view?.narration, { replay: true });
    case 'skip': return act('skip');
    case 'endGame':
      if (confirm('Kết thúc ván này và về phòng chờ?')) act('endGame');
      return;
    case 'restart': return act('restart');
    case 'card':
    case 'artCard':
      cardTab = a === 'artCard' ? 'art' : 'role';
      renderCard(true);
      return document.getElementById('cardSheet').showModal();
    case 'cardTab':
      cardTab = el.dataset.tab;
      return renderCard(false);
    case 'flip': {
      const key = el.dataset.key;
      if (key) flipped.has(key) ? flipped.delete(key) : flipped.add(key);
      return el.classList.toggle('revealed');
    }
    case 'rulesTab':
      rulesTab = el.dataset.tab;
      return renderRules();
    case 'night': return act('night', { target: id });
    case 'noKill': return act('night', { noKill: true });
    case 'seerDone': return act('seerDone').then(() => act('endTurn'));
    case 'detectiveDone': return act('detectiveDone').then(() => act('endTurn'));
    case 'ack': return act('ack').then(() => act('endTurn'));
    case 'endTurn': return act('endTurn');
    case 'stir': return act('troublemaker');
    case 'ghostLetter': return act('ghost', { letter: el.dataset.letter });
    case 'extend': return act('extend');
    case 'thiefPick': {
      const card = view.me.task?.extras?.[Number(el.dataset.pick)];
      if (card && confirm(`Đổi sang lá ${ROLES[card].name}?`)) act('thief', { pick: Number(el.dataset.pick) });
      return;
    }
    case 'thiefKeep': return act('thief', { pick: null });
    case 'heal':
      if (confirm('Dùng bình Cứu đêm nay? Bình chỉ dùng được 1 lần, kể cả khi đêm nay không ai bị cắn.')) act('witch', { use: 'heal' });
      return;
    case 'poison': {
      const p = player(id);
      if (p && confirm(`Dùng bình Độc lên ${p.name}? Bình này chỉ dùng được 1 lần.`)) act('witch', { use: 'poison', target: id });
      return;
    }
    case 'witchDone': return act('witch', { use: 'done' }).then(() => act('endTurn'));
    case 'vote':
      // Tapping your own pick again takes the vote back.
      return view.game.votes?.[view.me.id] === id ? act('unvote') : act('vote', { target: id });
    case 'judge': return act('judge', { choice: el.dataset.choice });
    // Artifacts
    case 'artReveal': {
      const c = view.me.art?.hand.find(k => k.uid === Number(el.dataset.uid));
      if (c && confirm(`Lật ${ARTIFACTS[c.id].name} cho cả làng xem và dùng ngay?`)) {
        artPicks = [];
        document.getElementById('cardSheet').close();
        act('artReveal', { uid: c.uid });
      }
      return;
    }
    case 'artPick': {
      const pd = view.me.art?.pending;
      if (!pd) return;
      artPicks = artPicks.includes(id) ? artPicks.filter(x => x !== id) : [...artPicks, id].slice(-pd.n);
      return render();
    }
    case 'artChoose': {
      const targets = artPicks;
      artPicks = [];
      return act('artChoose', { targets });
    }
    case 'artDecide': return act('artDecide', { force: el.dataset.force === '1' });
    case 'artLetter': return act('artLetter', { letter: el.dataset.letter });
    case 'artDawn': return act('artDawn', { uid: Number(el.dataset.uid), target: id });
  }
});

// Lobby settings: show values live while dragging, send when released.
document.addEventListener('input', (e) => {
  const gkey = e.target.dataset?.gameConfig;
  if (gkey) document.getElementById(`gval-${gkey}`).textContent = fmtSeconds(Number(e.target.value));
  const key = e.target.dataset?.config;
  if (key && e.target.type === 'range') {
    document.getElementById(`val-${key}`).textContent = fmtSeconds(Number(e.target.value));
  }
});
document.addEventListener('change', (e) => {
  const gkey = e.target.dataset?.gameConfig;
  if (gkey) {
    act('gameConfig', { [gkey]: Number(e.target.value) }).then(() => e.target.blur());
    return;
  }
  const key = e.target.dataset?.config;
  if (!key) return;
  const value = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
  act('config', { [key]: value }).then(() => e.target.blur());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) {
    sync();
    if (isHost() && view?.phase !== 'LOBBY') requestWakeLock();
  }
});

// Remember whether the host left the settings panel open across re-renders.
document.addEventListener('toggle', (e) => {
  if (e.target.id === 'settingsBox') settingsOpen = e.target.open;
  if (e.target.id === 'timersBox') timersOpen = e.target.open;
}, true);

// A game module asking for an action outside a tap (a typed guess).
window.addEventListener('hub-act', (e) => act(e.detail.type, e.detail.payload));

// Close dialogs by tapping the backdrop.
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', (e) => {
  if (e.target === d) d.close();
}));

function setAmbience(on) {
  ambienceOn = on;
  store('masoi_ambience', on ? 'on' : 'off');
  narrator.unlock();
  narrator.setAmbienceVolume(ambienceVolume / 100);
  narrator.setAmbience(on, moodForPhase(view?.phase || 'LOBBY'));
}

// Browsers only allow sound after a tap. After a reload, music (or the
// narrator) that was on comes back with the first tap anywhere.
document.addEventListener('pointerdown', () => {
  if (ambienceOn || (view && audioOn())) narrator.unlock();
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'ambienceTheme') return;
  ambienceTheme = e.target.value;
  store('masoi_ambience_theme', ambienceTheme);
  narrator.setAmbienceTheme(ambienceTheme);
  // Picking a theme is a request to hear it.
  if (!ambienceOn) setAmbience(true);
  e.target.blur();
  render();
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'ambienceVolume') return;
  ambienceVolume = Number(e.target.value);
  store('masoi_ambience_volume', String(ambienceVolume));
  document.getElementById('ambienceVolumeValue').textContent = `${ambienceVolume}%`;
  narrator.setAmbienceVolume(ambienceVolume / 100);
});

const isLogHead = (line) => /^(🌙 Đêm|☀️ Sáng)/.test(line);

// The whole game as plain text: result, everyone's role, then what happened
// in order. Saved as a file or copied to the clipboard.
const pad2 = (n) => String(n).padStart(2, '0');
function logText(d = new Date()) {
  const g = view.game;
  const pad = pad2;
  const stamp = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const lines = ['MA SÓI – NHẬT KÝ VÁN CHƠI', `Phòng ${view.code} · ${stamp}`];
  if (view.phase === 'GAME_OVER' && g.winReason) lines.push(`Kết quả: ${g.winReason}`);
  const players = view.players.filter(p => p.inGame).sort((a, b) => a.seat - b.seat);
  if (players.some(p => p.role)) {
    lines.push('', 'VAI TRÒ');
    players.forEach(p => {
      const role = p.role ? (p.turned ? 'Sói Nguyền (đã hoá Sói)' : ROLES[p.role].name) : '?';
      lines.push(`- ${p.name}: ${role}${p.alive ? '' : ' (đã chết)'}`);
    });
  }
  lines.push('', 'DIỄN BIẾN');
  g.log.forEach(l => lines.push(isLogHead(l) ? `\n${l}` : `  ${l}`));
  return lines.join('\n') + '\n';
}

function exportLog() {
  const pad = pad2;
  const d = new Date();
  // A byte-order mark so Windows Notepad reads the Vietnamese correctly.
  const blob = new Blob(['\ufeff' + logText(d)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ma-soi-${view.code}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyLog() {
  const text = logText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers, or no clipboard permission: copy from a hidden field.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) return toast('Không sao chép được. Hãy dùng "Tải nhật ký (.txt)".', 'error');
  }
  toast('Đã sao chép nhật ký ván chơi.');
}

async function share() {
  const url = shareUrl();
  const text = `Vào chơi Ma Sói với mình nhé! Mã phòng: ${view.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Ma Sói Online', text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Đã sao chép link mời. Gửi cho bạn bè nhé!');
  } catch {
    prompt('Sao chép link mời:', url);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

narrator.onState = () => {
  if (screen === 'lobby' && isHost()) {
    const el = document.getElementById('hostVoice');
    if (el) renderVoicePanel(true);
  }
};

(async function boot() {
  await narrator.init();
  const roomParam = (params.get('room') || '').toUpperCase();
  if (session && roomParam === session.code) {
    // Reloading the room's own link: go straight back in.
    render();
    startRealtime();
    sync();
  } else {
    const saved = session;
    if (saved && roomParam) saveSession(null); // a link to another room
    else session = null;
    render();
    // Plain home page: offer the saved room, but only once the server
    // confirms it still exists with this player in it.
    if (saved && !roomParam) checkSavedRoom(saved);
  }
})();
