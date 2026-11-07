// "Ai là nội gián" (Undercover). Everyone gets a secret word; the undercover
// players get a close but different one, and nobody is told which word they
// have. Optionally one "Trắng" (Mr. White) gets no word at all.
//
//   UC_SPEAK   one player at a time describes their word in a few words,
//              around the table (the speaker taps "Xong", or time runs out).
//   UC_VOTE    everyone still in names who to send away. The most votes
//              leaves (a tie sends nobody); their part is shown.
//   UC_GUESS   Trắng, voted out, may guess the village's word: right, and
//              Trắng wins alone.
//   UC_OUT     a short pause on who left, then the next round.
//   GAME_OVER  the village wins once every undercover and Trắng is out; the
//              undercover side (with Trắng) wins once a single villager is
//              left.

import { WORD_PAIRS, UNDERCOVER_DEFAULTS, UNDERCOVER_LIMITS, autoUndercovers, sameWord } from '../../public/shared/undercover.js';

const BOT_DELAY_MS = 2500;
const OUT_MS = 6000;
const PART_NAME = { civilian: 'Dân thường', undercover: 'Nội gián', white: 'Trắng' };

export const undercover = {
  id: 'undercover',
  minPlayers: 4,
  defaults: UNDERCOVER_DEFAULTS,

  configure(c, payload, api) {
    for (const [key, [min, max]] of Object.entries(UNDERCOVER_LIMITS)) {
      if (payload[key] === undefined) continue;
      const v = Math.round(Number(payload[key]));
      if (!Number.isFinite(v)) api.fail('Giá trị không hợp lệ.');
      c[key] = Math.min(max, Math.max(min, v));
    }
    if (payload.mrWhite !== undefined) c.mrWhite = !!payload.mrWhite;
  },

  start(s, now, rng, api) {
    const c = conf(s);
    const players = api.shuffle(s.players.filter(p => p.inGame), rng);
    const n = players.length;
    const white = c.mrWhite ? 1 : 0;
    // Always leave the village a clear majority.
    const ucs = Math.max(1, Math.min(c.undercovers || autoUndercovers(n), Math.floor((n - 1 - white) / 2)));
    const pair = WORD_PAIRS[Math.floor(rng() * WORD_PAIRS.length)];
    const flip = rng() < 0.5;
    const roles = {};
    players.forEach((p, i) => { roles[p.id] = i < ucs ? 'undercover' : i < ucs + white ? 'white' : 'civilian'; });
    s.play = {
      words: { civilian: flip ? pair[1] : pair[0], undercover: flip ? pair[0] : pair[1] },
      roles,
      round: 0,
      order: [],
      speaker: 0,
      votes: {},
      out: [], // [{ id, role, round }]
      last: null,
      guess: null,
      result: null
    };
    api.log(s, `🗝️ Ván "Ai là nội gián" bắt đầu. Từ của dân: ${s.play.words.civilian}; từ của nội gián: ${s.play.words.undercover}.`);
    players.filter(p => roles[p.id] !== 'civilian').forEach(p => api.log(s, `   ${p.name}: ${PART_NAME[roles[p.id]]}`));
    beginRound(s, now, rng, api);
  },

  action(s, player, type, payload, now, rng, api) {
    const p = s.play;
    if (!player.inGame) api.fail('Bạn đang xem, không tham gia ván này.');
    const alive = player.alive;
    switch (type) {
      case 'spoke': {
        if (s.phase !== 'UC_SPEAK') api.fail('Chưa đến lượt mô tả.');
        if (p.order[p.speaker] !== player.id) api.fail('Chưa đến lượt bạn.');
        return nextSpeaker(s, now, rng, api);
      }
      case 'ucVote': {
        if (s.phase !== 'UC_VOTE') api.fail('Chưa đến lúc bỏ phiếu.');
        if (!alive) api.fail('Bạn đã bị loại.');
        const target = s.players.find(x => x.id === payload.target && x.inGame && x.alive);
        if (!target || target.id === player.id) api.fail('Hãy chọn một người khác còn trong ván.');
        if (p.votes[player.id] === target.id) delete p.votes[player.id];
        else p.votes[player.id] = target.id;
        if (inPlay(s).every(x => p.votes[x.id])) api.finishEarly(s, now, 2500);
        return;
      }
      case 'whiteGuess': {
        if (s.phase !== 'UC_GUESS' || p.last !== player.id) api.fail('Chưa đến lượt bạn đoán.');
        const word = String(payload.word || '').slice(0, 40).trim();
        if (!word) api.fail('Hãy nhập từ bạn đoán.');
        p.guess = word;
        if (sameWord(word, p.words.civilian)) {
          return finish(s, now, api, 'white', `${player.name} là Trắng và đoán đúng từ của dân: "${p.words.civilian}".`);
        }
        api.log(s, `❌ Trắng ${player.name} đoán "${word}", sai.`);
        return afterOut(s, now, rng, api);
      }
      default:
        api.fail('Hành động không hợp lệ.');
    }
  },

  skip(s, now) {
    s.game.phaseEndsAt = now;
  },

  onTimeout(s, now, rng, api) {
    switch (s.phase) {
      case 'UC_SPEAK': return nextSpeaker(s, now, rng, api);
      case 'UC_VOTE': return resolveVote(s, now, rng, api);
      case 'UC_GUESS':
        api.log(s, `⏰ Trắng ${api.nameOf(s, s.play.last)} không kịp đoán.`);
        return afterOut(s, now, rng, api);
      case 'UC_OUT': return beginRound(s, now, rng, api);
      default: s.game.phaseEndsAt = null;
    }
  },

  bots(s, now, rng, api) {
    const p = s.play;
    if (now < s.game.phaseStartedAt + BOT_DELAY_MS) return false;
    let changed = false;
    const act = (bot, type, payload) => {
      try { undercover.action(s, bot, type, payload, now, rng, api); changed = true; } catch {}
    };
    const bot = (id) => s.players.find(x => x.id === id && x.isBot);
    if (s.phase === 'UC_SPEAK') {
      const speaker = bot(p.order[p.speaker]);
      if (speaker) act(speaker, 'spoke', {});
    } else if (s.phase === 'UC_VOTE') {
      inPlay(s).filter(x => x.isBot && !p.votes[x.id]).forEach(b => {
        const options = inPlay(s).filter(x => x.id !== b.id);
        if (options.length) act(b, 'ucVote', { target: api.pick(options, rng).id });
      });
    } else if (s.phase === 'UC_GUESS') {
      const white = bot(p.last);
      if (white) act(white, 'whiteGuess', { word: api.pick(WORD_PAIRS, rng)[rng() < 0.5 ? 0 : 1] });
    }
    return changed;
  },

  view(s, me) {
    const p = s.play;
    if (!p) return null;
    const over = s.phase === 'GAME_OVER';
    const playing = !!me?.inGame;
    const role = playing ? p.roles[me.id] : null;
    return {
      round: p.round,
      order: p.order,
      speaker: s.phase === 'UC_SPEAK' ? p.order[p.speaker] : null,
      me: {
        playing,
        alive: playing && me.alive,
        // Your word, never whose side it is. Trắng knows they have none.
        word: role === 'white' ? null : role ? p.words[role] : null,
        white: role === 'white'
      },
      votes: ['UC_VOTE', 'UC_OUT', 'UC_GUESS'].includes(s.phase) || over ? p.votes : {},
      // Those voted out, with the part they played.
      out: p.out,
      last: p.last,
      guess: s.phase === 'UC_GUESS' ? null : p.guess,
      result: over ? { ...p.result, words: p.words, roles: p.roles } : null
    };
  }
};

