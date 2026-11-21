import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, tick, viewFor } from '../lib/engine.js';
import { chooseMove, discardPick } from '../lib/games/splendor.js';
import { cardsAtEnd, parseCommand } from '../lib/zalo.js';
import {
  COLORS, NOBLES, buildDeck, newGame, tokenPickError, legalTokenPicks, legalMoves, applyMove,
  paymentFor, canAfford, missingFor, currentId, countTokens, eligibleNobles
} from '../public/shared/splendor.js';
import { seeded } from './helpers.js';

const name = (id) => id.toUpperCase();
const pile = (o = {}) => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, ...o });
const card = (id, bonus, cost, points = 0, tier = 1) => ({ id, tier, bonus, points, cost });

// A bare game between a and b (and more), a to play.
function game(ids = ['a', 'b'], seed = 1) {
  return newGame(ids, seeded(seed));
}

// ---------------------------------------------------------------------------
// The cards and the rules (public/shared/splendor.js)
// ---------------------------------------------------------------------------

test('splendor rules: 90 cards, balanced over the colours; ten nobles', () => {
  const d = buildDeck();
  assert.deepEqual([d[1].length, d[2].length, d[3].length], [40, 30, 20]);
  COLORS.forEach(c => assert.equal(d[1].filter(k => k.bonus === c).length, 8));
  assert.equal(new Set([...d[1], ...d[2], ...d[3]].map(k => k.id)).size, 90);
  assert.equal(NOBLES.length, 10);
});

test('splendor rules: setup follows the player count', () => {
  for (const [n, gems] of [[2, 4], [3, 5], [4, 7]]) {
    const g = game(['a', 'b', 'c', 'd'].slice(0, n));
    assert.equal(g.bank.red, gems);
    assert.equal(g.bank.gold, 5);
    assert.equal(g.nobles.length, n + 1);
    [1, 2, 3].forEach(t => assert.equal(g.board[t].length, 4));
    assert.equal(g.decks[1].length, 36);
  }
});

test('splendor rules: which gem picks are allowed', () => {
  const g = game();
  assert.match(tokenPickError(g, []), /chọn đá/);
  assert.match(tokenPickError(g, 'red'), /chọn đá/);
  assert.match(tokenPickError(g, ['gold']), /Vàng/);
  assert.equal(tokenPickError(g, ['red', 'red']), null);
  assert.equal(tokenPickError(g, ['red', 'blue', 'green']), null);
  assert.match(tokenPickError(g, ['red', 'red', 'blue']), /3 viên khác màu, hoặc 2/);
  assert.match(tokenPickError(g, ['red', 'blue', 'green', 'white']), /tối đa 3/);
  assert.match(tokenPickError(g, ['red', 'blue']), /3 viên khác màu/);
  g.bank.red = 3;
  assert.match(tokenPickError(g, ['red', 'red']), /ít nhất 4/);
  g.bank.red = 0;
  assert.match(tokenPickError(g, ['red', 'blue', 'green']), /đã hết/);
  // With fewer than three colours left, fewer gems may be taken.
  Object.assign(g.bank, { white: 0, blue: 1, green: 2, black: 0 });
  assert.equal(tokenPickError(g, ['blue', 'green']), null);
  assert.deepEqual(legalTokenPicks(g), [['blue', 'green']]);
  g.bank.blue = 0;
  assert.deepEqual(legalTokenPicks(g), [['green']]);
  g.bank.green = 0;
  assert.deepEqual(legalTokenPicks(g), []);
});

test('splendor rules: paying with discounts and gold', () => {
  const hand = { tokens: { ...pile({ red: 1, blue: 2 }), gold: 1 }, bonuses: pile({ red: 1 }) };
  const k = card('x', 'white', { red: 3, blue: 2 });
  assert.deepEqual(paymentFor(hand, k), { ok: true, pay: { blue: 2, red: 1, gold: 1 }, gold: 1 });
  assert.equal(canAfford(hand, card('y', 'white', { black: 2 })), false);
  assert.deepEqual(missingFor(hand, card('y', 'white', { black: 2 })), { total: 2, coveredByGold: 1 });
  assert.deepEqual(paymentFor(hand, card('z', 'white', { red: 1 })), { ok: true, pay: {}, gold: 0 });
});

