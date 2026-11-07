// Avalon (The Resistance: Avalon). Good knights and hidden evil go on five
// quests; three successes or three failures decide, but if good gets its
// three, the Assassin may still win by naming Merlin.
//
//   AV_PICK     the leader (going round the table) picks a team of the size
//               the quest needs.
//   AV_VOTE     everyone approves or rejects the team. Votes stay hidden until
//               all are in, then are shown. More than half approve: the quest
//               goes; otherwise the next leader picks. Five rejected teams in
//               a row: evil wins.
//   AV_QUEST    the team secretly plays Success or Fail (good can only play
//               Success). One Fail fails the quest (two on the fourth quest
//               from seven players).
//   AV_RESULT   a pause on how many Fail cards were played.
//   AV_LADY     with Tiên Nữ Hồ (Lady of the Lake), after the 2nd, 3rd and
//               4th quests: whoever holds her learns one player's side (only
//               they see it), and hands her to that player. Nobody who has
//               held her can be looked at.
//   AV_ASSASSIN good has three successes: the Assassin names Merlin.
//   GAME_OVER

import { AVALON_ROLES, AVALON_SIDES, QUEST_SIZES, failsNeeded, AVALON_DEFAULTS, AVALON_LIMITS, LADY_AFTER } from '../../public/shared/avalon.js';

const BOT_DELAY_MS = 2500;
const RESULT_MS = 6000;
const isEvil = (role) => AVALON_ROLES[role]?.side === 'evil';

