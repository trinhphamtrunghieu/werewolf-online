// "Ai là gián điệp" in the browser: the stage, the private card, the list of
// places and the settings. app.js draws the room around it (ribbon, table,
// drawer, leaderboard) and passes its helpers in `h`.
import { LOCATIONS, SPYFALL_LIMITS } from '/shared/spyfall.js';

// Tapping "Tố cáo" turns the table into a ballot; places crossed off on the
// reference list stay crossed for this phone.
let accusing = false;
let guessing = false;
let crossed = new Set();
let crossedFor = null;

const placeName = (i) => `${LOCATIONS[i].icon} ${LOCATIONS[i].name}`;

export const SPY_RULES = `
  <p>Mọi người cùng ở một địa điểm (bãi biển, bệnh viện, tàu ngầm…), trừ <strong>gián điệp</strong>: gián điệp không biết đó là đâu. Mỗi người xem địa điểm trên lá bài của mình.</p>
  <ol class="rules-steps">
    <li>Người hỏi đầu tiên chọn một người và hỏi một câu về địa điểm. Người được hỏi trả lời, rồi hỏi tiếp người khác.</li>
    <li>Hỏi sao cho người cùng địa điểm hiểu, nhưng gián điệp không đoán ra. Trả lời cũng vậy.</li>
    <li>Trong lúc hỏi đáp, mỗi người được <strong>tố cáo</strong> một lần. Tất cả người còn lại cùng đồng ý thì người bị tố cáo bị lật bài; đồng hồ dừng trong lúc bỏ phiếu.</li>
    <li>Gián điệp có thể dừng ván bất cứ lúc nào để <strong>đoán địa điểm</strong> (trên lá bài của mình).</li>
    <li>Hết giờ: mỗi người chọn một người nghi là gián điệp. Ai được hơn nửa số phiếu sẽ bị lật bài.</li>
  </ol>
  <p><strong>Dân thường thắng</strong> khi lật đúng gián điệp, hoặc gián điệp đoán sai địa điểm. <strong>Gián điệp thắng</strong> khi đoán đúng địa điểm, khi một người vô tội bị lật bài, hoặc khi không ai bị lật bài.</p>`;

// Lobby: what the game is, and the host's settings.
export function spyLobby(h) {
  const c = h.view.gameConfig;
  const rows = [['roundTime', 'Thời gian hỏi đáp', 30], ['voteTime', 'Bỏ phiếu cuối ván', 5], ['accuseTime', 'Bỏ phiếu khi có người tố cáo', 5]];
  return `
    <div class="section-head"><h2>Ai là gián điệp</h2><p class="muted small">3–12 người</p></div>
    <p class="small" style="color:var(--soft)">Mọi người biết mình đang ở đâu, trừ một gián điệp. Hỏi đáp để lật mặt gián điệp; gián điệp nghe để đoán ra địa điểm.</p>
    <p class="muted small" style="margin-top:6px">${LOCATIONS.length} địa điểm. Một gián điệp mỗi ván.</p>
    ${h.isHost() ? rows.map(([key, label, step]) => {
      const [min, max] = SPYFALL_LIMITS[key];
      return `<div class="slider">
        <div class="row-between"><label for="gc-${key}">${label}</label><span class="slider-value" id="gval-${key}">${h.fmtSeconds(c[key])}</span></div>
        <input type="range" id="gc-${key}" data-game-config="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}" />
      </div>`;
    }).join('') : `<p class="muted small">Hỏi đáp ${h.fmtSeconds(c.roundTime)}, bỏ phiếu ${h.fmtSeconds(c.voteTime)}.</p>`}
    <button class="btn btn-link" data-act="rules">Xem luật chơi</button>`;
}

export function spyTitle(view) {
  const p = view.play;
  if (view.phase === 'GAME_OVER') return 'Ván chơi kết thúc';
  if (p?.accusation) return 'Tố cáo!';
  return view.phase === 'SPY_VOTE' ? 'Bỏ phiếu' : 'Hỏi đáp';
}

export function spySubtitle(view, h) {
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return h.esc(p.result?.reason || '');
  if (p.accusation) return `${h.esc(h.nameOnly(p.accusation.by))} tố cáo ${h.esc(h.nameOnly(p.accusation.target))}.`;
  if (view.phase === 'SPY_VOTE') return 'Hết giờ: chọn người bạn nghi là gián điệp.';
  return `Người hỏi đầu tiên: ${h.esc(h.nameOnly(p.first))}.`;
}

export function spyStage(h) {
  const { view } = h;
  const p = view.play;
  if (!p) return '';
  if (view.phase !== 'SPY_ROUND' || p.accusation) accusing = false;
  if (view.phase === 'GAME_OVER') return gameOver(h);
  if (p.accusation) return accusation(h);
  if (view.phase === 'SPY_VOTE') return finalVote(h);
  return round(h);
}

