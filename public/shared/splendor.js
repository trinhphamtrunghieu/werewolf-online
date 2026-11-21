// Splendor: the cards, the nobles and the rules. Shared by the server (which
// runs the game) and the browser (which shows what a player can afford, and
// which gem picks are allowed, before asking the server).
//
// Ported from the stand-alone Splendor web game. The 90 development cards are
// rotationally symmetric over the five gem colours: every tier is built from a
// handful of cost patterns, each appearing once per bonus colour.
//
//   tier 1 : 8 patterns x 5 colours = 40 cards
//   tier 2 : 6 patterns x 5 colours = 30 cards
//   tier 3 : 4 patterns x 5 colours = 20 cards
//
// `own` is the cost in the card's own colour, `rel` the cost in the colours at
// offset +1..+4 along white -> blue -> green -> red -> black.

export const COLORS = ['white', 'blue', 'green', 'red', 'black'];
export const TOKENS = [...COLORS, 'gold'];

export const GEMS = {
  white: { name: 'Kim cương' },
  blue: { name: 'Lam ngọc' },
  green: { name: 'Lục bảo' },
  red: { name: 'Hồng ngọc' },
  black: { name: 'Hắc ngọc' },
  gold: { name: 'Vàng' }
};

const PATTERNS = {
  1: [
    { own: 0, rel: [1, 1, 1, 1], pts: 0 },
    { own: 0, rel: [1, 2, 1, 1], pts: 0 },
    { own: 0, rel: [2, 2, 0, 1], pts: 0 },
    { own: 1, rel: [0, 0, 1, 3], pts: 0 },
    { own: 0, rel: [0, 0, 2, 1], pts: 0 },
    { own: 0, rel: [2, 0, 2, 0], pts: 0 },
    { own: 0, rel: [0, 0, 3, 0], pts: 0 },
    { own: 0, rel: [0, 4, 0, 0], pts: 1 }
  ],
  2: [
    { own: 0, rel: [3, 2, 2, 0], pts: 1 },
    { own: 2, rel: [0, 0, 3, 3], pts: 1 },
    { own: 0, rel: [0, 5, 0, 0], pts: 2 },
    { own: 3, rel: [5, 0, 0, 0], pts: 2 },
    { own: 2, rel: [0, 1, 4, 0], pts: 2 },
    { own: 6, rel: [0, 0, 0, 0], pts: 3 }
  ],
  3: [
    { own: 0, rel: [3, 3, 5, 3], pts: 3 },
    { own: 0, rel: [0, 0, 7, 0], pts: 4 },
    { own: 3, rel: [0, 0, 6, 3], pts: 4 },
    { own: 3, rel: [0, 0, 7, 0], pts: 5 }
  ]
};

export const TIERS = [1, 2, 3];

export function buildDeck() {
  const decks = { 1: [], 2: [], 3: [] };
  for (const tier of TIERS) {
    PATTERNS[tier].forEach((pattern, pi) => {
      COLORS.forEach((bonus, bi) => {
        const cost = {};
        if (pattern.own) cost[bonus] = pattern.own;
        pattern.rel.forEach((amount, ri) => {
          if (amount) cost[COLORS[(bi + ri + 1) % COLORS.length]] = amount;
        });
        decks[tier].push({ id: `t${tier}p${pi}-${bonus}`, tier, bonus, points: pattern.pts, cost });
      });
    });
  }
  return decks;
}

// The ten nobles, 3 points each. Portraits: /img/splendor/nobles/<id>.jpg.
export const NOBLES = [
  { id: 'n1', name: 'Mary Stuart', points: 3, req: { white: 3, blue: 3, green: 3 } },
  { id: 'n2', name: 'Charles V', points: 3, req: { white: 3, blue: 3, black: 3 } },
  { id: 'n3', name: 'Machiavelli', points: 3, req: { white: 3, red: 3, black: 3 } },
  { id: 'n4', name: 'Isabella I', points: 3, req: { blue: 3, green: 3, red: 3 } },
  { id: 'n5', name: 'Suleiman', points: 3, req: { green: 3, red: 3, black: 3 } },
  { id: 'n6', name: 'Catherine de Medici', points: 3, req: { white: 4, blue: 4 } },
  { id: 'n7', name: 'Anne of Brittany', points: 3, req: { blue: 4, green: 4 } },
  { id: 'n8', name: 'Elisabeth of Austria', points: 3, req: { green: 4, red: 4 } },
  { id: 'n9', name: 'Francis I of France', points: 3, req: { red: 4, black: 4 } },
  { id: 'n10', name: 'Henry VIII', points: 3, req: { white: 4, black: 4 } }
];

