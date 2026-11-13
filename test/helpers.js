// Shared by the Artifact tests: a seeded random source and a started game.
import assert from 'node:assert/strict';
import { createRoom, joinRoom, applyAction, tick } from '../lib/engine.js';

export function seeded(seed = 42) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A started game with Artifacts on, roles in seat order, and each player's
// Artifact card chosen by the test (`arts[i]`, or nothing).
export function setup(roles, arts = [], { config = {}, rng = seeded() } = {}) {
  let now = 1_000_000;
  const { state: s, player: host } = createRoom({ code: 'ART01', hostName: 'Chủ', now, rng });
  for (let i = 1; i < roles.length; i++) joinRoom(s, `P${i + 1}`, now, rng);
  applyAction(s, host.id, 'config', { swapEnabled: false, artifacts: true, ...config }, now, rng);
  const counts = {};
  roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  for (const roleId of Object.keys(s.roleCounts)) s.roleCounts[roleId] = 0;
  Object.assign(s.roleCounts, counts);
  applyAction(s, host.id, 'start', {}, now, rng);
  // The test deals the Artifacts itself.
  s.players.forEach((p, i) => {
    p.role = roles[i];
    if (s.game.art) s.game.art.hands[p.id] = arts[i] ? [{ uid: 100 + i, id: arts[i], revealed: false, day: null }] : [];
  });
  for (let i = 0; i < 5 && s.phase !== 'NIGHT'; i++) { now = s.game.phaseEndsAt; tick(s, now, rng); }
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

export const notes = (s, p) => (s.game.notes[p.id] || []).map(n => n.text).join('\n');
