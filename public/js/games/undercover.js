// "Ai là nội gián" in the browser. app.js draws the room around it and passes
// its helpers in `h`.
import { UNDERCOVER_LIMITS, autoUndercovers } from '/shared/undercover.js';

const PART = { civilian: ['Dân thường', 'result-village'], undercover: ['Nội gián', 'result-wolf'], white: ['Trắng', 'result-wolf'] };
let guessDraft = '';

const RULES = `
  <p>Mỗi người nhận một <strong>từ khoá</strong> bí mật. Phần lớn là <strong>dân thường</strong>, cùng một từ. <strong>Nội gián</strong> nhận một từ gần giống (ví dụ "Cà phê" và "Trà sữa"). Không ai được báo mình là dân hay nội gián: bạn chỉ thấy từ của mình. Có thể có thêm một người <strong>Trắng</strong>, không có từ nào.</p>
  <ol class="rules-steps">
    <li>Lần lượt mỗi người nói một câu ngắn về từ của mình, đủ để người cùng từ nhận ra, nhưng đừng để lộ từ. Người đang nói bấm "Xong" khi xong.</li>
    <li>Hết một vòng, cả bàn bỏ phiếu loại một người. Nhiều phiếu nhất thì bị loại và lật vai; hoà phiếu thì không ai bị loại.</li>
    <li>Trắng bị loại được đoán từ của dân thường: đoán đúng là Trắng thắng một mình.</li>
  </ol>
  <p><strong>Dân thường thắng</strong> khi loại hết nội gián và Trắng. <strong>Nội gián</strong> (cùng Trắng) thắng khi chỉ còn một dân thường.</p>`;

function lobby(h) {
  const c = h.view.gameConfig;
  const n = h.view.players.length;
  const host = h.isHost();
  const ucs = c.undercovers || autoUndercovers(n);
  const sliders = [['speakTime', 'Thời gian mỗi người mô tả', 5], ['voteTime', 'Bỏ phiếu loại', 5], ['guessTime', 'Trắng đoán từ', 5]];
  return `
    <div class="section-head"><h2>Ai là nội gián</h2><p class="muted small">4–12 người</p></div>
    <p class="small" style="color:var(--soft)">Mỗi người một từ khoá; nội gián nhận từ gần giống mà không biết mình là nội gián. Mô tả, nghi ngờ, rồi bỏ phiếu loại.</p>
    ${host ? `
      <div class="toggle-row" style="margin-top:8px">
        <span><strong>Số nội gián</strong><span class="muted">${c.undercovers ? '' : `Tự động theo số người: ${ucs}`}</span></span>
        <span class="mini-step">
          <button data-act="ucCount" data-delta="-1" ${c.undercovers > 0 ? '' : 'disabled'} aria-label="Bớt">−</button>
          <output>${c.undercovers || 'Tự'}</output>
          <button data-act="ucCount" data-delta="1" ${c.undercovers < UNDERCOVER_LIMITS.undercovers[1] ? '' : 'disabled'} aria-label="Thêm">+</button>
        </span>
      </div>
      <label class="toggle-row">
        <span><strong>Thêm người Trắng</strong><span class="muted">Một người không có từ nào; bị loại thì được đoán từ của dân.</span></span>
        <input type="checkbox" data-act="ucWhite" ${c.mrWhite ? 'checked' : ''} />
      </label>
      ${sliders.map(([key, label, step]) => {
        const [min, max] = UNDERCOVER_LIMITS[key];
        return `<div class="slider">
          <div class="row-between"><label for="gc-${key}">${label}</label><span class="slider-value" id="gval-${key}">${h.fmtSeconds(c[key])}</span></div>
          <input type="range" id="gc-${key}" data-game-config="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}" />
        </div>`;
      }).join('')}`
    : `<p class="muted small">${ucs} nội gián${c.mrWhite ? ', có người Trắng' : ''}. Mỗi người mô tả trong ${h.fmtSeconds(c.speakTime)}.</p>`}
    <button class="btn btn-link" data-act="rules">Xem luật chơi</button>`;
}

function title(view) {
  if (view.phase === 'GAME_OVER') return 'Ván chơi kết thúc';
  const p = view.play;
  return { UC_SPEAK: `Vòng ${p?.round}: mô tả`, UC_VOTE: `Vòng ${p?.round}: bỏ phiếu`, UC_GUESS: 'Trắng đoán từ', UC_OUT: `Vòng ${p?.round}: kết quả` }[view.phase] || '';
}