export const TOKENS_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };
export const GOLD_COUNT = 5;
export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;
export const BOARD_WIDTH = 4;

export const SPLENDOR_DEFAULTS = {
  turnTime: 90, // seconds for one turn; when it runs out the computer plays it
  target: 15 // prestige points that start the final round
};

export const SPLENDOR_LIMITS = {
  turnTime: [30, 300],
  target: [10, 21]
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pile = (gold) => Object.fromEntries((gold ? TOKENS : COLORS).map(c => [c, 0]));
export const countTokens = (p) => Object.values(p).reduce((a, b) => a + b, 0);
const gemList = (colors) => colors.map(c => GEMS[c].name).join(', ');

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export const currentId = (g) => g.order[g.turn];
const currentHand = (g) => g.hands[currentId(g)];

export const visibleCards = (g) => TIERS.flatMap(t => g.board[t].filter(Boolean));

function findBoardCard(g, cardId) {
  for (const tier of TIERS) {
    const index = g.board[tier].findIndex(c => c && c.id === cardId);
    if (index >= 0) return { card: g.board[tier][index], tier, index };
  }
  return null;
}

// What the player still pays after their bonuses, and how much of it in gold.
export function paymentFor(hand, card) {
  const pay = {};
  let gold = 0;
  for (const color of COLORS) {
    const need = (card.cost[color] || 0) - hand.bonuses[color];
    if (need <= 0) continue;
    const used = Math.min(hand.tokens[color], need);
    if (used) pay[color] = used;
    gold += need - used;
  }
  if (gold) pay.gold = gold;
  return { ok: gold <= hand.tokens.gold, pay, gold };
}

export const canAfford = (hand, card) => paymentFor(hand, card).ok;

// Gems short of a card, ignoring gold (for the computer players).
export function missingFor(hand, card) {
  let total = 0;
  for (const color of COLORS) {
    total += Math.max(0, (card.cost[color] || 0) - hand.bonuses[color] - hand.tokens[color]);
  }
  return { total, coveredByGold: Math.min(total, hand.tokens.gold) };
}

export function eligibleNobles(g, hand) {
  return g.nobles.filter(n => Object.entries(n.req).every(([c, k]) => hand.bonuses[c] >= k));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// A new game for these players (ids, in turn order).
export function newGame(order, rng, { target = SPLENDOR_DEFAULTS.target } = {}) {
  const decks = buildDeck();
  const perGem = TOKENS_BY_PLAYERS[order.length];
  const g = {
    order: [...order],
    turn: 0,
    round: 1,
    step: 'play', // play | discard | noble | over
    target,
    bank: { ...Object.fromEntries(COLORS.map(c => [c, perGem])), gold: GOLD_COUNT },
    decks: { 1: shuffle(decks[1], rng), 2: shuffle(decks[2], rng), 3: shuffle(decks[3], rng) },
    board: { 1: [], 2: [], 3: [] },
    nobles: shuffle(NOBLES.map(n => ({ ...n, req: { ...n.req } })), rng).slice(0, order.length + 1),
    hands: Object.fromEntries(order.map(id => [id, { tokens: pile(true), bonuses: pile(false), cards: [], reserved: [], nobles: [], points: 0 }])),
    pending: [],
    finalRound: false,
    noBuyStreak: 0,
    ranking: null,
    stalemate: false
  };
  for (const tier of TIERS) {
    for (let i = 0; i < BOARD_WIDTH; i++) g.board[tier].push(g.decks[tier].pop());
  }
  return g;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export function legalTokenPicks(g) {
  const picks = COLORS.filter(c => g.bank[c] >= 4).map(c => [c, c]);
  const available = COLORS.filter(c => g.bank[c] > 0);
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      for (let k = j + 1; k < available.length; k++) picks.push([available[i], available[j], available[k]]);
    }
  }
  if (available.length && available.length < 3) picks.push(available);
  return picks;
}

// Why these gems cannot be taken, or null when they can.
export function tokenPickError(g, colors) {
  if (!Array.isArray(colors) || !colors.length) return 'Hãy chọn đá quý.';
  if (colors.some(c => !COLORS.includes(c))) return 'Vàng chỉ có được khi giữ thẻ.';
  const distinct = new Set(colors);
  if (colors.length === 2 && distinct.size === 1) {
    return g.bank[colors[0]] < 4 ? 'Chỉ lấy 2 viên cùng màu khi chồng đó còn ít nhất 4 viên.' : null;
  }
  if (distinct.size !== colors.length) return 'Lấy 3 viên khác màu, hoặc 2 viên cùng màu.';
  if (colors.length > 3) return 'Chỉ được lấy tối đa 3 viên.';
  if (colors.some(c => g.bank[c] < 1)) return 'Màu đó đã hết.';
  if (colors.length < 3 && COLORS.filter(c => g.bank[c] > 0).length >= 3) return 'Hãy lấy 3 viên khác màu.';
  return null;
}

// Every move but the fallback pass.
export function realMoves(g) {
  const hand = currentHand(g);
  const moves = [];
  for (const card of visibleCards(g)) if (canAfford(hand, card)) moves.push({ type: 'buy', cardId: card.id, card });
  for (const card of hand.reserved) if (canAfford(hand, card)) moves.push({ type: 'buy', cardId: card.id, card });
  if (hand.reserved.length < MAX_RESERVED) {
    for (const card of visibleCards(g)) moves.push({ type: 'reserve', cardId: card.id, card });
    for (const tier of TIERS) if (g.decks[tier].length) moves.push({ type: 'reserveDeck', tier });
  }
  for (const colors of legalTokenPicks(g)) moves.push({ type: 'take', colors });
  return moves;
}

export function legalMoves(g) {
  const moves = realMoves(g);
  return moves.length ? moves : [{ type: 'pass' }];
}

// Play one move for the player whose turn it is. Returns { error } or
// { lines }: what happened, for the game log (`name(id)` names a player).
export function applyMove(g, move, name) {
  const lines = [];
  const who = name(currentId(g));
  const fail = (error) => ({ error });
  const hand = currentHand(g);
  switch (move?.type) {
    case 'take': {
      if (g.step !== 'play') return fail('Chưa đến lúc lấy đá.');
      const error = tokenPickError(g, move.colors);
      if (error) return fail(error);
      move.colors.forEach(c => { g.bank[c]--; hand.tokens[c]++; });
      lines.push(`💎 ${who} lấy ${gemList(move.colors)}.`);
      break;
    }
    case 'reserve':
    case 'reserveDeck': {
      if (g.step !== 'play') return fail('Chưa đến lúc giữ thẻ.');
      if (hand.reserved.length >= MAX_RESERVED) return fail(`Chỉ giữ được tối đa ${MAX_RESERVED} thẻ.`);
      let card;
      if (move.type === 'reserve') {
        const hit = findBoardCard(g, move.cardId);
        if (!hit) return fail('Thẻ đó không còn trên bàn.');
        card = { ...hit.card };
        g.board[hit.tier][hit.index] = g.decks[hit.tier].pop() || null;
      } else {
        const deck = g.decks[move.tier];
        if (!deck?.length) return fail('Chồng thẻ đó đã hết.');
        card = { ...deck.pop(), hidden: true };
      }
      hand.reserved.push(card);
      const gold = g.bank.gold > 0;
      if (gold) { g.bank.gold--; hand.tokens.gold++; }
      lines.push(`📌 ${who} giữ một thẻ cấp ${card.tier}${card.hidden ? ' (úp, từ chồng)' : ''}${gold ? ' và nhận 1 vàng' : ''}.`);
      break;
    }
    case 'buy': {
      if (g.step !== 'play') return fail('Chưa đến lúc mua thẻ.');
      const hit = findBoardCard(g, move.cardId);
      const card = hit ? hit.card : hand.reserved.find(c => c.id === move.cardId);
      if (!card) return fail('Thẻ đó không còn.');
      const payment = paymentFor(hand, card);
      if (!payment.ok) return fail('Bạn không đủ đá quý để mua thẻ này.');
      for (const [c, k] of Object.entries(payment.pay)) { hand.tokens[c] -= k; g.bank[c] += k; }
      if (hit) g.board[hit.tier][hit.index] = g.decks[hit.tier].pop() || null;
      else hand.reserved = hand.reserved.filter(c => c.id !== card.id);
      const { hidden, ...bought } = card;
      hand.cards.push(bought);
      hand.bonuses[card.bonus]++;
      hand.points += card.points;
      g.noBuyStreak = -1; // 0 once the turn is handed over
      lines.push(`🛒 ${who} mua thẻ ${GEMS[card.bonus].name} cấp ${card.tier}${card.points ? ` (+${card.points} điểm)` : ''}.`);
      break;
    }
    case 'pass':
      // Splendor has no pass: allowed only when nothing else is legal.
      if (g.step !== 'play') return fail('Chưa đến lúc này.');
      if (realMoves(g).length) return fail('Bạn vẫn còn nước đi.');
      lines.push(`⏭️ ${who} không còn nước đi, bỏ lượt.`);
      break;
    case 'noble': {
      if (g.step !== 'noble') return fail('Không có quý tộc nào để chọn.');
      if (!g.pending.includes(move.nobleId)) return fail('Quý tộc đó không đến thăm bạn.');
      lines.push(award(g, move.nobleId, who));
      g.pending = [];
      return afterNobles(g, lines, who);
    }
    case 'discard': {
      if (g.step !== 'discard') return fail('Bạn không cần trả đá.');
      const give = move.pile && typeof move.pile === 'object' ? move.pile : {};
      const over = countTokens(hand.tokens) - MAX_TOKENS;
      const entries = Object.entries(give).filter(([, k]) => k);
      if (entries.some(([c, k]) => !TOKENS.includes(c) || !Number.isInteger(k) || k < 0 || k > hand.tokens[c])) return fail('Bạn không có đủ số đá đó.');
      if (entries.reduce((a, [, k]) => a + k, 0) !== over) return fail(`Hãy trả lại đúng ${over} viên.`);
      for (const [c, k] of entries) { hand.tokens[c] -= k; g.bank[c] += k; }
      lines.push(`↩️ ${who} trả lại ${over} viên cho ngân hàng.`);
      return advance(g, lines, who);
    }
    default:
      return fail('Nước đi không hợp lệ.');
  }
  return endTurn(g, lines, who);
}

function award(g, nobleId, who) {
  const i = g.nobles.findIndex(n => n.id === nobleId);
  const [noble] = g.nobles.splice(i, 1);
  const hand = currentHand(g);
  hand.nobles.push(noble);
  hand.points += noble.points;
  return `👑 ${noble.name} đến thăm ${who} (+${noble.points} điểm).`;
}

// The end of a move: nobles visit, then the 10-token limit, then the next turn.
function endTurn(g, lines, who) {
  const nobles = eligibleNobles(g, currentHand(g));
  if (nobles.length > 1) {
    g.pending = nobles.map(n => n.id);
    g.step = 'noble';
    return { lines };
  }
  if (nobles.length) lines.push(award(g, nobles[0].id, who));
  return afterNobles(g, lines, who);
}

function afterNobles(g, lines, who) {
  if (countTokens(currentHand(g).tokens) > MAX_TOKENS) {
    g.step = 'discard';
    return { lines };
  }
  return advance(g, lines, who);
}

function advance(g, lines, who) {
  const hand = currentHand(g);
  g.noBuyStreak++;
  if (!g.finalRound && hand.points >= g.target) {
    g.finalRound = true;
    lines.push(`🏁 ${who} đạt ${hand.points} điểm: vòng cuối! Chơi nốt đến hết vòng này.`);
  }
  // Nobody has bought anything for a long stretch: the position is dead.
  if (g.noBuyStreak >= g.order.length * 8) {
    g.stalemate = true;
    lines.push('🧱 Đã lâu không ai mua được thẻ nào: ván kết thúc, tính điểm.');
    return finish(g, lines);
  }
  const next = (g.turn + 1) % g.order.length;
  // The final round is played out, so everyone has had as many turns.
  if (g.finalRound && next === 0) return finish(g, lines);
  g.turn = next;
  if (next === 0) g.round++;
  g.step = 'play';
  return { lines };
}

// Most points wins; on a tie, fewer cards bought.
function finish(g, lines) {
  g.step = 'over';
  g.ranking = [...g.order].sort((a, b) => g.hands[b].points - g.hands[a].points || g.hands[a].cards.length - g.hands[b].cards.length);
  return { lines, over: true };
}
