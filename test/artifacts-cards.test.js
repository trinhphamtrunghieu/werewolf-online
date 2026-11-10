// Every Artifact card, its corner cases, and what each player is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, viewFor, GameError, createRoom } from '../lib/engine.js';
import { makeArtifacts } from '../lib/artifacts.js';
import { setup, notes, seeded } from './helpers.js';

const fails = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));
const cards = (s, p) => s.game.art.hands[p.id].map(c => c.id);
const feedText = (s) => s.game.art.feed.map(f => f.text).join('\n');
const V5 = ['werewolf', 'villager', 'villager', 'villager', 'seer'];
const V6 = ['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'];

test('Artifact moves are refused when off, out of turn, or not allowed', () => {
  // A game without Artifacts.
  const plain = setup(V5, [], { config: { artifacts: false } });
  plain.untilPhase('DISCUSSION');
  fails(() => plain.act(plain.P[1], 'artReveal', { uid: 1 }), /không dùng Artifact/);

  const { s, P, act, untilPhase, reveal } = setup(V6, ['spear', 'amethyst', 'void', 'void']);
  fails(() => act(P[0], 'artKeep', { index: 0 }), /hết lúc chọn/);
  untilPhase('DISCUSSION');
  fails(() => act(P[0], 'artDance'), /không hợp lệ/);
  fails(() => act(P[0], 'artReveal', { uid: 999 }), /không hợp lệ/);
  fails(() => act(P[0], 'artChoose', { targets: [] }), /Chưa đến lượt/);
  fails(() => act(P[0], 'artDecide', {}), /Chưa đến lượt/);
  fails(() => act(P[0], 'artLetter', {}), /Chưa đến lượt/);
  fails(() => act(P[0], 'artDawn', { uid: 100, target: P[1].id }), /Không có lựa chọn/);
  act(P[0], 'artReveal', { uid: 100 });
  fails(() => act(P[0], 'artChoose', {}), /đúng 1 người/);
  fails(() => act(P[0], 'artChoose', { targets: [P[1].id, P[2].id] }), /đúng 1 người/);
  fails(() => act(P[0], 'artChoose', { targets: [P[0].id] }), /không chọn được/);
  fails(() => act(P[1], 'artChoose', { targets: [P[2].id] }), /Chưa đến lượt/);
  act(P[0], 'artChoose', { targets: [P[3].id] });
  // The dead may not turn their card over, nor choose at dawn.
  fails(() => act(P[3], 'artReveal', { uid: 103 }), /đã bị loại|không hợp lệ/);
  fails(() => act(P[3], 'artDawn', { uid: 103, target: P[1].id }), /đã bị loại/);
  // Amethyst: the viewed card stays down if not forced.
  reveal(P[1], [P[2]]);
  fails(() => act(P[0], 'artDecide', { force: true }), /Chưa đến lượt/);
  act(P[1], 'artDecide', { force: false });
  assert.match(feedText(s), /không bắt/);
  assert.ok(!s.game.art.hands[P[2].id][0].revealed);
  // Not at night.
  untilPhase('NIGHT');
  fails(() => act(P[2], 'artReveal', { uid: 102 }), /thảo luận ban ngày/);
});

test('a dead player gives the Sheet of the Ghost its letter; the letter must be one letter', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(V6, [null, 'sheet']);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[3].id });
  untilPhase('DISCUSSION');
  reveal(P[1], [P[3]]);
  const v = viewFor(s, P[3].id, 0, 1);
  assert.deepEqual(v.me.art.pending, { type: 'letter', by: P[1].id });
  assert.deepEqual(viewFor(s, P[4].id, 0, 1).game.art.waiting, { type: 'letter', owner: P[3].id, id: null, by: P[1].id });
  fails(() => act(P[3], 'artLetter', { letter: 'AB' }), /chữ cái/);
  fails(() => act(P[3], 'artLetter', {}), /chữ cái/);
  act(P[3], 'artLetter', { letter: 'đ' });
  assert.match(feedText(s), /chữ "Đ"/);
});