function subtitle(view, h) {
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return h.esc(p.result?.reason || '');
  if (view.phase === 'UC_SPEAK') return `${h.esc(h.nameOnly(p.speaker))} đang mô tả.`;
  if (view.phase === 'UC_VOTE') return 'Chọn người bạn muốn loại.';
  if (view.phase === 'UC_GUESS') return `${h.esc(h.nameOnly(p.last))} là Trắng và đang đoán từ.`;
  return p.last ? `${h.esc(h.nameOnly(p.last))} đã bị loại.` : 'Phiếu hoà: không ai bị loại.';
}

function stage(h) {
  const { view } = h;
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return gameOver(h);
  const seated = view.players.filter(x => x.inGame);
  const out = Object.fromEntries(p.out.map(o => [o.id, PART[o.role][0]]));
  const me = view.me.id;
  if (view.phase === 'UC_SPEAK') {
    const mine = p.speaker === me;
    return `
      <div class="panel">
        <p class="card-kicker"><span>Lượt mô tả</span><span class="icon" aria-hidden="true">🗣️</span></p>
        <h2>${mine ? 'Đến lượt bạn' : `${h.esc(h.nameOnly(p.speaker))} đang mô tả`}</h2>
        <p class="lead">${mine
          ? 'Nói một câu ngắn về từ của bạn (xem trên lá bài), rồi bấm "Xong".'
          : 'Lắng nghe, đoán xem người đó có cùng từ với bạn không.'}</p>
        ${mine ? '<button class="btn btn-primary btn-block btn-big" style="margin-top:12px" data-act="ucSpoke">Xong, đến người tiếp</button>' : ''}
        <p class="muted small" style="margin-top:10px">Thứ tự: ${p.order.map(id => id === p.speaker ? `<strong>${h.esc(h.nameOnly(id))}</strong>` : h.esc(h.nameOnly(id))).join(' → ')}</p>
      </div>
      ${h.roundTable(seated, { center: `<span>Đang nói<strong>${h.esc(h.nameOnly(p.speaker))}</strong></span>`, seatOpts: (x) => ({ sub: out[x.id] || (x.id === p.speaker ? '🗣️ đang nói' : '') }) })}`;
  }
  if (view.phase === 'UC_VOTE') {
    const counts = {};
    Object.values(p.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const mine = p.votes[me];
    const alive = seated.filter(x => x.alive);
    return `
      <div class="panel">
        <p class="card-kicker"><span>Bỏ phiếu</span><span class="icon" aria-hidden="true">🗳️</span></p>
        <h2>Loại ai?</h2>
        <p class="lead">${p.me.alive ? 'Chạm vào người bạn nghi là nội gián. Chạm lại để huỷ.' : 'Bạn đã bị loại, chỉ xem.'}</p>
        <p class="muted small" style="margin-top:6px">Đã bỏ phiếu: ${Object.keys(p.votes).length}/${alive.length}</p>
      </div>
      ${h.roundTable(seated, {
        center: mine ? `<span>Bạn chọn<strong>${h.esc(h.nameOnly(mine))}</strong></span>` : 'Chạm vào người muốn loại',
        seatOpts: (x) => ({ selectable: p.me.alive && x.alive && x.id !== me, act: 'ucVote', pressed: mine === x.id, count: counts[x.id] || 0, sub: out[x.id] })
      })}
      ${h.voteList(p.votes) ? `<div class="panel" style="margin-top:12px"><h3>Ai bầu ai</h3>${h.voteList(p.votes)}</div>` : ''}`;
  }
  if (view.phase === 'UC_GUESS') {
    const mine = p.last === me;
    return `
      <div class="panel stack">
        <p class="card-kicker"><span>Trắng đoán từ</span><span class="icon" aria-hidden="true">❔</span></p>
        <h2>${mine ? 'Bạn là Trắng: đoán từ của dân' : `${h.esc(h.nameOnly(p.last))} là Trắng`}</h2>
        <p class="lead">${mine ? 'Đoán đúng từ của dân thường là bạn thắng một mình.' : 'Trắng đang đoán từ của dân thường. Đoán đúng là Trắng thắng.'}</p>
        ${mine ? `<form id="ucGuessForm" class="stack" autocomplete="off">
          <input class="input" id="ucGuessInput" maxlength="40" placeholder="Từ của dân thường" value="${h.esc(guessDraft)}" />
          <button class="btn btn-primary btn-block" type="submit">Đoán</button>
        </form>` : ''}
      </div>`;
  }
  // UC_OUT
  const last = p.out.find(o => o.id === p.last && o.round === p.round);
  return `
    <div class="panel stack" style="text-align:center">
      <h2>${last ? `${h.esc(h.nameOnly(last.id))} bị loại` : 'Không ai bị loại'}</h2>
      ${last ? `<p class="result ${PART[last.role][1]}">${h.esc(h.nameOnly(last.id))} là <strong>${PART[last.role][0]}</strong>${p.guess && last.role === 'white' ? ` (đoán "${h.esc(p.guess)}", sai)` : ''}</p>` : '<p class="lead">Phiếu hoà. Vòng tiếp theo bắt đầu ngay.</p>'}
    </div>
    ${h.roundTable(seated, { center: `<span><strong>${seated.filter(x => x.alive).length}</strong>còn lại</span>`, seatOpts: (x) => ({ sub: out[x.id] }) })}`;
}

function gameOver(h) {
  const r = h.view.play.result;
  const icon = { civilian: '🏘️', undercover: '🗝️', white: '❔' }[r.winner];
  const title = { civilian: 'Dân thường chiến thắng', undercover: 'Nội gián chiến thắng', white: 'Trắng chiến thắng' }[r.winner];
  const by = (role) => Object.keys(r.roles).filter(id => r.roles[id] === role).map(h.nameOnly).map(h.esc).join(', ');
  return `
    <div class="panel winner">
      <div class="big" aria-hidden="true">${icon}</div>
      <h2>${title}</h2>
      <p class="lead">${h.esc(r.reason)}</p>
      <p style="margin-top:12px">Từ của dân: <strong>${h.esc(r.words.civilian)}</strong></p>
      <p>Từ của nội gián: <strong>${h.esc(r.words.undercover)}</strong></p>
      <p class="small" style="margin-top:8px">Nội gián: <strong>${by('undercover')}</strong>${by('white') ? ` · Trắng: <strong>${by('white')}</strong>` : ''}</p>
      ${h.isHost() ? '<button class="btn btn-primary btn-block" style="margin-top:16px" data-act="restart">Về phòng chờ, chơi ván mới</button>' : '<p class="muted small" style="margin-top:12px">Chờ chủ phòng mở ván mới.</p>'}
    </div>`;
}

function card(h) {
  const p = h.view.play;
  if (!p?.me.playing) return '<p class="muted">Bạn đang xem ván này.</p>';
  if (p.me.white) {
    return `
      <div class="spy-card spy">
        <p class="card-top"><span>Từ khoá của bạn</span></p>
        <div class="spy-icon" aria-hidden="true">❔</div>
        <h3>Trắng</h3>
        <p class="desc">Bạn không có từ nào. Nghe mọi người mô tả để đoán ra từ của dân, và mô tả sao cho không ai biết bạn không có từ.</p>
      </div>`;
  }
  return `
    <div class="spy-card">
      <p class="card-top"><span>Từ khoá của bạn</span></p>
      <div class="spy-icon" aria-hidden="true">🗝️</div>
      <h3>${h.esc(p.me.word)}</h3>
      <p class="desc">Bạn không biết mình là dân hay nội gián: nghe người khác mô tả để đoán xem từ của họ có giống bạn không.</p>
    </div>`;
}

function click(a, el, h) {
  switch (a) {
    case 'ucSpoke': h.act('spoke'); return true;
    case 'ucVote': h.act('ucVote', { target: el.dataset.id }); return true;
    case 'ucCount': {
      const c = h.view.gameConfig.undercovers || 0;
      h.act('gameConfig', { undercovers: Math.max(0, c + Number(el.dataset.delta)) });
      return true;
    }
    case 'ucWhite': h.act('gameConfig', { mrWhite: el.checked }); return true;
  }
  return false;
}

// The guess is typed: keep the draft across redraws, send on submit.
document.addEventListener('input', (e) => { if (e.target.id === 'ucGuessInput') guessDraft = e.target.value; });
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'ucGuessForm') return;
  e.preventDefault();
  const word = document.getElementById('ucGuessInput').value.trim();
  if (!word) return;
  window.dispatchEvent(new CustomEvent('hub-act', { detail: { type: 'whiteGuess', payload: { word } } }));
  guessDraft = '';
});

export const undercoverUI = {
  rules: RULES,
  lobby,
  title,
  subtitle,
  stage,
  card,
  click,
  handHint: 'Từ khoá của bạn',
  sides: [['civilian', 'Dân thường', 'v'], ['undercover', 'Nội gián', 'w'], ['white', 'Trắng', 't']]
};
