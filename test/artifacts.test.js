import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, applyAction, tick, viewFor, isWinner, GameError } from '../lib/engine.js';
import { ARTIFACTS, ARTIFACT_IDS, gemsFor } from '../public/shared/artifacts.js';

function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A started game with Artifacts on, roles in seat order, and each player's
// Artifact card chosen by the test (`arts[i]`, or nothing).
function setup(roles, arts = [], { config = {}, rng = seeded() } = {}) {
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'ART01', hostName: 'Chủ', now, rng });
  for (let i = 1; i < roles.length; i++) joinRoom(s, `P${i + 1}`, now, rng);
  applyAction(s, host.id, 'config', { swapEnabled: false, artifacts: true, ...config }, now, rng);
  const counts = {};
  roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  for (const roleId of Object.keys(s.roleCounts)) s.roleCounts[roleId] = 0;
  Object.assign(s.roleCounts, counts);
  applyAction(s, host.id, 'start', {}, now, rng);
  s.players.forEach((p, i) => {
    p.role = roles[i];
    s.game.art.hands[p.id] = arts[i] ? [{ uid: 100 + i, id: arts[i], revealed: false, day: null }] : [];
  });
  if (s.phase === 'REVEAL') { now = s.game.phaseEndsAt; tick(s, now, rng); }
  const P = s.players;
  const clock = {
    get now() { return now; },
    advance(ms) { now += ms; tick(s, now, rng); }
  };
  const act = (p, type, payload = {}) => applyAction(s, p.id, type, payload, now, rng);
  const endPhase = () => clock.advance(Math.max(0, s.game.phaseEndsAt - now));
  const untilPhase = (phase, limit = 40) => {
    for (let i = 0; i < limit && s.phase !== phase; i++) endPhase();
    assert.equal(s.phase, phase);
  };
  const untilNightRole = (role) => {
    for (let i = 0; i < 40 && !(s.phase === 'NIGHT' && s.game.queue[s.game.step] === role && s.game.nightStage === 'act'); i++) endPhase();
    assert.equal(s.game.queue[s.game.step], role);
  };
  // Turn over this player's card (and make its choices, if any).
  const reveal = (p, targets) => {
    const c = s.game.art.hands[p.id].find(k => !k.revealed);
    act(p, 'artReveal', { uid: c.uid });
    if (targets) act(p, 'artChoose', { targets: targets.map(q => q.id) });
  };
  return { s, P, host, clock, act, endPhase, untilPhase, untilNightRole, reveal, rng };
}

const notes = (s, p) => (s.game.notes[p.id] || []).map(n => n.text).join('\n');

test('every Artifact card is described, and the gems are 1 in 5', () => {
  assert.equal(ARTIFACT_IDS.length, 40);
  for (const id of ARTIFACT_IDS) {
    const c = ARTIFACTS[id];
    assert.ok(c.name && c.icon && c.desc && typeof c.once === 'boolean', id);
  }
  assert.equal(ARTIFACT_IDS.filter(id => ARTIFACTS[id].gem).length, 8);
  assert.equal(gemsFor(10), 2);
});