test('cards that read people: Cauldron, Mist, Ring, Staff and Pendant', () => {
  const { s, P, untilPhase, reveal } = setup(['werewolf', 'villager', 'seer', 'villager', 'villager', 'villager', 'villager'],
    ['cauldron', 'cauldron', 'mist', 'mist', 'ring', 'pendant']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1]]);
  reveal(P[1], [P[2]]);
  assert.match(feedText(s), /LÀ Dân Làng thường[\s\S]*KHÔNG phải Dân Làng thường/);
  reveal(P[2], [P[1]]);
  reveal(P[3], [P[2]]);
  assert.match(feedText(s), /KHÔNG có vai đặc biệt[\s\S]*CÓ vai đặc biệt/);
  reveal(P[4], [P[1]]);
  assert.match(notes(s, P[4]), /không phải Sói/);
  reveal(P[5], [P[6]]);
  assert.match(notes(s, P[6]), /cho bạn xem lá vai trò/);
  assert.equal(viewFor(s, P[6].id, 0, 1).players[5].role, 'villager');
});

test('Diary of the Insomniac: told whether a neighbour woke last night', () => {
  const awake = setup(['villager', 'werewolf', 'villager', 'villager', 'villager', 'seer'], ['diary']);
  awake.untilNightRole('werewolf');
  awake.act(awake.P[1], 'night', { noKill: true });
  awake.untilPhase('DISCUSSION');
  awake.reveal(awake.P[0]);
  assert.match(notes(awake.s, awake.P[0]), /CÓ người ngồi cạnh/);
  const asleep = setup(['villager', 'villager', 'werewolf', 'villager', 'villager', 'villager'], [null, null, null, 'diary']);
  asleep.untilNightRole('werewolf');
  asleep.act(asleep.P[2], 'night', { noKill: true });
  asleep.untilPhase('DISCUSSION');
  asleep.reveal(asleep.P[3]);
  assert.match(notes(asleep.s, asleep.P[3]), /CÓ người ngồi cạnh/);
});

test('Diary: no neighbour awake', () => {
  const g = setup(['villager', 'villager', 'villager', 'werewolf', 'villager', 'villager'], ['diary']);
  g.untilNightRole('werewolf');
  g.act(g.P[3], 'night', { noKill: true });
  g.untilPhase('DISCUSSION');
  g.reveal(g.P[0]);
  assert.match(notes(g.s, g.P[0]), /KHÔNG có người ngồi cạnh/);
});

test('Blood of the Diseased: the pack eats the infected and goes hungry the next night', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(V6, [null, 'blood']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[2]]);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, false);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[3].id });
  untilPhase('MORNING');
  assert.equal(P[3].alive, true, 'sick: nobody dies');
  void s;
});

test('Onyx destroys a face-down card; Citrine swaps for a new card shown at once', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['onyx', 'void', 'citrine']);
  untilPhase('DISCUSSION');
  const deck = s.game.art.deck.length;
  reveal(P[0], [P[1]]);
  assert.deepEqual(cards(s, P[1]), []);
  assert.equal(s.game.art.deck.length, deck, 'out of the game, not back in the deck');
  s.game.art.deck = ['mark'];
  reveal(P[2]);
  assert.deepEqual(cards(s, P[2]), ['mark']);
  assert.ok(s.game.art.hands[P[2].id][0].revealed);
  // An empty deck: the Citrine has nothing to give.
  const h = setup(V6, ['citrine']);
  h.untilPhase('DISCUSSION');
  h.s.game.art.deck = [];
  h.reveal(h.P[0]);
  assert.match(feedText(h.s), /hết bài để đổi/);
});

test('Amber of Dawn: whoever used a one-time card gets a new one', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['amber', 'staff', 'mark']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[2]]);
  reveal(P[2]);
  s.game.art.deck = ['void', 'cap'];
  reveal(P[0]);
  assert.equal(cards(s, P[0]).length, 1);
  assert.equal(cards(s, P[1]).length, 1);
  assert.ok(!s.game.art.hands[P[1].id][0].revealed);
  assert.deepEqual(cards(s, P[2]), ['mark'], 'an "∞" card stays');
  // With an empty deck, the cards handed back are drawn again.
  const h = setup(V6, ['amber']);
  h.untilPhase('DISCUSSION');
  h.s.game.art.deck = [];
  h.reveal(h.P[0]);
  assert.deepEqual(cards(h.s, h.P[0]), ['amber']);
});

