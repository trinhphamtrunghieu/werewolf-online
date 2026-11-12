import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, applyAction, tick, viewFor, isWinner, GameError } from '../lib/engine.js';
import { ARTIFACTS, ARTIFACT_IDS, gemsFor } from '../public/shared/artifacts.js';
import { seeded, setup, notes } from './helpers.js';


test('every Artifact card is described, and the gems are 1 in 5', () => {
  assert.equal(ARTIFACT_IDS.length, 43);
  assert.equal(ARTIFACT_IDS.filter(id => ARTIFACTS[id].homebrew).length, 5);
  for (const id of ARTIFACT_IDS) {
    const c = ARTIFACTS[id];
    assert.ok(c.name && c.icon && c.desc && typeof c.once === 'boolean', id);
  }
  assert.equal(ARTIFACT_IDS.filter(id => ARTIFACTS[id].gem).length, 8);
  assert.equal(gemsFor(10), 2);
});

test('off by default; when on, everyone is dealt two Artifacts and keeps one', () => {
  const rng = seeded(7);
  let now = 0;
  const { state: s, player: host } = createRoom({ code: 'ART02', hostName: 'Chủ', now, rng });
  for (let i = 0; i < 9; i++) joinRoom(s, `P${i}`, now, rng);
  assert.equal(viewFor(s, host.id, now, 1).config.artifacts, false);
  applyAction(s, host.id, 'autoBalance', {}, now, rng);
  applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  assert.equal(s.phase, 'ARTPICK');
  const [a, b] = s.players;
  const offer = viewFor(s, a.id, now, 1).me.art.draft;
  assert.equal(offer.length, 2);
  assert.equal(viewFor(s, b.id, now, 1).me.art.draft.length, 2);
  const deckBefore = s.game.art.deck.length;
  applyAction(s, a.id, 'artKeep', { index: 1 }, now, rng);
  assert.deepEqual(s.game.art.hands[a.id].map(c => c.id), [offer[1]]);
  assert.equal(s.game.art.deck.length, deckBefore + 1, 'the other card goes back');
  assert.throws(() => applyAction(s, a.id, 'artKeep', { index: 0 }, now, rng), GameError);
  // Time runs out: the rest keep one at random.
  now = s.game.phaseEndsAt;
  tick(s, now, rng);
  assert.equal(s.phase, 'REVEAL');
  const hands = s.game.art.hands;
  assert.ok(Object.values(hands).every(h => h.length === 1 && !h[0].revealed));
  assert.equal(new Set(Object.values(hands).map(h => h[0].id)).size, 10, 'no card twice');
  // Only the owner sees their face-down card.
  assert.equal(viewFor(s, a.id, now, 1).me.art.hand[0].id, hands[a.id][0].id);
  assert.deepEqual(viewFor(s, b.id, now, 1).players.find(p => p.id === a.id).art.shown, []);
});

test('the deck keeps guards out without 2 ways of killing at night, and few role readers with seers', () => {
  const build = (roles, seed) => {
    const rng = seeded(seed);
    const { state: s, player: host } = createRoom({ code: 'ART04', hostName: 'Chủ', now: 0, rng });
    for (let i = 1; i < roles.length; i++) joinRoom(s, `P${i}`, 0, rng);
    applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false }, 0, rng);
    for (const k of Object.keys(s.roleCounts)) s.roleCounts[k] = 0;
    roles.forEach(r => { s.roleCounts[r] = (s.roleCounts[r] || 0) + 1; });
    applyAction(s, host.id, 'start', {}, 0, rng);
    const a = s.game.art;
    return [...Object.values(a.draft).flat(), ...Object.values(a.hands).flat().map(c => c.id), ...a.deck];
  };
  const plain = ['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager', 'villager'];
  const armed = ['werewolf', 'werewolf', 'witch', 'hunter', 'villager', 'villager', 'villager', 'villager'];
  for (let seed = 1; seed <= 20; seed++) {
    const cards = build(plain, seed);
    const guards = cards.filter(id => ARTIFACTS[id].guard);
    const kills = cards.filter(id => ['vial', 'silverbow', 'breath'].includes(id)).length;
    if (kills < 2) assert.deepEqual(guards, [], `seed ${seed}: no guards with ${kills} night kill`);
    assert.ok(cards.filter(id => ARTIFACTS[id].info).length <= 1, `seed ${seed}: one role reader at most with a Seer`);
  }
  assert.ok([1, 2, 3, 4, 5].some(seed => build(armed, seed).some(id => ARTIFACTS[id].guard)), 'guards with Witch + Hunter');
  // Homebrew off: none of those cards.
  const rng = seeded(3);
  const { state: s, player: host } = createRoom({ code: 'ART05', hostName: 'Chủ', now: 0, rng });
  for (let i = 1; i < 8; i++) joinRoom(s, `P${i}`, 0, rng);
  applyAction(s, host.id, 'config', { artifacts: true, artifactsHomebrew: false, swapEnabled: false }, 0, rng);
  applyAction(s, host.id, 'autoBalance', {}, 0, rng);
  applyAction(s, host.id, 'start', {}, 0, rng);
  const all = [...Object.values(s.game.art.draft).flat(), ...s.game.art.deck];
  assert.ok(all.every(id => !ARTIFACTS[id].homebrew));
});

