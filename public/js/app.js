import {
  ROLES, ROLE_IDS, TEAM_LABEL, MIN_PLAYERS, totalRoles, validateRoleCounts
} from '/shared/roles.js';
import { Narrator } from './narrator.js';
import { connectRealtime } from './realtime.js';

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
let view = null;
let clockOffset = 0;
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
let lastTaskKey = null;
let lastPhaseKey = null;
let wakeLock = null;
let ambienceOn = false;

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
const shareUrl = () => `${location.origin}/?room=${view?.code || ''}`;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, body, query) {
  const url = '/api/room' + (query ? '?' + new URLSearchParams(query) : '');
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Không kết nối được máy chủ.');
    err.status = res.status;
    throw err;
  }
  return data;
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
      else if (data.serverNow) clockOffset = data.serverNow - Date.now();
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
  if (live) delay = 15000;
  else if (hidden) delay = 5000;
  else delay = Math.min((isHost() ? 1000 : 1500) * (1 + failures), 8000);
  heartbeatTimer = setTimeout(sync, delay);
}

// Ask the server to advance the game when the phase ends. The host's phone
// goes first; others follow a moment later in case the host is offline (if the
// host already advanced it, their request just returns "unchanged").
function scheduleWake() {
  clearTimeout(wakeTimer);
  const at = view?.game?.wakeAt;
  if (!session || !at) return;
  const grace = isHost() ? 250 : 1500 + Math.random() * 1500;
  const version = view.version;
  wakeTimer = setTimeout(() => {
    if (view?.version === version) sync();
  }, Math.max(0, at - serverNow()) + grace);
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
        if (session?.code === code && (!view || !v || v > view.version)) setTimeout(sync, Math.random() * 200);
      },
      onPresence: (ids) => {
        presence = ids;
        if (view) render();
      },
      onStatus: (ok) => {
        const was = live;
        live = ok;
        // Catch up on anything missed while disconnected.
        if (ok && !was) sync();
        else scheduleHeartbeat();
      }
    });
  } catch (err) {
    console.warn('Realtime unavailable, falling back to polling', err);
  }
}

function stopRealtime() {
  realtime?.close();
  realtime = null;
  live = false;
  presence = null;
}

// Online if Realtime presence says so; otherwise trust the server's last-seen.
const isOnline = (p) => p.isBot || (presence?.size ? presence.has(p.id) : p.online);