export const avalon = {
  id: 'avalon',
  minPlayers: 5,
  defaults: AVALON_DEFAULTS,

  configure(c, payload, api) {
    for (const [key, [min, max]] of Object.entries(AVALON_LIMITS)) {
      if (payload[key] === undefined) continue;
      const v = Math.round(Number(payload[key]));
      if (!Number.isFinite(v)) api.fail('Giá trị không hợp lệ.');
      c[key] = Math.min(max, Math.max(min, v));
    }
    for (const key of ['percival', 'mordred', 'oberon', 'lady']) if (payload[key] !== undefined) c[key] = !!payload[key];
  },

  start(s, now, rng, api) {
    const c = conf(s);
    const players = s.players.filter(p => p.inGame);
    const n = players.length;
    const [goodN, evilN] = AVALON_SIDES[n];
    // Evil: the Assassin always, then the chosen specials while there is room.
    const evil = ['assassin', ...[c.percival && 'morgana', c.mordred && 'mordred', c.oberon && 'oberon'].filter(Boolean)].slice(0, evilN);
    while (evil.length < evilN) evil.push('minion');
    const good = ['merlin', ...(c.percival && evil.includes('morgana') ? ['percival'] : [])];
    while (good.length < goodN) good.push('servant');
    const cards = api.shuffle([...good, ...evil], rng);
    const roles = {};
    players.forEach((p, i) => { roles[p.id] = cards[i]; });
    const ring = players.slice().sort((a, b) => a.seat - b.seat).map(p => p.id);
    const leader = Math.floor(rng() * ring.length);
    // Tiên Nữ Hồ starts with the player to the first leader's right.
    const lady = c.lady ? ring[(leader - 1 + ring.length) % ring.length] : null;
    s.play = {
      roles,
      ring,
      leader,
      lady,
      ladyHeld: lady ? [lady] : [],
      ladyLooks: [], // [{ by, target, quest }] public; the side only to `by`
      ladySaw: {}, // holder id -> [{ target, side }]
      quest: 0,
      results: [], // [{ team, fails, success }]
      team: [],
      votes: {},
      lastVote: null, // { leader, team, votes, approved }
      rejects: 0,
      played: {},
      assassinPick: null,
      result: null
    };
    api.log(s, `🛡️ Ván Avalon bắt đầu với ${n} người.`);
    players.forEach(p => api.log(s, `   ${p.name}: ${AVALON_ROLES[roles[p.id]].name}`));
    if (lady) api.log(s, `🌊 ${api.nameOf(s, lady)} giữ Tiên Nữ Hồ.`);
    beginPick(s, now, api);
  },

  action(s, player, type, payload, now, rng, api) {
    const p = s.play;
    if (!player.inGame) api.fail('Bạn đang xem, không tham gia ván này.');
    switch (type) {
      case 'avPick': {
        if (s.phase !== 'AV_PICK') api.fail('Chưa đến lúc chọn đội.');
        if (leaderId(p) !== player.id) api.fail('Chỉ đội trưởng mới chọn đội.');
        const id = payload.target;
        if (!p.ring.includes(id)) api.fail('Người này không ở trong ván.');
        if (p.team.includes(id)) p.team = p.team.filter(x => x !== id);
        else if (p.team.length < size(s)) p.team.push(id);
        else api.fail(`Đội chỉ có ${size(s)} người: bỏ bớt một người trước.`);
        return;
      }
      case 'avPropose': {
        if (s.phase !== 'AV_PICK') api.fail('Chưa đến lúc chọn đội.');
        if (leaderId(p) !== player.id) api.fail('Chỉ đội trưởng mới chọn đội.');
        if (p.team.length !== size(s)) api.fail(`Hãy chọn đủ ${size(s)} người.`);
        return beginVote(s, now, api);
      }
      case 'avVote': {
        if (s.phase !== 'AV_VOTE') api.fail('Chưa đến lúc bỏ phiếu.');
        p.votes[player.id] = !!payload.approve;
        if (p.ring.every(id => p.votes[id] !== undefined)) resolveVote(s, now, api);
        return;
      }
      case 'avQuest': {
        if (s.phase !== 'AV_QUEST') api.fail('Chưa đến lúc làm nhiệm vụ.');
        if (!p.team.includes(player.id)) api.fail('Bạn không ở trong đội làm nhiệm vụ.');
        if (p.played[player.id]) api.fail('Bạn đã chọn rồi.');
        const fail = !!payload.fail;
        if (fail && !isEvil(p.roles[player.id])) api.fail('Phe Thiện chỉ được chọn Thành công.');
        p.played[player.id] = fail ? 'fail' : 'success';
        if (p.team.every(id => p.played[id])) resolveQuest(s, now, api);
        return;
      }
      case 'avLady': {
        if (s.phase !== 'AV_LADY') api.fail('Chưa đến lúc dùng Tiên Nữ Hồ.');
        if (p.lady !== player.id) api.fail('Bạn không giữ Tiên Nữ Hồ.');
        return ladyLook(s, now, api, payload.target);
      }
      case 'avAssassinate': {
        if (s.phase !== 'AV_ASSASSIN') api.fail('Chưa đến lúc ám sát.');
        if (p.roles[player.id] !== 'assassin') api.fail('Chỉ Sát Thủ mới chọn được.');
        const target = payload.target;
        if (!p.ring.includes(target) || isEvil(p.roles[target])) api.fail('Hãy chọn một người phe Thiện.');
        return assassinate(s, now, api, target);
      }
      default:
        api.fail('Hành động không hợp lệ.');
    }
  },

  skip(s, now) {
    s.game.phaseEndsAt = now;
  },

  onTimeout(s, now, rng, api) {
    const p = s.play;
    switch (s.phase) {
      case 'AV_PICK': {
        // Out of time: the leader goes, with others drawn to fill the team.
        const leader = leaderId(p);
        if (!p.team.includes(leader) && p.team.length < size(s)) p.team.push(leader);
        const rest = api.shuffle(p.ring.filter(id => !p.team.includes(id)), rng);
        while (p.team.length < size(s)) p.team.push(rest.shift());
        api.log(s, `⏰ Đội trưởng ${api.nameOf(s, leader)} hết giờ, đội được chọn ngẫu nhiên.`);
        return beginVote(s, now, api);
      }
      case 'AV_VOTE':
        // A missing vote counts as approve.
        p.ring.forEach(id => { if (p.votes[id] === undefined) p.votes[id] = true; });
        return resolveVote(s, now, api);
      case 'AV_QUEST':
        // A missing card counts as Success.
        p.team.forEach(id => { p.played[id] ||= 'success'; });
        return resolveQuest(s, now, api);
      case 'AV_RESULT': return afterQuest(s, now, api);
      case 'AV_LADY': return ladyLook(s, now, api, api.pick(ladyTargets(p), rng));
      case 'AV_ASSASSIN': {
        const good = p.ring.filter(id => !isEvil(p.roles[id]));
        return assassinate(s, now, api, api.pick(good, rng));
      }
      default: s.game.phaseEndsAt = null;
    }
  },

  bots(s, now, rng, api) {
    const p = s.play;
    if (now < s.game.phaseStartedAt + BOT_DELAY_MS) return false;
    let changed = false;
    const act = (bot, type, payload) => {
      try { avalon.action(s, bot, type, payload, now, rng, api); changed = true; } catch {}
    };
    const bots = s.players.filter(x => x.isBot && x.inGame);
    const evilOn = (team) => team.some(id => isEvil(p.roles[id]));
    if (s.phase === 'AV_PICK') {
      const leader = bots.find(b => b.id === leaderId(p));
      if (leader) {
        p.team = [leader.id, ...api.shuffle(p.ring.filter(id => id !== leader.id), rng)].slice(0, size(s));
        act(leader, 'avPropose', {});
      }
    } else if (s.phase === 'AV_VOTE') {
      bots.filter(b => p.votes[b.id] === undefined).forEach(b => {
        const evil = isEvil(p.roles[b.id]);
        const approve = evil ? (evilOn(p.team) || rng() < 0.4) : rng() < 0.65;
        act(b, 'avVote', { approve });
      });
    } else if (s.phase === 'AV_QUEST') {
      bots.filter(b => p.team.includes(b.id) && !p.played[b.id])
        .forEach(b => act(b, 'avQuest', { fail: isEvil(p.roles[b.id]) && rng() < 0.7 }));
    } else if (s.phase === 'AV_LADY') {
      const holder = bots.find(b => b.id === p.lady);
      if (holder) act(holder, 'avLady', { target: api.pick(ladyTargets(p), rng) });
    } else if (s.phase === 'AV_ASSASSIN') {
      const assassin = bots.find(b => p.roles[b.id] === 'assassin');
      if (assassin) act(assassin, 'avAssassinate', { target: api.pick(p.ring.filter(id => !isEvil(p.roles[id])), rng) });
    }
    return changed;
  },

  view(s, me) {
    const p = s.play;
    if (!p) return null;
    const over = s.phase === 'GAME_OVER';
    const playing = !!me?.inGame && p.roles[me.id];
    const role = playing ? p.roles[me.id] : null;
    const n = p.ring.length;
    return {
      ring: p.ring,
      leader: leaderId(p),
      quest: p.quest,
      sizes: QUEST_SIZES[n],
      twoFails: QUEST_SIZES[n].map((_, i) => failsNeeded(n, i) === 2),
      results: p.results.map(r => ({ success: r.success, fails: r.fails, team: r.team })),
      team: p.team,
      // Who has voted, but not how, until every vote is in.
      voted: s.phase === 'AV_VOTE' ? Object.keys(p.votes) : [],
      myVote: s.phase === 'AV_VOTE' ? p.votes[me?.id] ?? null : null,
      lastVote: p.lastVote,
      rejects: p.rejects,
      // Who holds Tiên Nữ Hồ, who may still be looked at, and who looked at
      // whom (everyone sees that much, never what they saw).
      lady: p.lady ?? null,
      ladyTargets: s.phase === 'AV_LADY' ? ladyTargets(p) : [],
      ladyLooks: p.ladyLooks || [],
      // How many of the team have played their card (never which).
      playedCount: s.phase === 'AV_QUEST' ? Object.keys(p.played).length : 0,
      me: {
        playing: !!playing,
        role,
        side: role ? AVALON_ROLES[role].side : null,
        sees: role ? knowledge(p, me.id) : null,
        played: s.phase === 'AV_QUEST' ? p.played[me?.id] || null : null,
        ladySaw: (p.ladySaw || {})[me?.id] || []
      },
      result: over ? { ...p.result, roles: p.roles, assassinPick: p.assassinPick } : null
    };
  }
};

