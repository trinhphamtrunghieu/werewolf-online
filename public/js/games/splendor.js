// Splendor in the browser: the nobles, the three rows of cards, the gem bank
// and everyone's gems. app.js draws the room around it (ribbon, clock,
// leaderboard) and passes its helpers in `h`. The rules come from
// /shared/splendor.js, so a phone can tell what is affordable before asking.
import {
  COLORS, TOKENS, GEMS, TIERS, MAX_TOKENS, MAX_RESERVED, SPLENDOR_LIMITS,
  paymentFor, canAfford, tokenPickError, countTokens
} from '/shared/splendor.js';
import { GEM_SPRITE } from './splendor-art.js';

// This phone's choices while it is your turn: gems picked from the bank, the
// card tapped, the gems set aside to give back. Cleared when the turn moves.
let picked = [];
let chosen = null; // { kind: 'card' | 'deck', id, tier }
let giving = {};
let turnKey = null;

function syncTurn(p) {
  const key = `${p.round}:${p.current}:${p.step}`;
  if (key === turnKey) return;
  turnKey = key;
  picked = [];
  chosen = null;
  giving = {};
}

function injectSprite() {
  if (document.getElementById('sp-art')) return;
  const holder = document.createElement('div');
  holder.innerHTML = GEM_SPRITE;
  document.body.prepend(holder.firstElementChild);
}

const gem = (color, cls = 'spl-gem') => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#spg-${color}"/></svg>`;
const gemName = (c) => GEMS[c].name;

export const SPLENDOR_RULES = `
  <p>Bạn là thương nhân đá quý thời Phục hưng: gom đá quý để mua thẻ phát triển (mỏ, xưởng, cửa hàng). Mỗi thẻ cho bạn <strong>chiết khấu vĩnh viễn</strong> một viên màu đó, nhiều thẻ có <strong>điểm uy tín</strong>.</p>
  <ol class="rules-steps">
    <li>Mỗi lượt làm đúng <strong>một</strong> việc: lấy 3 viên đá khác màu; hoặc lấy 2 viên cùng màu (khi chồng đó còn ít nhất 4 viên); hoặc giữ 1 thẻ (trên bàn hoặc thẻ úp trên chồng) và nhận 1 vàng; hoặc mua 1 thẻ trên bàn hay thẻ mình đang giữ.</li>
    <li>Mua thẻ: trả giá trên thẻ, trừ đi chiết khấu từ các thẻ đã mua. Vàng thay được mọi màu. Giữ tối đa 3 thẻ.</li>
    <li>Cuối lượt, nếu giữ hơn 10 viên (tính cả vàng), phải trả lại cho đủ 10.</li>
    <li>Cuối lượt, nếu chiết khấu đủ yêu cầu của một <strong>quý tộc</strong>, quý tộc đến thăm và tặng 3 điểm (mỗi lượt một quý tộc).</li>
    <li>Ai đạt 15 điểm trước sẽ mở <strong>vòng cuối</strong>: chơi nốt cho đến lượt người đi đầu.</li>
  </ol>
  <p>Hết vòng cuối, <strong>nhiều điểm nhất thắng</strong>; bằng điểm thì ai mua ít thẻ hơn thắng. Mỗi lượt có giờ: hết giờ thì máy đi thay.</p>
  <p class="muted small">Đá mỗi màu: 4 viên (2 người), 5 viên (3 người), 7 viên (4 người), cùng 5 vàng. Quý tộc: số người + 1. Chân dung quý tộc là tranh thế kỷ 16 thuộc phạm vi công cộng (Wikimedia Commons).</p>`;