test('splendor rules: taking gems, then the turn passes', () => {
  const g = game();
  const r = applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  assert.deepEqual(r.lines, ['💎 A lấy Hồng ngọc, Lam ngọc, Lục bảo.']);
  assert.equal(g.hands.a.tokens.red, 1);
  assert.equal(g.bank.red, 3);
  assert.equal(currentId(g), 'b');
  assert.match(applyMove(g, { type: 'take', colors: ['gold'] }, name).error, /Vàng/);
  assert.match(applyMove(g, { type: 'fly' }, name).error, /không hợp lệ/);
  assert.match(applyMove(g, null, name).error, /không hợp lệ/);
  applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  assert.equal(g.round, 2);
});

test('splendor rules: reserving from the table or a deck, with a gold', () => {
  const g = game();
  const top = g.board[1][0];
  const next = g.decks[1].at(-1);
  assert.match(applyMove(g, { type: 'reserve', cardId: top.id }, name).lines[0], /giữ một thẻ cấp 1 và nhận 1 vàng/);
  assert.equal(g.board[1][0], next, 'the gap is refilled from the deck');
  assert.equal(g.hands.a.tokens.gold, 1);
  const r = applyMove(g, { type: 'reserveDeck', tier: 3 }, name);
  assert.match(r.lines[0], /úp, từ chồng/);
  assert.equal(g.hands.b.reserved[0].hidden, true);
  assert.match(applyMove(g, { type: 'reserve', cardId: 'nope' }, name).error, /không còn trên bàn/);
  assert.match(applyMove(g, { type: 'reserveDeck', tier: 9 }, name).error, /đã hết/);
  g.decks[2] = [];
  assert.match(applyMove(g, { type: 'reserveDeck', tier: 2 }, name).error, /đã hết/);
  // No gold left: the card only.
  g.bank.gold = 0;
  const id = g.board[2][1].id;
  assert.doesNotMatch(applyMove(g, { type: 'reserve', cardId: id }, name).lines[0], /vàng/);
  assert.equal(g.board[2][1], null, 'an empty deck leaves a gap');
  g.hands.b.reserved.push({}, {});
  assert.match(applyMove(g, { type: 'reserve', cardId: g.board[1][1].id }, name).error, /tối đa 3/);
});

test('splendor rules: buying from the table and from your reserved cards', () => {
  const g = game();
  const k = card('k', 'blue', { red: 2, white: 1 });
  g.board[1][2] = k;
  const hand = g.hands.a;
  assert.match(applyMove(g, { type: 'buy', cardId: k.id }, name).error, /không đủ/);
  assert.match(applyMove(g, { type: 'buy', cardId: 'nope' }, name).error, /không còn/);
  Object.assign(hand.tokens, { white: 1, red: 2 });
  const r = applyMove(g, { type: 'buy', cardId: k.id }, name);
  assert.match(r.lines[0], /mua thẻ/);
  assert.equal(hand.bonuses[k.bonus], 1);
  assert.equal(hand.cards.length, 1);
  // b reserves a hidden card, then buys it later; it is face up once bought.
  g.hands.b.tokens.gold = 0;
  applyMove(g, { type: 'reserveDeck', tier: 1 }, name);
  applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  const held = g.hands.b.reserved[0];
  held.cost = { black: 1 };
  g.hands.b.tokens.black = 1;
  applyMove(g, { type: 'buy', cardId: held.id }, name);
  assert.equal(g.hands.b.reserved.length, 0);
  assert.equal(g.hands.b.cards[0].hidden, undefined);
  // A card with points says so.
  const pts = card('p', 'red', {}, 2);
  g.board[1][0] = pts;
  assert.match(applyMove(g, { type: 'buy', cardId: 'p' }, name).lines[0], /\+2 điểm/);
});