test('Diamond of Denial takes a face-up card back; with none to take it does nothing', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['diamond', 'shield', 'diamond']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  s.game.art.shield = { id: P[3].id, day: s.game.day, uid: 101 };
  reveal(P[0], [P[1]]);
  assert.deepEqual(cards(s, P[1]), []);
  assert.equal(s.game.art.shield, null);
  assert.ok(s.game.art.deck.includes('shield'));
  reveal(P[2]);
  assert.match(feedText(s), /không đủ người để chọn/);
});

test('Gloves take the Amulet and the Shield along; the Mirror ends a Shield', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['gloves', 'amulet', 'shield', 'mirror']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  reveal(P[0], [P[1]]);
  assert.equal(s.game.art.amulet.holder, P[0].id);
  assert.ok(s.game.art.amulet.had.includes(P[0].id));
  // Stolen twice: no double entry in who has held it.
  const h = setup(V6, ['gloves', 'amulet']);
  h.untilPhase('DISCUSSION');
  h.reveal(h.P[1]);
  h.s.game.art.amulet.had.push(h.P[0].id);
  h.reveal(h.P[0], [h.P[1]]);
  assert.equal(h.s.game.art.amulet.had.filter(id => id === h.P[0].id).length, 1);
  // Gloves on a Shield in use, Mirror on a Shield in use.
  const k = setup(V6, ['gloves', 'shield', 'shield', 'mirror']);
  k.untilPhase('DISCUSSION');
  k.reveal(k.P[1]);
  k.reveal(k.P[2]);
  k.s.game.art.shield = { id: k.P[4].id, day: k.s.game.day, uid: 101 };
  k.reveal(k.P[0], [k.P[1]]);
  assert.equal(k.s.game.art.shield, null);
  k.s.game.art.shield = { id: k.P[4].id, day: k.s.game.day, uid: 102 };
  k.reveal(k.P[3], [k.P[2]]);
  assert.equal(k.s.game.art.shield, null);
  void s;
});

test('Stone of Alteration: a wolf gets a wolf card; Rod of Reincarnation leaves a wolf powerless', () => {
  const g = setup(['wolf_cub', 'villager', 'villager', 'villager', 'villager', 'seer'], ['stone', 'stone']);
  g.untilPhase('DISCUSSION');
  g.reveal(g.P[0]);
  assert.equal(g.P[0].role, 'werewolf');
  g.reveal(g.P[1]);
  assert.match(notes(g.s, g.P[1]), /đã đổi lá vai trò/);
  // A role whose night step was not called yet joins the night.
  g.s.game.rolesInPlay = g.s.game.rolesInPlay.filter(r => r !== 'old_hag');

  const r = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['rod']);
  r.untilPhase('VOTE');
  r.P.filter(p => p !== r.P[0]).forEach(p => r.act(p, 'vote', { target: r.P[0].id }));
  r.untilPhase('JUDGE');
  r.P.filter(p => p !== r.P[0] && !r.s.game.judge[p.id]).forEach(p => r.act(p, 'judge', { choice: 'kill' }));
  r.untilPhase('VERDICT');
  assert.equal(r.P[0].alive, true);
  assert.match(notes(r.s, r.P[0]), /mất chức năng Sói/);
  r.untilNightRole('werewolf');
  assert.ok(!viewFor(r.s, r.P[0].id, 0, 1).me.task, 'no longer wakes');
});

test('a Rod or Stone role with a night step is called from then on', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = setup(['villager', 'werewolf', 'villager', 'villager', 'villager', 'seer'], ['stone'], { rng: seeded(seed) });
    g.untilPhase('DISCUSSION');
    g.reveal(g.P[0]);
    if (['aura_seer', 'spellcaster', 'old_hag'].includes(g.P[0].role)) {
      assert.ok(g.s.game.rolesInPlay.includes(g.P[0].role));
      return;
    }
  }
  assert.fail('no seed gave a role with a night step');
});

test('Rod or Scepter turned over too early does nothing', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['rod', 'scepter']);
  untilPhase('DISCUSSION');
  reveal(P[0]);
  reveal(P[1]);
  assert.match(feedText(s), /không có tác dụng/);
});