const conf = (s) => ({ ...AVALON_DEFAULTS, ...(s.gameConfigs?.avalon || {}) });
const leaderId = (p) => p.ring[p.leader % p.ring.length];
const size = (s) => QUEST_SIZES[s.play.ring.length][s.play.quest];

// What each part learns at the start, as { label, ids }.
function knowledge(p, id) {
  const role = p.roles[id];
  const with_ = (fn) => p.ring.filter(x => x !== id && fn(p.roles[x]));
  if (role === 'merlin') return { label: 'Phe Ác (Mordred không hiện)', ids: with_(r => isEvil(r) && r !== 'mordred') };
  if (role === 'percival') {
    // Merlin and Morgana, in seat order, so the order gives nothing away.
    return { label: 'Một trong số này là Merlin', ids: with_(r => r === 'merlin' || r === 'morgana') };
  }
  if (isEvil(role) && role !== 'oberon') return { label: 'Đồng bọn phe Ác (Oberon không hiện)', ids: with_(r => isEvil(r) && r !== 'oberon') };
  return { label: null, ids: [] };
}

function beginPick(s, now, api) {
  s.play.team = [];
  s.play.votes = {};
  api.setPhase(s, 'AV_PICK', now, conf(s).pickTime * 1000);
}

function beginVote(s, now, api) {
  s.play.votes = {};
  api.log(s, `🗳️ Nhiệm vụ ${s.play.quest + 1}: ${api.nameOf(s, leaderId(s.play))} chọn ${s.play.team.map(id => api.nameOf(s, id)).join(', ')}.`);
  api.setPhase(s, 'AV_VOTE', now, conf(s).voteTime * 1000);
}

