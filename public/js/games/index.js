// The browser side of the games other than Ma Sói, by game id. Each gives:
//   rules (html), lobby(h), title(view), subtitle(view, h), stage(h), card(h),
//   click(act, el, h) -> handled?, handHint, sides (leaderboard tabs).
import { spyfallUI } from './spyfall.js';
import { undercoverUI } from './undercover.js';
import { avalonUI } from './avalon.js';

export const GAME_UI = { spyfall: spyfallUI, undercover: undercoverUI, avalon: avalonUI };