test('Artifacts are turned over only during the discussion, one at a time, and are public', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], ['void', 'mark']);
  const uid = s.game.art.hands[P[0].id][0].uid;
  assert.throws(() => act(P[0], 'artReveal', { uid }), GameError);
  untilPhase('DISCUSSION');
  reveal(P[0]);
  assert.ok(s.game.art.hands[P[0].id][0].revealed);
  assert.deepEqual(viewFor(s, P[3].id, 0, 1).players[0].art.shown, ['void']);
  assert.match(s.game.art.feed.at(-1).text, /Hư Không/);
  // Not twice.
  assert.throws(() => act(P[0], 'artReveal', { uid }), GameError);
});

test('Spear of Fury eliminates at once and shows the owner\'s card', () => {
  const { s, P, untilPhase, reveal, host } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'spear']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[4]]);
  assert.equal(P[4].alive, false);
  assert.equal(P[1].revealed, true);
  assert.equal(viewFor(s, P[2].id, 0, 1).players[1].role, 'villager');
});

test('the Spear can end the game, and waiting choices block other reveals', () => {
  const { s, P, act, untilPhase } = setup(['werewolf', 'villager', 'villager', 'seer'], ['spear', 'void']);
  untilPhase('DISCUSSION');
  act(P[0], 'artReveal', { uid: s.game.art.hands[P[0].id][0].uid });
  assert.throws(() => act(P[1], 'artReveal', { uid: s.game.art.hands[P[1].id][0].uid }), /chờ/);
  act(P[0], 'artChoose', { targets: [P[3].id] });
  // 1 wolf, 2 others left: not over yet. One more goes and the pack wins.
  assert.equal(s.phase, 'DISCUSSION');
});

test('Orb of Speculation: right ends the game for the village, wrong eliminates its owner', () => {
  const right = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer'], [null, null, 'orb']);
  right.untilPhase('DISCUSSION');
  right.reveal(right.P[2], [right.P[0], right.P[1]]);
  assert.equal(right.s.phase, 'GAME_OVER');
  assert.equal(right.s.game.winner, 'village');

  const wrong = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer'], [null, null, 'orb']);
  wrong.untilPhase('DISCUSSION');
  wrong.reveal(wrong.P[2], [wrong.P[0], wrong.P[3]]);
  assert.equal(wrong.P[2].alive, false);
});

test('Cloak of the Prince: can never be eliminated by day', () => {
  const { s, P, act, untilPhase, endPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['cloak']);
  const hang = (who) => {
    untilPhase('VOTE');
    for (const p of P.filter(p => p !== who && p.alive)) act(p, 'vote', { target: who.id });
    untilPhase('JUDGE');
    for (const p of P.filter(p => p !== who && p.alive && !s.game.judge[p.id])) act(p, 'judge', { choice: 'kill' });
    for (let i = 0; i < 5 && !['VERDICT', 'GAME_OVER'].includes(s.phase); i++) endPhase();
  };
  untilPhase('DISCUSSION');
  reveal(P[0]);
  hang(P[0]);
  assert.equal(P[0].alive, true);
  assert.equal(s.game.verdict.type, 'spare');
  untilPhase('NIGHT');
  untilPhase('DISCUSSION');
  hang(P[0]);
  assert.equal(P[0].alive, true, 'still saved the second time');
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).players[0].art.shown, ['cloak']);
});

test('Sword of Justice cuts through every Artifact protection', () => {
  const { s, P, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['cloak', 'sword']);
  untilPhase('DISCUSSION');
  reveal(P[0]);
  s.game.art.hands[P[0].id].push({ uid: 999, id: 'scepter', revealed: false, day: null });
  reveal(P[1], [P[0]]);
  assert.equal(P[0].alive, false);
  assert.ok(s.game.art.hands[P[0].id].length === 0 || s.game.art.hands[P[0].id].every(c => c.id !== 'scepter' || !c.revealed));
});

