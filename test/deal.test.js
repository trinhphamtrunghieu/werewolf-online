// Dealing a new game: nobody holds a card of the same kind as last game when
// it can be avoided, whatever happened to their card during that game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../lib/engine.js';
import { PACK_ROLES } from '../public/shared/roles.js';
import { setup, seeded } from './helpers.js';

const isWolfCard = (role) => PACK_ROLES.includes(role);
const wolf = (roles, seed) => setup(roles, [], { rng: seeded(seed), config: { artifacts: false } });
const newGame = (g) => {
  applyAction(g.s, g.host.id, 'endGame', {}, g.clock.now, g.rng);
  applyAction(g.s, g.host.id, 'start', {}, g.clock.now, g.rng);
};

test('a wolf last game is not dealt any wolf card next game (Werewolf, Wolf Cub, Avenger…)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = wolf(['werewolf', 'wolf_cub', 'seer', 'guard', 'villager', 'villager', 'villager', 'villager'], seed);
    const wolves = g.P.filter(p => isWolfCard(p.role));
    newGame(g);
    wolves.forEach(p => assert.ok(!isWolfCard(p.role), `seed ${seed}: ${p.name} is a wolf again (${p.role})`));
  }
});

test('a card that changed during the game counts too: Thief, Cursed, Drunk, Doppelgänger', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = wolf(['villager', 'cursed', 'drunk', 'doppelganger', 'werewolf', 'villager', 'villager', 'villager', 'villager'], seed);
    const [thief, cursed, drunk, dop] = g.P;
    thief.dealtRole = 'thief';
    thief.role = 'werewolf'; // took a wolf card from the spares
    cursed.role = 'werewolf'; // bitten
    drunk.drunkRole = 'werewolf'; // really a wolf all along
    dop.dealtRole = 'doppelganger';
    dop.role = 'seer'; // copied the Seer
    newGame(g);
    [thief, cursed, drunk].forEach(p => assert.ok(!isWolfCard(p.role), `seed ${seed}: ${p.name} is a wolf again`));
    assert.notEqual(dop.role, 'seer');
    assert.notEqual(dop.role, 'doppelganger');
  }
});

test('joining the pack through an Artifact counts as having been a wolf', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = setup(['villager', 'werewolf', 'villager', 'villager', 'villager', 'seer'], ['claw'], { rng: seeded(seed) });
    g.untilPhase('DISCUSSION');
    g.reveal(g.P[0]);
    newGame(g);
    assert.ok(!isWolfCard(g.P[0].role), `seed ${seed}`);
  }
});

test('a table where a repeat cannot be avoided gives back a Villager card, not a wolf one', () => {
  // 4 players, 3 Villager cards: someone must be a Villager twice in a row.
  for (let seed = 1; seed <= 30; seed++) {
    const g = wolf(['werewolf', 'villager', 'villager', 'villager'], seed);
    const lastWolf = g.P.find(p => isWolfCard(p.role));
    newGame(g);
    assert.ok(!isWolfCard(lastWolf.role), `seed ${seed}`);
  }
});

test('someone who sat out a game (the narrator) keeps what they held before', () => {
  const g = wolf(['werewolf', 'villager', 'villager', 'villager', 'seer'], 3);
  const host = g.P[0];
  applyAction(g.s, host.id, 'endGame', {}, g.clock.now, g.rng);
  assert.ok(host.lastFamilies.includes('wolf'));
  applyAction(g.s, host.id, 'config', { hostPlays: false }, g.clock.now, g.rng);
  applyAction(g.s, host.id, 'start', {}, g.clock.now, g.rng);
  assert.equal(host.inGame, false);
  applyAction(g.s, host.id, 'endGame', {}, g.clock.now, g.rng);
  assert.ok(host.lastFamilies.includes('wolf'), 'not forgotten while narrating');
});
