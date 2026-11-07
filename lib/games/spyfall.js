// "Ai là gián điệp" (Spyfall). Everyone but the spy is told the place; the
// players question each other out loud, then catch the spy or let them go.
//
//   SPY_ROUND  questions, on the clock. Any player may accuse someone once a
//              round: everyone else votes, and only a unanimous yes convicts.
//              The round clock stops while they vote. The spy may stop
//              everything to guess the place.
//   SPY_VOTE   time is up: everyone names a suspect. More than half on one
//              player convicts them. The spy may still guess the place.
//   GAME_OVER  the spy is caught (villagers win), or an innocent is convicted,
//              nobody is, or the spy names the place (the spy wins).
//
// The room code (players, host, bots, the clock) lives in ../engine.js; this
// module runs the game itself on s.play, and the clock on s.game.phase*.

import { LOCATIONS, SPYFALL_DEFAULTS, SPYFALL_LIMITS } from '../../public/shared/spyfall.js';

const BOT_DELAY_MS = 2500;

export const spyfall = {
  id: 'spyfall',
  minPlayers: 3,
  defaults: SPYFALL_DEFAULTS,

  configure(conf, payload, api) {
    for (const [key, [min, max]] of Object.entries(SPYFALL_LIMITS)) {
      if (payload[key] === undefined) continue;
      const v = Math.round(Number(payload[key]));
      if (!Number.isFinite(v)) api.fail('Giá trị không hợp lệ.');
      conf[key] = Math.min(max, Math.max(min, v));
    }
  },

  start(s, now, rng, api) {
    const players = s.players.filter(p => p.inGame);
    const spy = api.pick(players, rng);
    const first = api.pick(players, rng);
    s.play = {
      location: Math.floor(rng() * LOCATIONS.length),
      spy: spy.id,
      first: first.id,
      accusation: null,
      accused: [], // who has used their accusation this round
      votes: {},
      result: null
    };
    api.log(s, `🕵️ Ván "Ai là gián điệp" bắt đầu. Địa điểm: ${LOCATIONS[s.play.location].name}. Gián điệp: ${spy.name}.`);
    api.setPhase(s, 'SPY_ROUND', now, conf(s).roundTime * 1000);
  },

  action(s, player, type, payload, now, rng, api) {
    const p = s.play;
    if (!player.inGame) api.fail('Bạn đang xem, không tham gia ván này.');
    switch (type) {
      case 'accuse': {
        if (s.phase !== 'SPY_ROUND') api.fail('Chỉ tố cáo được trong lúc hỏi đáp.');
        if (p.accusation) api.fail('Đang có một lời tố cáo, hãy bỏ phiếu trước.');
        if (p.accused.includes(player.id)) api.fail('Mỗi người chỉ tố cáo được một lần mỗi ván.');
        const target = s.players.find(x => x.id === payload.target && x.inGame);
        if (!target || target.id === player.id) api.fail('Hãy chọn một người khác.');
        p.accused.push(player.id);
        // The round clock stops while the table votes.
        p.accusation = { by: player.id, target: target.id, votes: { [player.id]: true }, roundLeft: Math.max(0, s.game.phaseEndsAt - now) };
        s.game.phaseStartedAt = now;
        s.game.phaseEndsAt = now + conf(s).accuseTime * 1000;
        api.log(s, `☝️ ${player.name} tố cáo ${target.name}.`);
        settleAccusation(s, now, api);
        return;
      }
      case 'accuseVote': {
        const a = p.accusation;
        if (s.phase !== 'SPY_ROUND' || !a) api.fail('Không có lời tố cáo nào.');
        if (player.id === a.target) api.fail('Người bị tố cáo không bỏ phiếu.');
        a.votes[player.id] = !!payload.yes;
        settleAccusation(s, now, api);
        return;
      }
      case 'guess': {
        if (!['SPY_ROUND', 'SPY_VOTE'].includes(s.phase)) api.fail('Ván đã kết thúc.');
        if (player.id !== p.spy) api.fail('Chỉ gián điệp mới đoán địa điểm.');
        if (p.accusation) api.fail('Hãy chờ bỏ phiếu xong lời tố cáo.');
        const i = Number(payload.location);
        if (!Number.isInteger(i) || !LOCATIONS[i]) api.fail('Địa điểm không hợp lệ.');
        p.guess = i;
        const right = i === p.location;
        finish(s, now, api, right ? 'spy' : 'village', right
          ? `Gián điệp ${player.name} đoán đúng địa điểm: ${LOCATIONS[i].name}.`
          : `Gián điệp ${player.name} đoán sai (${LOCATIONS[i].name}); địa điểm là ${LOCATIONS[p.location].name}.`);
        return;
      }
      case 'spyVote': {
        if (s.phase !== 'SPY_VOTE') api.fail('Chưa đến lúc bỏ phiếu.');
        const target = s.players.find(x => x.id === payload.target && x.inGame);
        if (!target || target.id === player.id) api.fail('Hãy chọn một người khác.');
        if (p.votes[player.id] === target.id) delete p.votes[player.id];
        else p.votes[player.id] = target.id;
        if (s.players.filter(x => x.inGame).every(x => p.votes[x.id])) api.finishEarly(s, now, 2500);
        return;
      }
      default:
        api.fail('Hành động không hợp lệ.');
    }
  },

  // The host's "skip": end the questions (or the vote) now.
  skip(s, now) {
    if (!s.play?.accusation) s.game.phaseEndsAt = now;
  },

  onTimeout(s, now, rng, api) {
    const p = s.play;
    if (s.phase === 'SPY_ROUND' && p.accusation) return failAccusation(s, now, api, 'hết giờ bỏ phiếu');
    if (s.phase === 'SPY_ROUND') {
      api.log(s, '⏰ Hết giờ hỏi đáp: cả bàn bỏ phiếu tìm gián điệp.');
      return api.setPhase(s, 'SPY_VOTE', now, conf(s).voteTime * 1000);
    }
    if (s.phase === 'SPY_VOTE') return resolveFinalVote(s, now, rng, api);
    s.game.phaseEndsAt = null;
  },

  bots(s, now, rng, api) {
    const p = s.play;
    const g = s.game;
    if (now < g.phaseStartedAt + BOT_DELAY_MS) return false;
    const bots = s.players.filter(x => x.isBot && x.inGame);
    if (!bots.length) return false;
    let changed = false;
    const act = (bot, type, payload) => {
      try { spyfall.action(s, bot, type, payload, now, rng, api); changed = true; } catch {}
    };
    const others = (bot) => s.players.filter(x => x.inGame && x.id !== bot.id);
    if (s.phase === 'SPY_ROUND' && p.accusation) {
      // Bots go along with an accusation about half the time.
      bots.filter(b => b.id !== p.accusation.target && p.accusation.votes[b.id] === undefined)
        .forEach(b => act(b, 'accuseVote', { yes: b.id !== p.spy && rng() < 0.5 }));
    } else if (s.phase === 'SPY_ROUND') {
      // A spy bot takes a guess once most of the time has gone.
      const spyBot = bots.find(b => b.id === p.spy);
      const total = g.phaseEndsAt - g.phaseStartedAt;
      if (spyBot && !p.botGuessed && now - g.phaseStartedAt > total * 0.7) {
        p.botGuessed = true;
        changed = true;
        if (rng() < 0.4) act(spyBot, 'guess', { location: Math.floor(rng() * LOCATIONS.length) });
      }
    } else if (s.phase === 'SPY_VOTE') {
      bots.filter(b => !p.votes[b.id]).forEach(b => act(b, 'spyVote', { target: api.pick(others(b), rng).id }));
    }
    return changed;
  },

  // What this player may see. The place is hidden from the spy until the end.
  view(s, me) {
    const p = s.play;
    if (!p) return null;
    const over = s.phase === 'GAME_OVER';
    const playing = !!me?.inGame;
    const isSpy = playing && me.id === p.spy;
    const a = p.accusation;
    return {
      first: p.first,
      me: {
        playing,
        spy: isSpy,
        location: playing && !isSpy ? p.location : null,
        canAccuse: playing && s.phase === 'SPY_ROUND' && !p.accused.includes(me.id)
      },
      accusation: a ? {
        by: a.by,
        target: a.target,
        yes: Object.values(a.votes).filter(Boolean).length,
        voted: Object.keys(a.votes).length,
        voters: s.players.filter(x => x.inGame && x.id !== a.target).length,
        mine: a.votes[me?.id]
      } : null,
      // Like hands raised around the table: who named whom.
      votes: s.phase === 'SPY_VOTE' || over ? p.votes : {},
      result: over ? { ...p.result, spy: p.spy, location: p.location, guess: p.guess ?? null } : null
    };
  }
};