test('Vial of Poison kills tonight past the Guard; Silver Bow only kills a wolf', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'werewolf', 'guard', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, null, null, 'vial', 'silverbow']);
  untilPhase('DISCUSSION');
  reveal(P[3], [P[5]]);
  reveal(P[4], [P[0]]);
  untilNightRole('guard');
  act(P[2], 'night', { target: P[5].id });
  untilPhase('MORNING');
  assert.equal(P[5].alive, false, 'poisoned through the Guard');
  assert.equal(P[0].alive, false, 'the silver arrow found a wolf');
  const miss = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'silverbow']);
  miss.untilPhase('DISCUSSION');
  miss.reveal(miss.P[1], [miss.P[2]]);
  miss.untilNightRole('werewolf');
  miss.act(miss.P[0], 'night', { noKill: true });
  miss.untilPhase('MORNING');
  assert.equal(miss.P[2].alive, true);
});

test('Gloves of the Thief steal a face-up card; Mirror of Negation destroys one', () => {
  const { s, P, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['cloak', 'gloves', 'mark', 'mirror']);
  untilPhase('DISCUSSION');
  reveal(P[0]);
  reveal(P[2]);
  reveal(P[1], [P[0]]);
  assert.ok(s.game.art.hands[P[1].id].some(c => c.id === 'cloak' && c.revealed));
  assert.ok(!s.game.art.hands[P[0].id].some(c => c.id === 'cloak'));
  const deck = s.game.art.deck.length;
  reveal(P[3], [P[2]]);
  assert.ok(!Object.values(s.game.art.hands).flat().some(c => c.id === 'mark'));
  assert.equal(s.game.art.deck.length, deck, 'destroyed, not back in the deck');
});

test('Amulet: bites fail on its holder, who passes it on every morning', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'amulet']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('MORNING');
  assert.equal(P[1].alive, true, 'the bite fails');
  untilPhase('DISCUSSION');
  const d = viewFor(s, P[1].id, 0, 1).me.art.dawn;
  assert.equal(d[0].kind, 'amulet');
  assert.ok(!d[0].options.includes(P[1].id));
  act(P[1], 'artDawn', { uid: d[0].uid, target: P[2].id });
  assert.equal(s.game.art.amulet.holder, P[2].id);
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).me.art.dawn, []);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('MORNING');
  assert.equal(P[1].alive, false, 'no longer holding it');
});

test('the Amulet is passed at random if its holder forgets', () => {
  const { s, P, untilPhase, endPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'amulet']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilPhase('MORNING');
  untilPhase('DISCUSSION');
  endPhase();
  assert.notEqual(s.game.art.amulet.holder, P[1].id);
});

test('Brand of the Villager: a wolf without power no longer wakes; the Seer keeps seeing cards', () => {
  const { s, P, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'brand']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[0]]);
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[0].id, 0, 1).me.task, null);
  untilPhase('MORNING');
  assert.ok(P.every(p => p.alive), 'nobody bitten');
});

test('Flask of Dreams: the power comes back at dawn on the third day', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['flask']);
  untilPhase('DISCUSSION');
  const day = s.game.day;
  reveal(P[0], [P[5]]);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilNightRole('seer');
  assert.equal(viewFor(s, P[5].id, 0, 1).me.task, null, 'tonight: no power');
  untilPhase('DISCUSSION');
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilNightRole('seer');
  assert.equal(viewFor(s, P[5].id, 0, 1).me.task, null, 'tomorrow night: no power');
  untilPhase('MORNING');
  assert.equal(s.game.day, day + 2);
  untilPhase('DISCUSSION');
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilNightRole('seer');
  assert.equal(viewFor(s, P[5].id, 0, 1).me.task.role, 'seer', 'back');
});

test('Claw of the Werewolf: joins the pack, wakes with it and wins with it', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager'], [null, 'claw']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  assert.equal(viewFor(s, P[1].id, 0, 1).me.task.role, 'werewolf');
  // The pack knows the clawed seer as a wolf, not their card.
  assert.equal(viewFor(s, P[0].id, 0, 1).players[1].role, null);
  act(P[0], 'night', { target: P[2].id });
  act(P[1], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, false);
  P[3].alive = false;
  untilPhase('GAME_OVER');
  assert.equal(s.game.winner, 'werewolf');
  assert.ok(isWinner(s, P[1]));
});