test('Sapphire of Fate: the viewer uses the card too, after its owner', () => {
  const { s, P, untilPhase, reveal, act } = setup(V6, ['sapphire', 'staff']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1]]);
  assert.match(notes(s, P[0]), /Gậy Tiên Tri/);
  reveal(P[1], [P[2]]);
  // Now the Sapphire's owner chooses for their copy of the Staff.
  assert.equal(viewFor(s, P[0].id, 0, 1).me.art.pending.id, 'staff');
  act(P[0], 'artChoose', { targets: [P[3].id] });
  assert.match(feedText(s), /nhờ Lam Ngọc Số Phận/);
  assert.ok(s.game.art.hands[P[0].id].some(c => c.copy));
  // A Sapphire owner who died before the reveal gets nothing.
  const h = setup(V6, ['sapphire', 'void']);
  h.untilPhase('DISCUSSION');
  h.reveal(h.P[0], [h.P[1]]);
  h.P[0].alive = false;
  h.reveal(h.P[1]);
  assert.equal(h.s.game.art.hands[h.P[0].id].filter(c => c.copy).length, 0);
});

test('Ruby: a card taken by the Emerald before its turn is not turned over twice', () => {
  const { s, P, untilPhase, reveal, act } = setup(V6, ['ruby', 'emerald', 'mark']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1], P[2]]);
  act(P[1], 'artChoose', { targets: [P[2].id] });
  assert.ok(cards(s, P[1]).includes('mark'));
  assert.equal(s.game.art.queue.length, 0);
});

test('a reveal waiting on a card that is gone (or already face up) is dropped', () => {
  const { s, P, untilPhase, endPhase } = setup(V6, ['void', 'void']);
  untilPhase('DISCUSSION');
  s.game.art.hands[P[1].id][0].revealed = true;
  s.game.art.queue = [{ type: 'reveal', owner: P[1].id, uid: 101 }, { type: 'choose', owner: P[2].id, uid: 5, id: 'staff' }];
  P[2].alive = false;
  // The vote settles what is waiting: both are dropped without effect.
  endPhase();
  assert.equal(s.game.art.queue.length, 0);
  assert.equal(s.phase, 'VOTE');
});

test('when the vote starts, waiting choices are made at random (or lapse)', () => {
  const pick = (cardId, extra = {}) => {
    const g = setup(V6, [cardId, 'void', ...(extra.more || [])]);
    g.untilPhase('DISCUSSION');
    return g;
  };
  // A decision is "no"; a letter never comes; a choice with nobody left lapses.
  const a = pick('amethyst');
  a.reveal(a.P[0], [a.P[1]]);
  a.endPhase();
  assert.match(feedText(a.s), /không bắt/);
  const b = setup(V6, [null, 'sheet']);
  b.untilNightRole('werewolf');
  b.act(b.P[0], 'night', { target: b.P[3].id });
  b.untilPhase('DISCUSSION');
  b.reveal(b.P[1], [b.P[3]]);
  b.endPhase();
  assert.match(feedText(b.s), /không có chữ nào/);
  const c = pick('diamond', { more: ['mark'] });
  c.reveal(c.P[2]);
  c.act(c.P[0], 'artReveal', { uid: 100 });
  c.s.game.art.hands[c.P[2].id] = [];
  c.endPhase();
  assert.match(feedText(c.s), /không đủ người để chọn/);
  // A Pendant chosen at random.
  const d = pick('pendant');
  d.act(d.P[0], 'artReveal', { uid: 100 });
  d.endPhase();
  assert.match(feedText(d.s), /hết giờ, chọn ngẫu nhiên/);
});

test('the Sword on a blessed player: the blessing still holds', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['sword']);
  untilPhase('DISCUSSION');
  s.game.blessed = P[1].id;
  reveal(P[0], [P[1]]);
  assert.equal(P[1].alive, true);
  assert.match(feedText(s), /không bị loại/);
});

test('the Vial target lynched by day dies only once; the shots are public by day', () => {
  const { s, P, act, untilPhase, reveal } = setup(V6, ['vial']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[2]]);
  assert.deepEqual(viewFor(s, P[3].id, 0, 1).game.art.shots, [{ id: P[2].id, kind: 'vial' }]);
  untilPhase('VOTE');
  P.filter(p => p !== P[2]).forEach(p => act(p, 'vote', { target: P[2].id }));
  untilPhase('JUDGE');
  P.filter(p => p !== P[2] && !s.game.judge[p.id]).forEach(p => act(p, 'judge', { choice: 'kill' }));
  untilPhase('NIGHT');
  assert.deepEqual(viewFor(s, P[3].id, 0, 1).game.art.shots, []);
  untilPhase('MORNING');
  assert.ok(!s.game.lastNightDeaths.includes(P[2].id));
});