test('splendor rules: one noble visits by itself; two to choose from', () => {
  const g = game(['a', 'b'], 3);
  g.nobles = [{ ...NOBLES[5] }, { ...NOBLES[6] }, { ...NOBLES[0] }]; // white4 blue4 / blue4 green4 / white3 blue3 green3
  Object.assign(g.hands.a.bonuses, { white: 4, blue: 3 });
  g.board[1][0] = card('k1', 'blue', {});
  let r = applyMove(g, { type: 'buy', cardId: 'k1' }, name);
  assert.match(r.lines.at(-1), /Catherine de Medici đến thăm A/);
  assert.equal(g.hands.a.points, 3);
  // b qualifies for two at once.
  Object.assign(g.hands.b.bonuses, { white: 3, blue: 4, green: 3 });
  g.board[1][0] = card('k2', 'green', {});
  assert.match(applyMove(g, { type: 'noble', nobleId: 'n7' }, name).error, /Không có quý tộc/);
  r = applyMove(g, { type: 'buy', cardId: 'k2' }, name);
  assert.equal(g.step, 'noble');
  assert.deepEqual(g.pending, ['n7', 'n1']);
  assert.deepEqual(eligibleNobles(g, g.hands.b).map(n => n.id), ['n7', 'n1']);
  assert.match(applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name).error, /Chưa đến lúc/);
  assert.match(applyMove(g, { type: 'noble', nobleId: 'n6' }, name).error, /không đến thăm/);
  r = applyMove(g, { type: 'noble', nobleId: 'n1' }, name);
  assert.match(r.lines[0], /Mary Stuart/);
  assert.equal(currentId(g), 'a');
  assert.equal(g.nobles.length, 1);
});

test('splendor rules: over ten gems, give some back', () => {
  const g = game();
  Object.assign(g.hands.a.tokens, { white: 3, blue: 3, black: 3 });
  applyMove(g, { type: 'take', colors: ['red', 'green', 'white'] }, name);
  assert.equal(g.step, 'discard');
  assert.match(applyMove(g, { type: 'take', colors: ['red', 'green', 'white'] }, name).error, /Chưa đến lúc/);
  assert.match(applyMove(g, { type: 'reserveDeck', tier: 1 }, name).error, /Chưa đến lúc/);
  assert.match(applyMove(g, { type: 'buy', cardId: 'x' }, name).error, /Chưa đến lúc/);
  assert.match(applyMove(g, { type: 'pass' }, name).error, /Chưa đến lúc/);
  assert.match(applyMove(g, { type: 'discard', pile: { red: 1 } }, name).error, /đúng 2 viên/);
  assert.match(applyMove(g, { type: 'discard' }, name).error, /đúng 2 viên/);
  assert.match(applyMove(g, { type: 'discard', pile: { gold: 2 } }, name).error, /không có đủ/);
  assert.match(applyMove(g, { type: 'discard', pile: { ruby: 2 } }, name).error, /không có đủ/);
  assert.match(applyMove(g, { type: 'discard', pile: { red: 1.5, blue: 0.5 } }, name).error, /không có đủ/);
  assert.match(applyMove(g, { type: 'discard', pile: { red: -1, blue: 3 } }, name).error, /không có đủ/);
  const r = applyMove(g, { type: 'discard', pile: { red: 1, blue: 1, green: 0 } }, name);
  assert.match(r.lines.at(-1), /trả lại 2 viên/);
  assert.equal(countTokens(g.hands.a.tokens), 10);
  assert.equal(currentId(g), 'b');
  assert.match(applyMove(g, { type: 'discard', pile: {} }, name).error, /không cần trả/);
});