test('Skimmer of the Cursed: bitten, turns into a wolf instead of dying', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'skimmer']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('MORNING');
  assert.equal(P[1].alive, true);
  assert.equal(P[1].clawed, true);
  assert.equal(s.game.lastNightDeaths.length, 0);
});

test('Scepter of Rebirth keeps its owner in the game when hanged; Rod gives a non-wolf a new role', () => {
  const { s, P, act, untilPhase, untilNightRole } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'scepter', 'rod']);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  assert.equal(P[2].alive, true);
  assert.ok(s.game.art.hands[P[2].id][0].revealed);
  assert.match(notes(s, P[2]), /vai mới/);
  untilPhase('VOTE');
  for (const p of P.filter(p => p !== P[1])) act(p, 'vote', { target: P[1].id });
  untilPhase('JUDGE');
  // (The Rod's new role may be one whose verdict is fixed.)
  for (const p of P.filter(p => p !== P[1] && !s.game.judge[p.id])) act(p, 'judge', { choice: 'kill' });
  untilPhase('VERDICT');
  assert.equal(P[1].alive, true);
});

test('Prism of Power: the pack may only bite one of the three', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'prism']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[2], P[3], P[4]]);
  untilNightRole('werewolf');
  assert.throws(() => act(P[0], 'night', { target: P[5].id }), /Lăng Kính/);
  act(P[0], 'night', { target: P[3].id });
  untilPhase('MORNING');
  assert.equal(P[3].alive, false);
});

test('Cap of Idiocy and Wreath of Peace fix the verdict; Mark of the Mayor counts twice', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer', 'villager'], [null, 'cap', 'wreath', 'mark']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  reveal(P[2]);
  reveal(P[3]);
  untilPhase('VOTE');
  act(P[3], 'vote', { target: P[0].id });
  act(P[0], 'vote', { target: P[4].id });
  untilPhase('DEFENSE');
  assert.equal(s.game.defendant, P[0].id, 'the Mark\'s two votes win');
  untilPhase('JUDGE');
  assert.equal(s.game.judge[P[1].id], 'kill');
  assert.equal(s.game.judge[P[2].id], 'spare');
  assert.throws(() => act(P[2], 'judge', { choice: 'kill' }), /cố định/);
});

test('Cudgel and Heart: chosen each morning from the day after the reveal', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'cudgel', 'heart']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  reveal(P[2]);
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).me.art.dawn, [], 'not on the day of the reveal');
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilPhase('DISCUSSION');
  const cud = viewFor(s, P[1].id, 0, 1).me.art.dawn[0];
  act(P[1], 'artDawn', { uid: cud.uid, target: P[3].id });
  const heart = viewFor(s, P[2].id, 0, 1).me.art.dawn[0];
  act(P[2], 'artDawn', { uid: heart.uid, target: P[4].id });
  untilPhase('VOTE');
  assert.throws(() => act(P[0], 'vote', { target: P[3].id }), /không có mặt/);
  assert.throws(() => act(P[4], 'vote', { target: P[0].id }), /không được bỏ phiếu/);
  assert.deepEqual(s.game.art.picked[cud.uid], [P[3].id]);
});

test('Shield of the Bodyguard protects its pick that night', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'shield']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilPhase('DISCUSSION');
  const d = viewFor(s, P[1].id, 0, 1).me.art.dawn[0];
  act(P[1], 'artDawn', { uid: d.uid, target: P[3].id });
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[3].id });
  untilPhase('MORNING');
  assert.equal(P[3].alive, true);
});

test('Ring of Truth and Staff of the Seer tell only their owner', () => {
  const { s, P, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'ring', 'staff']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[0]]);
  assert.match(notes(s, P[1]), /LÀ Sói/);
  reveal(P[2], [P[4]]);
  assert.equal(viewFor(s, P[2].id, 0, 1).players[4].role, 'seer');
  assert.equal(viewFor(s, P[3].id, 0, 1).players[4].role, null);
});

test('Ruby of Kismet makes two players reveal, in order; Emerald takes a card', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], ['ruby', 'void', 'emerald', 'mark']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1], P[2]]);
  assert.ok(s.game.art.hands[P[1].id][0].revealed);
  // The Emerald came up through the Ruby: P3 now chooses for it.
  act(P[2], 'artChoose', { targets: [P[3].id] });
  const mine = s.game.art.hands[P[2].id].map(c => c.id);
  assert.ok(mine.includes('mark'));
  assert.equal(s.game.art.hands[P[3].id].length, 1, 'got a new card');
  assert.notEqual(s.game.art.hands[P[3].id][0].id, 'mark');
});