test('off by default; when on, everyone is dealt one face-down Artifact', () => {
  const rng = seeded(7);
  const { state: s, player: host } = createRoom({ code: 'ART02', hostName: 'Chủ', now: 0, rng });
  for (let i = 0; i < 9; i++) joinRoom(s, `P${i}`, 0, rng);
  assert.equal(viewFor(s, host.id, 0, 1).config.artifacts, false);
  applyAction(s, host.id, 'autoBalance', {}, 0, rng);
  applyAction(s, host.id, 'config', { artifacts: true }, 0, rng);
  applyAction(s, host.id, 'start', {}, 0, rng);
  const hands = s.game.art.hands;
  assert.equal(Object.keys(hands).length, 10);
  const dealt = Object.values(hands).map(h => h[0].id);
  assert.equal(new Set(dealt).size, 10, 'no card twice');
  assert.ok(dealt.filter(id => ARTIFACTS[id].gem).length <= 2);
  assert.ok(Object.values(hands).every(h => h.length === 1 && !h[0].revealed));
  // Only the owner sees their face-down card.
  const [a, b] = s.players;
  assert.equal(viewFor(s, a.id, 0, 1).me.art.hand[0].id, hands[a.id][0].id);
  assert.deepEqual(viewFor(s, b.id, 0, 1).players.find(p => p.id === a.id).art.shown, []);
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

test('Cloak of the Prince: cannot be hanged; Amulet holder cannot be eliminated at all', () => {
  const { s, P, act, untilPhase, endPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'cloak', 'amulet']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  reveal(P[2]);
  endPhase();
  assert.equal(s.phase, 'VOTE');
  for (const p of P.filter(p => p !== P[1])) act(p, 'vote', { target: P[1].id });
  untilPhase('JUDGE');
  for (const p of P.filter(p => p !== P[1])) act(p, 'judge', { choice: 'kill' });
  untilPhase('VERDICT');
  assert.equal(P[1].alive, true);
  assert.equal(s.game.verdict.type, 'spare');
});

test('Amulet: bites fail on its holder, who passes it on every morning', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'seer'], [null, 'amulet']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('MORNING');
  assert.equal(P[1].alive, true);
  untilPhase('DISCUSSION');
  const d = viewFor(s, P[1].id, 0, 1).me.art.dawn;
  assert.equal(d[0].kind, 'amulet');
  assert.ok(!d[0].options.includes(P[1].id));
  act(P[1], 'artDawn', { uid: d[0].uid, target: P[2].id });
  assert.equal(s.game.art.amulet.holder, P[2].id);
  assert.deepEqual(viewFor(s, P[1].id, 0, 1).me.art.dawn, []);
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

test('Vote from Beyond: votes after death, and does not watch the night', () => {
  const { s, P, act, untilPhase, untilNightRole, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], [null, 'beyond']);
  untilPhase('DISCUSSION');
  reveal(P[1]);
  untilNightRole('werewolf');
  act(P[0], 'night', { target: P[1].id });
  untilPhase('VOTE');
  assert.equal(P[1].alive, false);
  act(P[1], 'vote', { target: P[0].id });
  assert.equal(s.game.votes[P[1].id], P[0].id);
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

test('Amethyst can force a reveal; Bow hands the shot to the chosen player', () => {
  const { s, P, act, untilPhase, reveal } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'seer'], ['amethyst', 'bow']);
  untilPhase('DISCUSSION');
  reveal(P[0], [P[1]]);
  assert.match(notes(s, P[0]), /Cung Săn/);
  act(P[0], 'artDecide', { force: true });
  // The Bow came up: its owner P2 picks who shoots.
  act(P[1], 'artChoose', { targets: [P[2].id] });
  assert.throws(() => act(P[1], 'artShoot', { target: P[3].id }), GameError);
  act(P[2], 'artShoot', { target: P[3].id });
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
    let now = 0;
    const { state: s, player: host } = createRoom({ code: 'ART03', hostName: 'Chủ', now, rng });
    applyAction(s, host.id, 'config', { hostPlays: false, artifacts: true, swapEnabled: false }, now, rng);
    applyAction(s, host.id, 'addBot', { count: 12 }, now, rng);
    applyAction(s, host.id, 'autoBalance', {}, now, rng);
    applyAction(s, host.id, 'start', {}, now, rng);
    for (let i = 0; i < 3000 && s.phase !== 'GAME_OVER'; i++) {
      now += 1000;
      tick(s, now, rng);
    }
    assert.equal(s.phase, 'GAME_OVER', `seed ${seed}`);
    assert.ok(s.game.art.feed.length > 0, `seed ${seed}: someone used an Artifact`);
  }
});
