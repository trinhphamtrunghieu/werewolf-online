// The games other than Ma Sói (which is lib/engine.js itself). Each module
// runs its own phases on s.play; the room code in lib/engine.js handles the
// players, the host, the clock and the leaderboard, and hands it the rest.
//
// A module provides:
//   id, minPlayers, defaults            settings the host can change
//   configure(conf, payload, api)       apply the host's settings
//   start(s, now, rng, api)             deal and open the first phase
//   action(s, player, type, payload, now, rng, api)
//   skip(s, now)                        the host's "skip"
//   onTimeout(s, now, rng, api)         the phase clock ran out
//   bots(s, now, rng, api) -> bool      computer players act
//   view(s, me) -> object               what this player may see (view.play)
import { spyfall } from './spyfall.js';

export const GAMES = { spyfall };