test('Amethyst can force a reveal, which then resolves for its owner', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['amethyst', 'spear']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1]]);
  assert.match(notes(s, P[0]), /Giáo Cuồng Nộ/);
  act(P[0], 'artDecide', { force: true });
  // The Spear came up: its owner P2 picks, not the Amethyst's.
  assert.throws(() => act(P[0], 'artChoose', { targets: [P[3].id] }), GameError);
  act(P[1], 'artChoose', { targets: [P[3].id] });
  assert.equal(P[3].alive, false);
});

test('choices still waiting when the vote starts are made at random', () => {
  const { s, P, untilPhase, endPhase, act } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'spear']);
  untilPhase('DISCUSSION');
  act(P[1], 'artReveal', { uid: s.game.art.hands[P[1].id][0].uid });
  endPhase();
  assert.equal(s.game.art.queue.length, 0);
  assert.equal(P.filter(p => !p.alive).length, 1);
});

test('a reveal leaves at least 20 s of discussion', () => {
  const { s, P, clock, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'void']);
  untilPhase('DISCUSSION');
  clock.advance(s.game.phaseEndsAt - clock.now - 1000);
  reveal(P[1]);
  assert.ok(s.game.phaseEndsAt - clock.now >= 20000);
});

test('Talisman of Trouble: two hangings today', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, null, 'talisman']);
  untilPhase('DISCUSSION');
  reveal(P[2]);
  untilPhase('VOTE');
  for (const p of P.filter(p => p !== P[7])) act(p, 'vote', { target: P[7].id });
  untilPhase('JUDGE');
  for (const p of P.filter(p => p !== P[7])) act(p, 'judge', { choice: 'kill' });
  untilPhase('VERDICT');
  assert.equal(s.game.secondVote, true);
});

test('Breath of the Old Man: the target dies on the night after the next day', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'breath']);
  untilPhase('DISCUSSION');
  reveal(P[1], [P[3]]);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilPhase('MORNING');
  assert.equal(P[3].alive, true);
  untilNightRole('werewolf');
  act(P[0], 'night', { noKill: true });
  untilPhase('MORNING');
  assert.equal(P[3].alive, false);
});

test('bots with Artifacts play a whole game without getting stuck', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const { state: s, player: host } = createRoom({ code: 'ART03', hostName: 'Chủ', now, rng });
    applyAction(s, host.id, 'config', { hostPlays: false, artifacts: true, swapEnabled: false }, now, rng);
    applyAction(s, host.id, 'addBot', { count: 12 }, now, rng);
    applyAction(s, host.id, 'autoBalance', {}, now, rng);
    applyAction(s, host.id, 'start', {}, now, rng);
    for (let i = 0; i < 12000 && s.phase !== 'GAME_OVER'; i++) {
      now += 1000;
      tick(s, now, rng);
    }
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
    assert.ok(s.game.art.feed.length > 0, `seed ${seed}: someone used an Artifact`);
  }
});

test('every phone is told which card was turned over and by whom, so it can show what it does', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'mark', 'scepter']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  const feed = viewFor(s, P[3].id, 0, 1).game.art.feed;
  assert.deepEqual(feed.at(-1), { day: s.game.day, text: `${P[1].name} lật 🎖️ Dấu Ấn Trưởng Làng.`, card: 'mark', by: P[1].id });
  // A card turned over by itself on death is announced the same way.
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[2].id });
  untilPhase('MORNING');
  const last = viewFor(s, P[3].id, 0, 1).game.art.feed.filter(f => f.card).at(-1);
  assert.deepEqual([last.card, last.by], ['scepter', P[2].id]);
  // Lines that only report a result carry no card.
  assert.ok(s.game.art.feed.every(f => f.card === undefined || f.by));
});