test('splendor rules: no pass while a move exists; a stuck player may pass', () => {
  const g = game();
  assert.match(applyMove(g, { type: 'pass' }, name).error, /còn nước đi/);
  COLORS.forEach(c => { g.bank[c] = 0; });
  g.hands.a.reserved = [{}, {}, {}].map((_, i) => card(`r${i}`, 'red', { black: 9 }));
  g.board = { 1: [null, null, null, null], 2: [null, null, null, null], 3: [null, null, null, null] };
  assert.deepEqual(legalMoves(g), [{ type: 'pass' }]);
  assert.match(applyMove(g, { type: 'pass' }, name).lines[0], /bỏ lượt/);
});

test('splendor rules: the target opens the final round, played out to the first seat', () => {
  const g = game(['a', 'b', 'c']);
  g.hands.b.points = 14;
  applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  g.board[1][0] = card('big', 'red', {}, 1);
  let r = applyMove(g, { type: 'buy', cardId: 'big' }, name);
  assert.match(r.lines.at(-1), /vòng cuối/);
  assert.equal(g.finalRound, true);
  // c ties on points with fewer cards, and wins.
  g.hands.c.points = 15;
  r = applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  assert.equal(r.over, true);
  assert.equal(g.step, 'over');
  assert.deepEqual(g.ranking, ['c', 'b', 'a']);
});

test('splendor rules: a long stretch without a purchase ends the game', () => {
  const g = game();
  g.noBuyStreak = 15;
  const r = applyMove(g, { type: 'take', colors: ['red', 'blue', 'green'] }, name);
  assert.equal(r.over, true);
  assert.equal(g.stalemate, true);
});

// ---------------------------------------------------------------------------
// The computer player (lib/games/splendor.js)
// ---------------------------------------------------------------------------

test('splendor bots: give back the gems wanted least, never gold', () => {
  const g = game();
  Object.assign(g.hands.a.tokens, { white: 4, red: 4, gold: 3 });
  assert.equal(countTokens(discardPick(g, 'a')), 1);
  assert.equal(discardPick(g, 'a').gold, undefined);
});

test('splendor bots: settle a noble choice and a give-back while looking ahead', () => {
  const g = game(['a', 'b'], 5);
  g.nobles = [{ ...NOBLES[5] }, { ...NOBLES[0] }];
  Object.assign(g.hands.a.bonuses, { white: 4, blue: 3, green: 3 });
  Object.assign(g.hands.a.tokens, { red: 4, black: 4, gold: 2 });
  g.board[1][0] = card('k', 'blue', {});
  const move = chooseMove(g, seeded(2));
  assert.equal(move.type, 'buy', 'a free card bringing two nobles is the best move');
  assert.equal(move.card, undefined);
  // A table with nothing wanted at all.
  const empty = game();
  empty.nobles = [];
  empty.board = { 1: [null, null, null, null], 2: [null, null, null, null], 3: [null, null, null, null] };
  assert.ok(chooseMove(empty, seeded(3)));
});

// ---------------------------------------------------------------------------
// In a room (lib/engine.js + lib/games/splendor.js)
// ---------------------------------------------------------------------------

function room(n, { seed = 7, config = {}, bots = 0 } = {}) {
  let now = 1_000_000;
  const rng = seeded(seed);
  const { state: s, player: host } = createRoom({ code: 'SPL01', hostName: 'Chủ', now, rng });
  applyAction(s, host.id, 'selectGame', { gameId: 'splendor' }, now, rng);
  if (n > 1) applyAction(s, host.id, 'addBot', { count: n - 1 }, now, rng);
  s.players.forEach((p, i) => { p.isBot = i > 0 && i <= bots; });
  if (Object.keys(config).length) applyAction(s, host.id, 'gameConfig', config, now, rng);
  const act = (id, type, payload = {}) => applyAction(s, id, type, payload, now, rng);
  const clock = {
    get now() { return now; },
    advance(ms) { now += ms; return tick(s, now, rng); }
  };
  return { s, host, act, clock, rng, start: () => act(host.id, 'start'), view: (id) => viewFor(s, id, now, 1) };
}