test('dawn choices: wrong target, the Shield shown for the day, and the Amulet in the morning', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(V6, [null, 'shield', 'amulet']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  reveal(P[2]);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilPhase('MORNING');
  const d = viewFor(s, P[1].id, 0, 1).me.art.dawn[0];
  fails(() => act(P[1], 'artDawn', { uid: d.uid, target: P[1].id }), /Không chọn được/);
  act(P[1], 'artDawn', { uid: d.uid, target: P[3].id });
  assert.equal(viewFor(s, P[4].id, 0, 1).game.art.shield, P[3].id);
  const am = viewFor(s, P[2].id, 0, 1).me.art.dawn[0];
  act(P[2], 'artDawn', { uid: am.uid, target: P[4].id });
  assert.equal(s.game.art.amulet.holder, P[4].id);
});

test('bots: draft picks, waiting choices, decisions, letters, and refused moves', () => {
  // A bot owner of each kind of waiting item.
  const g = setup(V6, ['amethyst', 'void', 'staff']);
  g.untilPhase('DISCUSSION');
  g.P[0].isBot = true;
  g.P[2].isBot = true;
  g.act(g.P[0], 'artReveal', { uid: 100 });
  g.clock.advance(3000);
  assert.equal(g.s.game.art.queue.length, 0);

  const b = setup(V6, ['sheet']);
  b.untilNightRole('werewolf');
  b.act(b.P[0], 'night', { target: b.P[3].id });
  b.untilPhase('DISCUSSION');
  b.P[3].isBot = true;
  b.reveal(b.P[0], [b.P[3]]);
  b.clock.advance(3000);
  assert.match(feedText(b.s), /cho P1 chữ|cho Chủ chữ/);

  // A move the rules refuse: skipped. A real bug: thrown.
  const A = makeArtifacts({ GameError, fail: (m) => { throw new GameError(m); }, findPlayer: (st, id) => st.players.find(p => p.id === id) });
  const s = { phase: 'DISCUSSION', game: { day: 1, art: { queue: [], draft: {}, hands: {}, botDay: 1 } }, players: [{ id: 'b', isBot: true, inGame: true, alive: true }] };
  s.game.art.queue = [{ type: 'decide', owner: 'b' }];
  assert.equal(A.bots(s, () => 0.1, () => { throw new GameError('no'); }), false);
  assert.throws(() => A.bots(s, () => 0.1, () => { throw new TypeError('bug'); }), TypeError);
  // A bot move that ends the game stops the others.
  s.phase = 'GAME_OVER';
  assert.equal(A.bots(s, () => 0.1, () => {}), false);
});