test('the host may let only some players keep an Artifact; everyone still picks', () => {
  const start = (count, seed = 3) => {
    const rng = seeded(seed);
    const { state: s, player: host } = createRoom({ code: 'ART06', hostName: 'Chủ', now: 0, rng });
    for (let i = 1; i < 8; i++) joinRoom(s, `P${i}`, 0, rng);
    applyAction(s, host.id, 'autoBalance', {}, 0, rng);
    applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false, artifactPlayers: count }, 0, rng);
    applyAction(s, host.id, 'start', {}, 0, rng);
    return { s, host };
  };
  const { s } = start(3);
  // Everyone is offered two cards: the same screen for all.
  assert.equal(Object.keys(s.game.art.draft).length, 8);
  assert.equal(s.game.art.dealt.length, 3);
  const keeper = s.players.find(p => s.game.art.dealt.includes(p.id));
  const left = s.players.find(p => !s.game.art.dealt.includes(p.id));
  const v = viewFor(s, left.id, 0, 1).me.art;
  assert.deepEqual([v.dealt, v.hand, v.draft.length], [false, [], 2]);
  assert.equal(viewFor(s, keeper.id, 0, 1).me.art.draft.length, 2);
  // The keeper holds the card; the other one learns, alone, that theirs is set aside.
  const deck = s.game.art.deck.length;
  applyAction(s, keeper.id, 'artKeep', { index: 0 }, 0);
  assert.equal(s.game.art.hands[keeper.id].length, 1);
  const want = s.game.art.draft[left.id][1];
  applyAction(s, left.id, 'artKeep', { index: 1 }, 0);
  assert.deepEqual(s.game.art.hands[left.id], []);
  assert.equal(s.game.art.stash[left.id], want);
  assert.equal(s.game.art.deck.length, deck + 2);
  assert.match(notes(s, left), /không nằm trong số đó/);
  assert.doesNotMatch(notes(s, keeper), /không nằm trong số đó/);
  // Different players each game.
  const picks = new Set([3, 4, 5, 6].map(seed => [...start(3, seed).s.game.art.dealt].sort().join()));
  assert.ok(picks.size > 1);
  // 0, or as many as there are players: everyone.
  assert.equal(start(0).s.game.art.dealt.length, 8);
  assert.equal(start(8).s.game.art.dealt.length, 8);
  // Settings: kept between 0 and the room size, and must be a number.
  const { state: r, player: h } = createRoom({ code: 'ART07', hostName: 'Chủ', now: 0 });
  applyAction(r, h.id, 'config', { artifactPlayers: 99 }, 0);
  assert.equal(r.config.artifactPlayers, 18);
  applyAction(r, h.id, 'config', { artifactPlayers: -2 }, 0);
  assert.equal(r.config.artifactPlayers, 0);
  assert.throws(() => applyAction(r, h.id, 'config', { artifactPlayers: 'nhiều' }, 0), GameError);
});

test('a choice that comes a moment too late still counts until the night falls; the host cannot cut the choosing short', () => {
  const rng = seeded(9);
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'ART08', hostName: 'Chủ', now, rng });
  for (let i = 1; i < 6; i++) joinRoom(s, `P${i}`, now, rng);
  applyAction(s, host.id, 'autoBalance', {}, now, rng);
  applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false }, now, rng);
  applyAction(s, host.id, 'start', {}, now, rng);
  const [, lan, minh, an] = s.players;
  const offer = [...s.game.art.draft[lan.id]];
  applyAction(s, an.id, 'artKeep', { index: 0 }, now, rng);
  // The host's skip does nothing while people are still choosing.
  applyAction(s, host.id, 'skip', {}, now, rng);
  tick(s, now, rng);
  assert.equal(s.phase, 'ARTPICK');
  // Time runs out: a card is picked for Lan (and Minh).
  now = s.game.phaseEndsAt;
  tick(s, now, rng);
  assert.equal(s.phase, 'REVEAL');
  const deck = s.game.art.deck.length;
  const ap = viewFor(s, lan.id, now, 1).me.art.autoPicked;
  assert.deepEqual(ap.opts, offer);
  assert.ok(offer.includes(ap.kept));
  assert.match(notes(s, lan), /quản trò chọn giúp/);
  // Lan's tap for the other card arrives now: she gets it, the picked one goes back.
  const want = offer.find(id => id !== ap.kept);
  applyAction(s, lan.id, 'artKeep', { index: offer.indexOf(want) }, now, rng);
  assert.deepEqual(s.game.art.hands[lan.id].map(c => c.id), [want]);
  assert.ok(s.game.art.deck.includes(ap.kept) && !s.game.art.deck.includes(want));
  assert.equal(s.game.art.deck.length, deck);
  assert.equal(viewFor(s, lan.id, now, 1).me.art.autoPicked, null);
  assert.throws(() => applyAction(s, lan.id, 'artKeep', { index: 0 }, now, rng), /hết lúc/);
  // Minh keeps the one picked for him: nothing changes.
  const mine = s.game.art.hands[minh.id][0].id;
  const mo = s.game.art.autoPicked[minh.id].opts;
  assert.throws(() => applyAction(s, minh.id, 'artKeep', { index: 5 }, now, rng), /không hợp lệ/);
  applyAction(s, minh.id, 'artKeep', { index: mo.indexOf(mine) }, now, rng);
  assert.deepEqual(s.game.art.hands[minh.id].map(c => c.id), [mine]);
  // An, who chose in time, cannot change; nobody can once the night has come.
  assert.throws(() => applyAction(s, an.id, 'artKeep', { index: 1 }, now, rng), /hết lúc/);
  now = s.game.phaseEndsAt;
  tick(s, now, rng);
  assert.equal(s.phase, 'NIGHT');
  assert.throws(() => applyAction(s, an.id, 'artKeep', { index: 1 }, now, rng), /hết lúc/);
});

