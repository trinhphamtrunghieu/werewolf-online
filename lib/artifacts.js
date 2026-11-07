// Ultimate Werewolf: Artifacts. Every player gets one face-down Artifact card
// on top of their role; during the day's discussion they may turn it over and
// use its power. The cards themselves live in public/shared/artifacts.js.
//
// All the state is in s.game.art (null when the option is off):
//   deck     card ids left to draw
//   hands    player id -> [{ uid, id, revealed, day, copy }]
//   queue    what is being resolved, one item at a time (see processQueue)
//   feed     public news: reveals and their public results
//   ...and the lasting effects of revealed cards (amulet, shield, prism...)
//
// The engine hands over its helpers in `x` (makeArtifacts below), so this
// file never reaches into the engine's internals by itself.

import { ARTIFACTS, ARTIFACT_IDS, gemsFor } from '../public/shared/artifacts.js';
import { ROLES, NIGHT_STEPS, PACK_ROLES } from '../public/shared/roles.js';

const FOREVER = 1e9;
// A reveal gives the village at least this long to take it in before the vote.
export const ART_MIN_LEFT_MS = 20000;
// A card that only counts when its owner dies: turning it over earlier wastes it.
const ON_DEATH = ['rod', 'scepter'];
// "Each day at dawn" cards whose owner may not choose the same player twice.
const UNIQUE_DAWN = ['cudgel', 'heart', 'shield'];
// The roles a Rod of Reincarnation or a Stone of Alteration can hand out: ones
// that work for any number of holders and keep no game-wide state of their own.
const NEW_ROLES = ['villager', 'villager', 'villager', 'mayor', 'tough_guy', 'idiot', 'pacifist', 'lycan', 'diseased', 'aura_seer', 'spellcaster', 'old_hag'];