function setConnection(ok) {
  const el = document.getElementById('conn');
  if (!el) return;
  el.innerHTML = ok
    ? '<span class="status-dot"></span>Đã kết nối'
    : '<span class="status-dot off"></span>Mất kết nối, đang thử lại…';
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function createRoom(name) {
  try {
    const data = await api('POST', { action: 'create', name, debug: DEBUG });
    enterRoom(data);
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

function enterRoom(data) {
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
  clockOffset = next.serverNow - Date.now();
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

  if (next.me?.isHost) {
    if (phaseChanged && prev && narrator.unlocked) {
      if (next.phase === 'NIGHT' && prev.phase !== 'NIGHT') narrator.sfx('night');
      if (next.phase === 'MORNING') narrator.sfx('morning');
      if (next.phase === 'VERDICT' || next.phase === 'JUDGE') narrator.sfx('gavel');
      if (next.phase === 'NIGHT' && next.game.activeRole === 'werewolf') narrator.sfx('howl');
    }
    narrator.handle(next.narration);
    if (next.phase !== 'LOBBY') requestWakeLock();
  }

  const task = next.me?.task;
  const taskKey = task ? `${phaseKey}:${task.role}` : null;
  if (taskKey && taskKey !== lastTaskKey && navigator.vibrate) navigator.vibrate([120, 80, 120]);
  lastTaskKey = taskKey;

  if (prev && prev.phase === 'LOBBY' && next.phase === 'NIGHT' && next.me?.inGame) {
    toast('Ván chơi bắt đầu. Bấm “Lá bài của tôi” để xem vai trò.');
  }
  document.body.dataset.time = ['NIGHT', 'LOBBY'].includes(next.phase) ? 'night' : 'day';
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
    window.scrollTo(0, 0);
  }
  if (screen === 'home') renderHome();
  else if (screen === 'lobby') renderLobby();
  else renderGame();
}

function topbar(extra = '') {
  return `
    <header class="topbar">
      <a class="brand" href="/" data-act="home-link">Ma Sói</a>
      <div class="topbar-actions">
        ${extra}
        <button class="btn btn-ghost btn-small" data-act="rules">Luật chơi</button>
      </div>
    </header>`;
}

function moonSvg(fraction, day = false) {
  // fraction 1 = full disc, 0 = fully in shadow.
  const f = Math.max(0, Math.min(1, fraction));
  const shadowX = 50 + 96 * f;
  const lit = day ? '#f2c46b' : 'var(--moon)';
  return `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><clipPath id="moonClip"><circle cx="50" cy="50" r="46"/></clipPath></defs>
      <circle cx="50" cy="50" r="46" fill="${lit}"/>
      <circle cx="${shadowX.toFixed(1)}" cy="50" r="46" fill="#232a52" opacity="0.92" clip-path="url(#moonClip)"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(239,228,200,.35)" stroke-width="2"/>
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
    <section class="hero">
      <svg class="hero-moon" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" fill="var(--moon)"/>
        <circle cx="70" cy="40" r="44" fill="#232a57"/>
      </svg>
      <h1>Ma Sói</h1>
      <p>Mỗi người một điện thoại, một lá bài bí mật. Máy của chủ phòng làm quản trò và đọc lời dẫn cho cả làng nghe.</p>
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
          <p class="muted small">Bạn sẽ là chủ phòng: chọn vai trò, chỉnh thời gian, và để điện thoại của bạn giữa bàn làm quản trò.</p>
          <button class="btn btn-primary btn-block" type="submit">Tạo phòng</button>
        `}
      </form>
      ${DEBUG ? '<p class="hint">Chế độ thử nghiệm đang bật: chủ phòng có thể thêm bot.</p>' : ''}
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

function renderLobby() {
  const host = isHost();
  const focusInSettings = document.activeElement?.closest?.('#settings');
  if (!document.getElementById('lobbyRoot')) {
    app.innerHTML = `
      ${topbar('<button class="btn btn-ghost btn-small" data-act="leave">Rời phòng</button>')}
      <div id="lobbyRoot" class="stack-lg">
        <section class="panel stack" id="roomInfo"></section>
        <section class="panel" id="players"></section>
        <section id="hostVoice"></section>
        <section id="settings"></section>
        <section class="panel" id="roles"></section>
      </div>
      <div class="bottom-bar"><div class="bottom-bar-inner" id="lobbyFooter"></div></div>`;
  }

  const participants = view.players.filter(p => !(p.isHost && !view.config.hostPlays));
  document.getElementById('roomInfo').innerHTML = `
    <div class="row-between">
      <div>
        <p class="muted small">Mã phòng</p>
        <p class="room-code">${esc(view.code)}</p>
      </div>
      <button class="btn btn-primary" data-act="share">Mời bạn bè</button>
    </div>
    <p class="muted small" id="conn"><span class="status-dot"></span>Đã kết nối</p>`;

  document.getElementById('players').innerHTML = `
    <div class="row-between" style="margin-bottom:6px">
      <h3>Người trong phòng</h3>
      <span class="muted small">${participants.length} người chơi</span>
    </div>
    ${view.players.map(p => `
      <div class="player-row">
        <div class="seat" style="min-height:0;padding:0"><span class="disc" style="width:40px;height:40px;font-size:1.1rem">${p.seat ?? '★'}</span></div>
        <div class="name">
          ${esc(p.name)}
          ${p.isHost ? `<span class="tag tag-host">${view.config.hostPlays ? 'Chủ phòng' : 'Quản trò'}</span>` : ''}
          ${p.id === view.me.id ? '<span class="tag">Bạn</span>' : ''}
          ${!isOnline(p) ? '<span class="tag tag-off">Mất kết nối</span>' : ''}
        </div>
        ${host && !p.isHost ? `<button class="btn btn-ghost btn-small" data-act="kick" data-id="${esc(p.id)}" aria-label="Mời ${esc(p.name)} ra khỏi phòng">Mời ra</button>` : ''}
      </div>`).join('')}
    ${host && view.debug ? '<button class="btn btn-ghost btn-small" style="margin-top:10px" data-act="addBot">Thêm bot thử nghiệm</button>' : ''}
    ${participants.length < MIN_PLAYERS ? `<p class="hint">Cần ít nhất ${MIN_PLAYERS} người chơi. Hãy gửi link mời cho bạn bè.</p>` : ''}`;

  document.getElementById('hostVoice').innerHTML = host ? voicePanel() : '';

  if (!focusInSettings) {
    document.getElementById('settings').innerHTML = host ? settingsPanel() : '';
  }

  document.getElementById('roles').innerHTML = rolesPanel(participants.length, host);

  const problem = participants.length < MIN_PLAYERS
    ? `Cần thêm ${MIN_PLAYERS - participants.length} người nữa để bắt đầu.`
    : validateRoleCounts(view.roleCounts, participants.length);
  document.getElementById('lobbyFooter').innerHTML = host
    ? `${problem ? `<p class="note">${esc(problem)}</p>` : ''}
       <button class="btn btn-primary btn-block" data-act="start" ${problem ? 'disabled' : ''}>Chia bài và bắt đầu</button>`
    : `<p class="note">Đang chờ chủ phòng bắt đầu ván chơi…</p>`;
}

function voicePanel() {
  const status = narrator.hasRecordedVoice
    ? 'Đang dùng giọng đọc thu sẵn.'
    : narrator.voice
      ? `Đang dùng giọng của trình duyệt: ${esc(narrator.voice.name)}.`
      : 'Máy này chưa có giọng tiếng Việt. Hãy dùng Chrome hoặc Edge, hoặc tạo file giọng đọc (xem README).';
  return `
    <div class="panel stack">
      <h3>Giọng quản trò</h3>
      <p class="muted small">Chỉ máy của bạn phát tiếng. Hãy đặt máy ở giữa bàn và bật âm lượng to.</p>
      <p class="small">${status}</p>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn ${narrator.unlocked ? 'btn-ghost' : 'btn-primary'}" data-act="testVoice">${narrator.unlocked ? 'Nghe thử lại' : 'Bật âm thanh và nghe thử'}</button>
        <label class="check" style="padding:0"><input type="checkbox" data-act="ambience" ${ambienceOn ? 'checked' : ''} /> <span>Âm thanh nền</span></label>
      </div>
    </div>`;
}

const SLIDERS = [
  ['discussionTime', 'Thảo luận', 30, 600, 15],
  ['voteTime', 'Bỏ phiếu nghi phạm', 10, 120, 5],
  ['defenseTime', 'Biện hộ', 10, 180, 5],
  ['judgeTime', 'Phán quyết treo cổ', 10, 90, 5],
  ['nightStepTime', 'Mỗi lượt ban đêm', 10, 60, 5]
];

const fmtSeconds = (s) => s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${s % 60} giây` : ''}` : `${s} giây`;

function settingsPanel() {
  const c = view.config;
  return `
    <details class="panel section">
      <summary><h3>Cài đặt ván chơi</h3></summary>
      <label class="check">
        <input type="checkbox" data-config="hostPlays" ${c.hostPlays ? 'checked' : ''} />
        <span><strong>Tôi cũng nhận bài và chơi</strong><span class="muted small">Bỏ chọn nếu bạn chỉ làm quản trò. Khi đó bạn thấy được mọi vai trò.</span></span>
      </label>
      <label class="check">
        <input type="checkbox" data-config="revealRoleOnDeath" ${c.revealRoleOnDeath ? 'checked' : ''} />
        <span><strong>Lật bài người chết</strong><span class="muted small">Cả làng thấy vai trò của người vừa bị loại.</span></span>
      </label>
      ${SLIDERS.map(([key, label, min, max, step]) => `
        <div class="slider">
          <div class="row-between"><label for="cfg-${key}">${label}</label><span class="slider-value" id="val-${key}">${fmtSeconds(c[key])}</span></div>
          <input type="range" id="cfg-${key}" data-config="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}" />
        </div>`).join('')}
    </details>`;
}

function rolesPanel(count, host) {
  const counts = view.roleCounts;
  const total = totalRoles(counts);
  const wolves = counts.werewolf || 0;
  const wolfPct = total ? Math.round((wolves / total) * 100) : 0;
  return `
    <div class="row-between" style="margin-bottom:4px">
      <h3>Vai trò trong ván</h3>
      ${host && view.roleMode === 'manual' ? '<button class="btn btn-ghost btn-small" data-act="autoBalance">Dùng gợi ý</button>' : ''}
    </div>
    <p class="muted small">${view.roleMode === 'auto'
      ? 'Tự động cân bằng theo số người chơi.'
      : 'Chủ phòng đang tự chọn số lượng.'} ${total} lá bài cho ${count} người.</p>
    <div class="balance" style="margin:12px 0 4px" aria-label="Tỉ lệ phe Dân và phe Sói">
      <span class="v" style="width:${100 - wolfPct}%"></span><span class="w" style="width:${wolfPct}%"></span>
    </div>
    <div class="row-between small muted" style="margin-bottom:8px">
      <span>Phe Dân: ${total - wolves}</span><span>Phe Sói: ${wolves}</span>
    </div>
    ${ROLE_IDS.filter(id => host || counts[id] > 0).map(id => {
      const r = ROLES[id];
      return `
        <div class="role-row">
          <span class="icon" aria-hidden="true">${r.icon}</span>
          <div><strong>${r.name}</strong><p class="desc">${r.short}</p></div>
          ${host ? `
            <div class="stepper">
              <button data-act="role" data-role="${id}" data-delta="-1" ${counts[id] ? '' : 'disabled'} aria-label="Bớt ${r.name}">−</button>
              <output>${counts[id] || 0}</output>
              <button data-act="role" data-role="${id}" data-delta="1" aria-label="Thêm ${r.name}">+</button>
            </div>` : `<strong>×${counts[id]}</strong>`}
        </div>`;
    }).join('')}`;
}

// ---------- Game ----------

const PHASE_TITLE = {
  NIGHT: (g) => `Đêm ${g.day}`,
  MORNING: (g) => `Sáng ngày ${g.day}`,
  DISCUSSION: (g) => `Ngày ${g.day}: thảo luận`,
  VOTE: (g) => `Ngày ${g.day}: bỏ phiếu`,
  DEFENSE: (g) => `Ngày ${g.day}: biện hộ`,
  JUDGE: (g) => `Ngày ${g.day}: phán quyết`,
  VERDICT: (g) => `Ngày ${g.day}: kết quả`,
  GAME_OVER: () => 'Ván chơi kết thúc'
};

function renderGame() {
  if (!document.getElementById('gameRoot')) {
    app.innerHTML = `
      ${topbar('<button class="btn btn-ghost btn-small" data-act="leave">Rời</button>')}
      <div id="gameRoot" class="stack-lg">
        <section class="sky" id="sky"></section>
        <div id="narration"></div>
        <div id="hostBar"></div>
        <section class="stage" id="stage"></section>
        <section>
          <div class="row-between" style="margin-bottom:10px"><h3>Dân làng</h3><span class="muted small" id="aliveCount"></span></div>
          <div class="village" id="village"></div>
        </section>
        <details class="panel section" id="logBox">
          <summary><h3>Nhật ký ván chơi</h3></summary>
          <ol class="log" id="log"></ol>
        </details>
        <p class="muted small" id="conn"><span class="status-dot"></span>Đã kết nối</p>
      </div>
      <div class="bottom-bar"><div class="bottom-bar-inner" id="gameFooter"></div></div>`;
  }
  const g = view.game;
  document.getElementById('sky').innerHTML = `
    <div class="moon-timer" id="moon">${moonSvg(1)}<span class="time" id="timeLeft"></span></div>
    <div>
      <h1>${PHASE_TITLE[view.phase](g)}</h1>
      <p class="phase-sub">${phaseSubtitle()}</p>
    </div>`;
  updateClock();

  const text = narrationText(view.narration?.clips || []);
  document.getElementById('narration').innerHTML = text ? `<blockquote class="narration">${esc(text)}</blockquote>` : '';
  document.getElementById('hostBar').innerHTML = isHost() ? hostBar() : '';
  document.getElementById('stage').innerHTML = stage();

  const alive = view.players.filter(p => p.inGame && p.alive).length;
  const total = view.players.filter(p => p.inGame).length;
  document.getElementById('aliveCount').textContent = `Còn sống ${alive}/${total}`;
  document.getElementById('village').innerHTML = view.players.filter(p => p.inGame).map(p => seat(p)).join('');
  document.getElementById('log').innerHTML = g.log.map(l => `<li>${esc(l)}</li>`).join('');

  const m = view.me;
  document.getElementById('gameFooter').innerHTML = m.inGame
    ? `<button class="btn btn-ghost btn-block" data-act="card" style="background:var(--ink-2)">🂠 Lá bài của tôi</button>`
    : '';
  if (document.getElementById('cardSheet').open) renderCard(false);
}

// Seat clips ("Người chơi số ba") have no punctuation of their own; end the
// sentence when the next clip starts a new one.
function narrationText(clips) {
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
      const r = ROLES[g.activeRole];
      return r ? `Quản trò đang gọi ${r.name}.` : 'Cả làng đang ngủ.';
    }
    case 'MORNING': return g.lastNightDeaths.length ? 'Một đêm đẫm máu.' : 'Một đêm bình yên.';
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
      ${over ? '' : '<button class="btn btn-ghost btn-small" data-act="skip">Sang bước tiếp</button>'}
      <button class="btn btn-ghost btn-small" data-act="endGame">Kết thúc ván</button>
    </div>`;
}

function seat(p, opts = {}) {
  const { selectable = false, pressed = false, disabled = false, count = 0, sub = '', act = '' } = opts;
  // Keep roles off the always-visible village grid (a neighbour could glance at
  // it); your own role and wolf mates live in the card sheet and night panel.
  const showRole = view.phase === 'GAME_OVER' || !p.alive || !view.me?.inGame;
  const role = p.role && showRole ? ROLES[p.role] : null;
  const isMe = p.id === view.me?.id;
  const lover = view.me?.lover === p.id || (view.game.lovers || []).includes(p.id);
  const inner = `
    ${count ? `<span class="count">${count}</span>` : ''}
    <span class="disc">${p.seat ?? ''}${role ? `<span class="role-badge" title="${role.name}">${role.icon}</span>` : ''}</span>
    <span class="label">${esc(p.name)}</span>
    <span class="sub">${sub || [isMe ? 'Bạn' : '', lover ? '💘' : '', !p.alive ? 'Đã chết' : '', p.alive && !isOnline(p) ? 'Mất kết nối' : ''].filter(Boolean).join(' ')}</span>`;
  const cls = `seat ${p.alive ? '' : 'dead'} ${isMe ? 'me' : ''}`;
  if (!selectable) return `<div class="${cls}">${inner}</div>`;
  return `<button class="${cls}" data-act="${act}" data-id="${esc(p.id)}" aria-pressed="${pressed}" ${disabled ? 'disabled' : ''}>${inner}</button>`;
}

const alivePlayers = () => view.players.filter(p => p.inGame && p.alive);

function pickGrid(act, { exclude = [], disabled = [], selected = [], counts = {}, subs = {} } = {}) {
  return `<div class="village" style="margin-top:14px">${alivePlayers()
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

function stage() {
  const g = view.game;
  const m = view.me;
  const task = m.task;

  if (view.phase === 'NIGHT') {
    if (task) return nightTask(task);
    if (m.moderatorNight) return moderatorNight();
    const r = ROLES[g.activeRole];
    return `
      <div class="panel sleep">
        <div class="zz" aria-hidden="true">🌙</div>
        <h2>${m.inGame && m.alive ? 'Nhắm mắt lại nhé' : 'Màn đêm đang trôi qua'}</h2>
        <p class="lead">${r ? `${r.name} đang thức dậy.` : ''} Điện thoại sẽ rung khi đến lượt bạn.</p>
      </div>`;
  }

  if (view.phase === 'MORNING') {
    const deaths = g.lastNightDeaths;
    return `
      <div class="panel stack">
        <h2>${deaths.length ? 'Đêm qua có người đã chết' : 'Đêm qua không ai chết'}</h2>
        ${deaths.length ? `<div class="village">${deaths.map(id => seat(player(id))).join('')}</div>` : '<p class="lead">Bảo Vệ hoặc Phù Thủy đã làm tốt việc của mình… hoặc bầy Sói đang toan tính điều gì đó.</p>'}
      </div>`;
  }

  if (view.phase === 'DISCUSSION') {
    const deaths = g.lastNightDeaths.map(seatName).filter(Boolean);
    return `
      <div class="panel stack">
        <h2>Cả làng thảo luận</h2>
        <p class="lead">${deaths.length ? `Đêm qua ${esc(deaths.join(', '))} đã chết.` : 'Đêm qua không ai chết.'} Ai đang nói dối?</p>
        ${isHost() ? '<button class="btn btn-ghost" data-act="skip">Kết thúc thảo luận và bỏ phiếu</button>' : ''}
      </div>`;
  }

  if (view.phase === 'VOTE') {
    const counts = {};
    Object.values(g.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const voted = Object.keys(g.votes).length;
    const mine = g.votes[m.id];
    const canVote = m.inGame && m.alive;
    return `
      <div class="panel">
        <h2>Bỏ phiếu nghi phạm</h2>
        <p class="lead">${canVote
          ? (mine ? `Bạn đã chọn ${esc(seatName(mine))}. Có thể đổi trước khi hết giờ.` : 'Chạm vào người bạn nghi là Sói.')
          : 'Bạn đang theo dõi, không bỏ phiếu.'}</p>
        <p class="muted small" style="margin-top:6px">Đã bỏ phiếu: ${voted}/${alivePlayers().length}</p>
        ${canVote
          ? pickGrid('vote', { exclude: [m.id], selected: mine ? [mine] : [], counts })
          : `<div class="village" style="margin-top:14px">${alivePlayers().map(p => seat(p, { count: counts[p.id] || 0 })).join('')}</div>`}
      </div>`;
  }

  if (view.phase === 'DEFENSE') {
    const d = player(g.defendant);
    return `
      <div class="panel stack" style="text-align:center">
        <div class="village" style="grid-template-columns:110px;justify-content:center">${seat(d)}</div>
        <h2>${d.id === m.id ? 'Bạn đang trên bục biện hộ' : `${esc(d.name)} đang biện hộ`}</h2>
        <p class="lead">${d.id === m.id ? 'Hãy thuyết phục cả làng rằng bạn vô tội.' : 'Hãy lắng nghe. Khi hết giờ, cả làng sẽ quyết định.'}</p>
        ${isHost() ? '<button class="btn btn-ghost" data-act="skip">Kết thúc biện hộ</button>' : ''}
      </div>`;
  }

  if (view.phase === 'JUDGE') {
    const d = player(g.defendant);
    const votes = Object.values(g.judge);
    const kill = votes.filter(v => v === 'kill').length;
    const spare = votes.length - kill;
    const mine = g.judge[m.id];
    const canVote = m.inGame && m.alive && m.id !== d.id;
    return `
      <div class="panel stack">
        <h2>Số phận của ${esc(d.name)}</h2>
        <p class="lead">${canVote ? 'Treo cổ nếu phiếu treo nhiều hơn phiếu tha.' : d.id === m.id ? 'Bạn không được tự bỏ phiếu cho mình.' : 'Bạn đang theo dõi.'}</p>
        <div class="judge">
          <button class="kill" data-act="judge" data-choice="kill" aria-pressed="${mine === 'kill'}" ${canVote ? '' : 'disabled'}>
            <span class="big" aria-hidden="true">🪢</span>Treo cổ<span class="n">${kill} phiếu</span>
          </button>
          <button class="spare" data-act="judge" data-choice="spare" aria-pressed="${mine === 'spare'}" ${canVote ? '' : 'disabled'}>
            <span class="big" aria-hidden="true">🕊️</span>Tha mạng<span class="n">${spare} phiếu</span>
          </button>
        </div>
      </div>`;
  }

  if (view.phase === 'VERDICT') {
    const v = g.verdict || {};
    let body = '<h2>Hôm nay không ai lên bục</h2><p class="lead">Phiếu bầu chưa thống nhất. Màn đêm sắp buông xuống.</p>';
    if (v.type === 'kill') body = `<h2>${esc(v.ids.map(seatName).join(' và '))} đã bị loại</h2><p class="lead">${v.kill} phiếu treo, ${v.spare} phiếu tha.</p>`;
    if (v.type === 'spare') body = `<h2>${esc(seatName(v.ids[0]))} được tha</h2><p class="lead">${v.kill} phiếu treo, ${v.spare} phiếu tha.</p>`;
    return `<div class="panel stack">${body}</div>`;
  }

  if (view.phase === 'GAME_OVER') {
    const w = g.winner;
    const icon = { village: '🌾', werewolf: '🐺', lovers: '💘' }[w];
    const title = { village: 'Phe Dân Làng chiến thắng', werewolf: 'Phe Ma Sói chiến thắng', lovers: 'Cặp Tình Nhân chiến thắng' }[w];
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
  const head = (role, title, lead) => `
    <span class="tag" style="margin:0;background:${ROLES[role].color}22;color:${ROLES[role].color}">${ROLES[role].icon} Lượt của ${ROLES[role].name}</span>
    <h2 style="margin-top:10px">${title}</h2>
    <p class="lead">${lead}</p>`;

  if (task.role === 'cupid') {
    return `<div class="panel">${head('cupid', 'Chọn 2 người làm Tình Nhân', `Đã chọn ${task.picks.length}/2. Có thể chọn cả chính mình.`)}
      ${task.complete ? '<p class="result" style="margin-top:12px">Đã se duyên xong. Nhắm mắt lại nhé.</p>' : pickGrid('night', { selected: task.picks })}</div>`;
  }
  if (task.role === 'guard') {
    const subs = task.lastGuarded ? { [task.lastGuarded]: 'Đã bảo vệ đêm trước' } : {};
    return `<div class="panel">${head('guard', 'Bảo vệ ai đêm nay?', 'Người được bảo vệ sẽ không chết nếu bị Sói cắn.')}
      ${task.complete
        ? `<p class="result" style="margin-top:12px">Bạn đang bảo vệ ${esc(seatName(task.pick))}.</p>`
        : pickGrid('night', { disabled: task.lastGuarded ? [task.lastGuarded] : [], subs })}</div>`;
  }
  if (task.role === 'hunter') {
    const lastAim = task.lastAim && player(task.lastAim)?.alive ? task.lastAim : null;
    const subs = lastAim ? { [lastAim]: 'Đang chĩa súng' } : {};
    return `<div class="panel">${head('hunter', 'Chĩa súng vào ai đêm nay?', lastAim
      ? `Súng đang chĩa vào ${esc(seatName(lastAim))}. Chọn lại, hoặc để nguyên khi hết giờ.`
      : 'Nếu bạn chết, người này sẽ chết theo. Bạn không biết ai bị Sói cắn.')}
      ${task.complete
        ? `<p class="result" style="margin-top:12px">Súng đang chĩa vào ${esc(seatName(task.aim))}.</p>`
        : pickGrid('night', { exclude: [m.id], selected: lastAim ? [lastAim] : [], subs })}</div>`;
  }
  if (task.role === 'werewolf') {
    const counts = {};
    Object.values(task.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const mates = view.me.wolves.filter(id => player(id)?.alive).map(seatName);
    return `<div class="panel">${head('werewolf', 'Chọn con mồi', mates.length
      ? `Cả đàn phải chọn cùng một người. Đồng bọn: ${esc(mates.join(', '))}.`
      : 'Bạn là con Sói duy nhất. Chọn một người để cắn.')}
      ${task.target
        ? `<p class="result result-wolf" style="margin-top:12px">Đàn Sói đã chốt: ${esc(seatName(task.target))}.</p>`
        : pickGrid('night', { exclude: [m.id, ...view.me.wolves], selected: task.votes[m.id] ? [task.votes[m.id]] : [], counts })}</div>`;
  }
  if (task.role === 'seer') {
    if (task.result) {
      const wolf = task.result === 'werewolf';
      return `<div class="panel stack">${head('seer', 'Kết quả soi', 'Chỉ bạn nhìn thấy kết quả này.')}
        <p class="result ${wolf ? 'result-wolf' : 'result-village'}">${esc(seatName(task.target))} thuộc ${wolf ? 'Phe Ma Sói 🐺' : 'Phe Dân Làng 🌾'}</p>
        ${task.complete ? '' : '<button class="btn btn-primary btn-block" data-act="seerDone">Đã nhớ, nhắm mắt lại</button>'}</div>`;
    }
    return `<div class="panel">${head('seer', 'Soi ai đêm nay?', 'Bạn sẽ biết người đó thuộc phe Sói hay phe Dân.')}
      ${pickGrid('night', { exclude: [m.id] })}</div>`;
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
      <button class="btn btn-primary btn-block" data-act="witchDone">Xong, nhắm mắt lại</button></div>`;
  }
  return '';
}

function moderatorNight() {
  const g = view.game;
  const n = view.me.moderatorNight;
  const r = ROLES[g.activeRole];
  const line = (label, id) => id ? `<p class="small">${label}: <strong>${esc(seatName(id))}</strong></p>` : '';
  return `
    <div class="panel stack">
      <h2>Bảng quản trò</h2>
      <p class="lead">${r ? `Đang gọi ${r.name}.` : ''} Chỉ bạn thấy được bảng này.</p>
      ${n.lovers.length ? `<p class="small">Tình Nhân: <strong>${esc(n.lovers.map(seatName).join(' và '))}</strong></p>` : ''}
      ${line('Bảo Vệ chọn', n.guard)}
      ${line('Thợ Săn chĩa súng', n.hunterAim)}
      ${line('Sói cắn', n.wolfTarget)}
      ${line('Tiên Tri soi', n.seerTarget)}
      ${n.heal ? '<p class="small">Phù Thủy đã dùng bình Cứu.</p>' : ''}
      ${line('Phù Thủy đầu độc', n.poison)}
    </div>`;
}

// ---------- Role card ----------

function renderCard(reset = true) {
  const m = view.me;
  const r = ROLES[m.role];
  const body = document.getElementById('cardSheetBody');
  if (!r) return;
  const card = body.querySelector('.card');
  const revealed = !reset && card?.classList.contains('revealed');
  const extra = [];
  if (m.wolves.length) extra.push(`Đồng bọn Sói: ${m.wolves.map(seatName).join(', ')}`);
  if (m.lover) extra.push(`💘 Người yêu của bạn: ${seatName(m.lover)}`);
  if (!m.alive) extra.push('Bạn đã bị loại, hãy giữ im lặng nhé.');
  body.innerHTML = `
    <div class="sheet-head">
      <h3 id="cardSheetTitle">Lá bài của bạn</h3>
      <button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button>
    </div>
    <button class="card ${revealed ? 'revealed' : ''}" data-act="flip" aria-label="Lật lá bài">
      <div class="card-inner">
        <div class="card-face card-back"><p>Chạm để lật bài<br><span class="small muted">Che màn hình khỏi người bên cạnh</span></p></div>
        <div class="card-face card-front" style="color:${r.color}">
          <div class="art">${r.art}</div>
          <h3>${r.name}</h3>
          <span class="team">${TEAM_LABEL[r.team]}</span>
          <p class="desc">${r.description}</p>
        </div>
      </div>
    </button>
    ${extra.map(t => `<p class="small" style="margin-top:12px">${esc(t)}</p>`).join('')}`;
}

function renderRules() {
  document.getElementById('rulesBody').innerHTML = `
    <div class="sheet-head"><h3 id="rulesTitle">Luật chơi</h3><button class="btn btn-ghost btn-small" data-act="closeSheet">Đóng</button></div>
    <div class="stack small">
      <p>Mỗi đêm, quản trò gọi từng vai trò thức dậy theo thứ tự: Thần Tình Yêu (đêm đầu), Bảo Vệ, Thợ Săn, Ma Sói, Tiên Tri, Phù Thủy. Người có vai trò đó thao tác trên điện thoại của mình.</p>
      <p>Ban ngày: công bố người chết, thảo luận, bỏ phiếu chọn nghi phạm, nghi phạm biện hộ, rồi cả làng chọn treo cổ hay tha.</p>
      <p>Phe Dân thắng khi hết Sói. Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại.</p>
      ${ROLE_IDS.map(id => `<p><strong>${ROLES[id].icon} ${ROLES[id].name}</strong>: ${ROLES[id].description}</p>`).join('')}
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
    moon.querySelector('svg').outerHTML = moonSvg(1, day);
    label.textContent = '';
    return;
  }
  const total = Math.max(1, g.phaseEndsAt - g.phaseStartedAt);
  const left = Math.max(0, g.phaseEndsAt - serverNow());
  const secs = Math.ceil(left / 1000);
  moon.querySelector('svg').outerHTML = moonSvg(left / total, day);
  label.textContent = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}`;
  moon.classList.toggle('urgent', secs <= 5);
  moon.setAttribute('aria-label', `Còn ${secs} giây`);
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

  switch (a) {
    case 'home-link':
      if (session) { e.preventDefault(); }
      return;
    case 'tab': homeTab = el.dataset.tab; return renderHome();
    case 'rules': renderRules(); return document.getElementById('rulesSheet').showModal();
    case 'closeSheet': return el.closest('dialog').close();
    case 'leave': return leaveRoom();
    case 'share': return share();
    case 'kick': {
      const p = player(id);
      if (p && confirm(`Mời ${p.name} ra khỏi phòng?`)) act('kick', { id });
      return;
    }
    case 'addBot': return act('addBot');
    case 'autoBalance': return act('autoBalance');
    case 'role': return act('role', { roleId: el.dataset.role, delta: Number(el.dataset.delta) });
    case 'start':
      narrator.unlock();
      return act('start');
    case 'testVoice':
      narrator.unlock();
      narrator.sfx('night');
      narrator.play([
        { k: 'night_start', v: 0, t: 'Màn đêm buông xuống... Cả làng hãy nhắm mắt lại, và chìm vào giấc ngủ.' },
        { k: 'werewolf_wake', v: 0, t: 'Ma Sói... hãy thức dậy. Hãy nhìn nhau, và chọn con mồi cho đêm nay.' }
      ]);
      return renderLobby();
    case 'ambience':
      narrator.unlock();
      ambienceOn = el.checked;
      return narrator.setAmbience(ambienceOn);
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
      renderCard(true);
      return document.getElementById('cardSheet').showModal();
    case 'flip': return el.classList.toggle('revealed');
    case 'night': return act('night', { target: id });
    case 'seerDone': return act('seerDone');
    case 'heal':
      if (confirm('Dùng bình Cứu đêm nay? Bình chỉ dùng được 1 lần, kể cả khi đêm nay không ai bị cắn.')) act('witch', { use: 'heal' });
      return;
    case 'poison': {
      const p = player(id);
      if (p && confirm(`Dùng bình Độc lên ${p.name}? Bình này chỉ dùng được 1 lần.`)) act('witch', { use: 'poison', target: id });
      return;
    }
    case 'witchDone': return act('witch', { use: 'done' });
    case 'vote': return act('vote', { target: id });
    case 'judge': return act('judge', { choice: el.dataset.choice });
  }
});

// Lobby settings: show values live while dragging, send when released.
document.addEventListener('input', (e) => {
  const key = e.target.dataset?.config;
  if (key && e.target.type === 'range') {
    document.getElementById(`val-${key}`).textContent = fmtSeconds(Number(e.target.value));
  }
});
document.addEventListener('change', (e) => {
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

// Close dialogs by tapping the backdrop.
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', (e) => {
  if (e.target === d) d.close();
}));

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
    if (el) el.innerHTML = voicePanel();
  }
};

(async function boot() {
  await narrator.init();
  const roomParam = (params.get('room') || '').toUpperCase();
  if (session && (!roomParam || roomParam === session.code)) {
    render();
    startRealtime();
    sync();
  } else {
    if (session && roomParam && roomParam !== session.code) saveSession(null);
    render();
  }
})();