// Lovers from different sides always hold an Artifact, even when the host
// deals the cards to only some of the players.
test('cross-side lovers get an Artifact when Cupid pairs them; same-side lovers do not', () => {
  const roles = ['werewolf', 'cupid', 'villager', 'villager', 'villager', 'seer'];
  const cross = setup(roles, ['mark']);
  const { s, P, act, untilNightRole } = cross;
  s.game.art.dealt = [P[0].id];
  untilNightRole('cupid');
  act(P[1], 'night', { target: P[0].id });
  act(P[1], 'night', { target: P[2].id });
  untilNightRole('werewolf');
  // The wolf already had a card: nothing more. The villager gets one, once.
  assert.equal(s.game.art.hands[P[0].id].length, 1);
  assert.equal(s.game.art.hands[P[2].id].length, 1);
  assert.ok(s.game.art.dealt.includes(P[2].id));
  assert.equal(viewFor(s, P[2].id, 0, 1).me.art.dealt, true);
  assert.match(notes(s, P[2]), /người yêu khác phe/);
  // A card they lose is not replaced.
  s.game.art.hands[P[2].id] = [];
  act(P[0], 'night', { noKill: true });
  cross.untilPhase('MORNING');
  assert.equal(s.game.art.hands[P[2].id].length, 0);

  const same = setup(roles);
  same.s.game.art.dealt = [];
  same.untilNightRole('cupid');
  same.act(same.P[1], 'night', { target: same.P[2].id });
  same.act(same.P[1], 'night', { target: same.P[3].id });
  same.untilNightRole('werewolf');
  assert.equal(same.s.game.art.hands[same.P[2].id].length, 0);
  // Given once, at the start: a lover who changes side later (here a wolf's
  // claw) gets nothing.
  same.P[2].clawed = true;
  same.act(same.P[0], 'night', { noKill: true });
  same.untilPhase('MORNING');
  assert.equal(same.s.game.art.hands[same.P[2].id].length, 0);
  assert.equal(same.s.game.art.hands[same.P[3].id].length, 0);
});

test('a lover not drawn to keep a card gets back the one they picked; the rest go back to the deck at dawn', () => {
  const rng = seeded(11);
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'ART09', hostName: 'Chủ', now, rng });
  for (let i = 1; i < 6; i++) joinRoom(s, `P${i}`, now, rng);
  applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false, artifactPlayers: 1, autoLovers: false }, now, rng);
  for (const r of Object.keys(s.roleCounts)) s.roleCounts[r] = 0;
  Object.assign(s.roleCounts, { werewolf: 1, cupid: 1, villager: 3, seer: 1 });
  applyAction(s, host.id, 'start', {}, now, rng);
  const P = s.players;
  const roles = ['werewolf', 'cupid', 'villager', 'villager', 'villager', 'seer'];
  P.forEach((p, i) => { p.role = roles[i]; });
  const a = s.game.art;
  a.dealt = [P[5].id];
  // Everyone picks the first card, but P1 lets the time run out.
  const picked = Object.fromEntries(P.map(p => [p.id, a.draft[p.id]]));
  P.slice(1).forEach(p => applyAction(s, p.id, 'artKeep', { index: 0 }, now, rng));
  now = s.game.phaseEndsAt; tick(s, now, rng);
  assert.equal(s.phase, 'REVEAL');
  // Picked for P1 at random, set aside: P1 sees the same screen as a keeper
  // and may still swap (the swap stays set aside).
  const ap = viewFor(s, P[0].id, now, 1).me.art.autoPicked;
  assert.equal(ap.kept, a.stash[P[0].id]);
  const other = ap.opts.find(id => id !== ap.kept);
  applyAction(s, P[0].id, 'artKeep', { index: ap.opts.indexOf(other) }, now, rng);
  assert.equal(a.stash[P[0].id], other);
  assert.deepEqual(a.hands[P[0].id], []);
  // A swap back to the card already held changes nothing.
  a.autoPicked[P[0].id] = { opts: ap.opts, uid: null };
  applyAction(s, P[0].id, 'artKeep', { index: ap.opts.indexOf(other) }, now, rng);
  assert.equal(a.stash[P[0].id], other);
  // Cupid pairs the wolf P1 with the villager P3: both get their own picks back.
  for (let i = 0; i < 40 && !(s.phase === 'NIGHT' && s.game.queue[s.game.step] === 'cupid' && s.game.nightStage === 'act'); i++) {
    now = s.game.phaseEndsAt; tick(s, now, rng);
  }
  applyAction(s, P[1].id, 'night', { target: P[0].id }, now, rng);
  applyAction(s, P[1].id, 'night', { target: P[2].id }, now, rng);
  for (let i = 0; i < 40 && s.game.queue[s.game.step] === 'cupid'; i++) { now = s.game.phaseEndsAt; tick(s, now, rng); }
  assert.deepEqual(a.hands[P[0].id].map(c => c.id), [other]);
  assert.deepEqual(a.hands[P[2].id].map(c => c.id), [picked[P[2].id][0]]);
  assert.equal(a.stash[P[0].id], undefined);
  // The cards set aside for the others go back to the deck at dawn.
  const setAside = Object.values(a.stash);
  assert.equal(setAside.length, 3);
  for (let i = 0; i < 80 && s.phase !== 'MORNING'; i++) { now = s.game.phaseEndsAt; tick(s, now, rng); }
  assert.deepEqual(a.stash, {});
  setAside.forEach(id => assert.ok(a.deck.includes(id)));
});