export function makeArtifacts(x) {
  const art = (s) => s.game.art;
  const on = (s) => !!s.game?.art;
  const card = (id) => ARTIFACTS[id];
  const hand = (s, pid) => (art(s).hands[pid] ||= []);
  const name = (s, id) => x.nameOf(s, id);
  const label = (id) => `${card(id).icon} ${card(id).name}`;
  const feed = (s, text) => {
    art(s).feed.push({ day: s.game.day, text });
    x.log(s, `🗝️ ${text}`);
  };

  // --- Deck --------------------------------------------------------------

  function deal(s, rng) {
    const players = s.players.filter(p => p.inGame);
    const gems = x.shuffle(ARTIFACT_IDS.filter(id => card(id).gem), rng);
    const plain = x.shuffle(ARTIFACT_IDS.filter(id => !card(id).gem), rng);
    const nGems = Math.min(gems.length, gemsFor(players.length));
    const dealt = x.shuffle([...gems.slice(0, nGems), ...plain.slice(0, players.length - nGems)], rng);
    s.game.art = {
      // Cards drawn later (new cards, the Citrine) come from what was not
      // dealt; the gems stay out of it, keeping their 1-in-5 share low.
      deck: plain.slice(players.length - nGems),
      hands: {},
      nextUid: 1,
      queue: [],
      feed: [],
      amulet: null,
      dawnDone: {},
      picked: {},
      today: { day: 1, away: [], noVote: [] },
      shield: null,
      diseased: [],
      doomed: [],
      noPower: {},
      prism: null,
      seen: {},
      fate: [],
      woke: [],
      talismanDay: null,
      botDay: null
    };
    players.forEach((p, i) => give(s, p.id, dealt[i]));
  }

  function give(s, pid, id) {
    if (!id) return null;
    const a = art(s);
    const c = { uid: a.nextUid++, id, revealed: false, day: null };
    hand(s, pid).push(c);
    return c;
  }

  function draw(s, rng) {
    const a = art(s);
    if (!a.deck.length) return null;
    const i = Math.floor(rng() * a.deck.length);
    return a.deck.splice(i, 1)[0];
  }

  // Take a card out of a hand; it goes back to the deck unless it is gone
  // for good (the Onyx) or was only a copy (the Sapphire's).
  function takeCard(s, pid, uid, { toDeck = true } = {}) {
    const h = hand(s, pid);
    const i = h.findIndex(c => c.uid === uid);
    if (i < 0) return null;
    const [c] = h.splice(i, 1);
    if (toDeck && !c.copy) art(s).deck.push(c.id);
    const a = art(s);
    a.fate = a.fate.filter(f => f.uid !== uid);
    if (a.amulet?.uid === uid) a.amulet = null;
    return c;
  }

  const findCard = (s, uid) => {
    for (const [pid, h] of Object.entries(art(s).hands)) {
      const c = h.find(k => k.uid === uid);
      if (c) return { pid, c };
    }
    return null;
  };
  const unrevealed = (s, pid) => (on(s) ? hand(s, pid).filter(c => !c.revealed) : []);
  // A revealed "always in effect" card this player holds.
  const has = (s, pid, id) => on(s) && hand(s, pid).some(c => c.revealed && c.id === id);

  // --- Effects the engine asks about ---------------------------------------

  // Whether a player still has their role's special power (Brand, Flask).
  function hasPower(s, p) {
    if (!on(s) || !p) return true;
    const until = art(s).noPower[p.id];
    if (until == null) return true;
    const g = s.game;
    return !(g.day < until || (g.day === until && s.phase === 'NIGHT'));
  }

  // Why a player cannot be eliminated right now, or null.
  function shielded(s, p, cause) {
    if (!on(s) || cause === 'ghost') return null;
    const a = art(s);
    const g = s.game;
    if (a.amulet?.holder === p.id) return `${label('amulet')} bảo vệ`;
    if (s.phase !== 'NIGHT' && has(s, p.id, 'cloak')) return `${label('cloak')}: không bị loại ban ngày`;
    if (s.phase === 'NIGHT' && a.shield && a.shield.id === p.id && a.shield.day === g.day - 1) return `${label('shield')} bảo vệ đêm nay`;
    return null;
  }

  // Rod of Reincarnation, Scepter of Rebirth: turned over on death, the
  // owner stays in the game. Returns true if the player is saved.
  function savedOnDeath(s, p, cause, rng) {
    if (!on(s) || cause === 'ghost') return false;
    const c = unrevealed(s, p.id).find(k => ON_DEATH.includes(k.id));
    if (!c) return false;
    c.revealed = true;
    c.day = s.game.day;
    feed(s, `${name(s, p.id)} bị loại nhưng lật ${label(c.id)} và ở lại ván.`);
    if (c.id === 'rod') {
      if (x.inPack(p)) {
        art(s).noPower[p.id] = FOREVER;
        x.addNote(s, p.id, `${label('rod')}: bạn ở lại ván nhưng mất chức năng Sói (không thức dậy cùng đàn nữa).`);
        x.log(s, `🪄 ${name(s, p.id)} (Sói) mất chức năng`);
      } else {
        changeRole(s, p, x.pick(NEW_ROLES, rng));
        x.addNote(s, p.id, `${label('rod')}: bạn ở lại ván với vai mới: ${ROLES[p.role].name}.`);
      }
    }
    return true;
  }

  function changeRole(s, p, role) {
    const before = p.role;
    p.role = role;
    delete p.drunkRole;
    delete p.sober;
    delete p.turned;
    delete p.copied;
    // A role whose night step was not in the deck is called from now on.
    const g = s.game;
    if (NIGHT_STEPS.some(st => st.role === role) && !g.rolesInPlay.includes(role)) g.rolesInPlay.push(role);
    x.log(s, `🗝️ ${name(s, p.id)}: ${ROLES[before]?.name || before} → ${ROLES[role].name}`);
  }

  // A player is out: their face-down cards go back to the deck.
  function onDeath(s, p) {
    if (!on(s)) return;
    p.diedDay = s.game.day;
    unrevealed(s, p.id).forEach(c => takeCard(s, p.id, c.uid));
  }

  // Blood of the Diseased: the pack ate the infected one.
  const infected = (s, id) => on(s) && art(s).diseased.includes(id);
  // Skimmer of the Cursed: bitten, turns into a wolf instead of dying.
  function cursedBite(s, p) {
    if (!has(s, p.id, 'skimmer') || p.clawed) return false;
    p.clawed = true;
    x.addNote(s, p.id, `${label('skimmer')}: bạn bị Sói cắn và đã hoá Sói. Từ đêm sau bạn thức dậy cùng đàn, thắng thua cùng phe Sói.`);
    x.log(s, `🎩 ${name(s, p.id)} bị cắn và hoá Sói (Mũ Kẻ Bị Nguyền)`);
    return true;
  }

  // Prism of Power: the only players the pack may bite tonight, or null.
  function wolfOptions(s) {
    if (!on(s)) return null;
    const pr = art(s).prism;
    if (!pr || pr.day !== s.game.day - 1) return null;
    return pr.ids.filter(id => { const p = x.findPlayer(s, id); return p?.alive && !x.inPack(p); });
  }

  // Breath of the Old Man: who dies tonight.
  function doomedTonight(s) {
    if (!on(s)) return [];
    const a = art(s);
    const due = a.doomed.filter(d => d.day <= s.game.day);
    a.doomed = a.doomed.filter(d => d.day > s.game.day);
    return due.map(d => d.id);
  }

  // The Eye of the Beholder wakes with the Seer.
  const beholders = (s) => (on(s) ? s.players.filter(p => p.inGame && p.alive && has(s, p.id, 'eye')) : []);

  function markWoke(s, ids) {
    if (!on(s)) return;
    const n = s.game.night;
    n.woke = [...new Set([...(n.woke || []), ...ids])];
  }

  // A new day: yesterday's choices are over, lost powers may come back.
  function morning(s) {
    if (!on(s)) return;
    const a = art(s);
    const g = s.game;
    a.woke = g.night?.woke || [];
    a.today = { day: g.day, away: [], noVote: [] };
    for (const [id, until] of Object.entries(a.noPower)) {
      if (until <= g.day) {
        delete a.noPower[id];
        x.addNote(s, id, `${label('flask')}: bạn đã có lại chức năng.`);
      }
    }
  }

  const away = (s, id) => on(s) && art(s).today.day === s.game.day && art(s).today.away.includes(id);
  const noVote = (s, id) => on(s) && art(s).today.day === s.game.day && art(s).today.noVote.includes(id);
  const extraVote = (s, id) => (has(s, id, 'mark') ? 1 : 0);
  // The verdict this player is forced to give, if any (overrules the role).
  const fixedJudge = (s, id) => (has(s, id, 'cap') ? 'kill' : has(s, id, 'wreath') ? 'spare' : null);
  const seenBy = (s, viewer, id) => on(s) && (art(s).seen[viewer] || []).includes(id);

  // --- Choosing players ----------------------------------------------------

  const isWolf = (p) => PACK_ROLES.includes(x.trueRole(p)) || !!p.clawed;

  function options(s, owner, spec) {
    const others = s.players.filter(p => p.inGame && p.alive && p.id !== owner);
    if (spec.from === 'unrevealed') return others.filter(p => unrevealed(s, p.id).length);
    if (spec.from === 'forever') return others.filter(p => hand(s, p.id).some(c => c.revealed && !card(c.id).once && c.id !== 'claw'));
    if (spec.from === 'dead') return s.players.filter(p => p.inGame && !p.alive && p.diedDay != null && p.diedDay >= s.game.day - 1);
    return others;
  }

  function dawnOptions(s, ownerId, kind, uid) {
    const a = art(s);
    const others = s.players.filter(p => p.inGame && p.alive && p.id !== ownerId);
    if (kind === 'amulet') return others.filter(p => !a.amulet.had.includes(p.id));
    const used = a.picked[uid] || [];
    return others.filter(p => !used.includes(p.id));
  }

  // The "each day at dawn" choices a player may make today.
  function dawnChoices(s, pid) {
    if (!on(s) || !['MORNING', 'DISCUSSION'].includes(s.phase)) return [];
    const a = art(s);
    const g = s.game;
    const p = x.findPlayer(s, pid);
    if (!p?.alive) return [];
    const out = [];
    if (a.amulet && a.amulet.holder === pid && a.amulet.since < g.day && a.amulet.passed !== g.day) {
      out.push({ kind: 'amulet', uid: a.amulet.uid, id: 'amulet' });
    }
    hand(s, pid).filter(c => c.revealed && card(c.id).dawn && c.id !== 'amulet' && c.day < g.day && a.dawnDone[c.uid] !== g.day)
      .forEach(c => out.push({ kind: c.id, uid: c.uid, id: c.id }));
    return out.map(d => ({ ...d, options: dawnOptions(s, pid, d.kind, d.uid).map(q => q.id) })).filter(d => d.options.length);
  }

  function useDawn(s, p, uid, targetId, auto = false) {
    const a = art(s);
    const g = s.game;
    const choice = dawnChoices(s, p.id).find(d => d.uid === uid);
    if (!choice) x.fail('Không có lựa chọn buổi sáng nào cho lá này.');
    if (!choice.options.includes(targetId)) x.fail('Không chọn được người này.');
    const t = name(s, targetId);
    const how = auto ? ' (hết giờ, chọn ngẫu nhiên)' : '';
    switch (choice.kind) {
      case 'amulet':
        a.amulet.holder = targetId;
        a.amulet.had.push(targetId);
        a.amulet.passed = g.day;
        a.amulet.since = g.day - 1; // the new holder passes it on tomorrow
        feed(s, `${name(s, p.id)} trao ${label('amulet')} cho ${t}${how}.`);
        return;
      case 'cudgel': a.today.away.push(targetId); feed(s, `${label('cudgel')}: ${t} phải rời làng hôm nay, không ai được bỏ phiếu cho người này${how}.`); break;
      case 'heart': a.today.noVote.push(targetId); feed(s, `${label('heart')}: ${t} không được bỏ phiếu hôm nay${how}.`); break;
      case 'shield': a.shield = { id: targetId, day: g.day }; feed(s, `${label('shield')}: ${t} không thể bị loại đêm nay${how}.`); break;
      default: x.fail('Lá này không có lựa chọn buổi sáng.');
    }
    a.dawnDone[uid] = g.day;
    if (UNIQUE_DAWN.includes(choice.kind)) (a.picked[uid] ||= []).push(targetId);
  }

  // --- Revealing and resolving ----------------------------------------------
  //
  // The queue holds what is being resolved, in order. "reveal" items are
  // handled at once; the others wait for a player:
  //   choose  the owner picks the players for the card just revealed
  //   decide  Amethyst: force the viewed card to be revealed now, or not
  //   letter  Sheet: the dead player picks a letter
  // Nobody may turn over a card while something is waiting.

  function waiting(s) {
    return on(s) ? art(s).queue[0] || null : null;
  }

  function processQueue(s, rng) {
    const a = art(s);
    for (let guard = 0; guard < 200 && a.queue.length; guard++) {
      const head = a.queue[0];
      const owner = x.findPlayer(s, head.owner);
      // A player who died meanwhile can no longer choose (the dead only
      // give the Sheet's letter).
      if (head.type !== 'letter' && head.type !== 'reveal' && !owner?.alive) { a.queue.shift(); continue; }
      if (head.type !== 'reveal') return;
      a.queue.shift();
      a.queue.unshift(...reveal(s, head.owner, head.uid, rng));
    }
  }

  // Turn a card over. Returns what has to happen next, in order.
  function reveal(s, pid, uid, rng) {
    const a = art(s);
    const c = hand(s, pid).find(k => k.uid === uid);
    if (!c || c.revealed) return [];
    c.revealed = true;
    c.day = s.game.day;
    const info = card(c.id);
    feed(s, `${name(s, pid)} lật ${label(c.id)}${c.copy ? ' (nhờ Lam Ngọc Số Phận)' : ''}.`);
    // The Sapphire of Fate: whoever viewed this card resolves it too, after.
    const fated = a.fate.filter(f => f.uid === uid);
    a.fate = a.fate.filter(f => f.uid !== uid);
    const after = fated.filter(f => x.findPlayer(s, f.owner)?.alive).map(f => {
      const copy = give(s, f.owner, c.id);
      copy.copy = true;
      return { type: 'reveal', owner: f.owner, uid: copy.uid };
    });
    if (info.pick) {
      const opts = options(s, pid, info.pick);
      if (opts.length < info.pick.n) {
        feed(s, `${label(c.id)}: không đủ người để chọn, lá này không có tác dụng.`);
        return after;
      }
      return [{ type: 'choose', owner: pid, uid, id: c.id }, ...after];
    }
    return [...apply(s, pid, c, [], rng), ...after];
  }

  function choose(s, p, targets, rng, auto = false) {
    const a = art(s);
    const head = a.queue[0];
    const info = card(head.id);
    const ids = [...new Set(targets)];
    if (ids.length !== info.pick.n) x.fail(`Hãy chọn đúng ${info.pick.n} người.`);
    const allowed = options(s, p.id, info.pick).map(q => q.id);
    if (!ids.every(id => allowed.includes(id))) x.fail('Có người không chọn được.');
    a.queue.shift();
    const c = hand(s, p.id).find(k => k.uid === head.uid) || { id: head.id, uid: head.uid };
    if (head.id !== 'pendant' && head.id !== 'staff') {
      feed(s, `${name(s, p.id)} dùng ${label(head.id)} chọn ${ids.map(id => name(s, id)).join(', ')}${auto ? ' (hết giờ, chọn ngẫu nhiên)' : ''}.`);
    } else {
      feed(s, `${name(s, p.id)} dùng ${label(head.id)} với ${name(s, ids[0])}${auto ? ' (hết giờ, chọn ngẫu nhiên)' : ''}.`);
    }
    a.queue.unshift(...apply(s, p.id, c, ids, rng));
  }

  // What a card does once its choices are made. Returns follow-ups.
  function apply(s, pid, c, ids, rng) {
    const a = art(s);
    const g = s.game;
    const me = x.findPlayer(s, pid);
    const [t] = ids.map(id => x.findPlayer(s, id));
    switch (c.id) {
      case 'amber': {
        const holders = s.players.filter(p => p.inGame && p.alive && hand(s, p.id).some(k => k.revealed && card(k.id).once));
        holders.forEach(p => hand(s, p.id).filter(k => k.revealed && card(k.id).once).forEach(k => takeCard(s, p.id, k.uid)));
        a.deck = x.shuffle(a.deck, rng);
        const got = holders.filter(p => give(s, p.id, draw(s, rng)));
        feed(s, got.length ? `${label('amber')}: ${got.map(p => p.name).join(', ')} nhận lá Artifact mới.` : `${label('amber')}: hết bài, không ai nhận thêm.`);
        return [];
      }
      case 'amulet':
        a.amulet = { holder: pid, had: [pid], uid: c.uid, since: g.day, passed: null };
        return [];
      case 'amethyst': {
        const tc = unrevealed(s, t.id)[0];
        x.addNote(s, pid, `${label('amethyst')}: lá Artifact của ${t.name} là ${label(tc.id)}.`);
        return [{ type: 'decide', owner: pid, target: t.id, tuid: tc.uid, seen: tc.id }];
      }
      case 'blood':
        a.diseased.push(t.id);
        return [];
      case 'brand':
        a.noPower[t.id] = FOREVER;
        x.addNote(s, t.id, `${label('brand')}: bạn đã mất chức năng đặc biệt đến hết ván.`);
        return [];
      case 'breath':
        a.doomed.push({ id: t.id, day: g.day + 2 });
        return [];
      case 'cauldron':
        feed(s, `${label('cauldron')}: ${t.name} ${x.trueRole(t) === 'villager' ? 'LÀ' : 'KHÔNG phải'} Dân Làng thường.`);
        return [];
      case 'citrine': {
        takeCard(s, pid, c.uid);
        const fresh = give(s, pid, draw(s, rng));
        if (!fresh) { feed(s, `${label('citrine')}: hết bài để đổi.`); return []; }
        return [{ type: 'reveal', owner: pid, uid: fresh.uid }];
      }
      case 'claw':
        me.clawed = true;
        x.addNote(s, pid, `${label('claw')}: bạn đã thành Sói. Từ đêm nay bạn thức dậy cùng đàn Sói (vẫn giữ chức năng của vai cũ) và thắng thua cùng phe Sói.`);
        return [];
      case 'diamond': {
        const tc = hand(s, t.id).find(k => k.revealed && !card(k.id).once && k.id !== 'claw');
        takeCard(s, t.id, tc.uid);
        feed(s, `${label('diamond')}: ${t.name} mất ${label(tc.id)}.`);
        return [];
      }
      case 'diary': {
        const near = x.seatNeighbours(s, pid);
        const woke = near.some(p => a.woke.includes(p.id));
        x.addNote(s, pid, `${label('diary')}: đêm qua ${woke ? 'CÓ' : 'KHÔNG có'} người ngồi cạnh bạn (${near.map(p => p.name).join(', ') || 'không ai'}) thức dậy.`);
        return [];
      }
      case 'emerald': {
        const tc = unrevealed(s, t.id)[0];
        takeCard(s, t.id, tc.uid, { toDeck: false });
        hand(s, pid).push(tc);
        give(s, t.id, draw(s, rng));
        return [{ type: 'reveal', owner: pid, uid: tc.uid }];
      }
      case 'flask':
        a.noPower[t.id] = g.day + 2;
        x.addNote(s, t.id, `${label('flask')}: bạn mất chức năng trong 2 ngày, có lại vào sáng ngày ${g.day + 2}.`);
        return [];
      case 'mist':
        feed(s, `${label('mist')}: ${t.name} ${x.isSpecial(t) ? 'CÓ' : 'KHÔNG có'} vai đặc biệt.`);
        return [];
      case 'onyx': {
        const tc = unrevealed(s, t.id)[0];
        takeCard(s, t.id, tc.uid, { toDeck: false });
        x.log(s, `⚫ Lá bị huỷ của ${t.name}: ${label(tc.id)}`);
        return [];
      }
      case 'orb': {
        const [p1, p2] = ids.map(id => x.findPlayer(s, id));
        const right = isWolf(p1) && isWolf(p2);
        feed(s, `${label('orb')}: ${me.name} đoán ${right ? 'ĐÚNG' : 'SAI'}.`);
        if (right) {
          a.villageWins = `${me.name} dùng Quả Cầu Phán Đoán chỉ đúng hai con Sói.`;
        } else {
          killNow(s, [{ id: pid, cause: 'orb' }]);
        }
        return [];
      }
      case 'pendant':
        (a.seen[t.id] ||= []).push(pid);
        x.addNote(s, t.id, `${label('pendant')}: ${me.name} cho bạn xem lá vai trò: ${ROLES[me.role].name}.`);
        return [];
      case 'prism':
        a.prism = { ids, day: g.day };
        return [];
      case 'ring':
        x.addNote(s, pid, `${label('ring')}: ${t.name} ${isWolf(t) ? 'LÀ Sói 🐺' : 'không phải Sói'}.`);
        return [];
      case 'rod':
      case 'scepter':
        feed(s, `${label(c.id)} được lật khi chưa bị loại nên không có tác dụng.`);
        return [];
      case 'ruby':
        return ids.flatMap(id => {
          const tc = unrevealed(s, id)[0];
          return tc ? [{ type: 'reveal', owner: id, uid: tc.uid }] : [];
        });
      case 'sapphire': {
        const tc = unrevealed(s, t.id)[0];
        a.fate.push({ owner: pid, uid: tc.uid });
        x.addNote(s, pid, `${label('sapphire')}: lá Artifact của ${t.name} là ${label(tc.id)}. Khi họ lật, bạn cũng được dùng.`);
        return [];
      }
      case 'sheet':
        return [{ type: 'letter', owner: t.id, by: pid }];
      case 'spear':
        me.revealed = true;
        feed(s, `${label('spear')}: ${me.name} lật lá vai trò: ${ROLES[me.role].name}.`);
        killNow(s, [{ id: t.id, cause: 'spear' }]);
        return [];
      case 'staff':
        (a.seen[pid] ||= []).push(t.id);
        x.addNote(s, pid, `${label('staff')}: ${t.name} là ${ROLES[t.role].name}.`);
        return [];
      case 'stone': {
        const role = x.inPack(me) && PACK_ROLES.includes(me.role) ? 'werewolf' : x.pick([...NEW_ROLES, 'werewolf'], rng);
        changeRole(s, me, role);
        x.addNote(s, pid, `${label('stone')}: bạn đã đổi lá vai trò, giờ bạn là ${ROLES[role].name}.`);
        return [];
      }
      case 'talisman':
        g.doubleLynch = true;
        a.talismanDay = g.day;
        return [];
      default:
        // Always-in-effect cards (Cap, Cloak, Eye...) only need to be face up.
        return [];
    }
  }

  // Eliminations by day (Spear, Orb), announced at once.
  function killNow(s, list) {
    const died = x.killPlayers(s, list);
    if (died.length) feed(s, `Đã bị loại: ${died.map(d => name(s, d.id)).join(', ')}.`);
    else feed(s, `${list.map(d => name(s, d.id)).join(', ')} không bị loại.`);
  }

  // --- Player actions (day only) ---------------------------------------------

  function action(s, p, type, payload, now, rng) {
    if (!on(s)) x.fail('Ván này không dùng Artifact.');
    if (s.phase !== 'DISCUSSION' && !(type === 'artDawn' && s.phase === 'MORNING')) x.fail('Artifact chỉ dùng được trong lúc thảo luận ban ngày.');
    const a = art(s);
    const head = a.queue[0];
    switch (type) {
      case 'artReveal': {
        if (!p.alive) x.fail('Người đã bị loại không được lật Artifact.');
        if (head) x.fail('Đang chờ một lá Artifact khác dùng xong.');
        const c = hand(s, p.id).find(k => k.uid === Number(payload.uid));
        if (!c || c.revealed) x.fail('Lá Artifact không hợp lệ.');
        a.queue.push({ type: 'reveal', owner: p.id, uid: c.uid });
        break;
      }
      case 'artChoose':
        if (head?.type !== 'choose' || head.owner !== p.id) x.fail('Chưa đến lượt bạn chọn.');
        choose(s, p, Array.isArray(payload.targets) ? payload.targets : [], rng);
        break;
      case 'artDecide': {
        if (head?.type !== 'decide' || head.owner !== p.id) x.fail('Chưa đến lượt bạn chọn.');
        a.queue.shift();
        decide(s, p, head, !!payload.force);
        break;
      }
      case 'artLetter': {
        if (head?.type !== 'letter' || head.owner !== p.id) x.fail('Chưa đến lượt bạn.');
        const letter = String(payload.letter || '').trim().toUpperCase();
        if (!/^[A-ZĐ]$/.test(letter)) x.fail('Hãy chọn một chữ cái.');
        a.queue.shift();
        feed(s, `${label('sheet')}: ${p.name} cho ${name(s, head.by)} chữ "${letter}".`);
        break;
      }
      case 'artDawn':
        if (!p.alive) x.fail('Bạn đã bị loại.');
        useDawn(s, p, Number(payload.uid), payload.target);
        return;
      default:
        x.fail('Hành động không hợp lệ.');
    }
    processQueue(s, rng);
  }

  function decide(s, p, item, force) {
    if (!force) { feed(s, `${name(s, p.id)} không bắt ${name(s, item.target)} lật lá Artifact.`); return; }
    feed(s, `${name(s, p.id)} bắt ${name(s, item.target)} lật lá Artifact ngay.`);
    if (findCard(s, item.tuid)?.pid === item.target) art(s).queue.unshift({ type: 'reveal', owner: item.target, uid: item.tuid });
  }

  // The vote is about to start: whatever is still waiting is settled at
  // random, and the Amulet is passed on if its holder forgot.
  function settle(s, rng) {
    if (!on(s)) return;
    const a = art(s);
    for (let i = 0; i < 50 && a.queue.length; i++) {
      processQueue(s, rng);
      const head = a.queue[0];
      if (!head) break;
      const p = x.findPlayer(s, head.owner);
      if (head.type === 'choose') {
        const info = card(head.id);
        const opts = x.shuffle(options(s, p.id, info.pick), rng).slice(0, info.pick.n).map(q => q.id);
        if (opts.length === info.pick.n) choose(s, p, opts, rng, true);
        else { a.queue.shift(); feed(s, `${label(head.id)}: không đủ người để chọn.`); }
      } else if (head.type === 'decide') {
        a.queue.shift();
        decide(s, p, head, false);
      } else {
        a.queue.shift();
        feed(s, `${label('sheet')}: hết giờ, không có chữ nào.`);
      }
    }
    a.queue = [];
    s.players.filter(p => p.inGame && p.alive).forEach(p => {
      dawnChoices(s, p.id).filter(d => d.kind === 'amulet').forEach(d => useDawn(s, p, d.uid, x.pick(d.options, rng), true));
    });
  }

  // --- Bots --------------------------------------------------------------

  // `act` runs an action the way a player's tap would (the engine's wrapper).
  function bots(s, rng, act) {
    if (!on(s) || s.phase !== 'DISCUSSION') return false;
    const a = art(s);
    const g = s.game;
    let changed = false;
    const tryAct = (bot, type, payload) => {
      if (s.phase !== 'DISCUSSION') return;
      try { act(bot, type, payload); changed = true; } catch (e) { if (!(e instanceof x.GameError)) throw e; }
    };
    // Whatever waits on a bot.
    for (let i = 0; i < 10; i++) {
      const head = a.queue[0];
      const bot = head && x.findPlayer(s, head.owner);
      if (!bot?.isBot) break;
      if (head.type === 'choose') {
        const info = card(head.id);
        tryAct(bot, 'artChoose', { targets: x.shuffle(options(s, bot.id, info.pick), rng).slice(0, info.pick.n).map(q => q.id) });
      } else if (head.type === 'decide') tryAct(bot, 'artDecide', { force: rng() < 0.5 });
      else if (head.type === 'letter') tryAct(bot, 'artLetter', { letter: x.pick([...'ABCDEGHIKLMNOPQRSTUVXY'], rng) });
      if (a.queue[0] === head) break;
    }
    const bots = s.players.filter(p => p.inGame && p.alive && p.isBot);
    bots.forEach(bot => dawnChoices(s, bot.id).forEach(d => tryAct(bot, 'artDawn', { uid: d.uid, target: x.pick(d.options, rng) })));
    // Once a day, now and then, a bot turns its card over.
    if (a.botDay !== g.day && !a.queue.length) {
      a.botDay = g.day;
      bots.forEach(bot => {
        const c = unrevealed(s, bot.id).find(k => !ON_DEATH.includes(k.id));
        if (c && !a.queue.length && rng() < 0.25) tryAct(bot, 'artReveal', { uid: c.uid });
      });
    }
    return changed;
  }

  // --- What each player may see ---------------------------------------------

  // Public, on every seat: the cards turned face up, the Amulet.
  function seatView(s, p) {
    if (!on(s)) return null;
    return {
      shown: hand(s, p.id).filter(c => c.revealed).map(c => c.id),
      amulet: art(s).amulet?.holder === p.id
    };
  }

  function publicView(s) {
    if (!on(s)) return null;
    const a = art(s);
    const g = s.game;
    const head = a.queue[0];
    const today = a.today.day === g.day && s.phase !== 'NIGHT' ? a.today : { away: [], noVote: [] };
    return {
      feed: a.feed,
      waiting: head ? { type: head.type, owner: head.owner, id: head.id || null, by: head.by || null } : null,
      away: today.away,
      noVote: today.noVote,
      shield: a.shield && a.shield.day === g.day && s.phase !== 'NIGHT' ? a.shield.id : null,
      deck: a.deck.length
    };
  }

  function myView(s, me) {
    if (!on(s) || !me?.inGame) return null;
    const a = art(s);
    const head = a.queue[0];
    const out = {
      hand: hand(s, me.id).map(c => ({ uid: c.uid, id: c.id, revealed: c.revealed, copy: !!c.copy })),
      dawn: dawnChoices(s, me.id),
      canReveal: s.phase === 'DISCUSSION' && me.alive && !head,
      lostPower: !hasPower(s, me),
      pending: null
    };
    if (head && head.owner === me.id) {
      if (head.type === 'choose') {
        const info = card(head.id);
        out.pending = { type: 'choose', id: head.id, n: info.pick.n, ordered: !!info.pick.ordered, options: options(s, me.id, info.pick).map(q => q.id) };
      } else if (head.type === 'decide') {
        out.pending = { type: 'decide', target: head.target, seen: head.seen };
      } else if (head.type === 'letter') {
        out.pending = { type: 'letter', by: head.by };
      }
    }
    return out;
  }

  return {
    deal, hasPower, shielded, savedOnDeath, onDeath, infected, cursedBite, wolfOptions, doomedTonight,
    beholders, markWoke, morning, away, noVote, extraVote, fixedJudge, seenBy,
    action, settle, bots, seatView, publicView, myView, waiting, isWolf, on
  };
}