const conf = (s) => ({ ...SPYFALL_DEFAULTS, ...(s.gameConfigs?.spyfall || {}) });

// Unanimous yes (everyone but the accused) convicts; one no, or the clock,
// drops the accusation and the questions go on.
function settleAccusation(s, now, api) {
  const a = s.play.accusation;
  const voters = s.players.filter(x => x.inGame && x.id !== a.target);
  if (voters.some(v => a.votes[v.id] === false)) return failAccusation(s, now, api, 'không đồng lòng');
  if (voters.every(v => a.votes[v.id] === true)) return convict(s, now, api, a.target);
}

function failAccusation(s, now, api, why) {
  const a = s.play.accusation;
  s.play.accusation = null;
  api.log(s, `🙅 Lời tố cáo ${api.nameOf(s, a.target)} không thành (${why}).`);
  s.game.phaseStartedAt = now;
  s.game.phaseEndsAt = now + a.roundLeft;
}

function convict(s, now, api, id) {
  s.play.accusation = null;
  s.play.convicted = id;
  const caught = id === s.play.spy;
  finish(s, now, api, caught ? 'village' : 'spy', caught
    ? `Cả bàn lật mặt được gián điệp ${api.nameOf(s, id)}.`
    : `${api.nameOf(s, id)} bị kết tội oan; gián điệp ${api.nameOf(s, s.play.spy)} thoát.`);
}

function resolveFinalVote(s, now, rng, api) {
  const p = s.play;
  const voters = s.players.filter(x => x.inGame);
  const tally = {};
  Object.values(p.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const [top, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [];
  if (top && n > voters.length / 2) return convict(s, now, api, top);
  finish(s, now, api, 'spy', `Không ai được quá nửa số phiếu; gián điệp ${api.nameOf(s, p.spy)} thoát.`);
}

function finish(s, now, api, winner, reason) {
  const p = s.play;
  p.result = { winner, reason };
  api.log(s, `🏆 ${winner === 'spy' ? 'GIÁN ĐIỆP' : 'DÂN THƯỜNG'} CHIẾN THẮNG! ${reason}`);
  api.record(s, 'spyfall', winner, s.players.filter(x => x.inGame).map(x => {
    const side = x.id === p.spy ? 'spy' : 'village';
    return { player: x, side, won: side === winner };
  }));
  api.setPhase(s, 'GAME_OVER', now, null);
}