test('views: the draft, the waiting choice for its owner, and nothing for a bystander', () => {
  const rng = seeded(4);
  const { state: s, player: host } = createRoom({ code: 'VIEW1', hostName: 'Chủ', now: 0, rng });
  applyAction(s, host.id, 'addBot', { count: 5 }, 0, rng);
  s.players.forEach(p => { p.isBot = false; });
  applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false, hostPlays: false }, 0, rng);
  applyAction(s, host.id, 'autoBalance', {}, 0, rng);
  applyAction(s, host.id, 'start', {}, 0, rng);
  assert.equal(s.phase, 'ARTPICK');
  assert.equal(viewFor(s, host.id, 0, 1).me.art, null, 'the narrator has no Artifact');
  assert.equal(viewFor(s, host.id, 0, 1).game.art.drafting, 5);
  const p = s.players[1];
  fails(() => applyAction(s, p.id, 'artKeep', { index: 5 }, 0, rng), /không hợp lệ/);
  applyAction(s, p.id, 'artKeep', { index: 0 }, 0, rng);
  assert.equal(viewFor(s, p.id, 0, 1).me.art.draft, null);
  // Everyone chose: on to the reveal straight away (once the narrator is done).
  const before = s.game.phaseEndsAt;
  s.players.slice(2).forEach(q => applyAction(s, q.id, 'artKeep', { index: 1 }, 0, rng));
  assert.ok(s.game.phaseEndsAt < before);

  const g = setup(['villager', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['orb', 'spear', 'ruby', 'void', 'void']);
  g.untilPhase('DISCUSSION');
  g.act(g.P[0], 'artReveal', { uid: 100 });
  const mine = viewFor(g.s, g.P[0].id, 0, 1).me.art.pending;
  assert.deepEqual([mine.type, mine.n, mine.ordered], ['choose', 2, false]);
  assert.equal(viewFor(g.s, g.P[1].id, 0, 1).me.art.pending, null);
  g.act(g.P[0], 'artChoose', { targets: [g.P[3].id, g.P[4].id] });
  g.act(g.P[2], 'artReveal', { uid: 102 });
  assert.equal(viewFor(g.s, g.P[2].id, 0, 1).me.art.pending.ordered, true);
  g.act(g.P[2], 'artChoose', { targets: [g.P[3].id, g.P[4].id] });
  // A decision for the Amethyst shows the viewed card to its owner only.
  const a = setup(V6, ['amethyst', 'mark']);
  a.untilPhase('DISCUSSION');
  a.reveal(a.P[0], [a.P[1]]);
  assert.deepEqual(viewFor(a.s, a.P[0].id, 0, 1).me.art.pending, { type: 'decide', target: a.P[1].id, seen: 'mark' });
  assert.equal(viewFor(a.s, a.P[2].id, 0, 1).game.art.waiting.by, null);
  // At night: no "today" news.
  a.act(a.P[0], 'artDecide', { force: true });
  a.untilPhase('NIGHT');
  assert.deepEqual(viewFor(a.s, a.P[2].id, 0, 1).game.art.away, []);
});

test('a bot Orb that finds both wolves ends the game, and the other bots stop', () => {
  for (let seed = 1; seed < 60; seed++) {
    const g = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'],
      [null, null, 'orb', 'void', 'void', 'void'], { rng: seeded(seed) });
    g.untilPhase('DISCUSSION');
    g.P.forEach(p => { p.isBot = true; });
    g.s.game.art.botDay = g.s.game.day;
    g.act(g.P[2], 'artReveal', { uid: 102 });
    for (let i = 0; i < 5 && g.s.phase === 'DISCUSSION'; i++) g.clock.advance(3000);
    if (g.s.phase === 'GAME_OVER' && g.s.game.winner === 'village') return;
  }
  assert.fail('no seed where the bot Orb guessed right');
});

test('a big table may be short of cards: some get a single Artifact, kept without choosing', () => {
  const rng = seeded(2);
  const { state: s, player: host } = createRoom({ code: 'BIG01', hostName: 'Chủ', now: 0, rng });
  applyAction(s, host.id, 'addBot', { count: 17 }, 0, rng);
  applyAction(s, host.id, 'config', { artifacts: true, artifactsHomebrew: false, swapEnabled: false }, 0, rng);
  for (const k of Object.keys(s.roleCounts)) s.roleCounts[k] = 0;
  Object.assign(s.roleCounts, { werewolf: 4, villager: 13, seer: 1 });
  applyAction(s, host.id, 'start', {}, 0, rng);
  const kept = Object.values(s.game.art.hands).filter(h => h.length === 1).length;
  assert.ok(kept > 0, 'single cards are kept at once');
  assert.equal(kept + Object.keys(s.game.art.draft).length, 18);
});

test('Emerald with an empty deck leaves its victim without a card; Diamond can take the Amulet', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['emerald', 'mark', 'diamond', 'amulet']);
  untilPhase('DISCUSSION');
  s.game.art.deck = [];
  reveal(P[0], [P[1]]);
  assert.deepEqual(cards(s, P[1]), []);
  reveal(P[3]);
  reveal(P[2], [P[3]]);
  assert.equal(s.game.art.amulet, null);
});

test('a card watched with the Sapphire that leaves its owner is no longer watched', () => {
  const { s, P, untilPhase, reveal } = setup(V6, ['sapphire', 'void', 'spear']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1]]);
  assert.equal(s.game.art.fate.length, 1);
  reveal(P[2], [P[1]]);
  assert.equal(P[1].alive, false);
  assert.equal(s.game.art.fate.length, 0);
});
