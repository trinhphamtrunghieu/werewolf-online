// Splendor. Gem merchants of the Renaissance take turns: take gems, reserve a
// card (with a gold), or buy a card. Cards give a permanent gem discount and
// prestige points; nobles visit whoever has enough discounts. Reaching the
// target (15) starts the final round; the most points then wins.
//
//   SPL_TURN   one player's turn, on the clock. Inside it, s.play.step is
//              'play', then possibly 'noble' (more than one noble would
//              visit: choose) and 'discard' (over 10 tokens: give some back).
//              When the clock runs out, the computer plays the turn for them.
//   GAME_OVER
//
// The rules themselves live in public/shared/splendor.js (the browser uses
// them to show what you can afford); this module runs turns, the clock and
// the computer players. Ported from the stand-alone Splendor web game.

import {
  COLORS, TOKENS, MAX_TOKENS, SPLENDOR_DEFAULTS, SPLENDOR_LIMITS,
  newGame, applyMove, currentId, legalMoves, visibleCards, canAfford, missingFor, countTokens
} from '../../public/shared/splendor.js';

const BOT_DELAY_MS = 2500;

export const splendor = {
  id: 'splendor',
  minPlayers: 2,
  defaults: SPLENDOR_DEFAULTS,

  configure(c, payload, api) {
    for (const [key, [min, max]] of Object.entries(SPLENDOR_LIMITS)) {
      if (payload[key] === undefined) continue;
      const v = Math.round(Number(payload[key]));
      if (!Number.isFinite(v)) api.fail('Giá trị không hợp lệ.');
      c[key] = Math.min(max, Math.max(min, v));
    }
  },

  start(s, now, rng, api) {
    const c = conf(s);
    const ring = s.players.filter(p => p.inGame).sort((a, b) => a.seat - b.seat).map(p => p.id);
    // A random first player; the turn order then goes round the table.
    const first = Math.floor(rng() * ring.length);
    const order = [...ring.slice(first), ...ring.slice(0, first)];
    s.play = { ...newGame(order, rng, { target: c.target }), last: null, result: null };
    api.log(s, `💎 Ván Splendor bắt đầu: ${order.length} người, ${c.target} điểm để vào vòng cuối. ${api.nameOf(s, order[0])} đi trước.`);
    api.setPhase(s, 'SPL_TURN', now, c.turnTime * 1000);
  },

  action(s, player, type, payload, now, rng, api) {
    const p = s.play;
    if (!player.inGame) api.fail('Bạn đang xem, không tham gia ván này.');
    if (currentId(p) !== player.id) api.fail('Chưa đến lượt bạn.');
    const move = toMove(type, payload);
    play(s, move, now, api, api.fail);
  },

  // The host's "skip": end this turn's clock now (the computer plays it).
  skip(s, now) {
    s.game.phaseEndsAt = now;
  },

  onTimeout(s, now, rng, api) {
    api.log(s, `⏰ Hết giờ: máy đi thay ${api.nameOf(s, currentId(s.play))}.`);
    autoTurn(s, now, rng, api);
  },

  bots(s, now, rng, api) {
    if (s.phase !== 'SPL_TURN' || now < s.game.phaseStartedAt + BOT_DELAY_MS) return false;
    const bot = s.players.find(x => x.id === currentId(s.play));
    if (!bot.isBot) return false;
    autoTurn(s, now, rng, api);
    return true;
  },

  view(s, me) {
    const p = s.play;
    const over = s.phase === 'GAME_OVER';
    const playing = !!me?.inGame && p.hands[me.id] !== undefined;
    const current = currentId(p);
    const hands = Object.fromEntries(p.order.map(id => {
      const h = p.hands[id];
      // A card reserved from a deck stays face down to everyone else.
      const reserved = h.reserved.map(c => (c.hidden && id !== me?.id && !over ? { hidden: true, tier: c.tier } : c));
      return [id, { ...h, reserved }];
    }));
    return {
      order: p.order,
      current: over ? null : current,
      step: p.step,
      round: p.round,
      target: p.target,
      finalRound: p.finalRound,
      bank: p.bank,
      board: p.board,
      decks: { 1: p.decks[1].length, 2: p.decks[2].length, 3: p.decks[3].length },
      nobles: p.nobles,
      hands,
      // Nobles to choose from, for the player choosing.
      pending: current === me?.id ? p.pending : [],
      last: p.last,
      me: { playing, myTurn: playing && !over && current === me.id },
      result: over ? p.result : null
    };
  }
};