export function splLobby(h) {
  const c = h.view.gameConfig;
  return `
    <div class="section-head"><h2>Splendor</h2><p class="muted small">2–4 người</p></div>
    <p class="small" style="color:var(--soft)">Gom đá quý, mua thẻ để có chiết khấu và điểm uy tín, mời quý tộc đến thăm. Người chơi máy chơi được cả ván.</p>
    ${h.isHost() ? `
      <div class="slider">
        <div class="row-between"><label for="gc-turnTime">Thời gian mỗi lượt</label><span class="slider-value" id="gval-turnTime">${h.fmtSeconds(c.turnTime)}</span></div>
        <input type="range" id="gc-turnTime" data-game-config="turnTime" min="${SPLENDOR_LIMITS.turnTime[0]}" max="${SPLENDOR_LIMITS.turnTime[1]}" step="15" value="${c.turnTime}" />
      </div>
      <div class="slider">
        <div class="row-between"><label for="gc-target">Điểm để vào vòng cuối</label><span class="slider-value" id="gval-target">${c.target}</span></div>
        <input type="range" id="gc-target" data-game-config="target" data-plain min="${SPLENDOR_LIMITS.target[0]}" max="${SPLENDOR_LIMITS.target[1]}" step="1" value="${c.target}" />
      </div>`
    : `<p class="muted small">Mỗi lượt ${h.fmtSeconds(c.turnTime)}, ${c.target} điểm để vào vòng cuối.</p>`}
    <button class="btn btn-link" data-act="rules">Xem luật chơi</button>`;
}

export function splTitle(view) {
  const p = view.play;
  if (view.phase === 'GAME_OVER') return 'Ván chơi kết thúc';
  if (p?.me.myTurn) return 'Lượt của bạn';
  return p?.finalRound ? 'Vòng cuối' : `Vòng ${p?.round ?? 1}`;
}