test('splendor room: 2–4 players; settings are clamped', () => {
  const one = room(1);
  assert.throws(() => one.start(), /ít nhất 2/);
  const five = room(5);
  assert.throws(() => five.start(), /tối đa 4/);
  const r = room(2, { config: { turnTime: 5, target: 99 } });
  assert.deepEqual(r.s.gameConfigs.splendor, { turnTime: 30, target: 21 });
  assert.throws(() => r.act(r.host.id, 'gameConfig', { target: 'x' }), /không hợp lệ/);
  r.start();
  assert.equal(r.s.phase, 'SPL_TURN');
  assert.equal(r.s.play.target, 21);
  assert.equal(r.s.game.phaseEndsAt - r.s.game.phaseStartedAt, 30_000);
  assert.match(r.s.game.log[0], /Ván Splendor bắt đầu: 2 người, 21 điểm/);
  assert.equal(parseCommand('>createRoom splendor').gameId, 'splendor');
});

test('splendor room: only the player to play moves; the clock restarts each turn', () => {
  const r = room(3);
  r.start();
  const [first, second] = r.s.play.order;
  assert.throws(() => r.act(second, 'take', { colors: ['red', 'blue', 'green'] }), /Chưa đến lượt/);
  assert.throws(() => r.act(first, 'take', { colors: ['red'] }), /3 viên khác màu/);
  assert.throws(() => r.act(first, 'hug'), /không hợp lệ/);
  r.clock.advance(5000);
  r.act(first, 'take', { colors: ['red', 'blue', 'green'] });
  assert.equal(currentId(r.s.play), second);
  assert.equal(r.s.game.phaseStartedAt, r.clock.now);
  assert.equal(r.view(first).play.last.by, first);
  r.act(second, 'reserveDeck', { tier: '2' });
  const third = r.s.play.order[2];
  r.act(third, 'reserve', { cardId: r.s.play.board[1][0].id });
  // Buying, and the pass that is refused.
  assert.throws(() => r.act(first, 'pass'), /còn nước đi/);
  r.s.play.board[1][0] = card('free', 'red', {});
  r.act(first, 'buy', { cardId: 'free' });
  assert.equal(r.s.play.hands[first].cards.length, 1);
  // A seat that is not in the game cannot play.
  r.s.players.find(p => p.id === second).inGame = false;
  assert.throws(() => r.act(second, 'take', { colors: ['red', 'blue', 'green'] }), /đang xem/);
});

test('splendor room: a hidden reserved card stays hidden from the others until the end', () => {
  const r = room(2);
  r.start();
  const [a, b] = r.s.play.order;
  r.act(a, 'reserveDeck', { tier: 1 });
  assert.equal(r.view(a).play.hands[a].reserved[0].hidden, true);
  assert.ok(r.view(a).play.hands[a].reserved[0].id, 'its owner sees it');
  assert.deepEqual(r.view(b).play.hands[a].reserved[0], { hidden: true, tier: 1 });
  assert.equal(r.view(b).play.me.myTurn, true);
  assert.equal(r.view(a).play.me.myTurn, false);
  assert.deepEqual(r.view(b).play.decks, { 1: 35, 2: 26, 3: 16 });
  assert.equal(r.view(b).play.result, null);
});