const conf = (s) => ({ ...SPLENDOR_DEFAULTS, ...(s.gameConfigs?.splendor || {}) });

// A request from the browser, as a move for the rules.
function toMove(type, payload) {
  switch (type) {
    case 'take': return { type, colors: payload.colors };
    case 'buy':
    case 'reserve': return { type, cardId: payload.cardId };
    case 'reserveDeck': return { type, tier: Number(payload.tier) };
    case 'discard': return { type, pile: payload.pile };
    case 'noble': return { type, nobleId: payload.nobleId };
    case 'pass': return { type };
    default: return { type: null };
  }
}

// Play a move; `fail` is called with the reason when it is not allowed.
function play(s, move, now, api, fail) {
  const p = s.play;
  const who = currentId(p);
  const r = applyMove(p, move, (id) => api.nameOf(s, id));
  if (r.error) return fail(r.error);
  r.lines.forEach(line => api.log(s, line));
  p.last = { by: who, type: move.type, cardId: move.cardId ?? null, colors: move.colors ?? null };
  if (r.over) return finish(s, now, api);
  // Same player still to choose a noble or give gems back: same clock.
  if (currentId(p) !== who) api.setPhase(s, 'SPL_TURN', now, conf(s).turnTime * 1000);
}

// The computer plays the whole turn of whoever is to play: the move, then
// the noble and the gems to give back, if asked.
function autoTurn(s, now, rng, api) {
  const p = s.play;
  const who = currentId(p);
  for (let i = 0; i < 3 && s.phase === 'SPL_TURN' && currentId(p) === who; i++) {
    if (p.step === 'noble') play(s, { type: 'noble', nobleId: p.pending[0] }, now, api, api.fail);
    else if (p.step === 'discard') play(s, { type: 'discard', pile: discardPick(p, who) }, now, api, api.fail);
    else play(s, chooseMove(p, rng), now, api, api.fail);
  }
}

function finish(s, now, api) {
  const p = s.play;
  const rank = p.ranking;
  const winner = s.players.find(x => x.id === rank[0]);
  const pts = (id) => p.hands[id].points;
  const reason = `${winner.name} thắng với ${pts(winner.id)} điểm${p.stalemate ? ' (ván bế tắc, tính theo điểm)' : ''}.`;
  p.result = {
    winner: winner.name,
    winnerId: winner.id,
    reason,
    ranking: rank.map(id => ({ id, points: pts(id), cards: p.hands[id].cards.length }))
  };
  api.log(s, `🏆 ${reason}`);
  const sideOf = (x) => (x.isBot ? 'bot' : 'human');
  api.record(s, 'splendor', sideOf(winner), rank.map(id => {
    const x = s.players.find(q => q.id === id);
    return { player: x, side: sideOf(x), won: id === winner.id };
  }));
  api.setPhase(s, 'GAME_OVER', now, null);
}

// ---------------------------------------------------------------------------
// Computer players: every legal move is tried on a copy of the game and the
// resulting position scored (one-ply search with a hand-tuned evaluation).
// ---------------------------------------------------------------------------

const NOISE = 1.5;
const NOBLE_WEIGHT = 6;
const DENY_WEIGHT = 0.6;

// How much each colour is wanted, from the cards and nobles in sight.
function colorDemand(g, hand) {
  const demand = Object.fromEntries(COLORS.map(c => [c, 0]));
  for (const card of [...visibleCards(g), ...hand.reserved]) {
    const weight = 1 + card.points * 0.5 + (4 - card.tier) * 0.25;
    for (const c of COLORS) demand[c] += Math.max(0, (card.cost[c] || 0) - hand.bonuses[c]) * weight;
  }
  for (const noble of g.nobles) {
    for (const c of COLORS) demand[c] += Math.max(0, (noble.req[c] || 0) - hand.bonuses[c]) * 2.5;
  }
  return demand;
}