export function splSubtitle(view, h) {
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return h.esc(p.result?.reason || '');
  const who = h.esc(h.nameOnly(p.current));
  if (p.step === 'noble') return `${who} đang chọn quý tộc.`;
  if (p.step === 'discard') return `${who} đang trả lại đá quý.`;
  return p.me.myTurn ? 'Lấy đá, giữ thẻ, hoặc mua thẻ.' : `Đang chờ ${who}${p.finalRound ? ' · vòng cuối' : ''}.`;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function cost(card) {
  return `<span class="spl-cost">${COLORS.filter(c => card.cost[c]).map(c => `<span class="pip ${c}">${card.cost[c]}</span>`).join('')}</span>`;
}

// A development card. `hand` is the viewer's own gems (to mark what is affordable).
function cardHtml(card, { hand, act, tier, selected } = {}) {
  if (!card) return `<span class="spl-card empty" aria-hidden="true"></span>`;
  if (card.hidden && !card.id) return `<span class="spl-card back t${card.tier}"><span class="back-tier">${'•'.repeat(card.tier)}</span><span class="small">Úp</span></span>`;
  const ok = hand && canAfford(hand, card);
  const label = `Thẻ ${gemName(card.bonus)} cấp ${card.tier}, ${card.points} điểm, giá ${COLORS.filter(c => card.cost[c]).map(c => `${card.cost[c]} ${gemName(c)}`).join(', ')}`;
  const inner = `
    <span class="top"><span class="pts">${card.points || ''}</span>${gem(card.bonus, 'spl-gem bonus')}</span>
    <span class="art" aria-hidden="true">${gem(card.bonus, 'spl-gem')}</span>
    ${cost(card)}`;
  return act
    ? `<button class="spl-card ${card.bonus} ${ok ? 'can' : ''} ${selected ? 'sel' : ''}" data-act="${act}" data-id="${card.id}" data-tier="${tier ?? card.tier}" aria-pressed="${!!selected}" aria-label="${label}">${inner}</button>`
    : `<span class="spl-card ${card.bonus}" role="img" aria-label="${label}">${inner}</span>`;
}

function nobleHtml(n, { act, owned } = {}) {
  const req = COLORS.filter(c => n.req[c]).map(c => `<span class="pip sq ${c}">${n.req[c]}</span>`).join('');
  const label = `Quý tộc ${n.name}, ${n.points} điểm, cần ${COLORS.filter(c => n.req[c]).map(c => `${n.req[c]} thẻ ${gemName(c)}`).join(', ')}`;
  const inner = `<img src="/img/splendor/nobles/${n.id}.jpg" alt="" loading="lazy" decoding="async"><span class="pts">${n.points}</span><span class="req">${req}</span>`;
  return act
    ? `<button class="spl-noble" data-act="${act}" data-id="${n.id}" aria-label="Chọn ${label}">${inner}</button>`
    : `<span class="spl-noble ${owned ? 'owned' : ''}" role="img" aria-label="${label}" title="${n.name}">${inner}</span>`;
}

// One player's gems: discount from cards (big number) and loose tokens.
function gemsOf(hand) {
  return `<div class="spl-holdings">${TOKENS.map(c => {
    const bonus = c === 'gold' ? null : hand.bonuses[c];
    return `<span class="hold ${c}" title="${gemName(c)}">
      ${gem(c, 'spl-gem')}
      <span class="tok">${hand.tokens[c]}</span>
      ${bonus === null ? '' : `<span class="bon" aria-label="${bonus} thẻ">${bonus}</span>`}
    </span>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export function splStage(h) {
  const { view } = h;
  const p = view.play;
  if (!p) return '';
  injectSprite();
  syncTurn(p);
  if (view.phase === 'GAME_OVER') return gameOver(h) + board(h) + players(h);
  // The tray sits under the bank, next to the gems and cards it confirms.
  return board(h) + tray(h) + players(h);
}

// What it is your turn to do, and the button that does it.
function tray(h) {
  const { view } = h;
  const p = view.play;
  const me = view.me.id;
  const hand = p.hands[me];
  if (!p.me.myTurn) {
    const last = p.last ? lastMove(h, p.last) : '';
    return `<div class="panel spl-tray">
      <p class="card-kicker"><span>${p.finalRound ? 'Vòng cuối' : `Vòng ${p.round}`}</span><span class="icon" aria-hidden="true">💎</span></p>
      <h2>Lượt của ${h.esc(h.nameOnly(p.current))}</h2>
      ${last ? `<p class="lead">${last}</p>` : ''}
    </div>`;
  }
  if (p.step === 'noble') {
    return `<div class="panel spl-tray mine">
      <p class="card-kicker"><span>Quý tộc</span><span class="icon" aria-hidden="true">👑</span></p>
      <h2>Chọn quý tộc đến thăm</h2>
      <p class="lead">Bạn đủ điều kiện với nhiều quý tộc. Mỗi lượt chỉ một người đến.</p>
      <div class="spl-nobles">${p.nobles.filter(n => p.pending.includes(n.id)).map(n => nobleHtml(n, { act: 'splNoble' })).join('')}</div>
    </div>`;
  }
  if (p.step === 'discard') {
    const over = countTokens(hand.tokens) - MAX_TOKENS;
    const n = countTokens(giving);
    return `<div class="panel spl-tray mine">
      <p class="card-kicker"><span>Trả đá</span><span class="icon" aria-hidden="true">↩️</span></p>
      <h2>Trả lại ${over} viên</h2>
      <p class="lead">Chỉ được giữ tối đa ${MAX_TOKENS} viên. Chạm vào đá của bạn để chọn viên trả lại.</p>
      <div class="spl-bank">${TOKENS.filter(c => hand.tokens[c]).map(c => `
        <button class="spl-token ${c}" data-act="splGive" data-color="${c}" aria-label="Trả 1 ${gemName(c)}" ${(giving[c] || 0) >= hand.tokens[c] ? 'disabled' : ''}>
          ${gem(c, 'spl-gem big')}<span class="count">${hand.tokens[c] - (giving[c] || 0)}</span>
        </button>`).join('')}
      </div>
      <p class="small" style="margin-top:8px">Trả: ${n ? TOKENS.filter(c => giving[c]).map(c => `${giving[c]} ${gemName(c)}`).join(', ') : 'chưa chọn'}</p>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-ghost" data-act="splClear" ${n ? '' : 'disabled'}>Chọn lại</button>
        <button class="btn btn-primary" data-act="splDiscard" ${n === over ? '' : 'disabled'}>Trả ${over} viên</button>
      </div>
    </div>`;
  }
  // Your move: gems picked, or a card chosen.
  let body = '<p class="lead">Chạm đá ở ngân hàng để lấy, hoặc chạm một thẻ để mua hay giữ.</p>';
  let buttons = '';
  if (picked.length) {
    const error = tokenPickError({ bank: p.bank }, picked);
    const total = countTokens(hand.tokens) + picked.length;
    body = `<p class="lead">Lấy: <strong>${picked.map(gemName).join(', ')}</strong>${error ? `<br><span class="muted small">${h.esc(error)}</span>` : ''}${!error && total > MAX_TOKENS ? `<br><span class="muted small">Bạn sẽ có ${total} viên, phải trả lại ${total - MAX_TOKENS}.</span>` : ''}</p>`;
    buttons = `<button class="btn btn-ghost" data-act="splClear">Bỏ chọn</button>
      <button class="btn btn-primary" data-act="splTake" ${error ? 'disabled' : ''}>Lấy đá</button>`;
  } else if (chosen) {
    const card = chosen.kind === 'card' ? findCard(p, hand, chosen.id) : null;
    const mine = card && hand.reserved.some(c => c.id === card.id);
    const canReserve = !mine && hand.reserved.length < MAX_RESERVED;
    const pay = card ? paymentFor(hand, card) : null;
    body = card
      ? `<div class="spl-chosen">${cardHtml(card)}<p class="small">${pay.ok
        ? `Trả: ${Object.keys(pay.pay).length ? TOKENS.filter(c => pay.pay[c]).map(c => `${pay.pay[c]} ${gemName(c)}`).join(', ') : 'không mất viên nào'}.`
        : 'Bạn chưa đủ đá để mua thẻ này.'}${canReserve ? ` Giữ thẻ: nhận ${p.bank.gold ? '1 vàng' : 'không còn vàng'}.` : ''}</p></div>`
      : `<p class="lead">Giữ thẻ úp trên cùng của chồng cấp ${chosen.tier}${p.bank.gold ? ' và nhận 1 vàng' : ''}.</p>`;
    buttons = `<button class="btn btn-ghost" data-act="splClear">Huỷ</button>
      ${card ? `<button class="btn btn-primary" data-act="splBuy" ${pay.ok ? '' : 'disabled'}>Mua</button>` : ''}
      ${canReserve || !card ? `<button class="btn ${card ? 'btn-ghost' : 'btn-primary'}" data-act="splReserve" ${hand.reserved.length < MAX_RESERVED ? '' : 'disabled'}>Giữ thẻ</button>` : ''}`;
  }
  return `<div class="panel spl-tray mine">
    <p class="card-kicker"><span>${p.finalRound ? 'Vòng cuối' : `Vòng ${p.round}`}</span><span class="icon" aria-hidden="true">💎</span></p>
    <h2>Lượt của bạn</h2>
    ${body}
    ${buttons ? `<div class="row" style="margin-top:10px;flex-wrap:wrap">${buttons}</div>` : ''}
    <button class="btn btn-link" data-act="splPass">Không còn nước đi? Bỏ lượt</button>
  </div>`;
}

function findCard(p, hand, id) {
  return TIERS.flatMap(t => p.board[t]).find(c => c?.id === id) || hand.reserved.find(c => c.id === id) || null;
}

function lastMove(h, last) {
  const who = h.esc(h.nameOnly(last.by));
  if (last.type === 'take') return `${who} vừa lấy ${last.colors.map(gemName).join(', ')}.`;
  if (last.type === 'buy') return `${who} vừa mua một thẻ.`;
  if (last.type === 'reserve' || last.type === 'reserveDeck') return `${who} vừa giữ một thẻ.`;
  return '';
}

function board(h) {
  const { view } = h;
  const p = view.play;
  const mine = p.me.myTurn && p.step === 'play';
  const hand = p.hands[view.me.id];
  const sel = (id) => chosen?.kind === 'card' && chosen.id === id;
  const bank = `<div class="spl-bank" role="group" aria-label="Ngân hàng đá quý">${TOKENS.map(c => {
    const n = picked.filter(x => x === c).length;
    const left = p.bank[c] - n;
    const can = mine && c !== 'gold' && left > 0 && picked.length < 3;
    return `<button class="spl-token ${c} ${n ? 'sel' : ''}" data-act="splPick" data-color="${c}" ${can ? '' : 'disabled'} aria-label="${gemName(c)}: còn ${left}">
      ${gem(c, 'spl-gem big')}<span class="count">${left}</span>${n ? `<span class="badge">+${n}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
  const rows = [3, 2, 1].map(t => `
    <div class="spl-row">
      <button class="spl-card back t${t} ${chosen?.kind === 'deck' && chosen.tier === t ? 'sel' : ''}" data-act="splDeck" data-tier="${t}" ${mine && p.decks[t] ? '' : 'disabled'} aria-label="Chồng thẻ cấp ${t}: còn ${p.decks[t]} thẻ">
        <span class="back-tier">${'•'.repeat(t)}</span><span class="small">${p.decks[t]}</span>
      </button>
      ${p.board[t].map(c => cardHtml(c, { hand, act: mine ? 'splCard' : null, tier: t, selected: c && sel(c.id) })).join('')}
    </div>`).join('');
  return `<section class="spl-board" aria-label="Bàn chơi">
    <div class="spl-nobles">${p.nobles.map(n => nobleHtml(n)).join('')}</div>
    ${rows}
    ${bank}
  </section>`;
}

// Everyone's gems, cards and nobles; you first.
function players(h) {
  const { view } = h;
  const p = view.play;
  const me = view.me.id;
  const ids = p.order.includes(me) ? [me, ...p.order.filter(id => id !== me)] : p.order;
  const mine = p.me.myTurn && p.step === 'play';
  return `<section class="spl-players">${ids.map(id => {
    const hand = p.hands[id];
    const turn = p.current === id;
    return `<div class="panel spl-player ${turn ? 'turn' : ''}">
      <div class="row-between">
        <h3>${turn ? '▶ ' : ''}${h.esc(h.nameOnly(id))}${id === me ? ' (bạn)' : ''}${p.order[0] === id ? ' <span class="muted small">đi đầu</span>' : ''}</h3>
        <span class="spl-points"><strong>${hand.points}</strong> điểm</span>
      </div>
      ${gemsOf(hand)}
      <p class="muted small">${hand.cards.length} thẻ · ${countTokens(hand.tokens)}/${MAX_TOKENS} viên${hand.nobles.length ? ` · ${hand.nobles.length} quý tộc` : ''}</p>
      ${hand.nobles.length ? `<div class="spl-nobles small">${hand.nobles.map(n => nobleHtml(n, { owned: true })).join('')}</div>` : ''}
      ${hand.reserved.length ? `<p class="small" style="margin-top:6px">Đang giữ (${hand.reserved.length}/${MAX_RESERVED})</p>
        <div class="spl-reserved">${hand.reserved.map(c => cardHtml(c, { hand, act: id === me && mine ? 'splCard' : null, selected: chosen?.id === c.id })).join('')}</div>` : ''}
    </div>`;
  }).join('')}</section>`;
}

function gameOver(h) {
  const { view } = h;
  const r = view.play.result;
  const won = r.winnerId === view.me.id;
  return `
    <div class="panel winner">
      <div class="big" aria-hidden="true">${won ? '🏆' : '💎'}</div>
      <h2>${won ? 'Bạn thắng!' : `${h.esc(r.winner)} thắng`}</h2>
      <p class="lead">${h.esc(r.reason)}</p>
      <ol class="leaderboard" style="margin-top:12px;text-align:left">${r.ranking.map((x, i) => `
        <li><span class="rank">${i + 1}</span><span class="who">${h.esc(h.nameOnly(x.id))}</span><span class="score"><strong>${x.points}</strong> điểm<span class="muted">${x.cards} thẻ</span></span></li>`).join('')}
      </ol>
      ${h.isHost() ? '<button class="btn btn-primary btn-block" style="margin-top:16px" data-act="restart">Về phòng chờ, chơi ván mới</button>' : '<p class="muted small" style="margin-top:12px">Chờ chủ phòng mở ván mới.</p>'}
    </div>`;
}

// The card in hand: your gems and the cards you hold, at a glance.
export function splCard(h) {
  const p = h.view.play;
  if (!p?.me.playing) return '<p class="muted">Bạn đang xem ván này.</p>';
  injectSprite();
  const hand = p.hands[h.view.me.id];
  return `
    <div class="spl-mine">
      <p class="card-top"><span>Của bạn</span><span><strong>${hand.points}</strong> điểm</span></p>
      ${gemsOf(hand)}
      <p class="muted small">Số lớn: đá đang có. Số nhỏ: chiết khấu từ ${hand.cards.length} thẻ đã mua.</p>
      ${hand.reserved.length ? `<h3 style="margin-top:12px">Thẻ đang giữ</h3><div class="spl-reserved">${hand.reserved.map(c => cardHtml(c, { hand })).join('')}</div>` : '<p class="muted small" style="margin-top:12px">Chưa giữ thẻ nào.</p>'}
    </div>`;
}

export function splClick(a, el, h) {
  const p = h.view.play;
  switch (a) {
    case 'splPick': {
      const c = el.dataset.color;
      chosen = null;
      // A second tap on a gem already picked takes two of it (or puts it back).
      if (picked.includes(c) && picked.length === 1) picked.push(c);
      else if (picked.includes(c)) picked = picked.filter(x => x !== c);
      else picked = picked.length === 2 && picked[0] === picked[1] ? [c] : [...picked, c];
      h.render();
      return true;
    }
    case 'splCard':
      picked = [];
      chosen = chosen?.id === el.dataset.id ? null : { kind: 'card', id: el.dataset.id, tier: Number(el.dataset.tier) };
      h.render();
      return true;
    case 'splDeck': {
      const tier = Number(el.dataset.tier);
      picked = [];
      chosen = chosen?.kind === 'deck' && chosen.tier === tier ? null : { kind: 'deck', tier };
      h.render();
      return true;
    }
    case 'splClear':
      picked = [];
      chosen = null;
      giving = {};
      h.render();
      return true;
    case 'splTake':
      h.act('take', { colors: picked });
      return true;
    case 'splBuy':
      h.act('buy', { cardId: chosen.id });
      return true;
    case 'splReserve':
      if (chosen.kind === 'deck') h.act('reserveDeck', { tier: chosen.tier });
      else h.act('reserve', { cardId: chosen.id });
      return true;
    case 'splPass':
      if (confirm('Chỉ bỏ lượt được khi không còn nước đi nào. Bỏ lượt?')) h.act('pass');
      return true;
    case 'splGive': {
      const c = el.dataset.color;
      giving[c] = (giving[c] || 0) + 1;
      const hand = p.hands[h.view.me.id];
      const over = countTokens(hand.tokens) - MAX_TOKENS;
      if (countTokens(giving) > over) giving = { [c]: 1 };
      h.render();
      return true;
    }
    case 'splDiscard':
      h.act('discard', { pile: giving });
      return true;
    case 'splNoble':
      h.act('noble', { nobleId: el.dataset.id });
      return true;
  }
  return false;
}

export const splendorUI = {
  rules: SPLENDOR_RULES,
  lobby: splLobby,
  title: splTitle,
  subtitle: splSubtitle,
  stage: splStage,
  card: splCard,
  click: splClick,
  handHint: 'Đá và thẻ đang giữ',
  sides: [['human', 'Người', 'v'], ['bot', 'Máy', 'w']]
};