const conf = (s) => ({ ...UNDERCOVER_DEFAULTS, ...(s.gameConfigs?.undercover || {}) });
const inPlay = (s) => s.players.filter(x => x.inGame && x.alive);

// A new round of descriptions: around the table, from a random player who is
// not Trắng (who would have nothing to go on).
function beginRound(s, now, rng, api) {
  const p = s.play;
  p.round += 1;
  p.votes = {};
  p.last = null;
  const ring = inPlay(s).sort((a, b) => a.seat - b.seat);
  const starters = ring.filter(x => p.roles[x.id] !== 'white');
  const first = api.pick(starters.length ? starters : ring, rng);
  const i = ring.indexOf(first);
  p.order = [...ring.slice(i), ...ring.slice(0, i)].map(x => x.id);
  p.speaker = 0;
  api.log(s, `🗣️ Vòng ${p.round}: ${api.nameOf(s, p.order[0])} mô tả trước.`);
  api.setPhase(s, 'UC_SPEAK', now, conf(s).speakTime * 1000);
}

function nextSpeaker(s, now, rng, api) {
  const p = s.play;
  p.speaker += 1;
  if (p.speaker < p.order.length) return api.setPhase(s, 'UC_SPEAK', now, conf(s).speakTime * 1000);
  api.setPhase(s, 'UC_VOTE', now, conf(s).voteTime * 1000);
}

function resolveVote(s, now, rng, api) {
  const p = s.play;
  const tally = {};
  Object.values(p.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) {
    api.log(s, `⚖️ Vòng ${p.round}: phiếu hoà, không ai bị loại.`);
    return api.setPhase(s, 'UC_OUT', now, OUT_MS);
  }
  const id = ranked[0][0];
  const out = s.players.find(x => x.id === id);
  out.alive = false;
  p.last = id;
  p.out.push({ id, role: p.roles[id], round: p.round });
  api.log(s, `🚪 ${out.name} bị loại (${ranked[0][1]} phiếu): ${PART_NAME[p.roles[id]]}.`);
  if (p.roles[id] === 'white') return api.setPhase(s, 'UC_GUESS', now, conf(s).guessTime * 1000);
  afterOut(s, now, rng, api);
}

// Who is left decides: the village has caught everyone, or only one villager
// is left with them.
function afterOut(s, now, rng, api) {
  const p = s.play;
  const left = inPlay(s);
  const villagers = left.filter(x => p.roles[x.id] === 'civilian').length;
  const others = left.length - villagers;
  if (!others) return finish(s, now, api, 'civilian', 'Dân thường đã loại hết nội gián.');
  if (villagers <= 1) return finish(s, now, api, 'undercover', 'Chỉ còn một dân thường: nội gián đã sống sót đến cuối.');
  api.setPhase(s, 'UC_OUT', now, OUT_MS);
}

function finish(s, now, api, winner, reason) {
  const p = s.play;
  p.result = { winner, reason };
  api.log(s, `🏆 ${{ civilian: 'DÂN THƯỜNG', undercover: 'NỘI GIÁN', white: 'TRẮNG' }[winner]} CHIẾN THẮNG! ${reason}`);
  // Trắng wins with the undercover side, or alone with the right guess.
  const won = (role) => winner === role || (winner === 'undercover' && role === 'white');
  api.record(s, 'undercover', winner, s.players.filter(x => x.inGame).map(x => ({
    player: x, side: p.roles[x.id], won: won(p.roles[x.id])
  })));
  api.setPhase(s, 'GAME_OVER', now, null);
}