test('splendor room: when the clock runs out the computer plays; the host may skip', () => {
  const r = room(2);
  r.start();
  const [a, b] = r.s.play.order;
  r.clock.advance(90_000);
  assert.equal(currentId(r.s.play), b);
  assert.ok(r.s.game.log.some(l => l.includes('Hết giờ: máy đi thay')));
  r.act(r.host.id, 'skip');
  r.clock.advance(0);
  assert.equal(currentId(r.s.play), a);
  // Mid-turn: a noble to choose, then gems to give back, all done for them.
  const p = r.s.play;
  p.nobles = [{ ...NOBLES[5] }, { ...NOBLES[0] }];
  Object.assign(p.hands[a].bonuses, { white: 4, blue: 4, green: 2 });
  Object.assign(p.hands[a].tokens, { white: 0, blue: 0, green: 0, red: 4, black: 4, gold: 3 });
  p.board[1][0] = card('g', 'green', {});
  r.act(a, 'buy', { cardId: 'g' });
  assert.equal(p.step, 'noble');
  assert.deepEqual(r.view(a).play.pending, ['n6', 'n1']);
  assert.deepEqual(r.view(b).play.pending, []);
  assert.equal(r.s.game.phaseStartedAt, 1_000_000 + 90_000, 'the same clock while choosing');
  r.clock.advance(90_000);
  assert.equal(currentId(p), b);
  assert.equal(p.hands[a].nobles.length, 1);
  assert.ok(countTokens(p.hands[a].tokens) <= 11);
});

test('splendor room: bots wait a moment, then play their whole turn', () => {
  const r = room(2, { bots: 1 });
  r.start();
  const bot = r.s.players[1].id;
  if (currentId(r.s.play) !== bot) r.act(r.host.id, 'take', { colors: ['red', 'blue', 'green'] });
  assert.equal(r.clock.advance(1000), false, 'too soon');
  assert.equal(r.clock.advance(2000), true);
  assert.equal(currentId(r.s.play), r.host.id);
  assert.equal(r.clock.advance(3000), false, "not the bot's turn");
});

test('splendor room: bots play a whole game; the leaderboard and the bot report it', () => {
  for (const [n, seed] of [[2, 1], [3, 2], [4, 3]]) {
    const r = room(n, { seed, bots: n });
    r.s.players[0].isBot = true;
    r.start();
    for (let i = 0; i < 5000 && r.s.phase !== 'GAME_OVER'; i++) r.clock.advance(3000);
    assert.equal(r.s.phase, 'GAME_OVER');
    const v = r.view(r.host.id).play;
    assert.equal(v.current, null);
    assert.equal(v.me.myTurn, false);
    assert.equal(v.result.ranking.length, n);
    assert.equal(v.result.winnerId, r.s.play.ranking[0]);
    assert.equal(r.s.statsByGame.splendor.games, 1);
    assert.equal(r.s.statsByGame.splendor.sideWins.bot, 1);
    const cards = cardsAtEnd(r.s);
    assert.equal(cards.filter(c => c.teamLabel === 'Thắng').length, 1);
    assert.match(cards[0].role, /^Hạng \d · \d+ điểm$/);
  }
});

test('splendor room: a stalemate ends on points, and a person can win', () => {
  const r = room(2);
  r.start();
  const p = r.s.play;
  const first = p.order[0];
  p.hands[first].points = 4;
  p.noBuyStreak = 15;
  r.act(first, 'take', { colors: ['red', 'blue', 'green'] });
  assert.equal(r.s.phase, 'GAME_OVER');
  const v = r.view(r.host.id).play;
  assert.match(v.result.reason, /bế tắc/);
  assert.equal(r.s.statsByGame.splendor.sideWins.human, 1);
  // At the end, every reserved card is shown.
  assert.equal(v.step, 'over');
});

test('splendor room: a person chooses their noble and gives gems back themselves', () => {
  const r = room(2);
  r.start();
  const a = r.s.play.order[0];
  const p = r.s.play;
  p.nobles = [{ ...NOBLES[5] }, { ...NOBLES[0] }];
  Object.assign(p.hands[a].bonuses, { white: 4, blue: 4, green: 2 });
  Object.assign(p.hands[a].tokens, { red: 4, black: 4, gold: 3 });
  p.board[1][0] = card('g', 'green', {});
  r.act(a, 'buy', { cardId: 'g' });
  r.act(a, 'noble', { nobleId: 'n1' });
  assert.equal(p.step, 'discard');
  r.act(a, 'discard', { pile: { red: 1 } });
  assert.notEqual(currentId(p), a);
  assert.equal(p.hands[a].points, 3);
});