test('a lover with no card set aside is armed from the deck, or from any card', () => {
  const roles = ['werewolf', 'cupid', 'villager', 'villager', 'villager', 'seer'];
  const { s, P, act, untilNightRole } = setup(roles);
  s.game.art.dealt = [];
  s.game.art.deck = [];
  untilNightRole('cupid');
  act(P[1], 'night', { target: P[0].id });
  act(P[1], 'night', { target: P[2].id });
  untilNightRole('werewolf');
  for (const p of [P[0], P[2]]) assert.equal(ARTIFACTS[s.game.art.hands[p.id][0].id].gem, undefined);
});

test('without homebrew cards, a lover armed from an empty deck gets no homebrew card', () => {
  const roles = ['werewolf', 'cupid', 'villager', 'villager', 'villager', 'seer'];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { s, P, act, untilNightRole } = setup(roles, [], { config: { artifactsHomebrew: false }, rng: seeded(seed) });
    s.game.art.dealt = [];
    s.game.art.deck = [];
    untilNightRole('cupid');
    act(P[1], 'night', { target: P[0].id });
    act(P[1], 'night', { target: P[2].id });
    untilNightRole('werewolf');
    for (const p of [P[0], P[2]]) {
      const [c] = s.game.art.hands[p.id];
      assert.ok(c && !ARTIFACTS[c.id].homebrew && !ARTIFACTS[c.id].gem);
    }
  }
});

test('a lover paired by the game whose card was picked at random may still swap it', () => {
  let tried = 0;
  for (let seed = 1; seed < 60 && !tried; seed++) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const { state: s, player: host } = createRoom({ code: 'ART10', hostName: 'Chủ', now, rng });
    for (let i = 1; i < 6; i++) joinRoom(s, `P${i}`, now, rng);
    applyAction(s, host.id, 'config', { artifacts: true, swapEnabled: false, artifactPlayers: 1, autoLovers: true }, now, rng);
    for (const r of Object.keys(s.roleCounts)) s.roleCounts[r] = 0;
    Object.assign(s.roleCounts, { werewolf: 1, villager: 4, seer: 1 });
    applyAction(s, host.id, 'start', {}, now, rng);
    const a = s.game.art;
    const dealt = [...a.dealt];
    now = s.game.phaseEndsAt; tick(s, now, rng);
    // Nobody picked: every card was picked at random. A lover from the other
    // side who was not drawn to keep one now holds theirs.
    const lover = s.game.lovers.find(id => !dealt.includes(id) && a.dealt.includes(id));
    if (!lover) continue;
    tried += 1;
    const ap = viewFor(s, lover, now, 1).me.art.autoPicked;
    assert.equal(a.hands[lover][0].id, ap.kept);
    const other = ap.opts.find(id => id !== ap.kept);
    applyAction(s, lover, 'artKeep', { index: ap.opts.indexOf(other) }, now, rng);
    assert.deepEqual(a.hands[lover].map(c => c.id), [other]);
  }
  assert.equal(tried, 1);
});