function resolveVote(s, now, api) {
  const p = s.play;
  const yes = p.ring.filter(id => p.votes[id]).length;
  const approved = yes > p.ring.length / 2;
  p.lastVote = { leader: leaderId(p), team: [...p.team], votes: { ...p.votes }, approved };
  api.log(s, `   ${approved ? 'Đội được duyệt' : 'Đội bị bác'} (${yes}/${p.ring.length} đồng ý).`);
  if (approved) {
    p.rejects = 0;
    p.played = {};
    return api.setPhase(s, 'AV_QUEST', now, conf(s).questTime * 1000);
  }
  p.rejects += 1;
  if (p.rejects >= 5) return finish(s, now, api, 'evil', 'Năm đội liên tiếp bị bác: phe Ác thắng.');
  p.leader += 1;
  beginPick(s, now, api);
}

function resolveQuest(s, now, api) {
  const p = s.play;
  const fails = Object.values(p.played).filter(x => x === 'fail').length;
  const success = fails < failsNeeded(p.ring.length, p.quest);
  p.results.push({ team: [...p.team], fails, success });
  api.log(s, `${success ? '✅' : '❌'} Nhiệm vụ ${p.quest + 1} ${success ? 'thành công' : 'thất bại'} (${fails} lá Thất bại).`);
  api.setPhase(s, 'AV_RESULT', now, RESULT_MS);
}

function afterQuest(s, now, api) {
  const p = s.play;
  const wins = p.results.filter(r => r.success).length;
  const losses = p.results.length - wins;
  if (losses >= 3) return finish(s, now, api, 'evil', 'Ba nhiệm vụ thất bại: phe Ác thắng.');
  if (wins >= 3) {
    api.log(s, '🗡️ Phe Thiện thắng 3 nhiệm vụ: Sát Thủ đoán ai là Merlin.');
    return api.setPhase(s, 'AV_ASSASSIN', now, conf(s).assassinTime * 1000);
  }
  if (p.lady && LADY_AFTER.includes(p.quest) && ladyTargets(p).length) {
    return api.setPhase(s, 'AV_LADY', now, conf(s).ladyTime * 1000);
  }
  nextQuest(s, now, api);
}

function nextQuest(s, now, api) {
  const p = s.play;
  p.quest += 1;
  p.leader += 1;
  beginPick(s, now, api);
}

// Players Tiên Nữ Hồ may look at: anyone who has never held her.
const ladyTargets = (p) => p.ring.filter(id => !p.ladyHeld.includes(id));

function ladyLook(s, now, api, target) {
  const p = s.play;
  if (!ladyTargets(p).includes(target)) api.fail('Không soi được người này (đã từng giữ Tiên Nữ Hồ).');
  const side = AVALON_ROLES[p.roles[target]].side;
  (p.ladySaw[p.lady] ||= []).push({ target, side });
  p.ladyLooks.push({ by: p.lady, target, quest: p.quest });
  api.log(s, `🌊 ${api.nameOf(s, p.lady)} dùng Tiên Nữ Hồ soi ${api.nameOf(s, target)}: phe ${side === 'good' ? 'Thiện' : 'Ác'}.`);
  p.lady = target;
  p.ladyHeld.push(target);
  nextQuest(s, now, api);
}

function assassinate(s, now, api, target) {
  const p = s.play;
  p.assassinPick = target;
  const hit = p.roles[target] === 'merlin';
  finish(s, now, api, hit ? 'evil' : 'good', hit
    ? `Sát Thủ chọn đúng Merlin (${api.nameOf(s, target)}): phe Ác lật ngược thế cờ.`
    : `Sát Thủ chọn ${api.nameOf(s, target)}, không phải Merlin: phe Thiện thắng.`);
}

function finish(s, now, api, winner, reason) {
  const p = s.play;
  p.result = { winner, reason };
  api.log(s, `🏆 PHE ${winner === 'good' ? 'THIỆN' : 'ÁC'} CHIẾN THẮNG! ${reason}`);
  api.record(s, 'avalon', winner, s.players.filter(x => x.inGame).map(x => {
    const side = AVALON_ROLES[p.roles[x.id]].side;
    return { player: x, side, won: side === winner };
  }));
  api.setPhase(s, 'GAME_OVER', now, null);
}