function round(h) {
  const { view } = h;
  const p = view.play;
  const seated = view.players.filter(x => x.inGame);
  const head = `
    <div class="panel">
      <p class="card-kicker"><span>Hỏi đáp</span><span class="icon" aria-hidden="true">🕵️</span></p>
      <h2>${accusing ? 'Tố cáo ai?' : 'Tìm gián điệp'}</h2>
      <p class="lead">${accusing
        ? 'Chạm vào người bạn nghi là gián điệp. Tất cả người còn lại sẽ bỏ phiếu đồng ý hay không.'
        : 'Lần lượt hỏi nhau về địa điểm. Xem địa điểm (hoặc vai gián điệp) trên lá bài của bạn.'}</p>
      ${p.me.playing ? `<div class="row" style="margin-top:12px;flex-wrap:wrap">
        ${p.me.canAccuse
          ? `<button class="btn ${accusing ? 'btn-ghost' : 'btn-primary'}" data-act="spyAccuseMode">${accusing ? 'Huỷ tố cáo' : '☝️ Tố cáo'}</button>`
          : '<span class="muted small">Bạn đã dùng lượt tố cáo của ván này.</span>'}
      </div>` : ''}
    </div>`;
  return head + h.roundTable(seated, {
    center: accusing ? 'Chạm vào người bị tố cáo' : `<span>Người hỏi đầu<strong>${h.esc(h.nameOnly(p.first))}</strong></span>`,
    seatOpts: (x) => ({ selectable: accusing && x.id !== view.me.id, act: 'spyAccuse' })
  }) + placesList(h);
}

function accusation(h) {
  const { view } = h;
  const a = view.play.accusation;
  const me = view.me.id;
  const accused = a.target === me;
  return `
    <div class="panel stack">
      <p class="card-kicker"><span>Tố cáo</span><span class="icon" aria-hidden="true">☝️</span></p>
      <h2>${accused ? 'Bạn đang bị tố cáo' : `${h.esc(h.nameOnly(a.target))} là gián điệp?`}</h2>
      <p class="lead">${accused
        ? 'Hãy tự bào chữa. Chỉ cần một người không đồng ý là bạn thoát.'
        : `${h.esc(h.nameOnly(a.by))} tố cáo. Cần tất cả mọi người đồng ý thì ${h.esc(h.nameOnly(a.target))} mới bị lật bài; một người không đồng ý là bỏ qua.`}</p>
      ${accused || !view.play.me.playing ? '' : `<div class="judge">
        <button class="kill" data-act="spyAccuseVote" data-yes="1" aria-pressed="${a.mine === true}"><span class="big" aria-hidden="true">👍</span>Đồng ý</button>
        <button class="spare" data-act="spyAccuseVote" data-yes="0" aria-pressed="${a.mine === false}"><span class="big" aria-hidden="true">✋</span>Không đồng ý</button>
      </div>`}
      <p class="muted small">Đồng ý: ${a.yes}/${a.voters}</p>
    </div>`;
}