function evaluate(g, id) {
  const hand = g.hands[id];
  let score = hand.points * 12;
  const demand = colorDemand(g, hand);
  const total = COLORS.reduce((a, c) => a + demand[c], 0) || 1;
  for (const c of COLORS) {
    const owned = hand.bonuses[c];
    // Discounts last all game: worth far more than the loose gems they cost.
    score += owned * 6 + owned * (demand[c] / total) * 7 - Math.max(0, owned - 4) * 1.2;
    score += hand.tokens[c] * (0.35 + (demand[c] / total) * 1.1);
  }
  score += hand.tokens.gold * 1.2;
  score -= Math.max(0, countTokens(hand.tokens) - MAX_TOKENS) * 2.5;
  for (const noble of g.nobles) {
    const req = Object.entries(noble.req);
    const need = req.reduce((a, [, k]) => a + k, 0);
    const owned = req.reduce((a, [c, k]) => a + Math.min(hand.bonuses[c], k), 0);
    score += NOBLE_WEIGHT * (owned / need) ** 2;
  }
  score += hand.cards.length * 1.5 + hand.reserved.length * 0.3;
  // What is within reach now.
  let reach = 0;
  for (const card of [...visibleCards(g), ...hand.reserved]) {
    const gap = missingFor(hand, card);
    const short = gap.total - gap.coveredByGold;
    if (short === 0) reach += 1.5 + card.points;
    else if (short <= 2) reach += (1.2 + card.points * 0.5) / short;
  }
  return score + reach * 0.8;
}

// The best card a rival could buy next turn.
function threat(g, id) {
  let worst = 0;
  for (const rival of g.order) {
    if (rival === id) continue;
    for (const card of visibleCards(g)) if (card.points && canAfford(g.hands[rival], card)) worst = Math.max(worst, card.points);
  }
  return worst * DENY_WEIGHT;
}

const fingerprint = (h) => JSON.stringify([h.tokens, h.bonuses, h.points, h.reserved.map(c => c.id)]);

export function chooseMove(g, rng) {
  const id = currentId(g);
  const before = fingerprint(g.hands[id]);
  let best = null;
  let bestScore = -Infinity;
  for (const move of legalMoves(g)) {
    const probe = structuredClone(g);
    applyMove(probe, move, String);
    // Settle the follow-ups, so the position scored is a legal one.
    if (probe.step === 'noble') applyMove(probe, { type: 'noble', nobleId: probe.pending[0] }, String);
    if (probe.step === 'discard') applyMove(probe, { type: 'discard', pile: discardPick(probe, id) }, String);
    let score = evaluate(probe, id) - threat(probe, id);
    if (move.type === 'buy') score += 2.5 + move.card.points;
    if (move.type === 'reserveDeck') score -= 1.5;
    if (move.type === 'reserve' && !move.card.points) score -= 1;
    // Never burn a turn taking gems only to hand them straight back.
    if (fingerprint(probe.hands[id]) === before) score -= 100;
    score += (rng() - 0.5) * 2 * NOISE;
    if (score > bestScore) { bestScore = score; best = move; }
  }
  const { card, ...plain } = best;
  return plain;
}

// The gems wanted least go back; gold is kept.
export function discardPick(g, id) {
  const hand = g.hands[id];
  const demand = colorDemand(g, hand);
  const over = countTokens(hand.tokens) - MAX_TOKENS;
  const pool = TOKENS.flatMap(c => Array.from({ length: hand.tokens[c] }, (_, i) => ({ c, v: c === 'gold' ? Infinity : demand[c] + i * 0.01 })));
  pool.sort((a, b) => a.v - b.v);
  const give = {};
  pool.slice(0, over).forEach(({ c }) => { give[c] = (give[c] || 0) + 1; });
  return give;
}