function finalVote(h) {
  const { view } = h;
  const p = view.play;
  const counts = {};
  Object.values(p.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  const mine = p.votes[view.me.id];
  const seated = view.players.filter(x => x.inGame);
  return `
    <div class="panel">
      <p class="card-kicker"><span>Bỏ phiếu</span><span class="icon" aria-hidden="true">🗳️</span></p>
      <h2>Ai là gián điệp?</h2>
      <p class="lead">Người được hơn nửa số phiếu sẽ bị lật bài. Chạm lại để huỷ phiếu.</p>
      <p class="muted small" style="margin-top:6px">Đã bỏ phiếu: ${Object.keys(p.votes).length}/${seated.length}</p>
    </div>
    ${h.roundTable(seated, {
      center: mine ? `<span>Bạn chọn<strong>${h.esc(h.nameOnly(mine))}</strong></span>` : 'Chạm vào người bạn nghi',
      seatOpts: (x) => ({ selectable: p.me.playing && x.id !== view.me.id, act: 'spyVote', pressed: mine === x.id, count: counts[x.id] || 0 })
    })}
    ${h.voteList(p.votes) ? `<div class="panel" style="margin-top:12px"><h3>Ai bầu ai</h3>${h.voteList(p.votes)}</div>` : ''}
    ${placesList(h)}`;
}

function gameOver(h) {
  const { view } = h;
  const r = view.play.result;
  const spyWon = r.winner === 'spy';
  return `
    <div class="panel winner">
      <div class="big" aria-hidden="true">${spyWon ? '🕵️' : '🏘️'}</div>
      <h2>${spyWon ? 'Gián điệp chiến thắng' : 'Dân thường chiến thắng'}</h2>
      <p class="lead">${h.esc(r.reason)}</p>
      <p style="margin-top:12px">Gián điệp: <strong>${h.esc(h.nameOnly(r.spy))}</strong></p>
      <p>Địa điểm: <strong>${placeName(r.location)}</strong></p>
      ${r.guess != null ? `<p class="muted small">Gián điệp đoán: ${placeName(r.guess)}</p>` : ''}
      ${h.isHost() ? '<button class="btn btn-primary btn-block" style="margin-top:16px" data-act="restart">Về phòng chờ, chơi ván mới</button>' : '<p class="muted small" style="margin-top:12px">Chờ chủ phòng mở ván mới.</p>'}
    </div>`;
}

// The reference sheet every player has: tap a place to cross it off.
function placesList(h) {
  const key = `${h.view.code}:${h.view.play?.first}`;
  if (crossedFor !== key) { crossed = new Set(); crossedFor = key; }
  return `
    <details class="panel section" style="margin-top:12px" id="spyPlaces">
      <summary><h3>Danh sách địa điểm</h3></summary>
      <p class="muted small">Chạm để gạch bỏ những nơi bạn đã loại trừ (chỉ trên máy bạn).</p>
      <div class="places">${LOCATIONS.map((l, i) => `
        <button class="place ${crossed.has(i) ? 'crossed' : ''}" data-act="spyCross" data-i="${i}" aria-pressed="${crossed.has(i)}">${l.icon} ${l.name}</button>`).join('')}
      </div>
    </details>`;
}

// The private card: the place, or the spy and the guess.
export function spyCard(h) {
  const p = h.view.play;
  if (!p?.me.playing) return '<p class="muted">Bạn đang xem ván này.</p>';
  if (!p.me.spy) {
    const l = LOCATIONS[p.me.location];
    return `
      <div class="spy-card">
        <p class="card-top"><span>Địa điểm</span></p>
        <div class="spy-icon" aria-hidden="true">${l.icon}</div>
        <h3>${l.name}</h3>
        <p class="desc">Mọi người trừ gián điệp đều đang ở đây. Hỏi và trả lời sao cho người cùng địa điểm hiểu, mà gián điệp không đoán ra.</p>
      </div>`;
  }
  const over = h.view.phase === 'GAME_OVER';
  const canGuess = !over && !p.accusation && ['SPY_ROUND', 'SPY_VOTE'].includes(h.view.phase);
  return `
    <div class="spy-card spy">
      <p class="card-top"><span>Vai của bạn</span></p>
      <div class="spy-icon" aria-hidden="true">🕵️</div>
      <h3>Gián điệp</h3>
      <p class="desc">Bạn không biết mọi người đang ở đâu. Nghe các câu hỏi để đoán ra, và đừng để lộ.</p>
    </div>
    ${canGuess ? (guessing ? `
      <p class="small" style="margin-top:12px">Chọn địa điểm bạn đoán. Đúng thì bạn thắng ngay, sai thì thua.</p>
      <div class="places">${LOCATIONS.map((l, i) => `<button class="place" data-act="spyGuess" data-i="${i}">${l.icon} ${l.name}</button>`).join('')}</div>
      <button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="spyGuessMode">Thôi, chưa đoán</button>`
      : '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="spyGuessMode">🎯 Đoán địa điểm</button>') : ''}`;
}

// Taps on this game's controls. Returns true when handled.
export function spyClick(a, el, h) {
  switch (a) {
    case 'spyAccuseMode':
      accusing = !accusing;
      h.render();
      return true;
    case 'spyAccuse': {
      const target = el.dataset.id;
      if (confirm(`Tố cáo ${h.nameOnly(target)} là gián điệp? Mỗi người chỉ tố cáo được một lần mỗi ván.`)) {
        accusing = false;
        h.act('accuse', { target });
      }
      return true;
    }
    case 'spyAccuseVote':
      h.act('accuseVote', { yes: el.dataset.yes === '1' });
      return true;
    case 'spyVote':
      h.act('spyVote', { target: el.dataset.id });
      return true;
    case 'spyCross': {
      const i = Number(el.dataset.i);
      if (crossed.has(i)) crossed.delete(i); else crossed.add(i);
      el.classList.toggle('crossed');
      el.setAttribute('aria-pressed', crossed.has(i));
      return true;
    }
    case 'spyGuessMode':
      guessing = !guessing;
      h.renderCard();
      return true;
    case 'spyGuess': {
      const i = Number(el.dataset.i);
      if (confirm(`Đoán địa điểm là "${LOCATIONS[i].name}"? Đúng thì bạn thắng, sai thì thua ngay.`)) {
        guessing = false;
        h.act('guess', { location: i }).then(() => el.closest('dialog')?.close());
      }
      return true;
    }
  }
  return false;
}

export const spyfallUI = {
  rules: SPY_RULES,
  lobby: spyLobby,
  title: spyTitle,
  subtitle: spySubtitle,
  stage: spyStage,
  card: spyCard,
  click: spyClick,
  handHint: 'Địa điểm, hoặc vai gián điệp',
  sides: [['village', 'Dân thường', 'v'], ['spy', 'Gián điệp', 'w']]
};
