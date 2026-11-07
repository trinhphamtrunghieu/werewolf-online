// Avalon in the browser. app.js draws the room around it and passes its
// helpers in `h`.
import { AVALON_ROLES, AVALON_SIDES, QUEST_SIZES, AVALON_LIMITS } from '/shared/avalon.js';

const RULES = `
  <p>Phe <strong>Thiện</strong> (các hiệp sĩ) và phe <strong>Ác</strong> ẩn mình cùng đi 5 nhiệm vụ. Phe Ác biết nhau (trừ Oberon); <strong>Merlin</strong> biết phe Ác (trừ Mordred). <strong>Percival</strong> thấy Merlin và Morgana nhưng không biết ai là ai.</p>
  <ol class="rules-steps">
    <li>Đội trưởng (lần lượt quanh bàn) chọn đội làm nhiệm vụ, đủ số người nhiệm vụ cần.</li>
    <li>Cả bàn bỏ phiếu duyệt hay bác đội. Phiếu được giấu đến khi mọi người bầu xong, rồi lật cùng lúc. Hơn nửa duyệt thì đội lên đường; bị bác thì đội trưởng tiếp theo chọn lại. <strong>5 đội liên tiếp bị bác: phe Ác thắng.</strong></li>
    <li>Người trong đội bí mật chọn <strong>Thành công</strong> hay <strong>Thất bại</strong>. Phe Thiện chỉ được chọn Thành công. Một lá Thất bại là nhiệm vụ thất bại (nhiệm vụ 4 cần 2 lá, từ 7 người). Chỉ lật số lá Thất bại, không biết ai chọn.</li>
    <li>3 nhiệm vụ thất bại: phe Ác thắng. 3 nhiệm vụ thành công: <strong>Sát Thủ</strong> được đoán ai là Merlin; đoán trúng là phe Ác thắng, trật là phe Thiện thắng.</li>
  </ol>`;

const roleName = (r) => AVALON_ROLES[r]?.name || '';

function lobby(h) {
  const c = h.view.gameConfig;
  const n = h.view.players.length;
  const host = h.isHost();
  const sides = AVALON_SIDES[n];
  const toggles = [
    ['percival', 'Percival và Morgana', 'Percival thấy Merlin và Morgana, không biết ai là ai.'],
    ['mordred', 'Mordred', 'Phe Ác, Merlin không thấy.'],
    ['oberon', 'Oberon', 'Phe Ác, không biết đồng bọn và đồng bọn không biết.']
  ];
  const sliders = [['pickTime', 'Đội trưởng chọn đội', 15], ['voteTime', 'Bỏ phiếu duyệt đội', 5], ['questTime', 'Làm nhiệm vụ', 5]];
  return `
    <div class="section-head"><h2>Avalon</h2><p class="muted small">5–10 người</p></div>
    <p class="small" style="color:var(--soft)">Hiệp sĩ đi làm nhiệm vụ, phe Ác lẫn trong đội. Merlin biết kẻ xấu nhưng phải giấu mình khỏi Sát Thủ.</p>
    <p class="muted small" style="margin-top:6px">${sides ? `${n} người: ${sides[0]} Thiện, ${sides[1]} Ác. Đội cho 5 nhiệm vụ: ${QUEST_SIZES[n].join(' · ')}.` : 'Cần 5 đến 10 người.'} Vai đặc biệt chỉ có khi phe Ác đủ chỗ.</p>
    ${host ? `${toggles.map(([key, label, desc]) => `
      <label class="toggle-row">
        <span><strong>${label}</strong><span class="muted">${desc}</span></span>
        <input type="checkbox" data-act="avToggle" data-key="${key}" ${c[key] ? 'checked' : ''} />
      </label>`).join('')}
      ${sliders.map(([key, label, step]) => {
        const [min, max] = AVALON_LIMITS[key];
        return `<div class="slider">
          <div class="row-between"><label for="gc-${key}">${label}</label><span class="slider-value" id="gval-${key}">${h.fmtSeconds(c[key])}</span></div>
          <input type="range" id="gc-${key}" data-game-config="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}" />
        </div>`;
      }).join('')}`
    : `<p class="muted small">Vai: Merlin, Sát Thủ${c.percival ? ', Percival, Morgana' : ''}${c.mordred ? ', Mordred' : ''}${c.oberon ? ', Oberon' : ''}.</p>`}
    <button class="btn btn-link" data-act="rules">Xem luật chơi</button>`;
}

function title(view) {
  const p = view.play;
  if (view.phase === 'GAME_OVER') return 'Ván chơi kết thúc';
  const q = `Nhiệm vụ ${(p?.quest ?? 0) + 1}`;
  return { AV_PICK: `${q}: chọn đội`, AV_VOTE: `${q}: duyệt đội`, AV_QUEST: `${q}: lên đường`, AV_RESULT: `${q}: kết quả`, AV_ASSASSIN: 'Sát Thủ ra tay' }[view.phase] || '';
}

function subtitle(view, h) {
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return h.esc(p.result?.reason || '');
  if (view.phase === 'AV_PICK') return `Đội trưởng ${h.esc(h.nameOnly(p.leader))} chọn ${p.sizes[p.quest]} người.`;
  if (view.phase === 'AV_VOTE') return `Đã bỏ phiếu: ${p.voted.length}/${p.ring.length}.`;
  if (view.phase === 'AV_QUEST') return `Đội đã chọn: ${p.playedCount}/${p.team.length}.`;
  if (view.phase === 'AV_ASSASSIN') return 'Phe Thiện thắng 3 nhiệm vụ: Sát Thủ đoán ai là Merlin.';
  const r = p.results[p.results.length - 1];
  return r ? (r.success ? 'Nhiệm vụ thành công.' : 'Nhiệm vụ thất bại.') : '';
}

// The five quests and the rejected-team counter, always on top.
function track(h) {
  const p = h.view.play;
  return `
    <div class="quest-track" aria-label="Các nhiệm vụ">
      ${p.sizes.map((size, i) => {
        const r = p.results[i];
        const cls = r ? (r.success ? 'win' : 'lose') : i === p.quest && h.view.phase !== 'GAME_OVER' ? 'now' : '';
        return `<div class="quest ${cls}"><span class="n">${r ? (r.success ? '✓' : '✗') : size}</span><span class="lbl">${r ? (r.success ? 'Thành công' : `${r.fails} Thất bại`) : `${size} người${p.twoFails[i] ? ' · 2 lá' : ''}`}</span></div>`;
      }).join('')}
    </div>
    <p class="muted small" style="text-align:center;margin:6px 0 0">Đội bị bác liên tiếp: <strong>${p.rejects}</strong>/5</p>`;
}

function stage(h) {
  const { view } = h;
  const p = view.play;
  if (!p) return '';
  if (view.phase === 'GAME_OVER') return gameOver(h);
  const me = view.me.id;
  const seated = view.players.filter(x => x.inGame);
  const leaderMark = (x) => (x.id === p.leader ? '👑 đội trưởng' : '');
  let body = '';
  if (view.phase === 'AV_PICK') {
    const mine = p.leader === me;
    const need = p.sizes[p.quest];
    body = `
      <div class="panel">
        <p class="card-kicker"><span>Chọn đội</span><span class="icon" aria-hidden="true">👑</span></p>
        <h2>${mine ? `Chọn ${need} người` : `${h.esc(h.nameOnly(p.leader))} đang chọn đội`}</h2>
        <p class="lead">${mine ? 'Chạm vào người để thêm hoặc bỏ khỏi đội (có thể chọn cả bạn), rồi gửi cho cả bàn duyệt.' : 'Hãy thảo luận: đội trưởng nên chọn ai?'}</p>
        ${mine ? `<button class="btn btn-primary btn-block" style="margin-top:12px" data-act="avPropose" ${p.team.length === need ? '' : 'disabled'}>Gửi đội (${p.team.length}/${need})</button>` : ''}
        ${lastVote(h)}
      </div>
      ${h.roundTable(seated, {
        center: `<span>Đội<strong>${p.team.length}/${need}</strong></span>`,
        seatOpts: (x) => ({ selectable: mine, act: 'avPick', pressed: p.team.includes(x.id), sub: [leaderMark(x), p.team.includes(x.id) ? '⚔️ trong đội' : ''].filter(Boolean).join(' · ') })
      })}`;
  } else if (view.phase === 'AV_VOTE') {
    body = `
      <div class="panel stack">
        <p class="card-kicker"><span>Duyệt đội</span><span class="icon" aria-hidden="true">🗳️</span></p>
        <h2>Duyệt đội này?</h2>
        <p class="lead">Đội của ${h.esc(h.nameOnly(p.leader))}: <strong>${p.team.map(h.nameOnly).map(h.esc).join(', ')}</strong>. Phiếu được giấu đến khi mọi người bầu xong.</p>
        ${p.me.playing ? `<div class="judge">
          <button class="spare" data-act="avVote" data-approve="1" aria-pressed="${p.myVote === true}"><span class="big" aria-hidden="true">👍</span>Duyệt</button>
          <button class="kill" data-act="avVote" data-approve="0" aria-pressed="${p.myVote === false}"><span class="big" aria-hidden="true">👎</span>Bác</button>
        </div>` : ''}
        <p class="muted small">Đã bỏ phiếu: ${p.voted.length}/${p.ring.length}${p.myVote != null ? ' (có thể đổi trước khi đủ phiếu)' : ''}</p>
      </div>`;
  } else if (view.phase === 'AV_QUEST') {
    const onTeam = p.team.includes(me);
    const evil = p.me.side === 'evil';
    body = `
      <div class="panel stack">
        <p class="card-kicker"><span>Làm nhiệm vụ</span><span class="icon" aria-hidden="true">⚔️</span></p>
        <h2>${onTeam ? (p.me.played ? 'Đã chọn, chờ cả đội' : 'Thành công hay thất bại?') : 'Đội đang làm nhiệm vụ'}</h2>
        <p class="lead">${onTeam
          ? (p.me.played ? 'Lá của bạn đã được úp. Chỉ số lá Thất bại được lật.' : 'Che màn hình rồi chọn. Phe Thiện chỉ được chọn Thành công.')
          : `${p.team.map(h.nameOnly).map(h.esc).join(', ')} đang chọn lá. Chỉ số lá Thất bại được lật.`}</p>
        ${onTeam && !p.me.played ? `<div class="judge">
          <button class="spare" data-act="avQuest" data-fail="0"><span class="big" aria-hidden="true">🏆</span>Thành công</button>
          <button class="kill" data-act="avQuest" data-fail="1" ${evil ? '' : 'disabled'}><span class="big" aria-hidden="true">💀</span>Thất bại</button>
        </div>` : ''}
        <p class="muted small">Đã chọn: ${p.playedCount}/${p.team.length}</p>
      </div>`;
  } else if (view.phase === 'AV_RESULT') {
    const r = p.results[p.results.length - 1];
    body = `
      <div class="panel stack" style="text-align:center">
        <div style="font-size:3rem" aria-hidden="true">${r.success ? '🏆' : '💀'}</div>
        <h2>Nhiệm vụ ${p.results.length} ${r.success ? 'thành công' : 'thất bại'}</h2>
        <p class="result ${r.success ? 'result-village' : 'result-wolf'}">${r.fails} lá Thất bại trong đội ${r.team.map(h.nameOnly).map(h.esc).join(', ')}</p>
      </div>`;
  } else if (view.phase === 'AV_ASSASSIN') {
    const assassin = p.me.role === 'assassin';
    body = `
      <div class="panel">
        <p class="card-kicker"><span>Ám sát</span><span class="icon" aria-hidden="true">🗡️</span></p>
        <h2>${assassin ? 'Ai là Merlin?' : 'Sát Thủ đang chọn'}</h2>
        <p class="lead">${assassin ? 'Chạm vào người bạn nghi là Merlin. Phe Ác có thể bàn với nhau trước khi chọn.' : 'Phe Thiện đã thắng 3 nhiệm vụ. Nếu Sát Thủ chọn trúng Merlin, phe Ác thắng.'}</p>
      </div>
      ${h.roundTable(seated, {
        center: 'Merlin là ai?',
        seatOpts: (x) => ({ selectable: assassin && x.id !== me && !p.me.sees?.ids.includes(x.id), act: 'avAssassinate' })
      })}`;
  }
  return `<div class="panel" style="margin-bottom:12px">${track(h)}</div>${body}`;
}

function lastVote(h) {
  const v = h.view.play.lastVote;
  if (!v || v.approved) return '';
  const yes = Object.keys(v.votes).filter(id => v.votes[id]).map(h.nameOnly).map(h.esc);
  const no = Object.keys(v.votes).filter(id => !v.votes[id]).map(h.nameOnly).map(h.esc);
  return `<p class="small muted" style="margin-top:10px">Đội trước bị bác. Duyệt: ${yes.join(', ') || 'không ai'}. Bác: ${no.join(', ') || 'không ai'}.</p>`;
}

function gameOver(h) {
  const p = h.view.play;
  const r = p.result;
  const good = r.winner === 'good';
  return `
    <div class="panel" style="margin-bottom:12px">${track(h)}</div>
    <div class="panel winner">
      <div class="big" aria-hidden="true">${good ? '🛡️' : '🗡️'}</div>
      <h2>${good ? 'Phe Thiện chiến thắng' : 'Phe Ác chiến thắng'}</h2>
      <p class="lead">${h.esc(r.reason)}</p>
      <ul class="vote-list" style="text-align:left">${p.ring.map(id => {
        const role = r.roles[id];
        return `<li><strong>${h.esc(h.nameOnly(id))}</strong>: ${AVALON_ROLES[role].icon} ${roleName(role)}${AVALON_ROLES[role].side === 'evil' ? ' (Ác)' : ''}</li>`;
      }).join('')}</ul>
      ${h.isHost() ? '<button class="btn btn-primary btn-block" style="margin-top:16px" data-act="restart">Về phòng chờ, chơi ván mới</button>' : '<p class="muted small" style="margin-top:12px">Chờ chủ phòng mở ván mới.</p>'}
    </div>`;
}

function card(h) {
  const p = h.view.play;
  if (!p?.me.playing) return '<p class="muted">Bạn đang xem ván này.</p>';
  const r = AVALON_ROLES[p.me.role];
  const evil = r.side === 'evil';
  return `
    <div class="spy-card ${evil ? 'spy' : ''}">
      <p class="card-top"><span>${evil ? 'Phe Ác' : 'Phe Thiện'}</span></p>
      <div class="spy-icon" aria-hidden="true">${r.icon}</div>
      <h3>${r.name}</h3>
      <p class="desc">${r.desc}</p>
    </div>
    ${p.me.sees?.label ? `<div class="card-notes"><p><strong>${p.me.sees.label}:</strong> ${p.me.sees.ids.length ? p.me.sees.ids.map(h.nameOnly).map(h.esc).join(', ') : 'không có ai'}</p></div>` : ''}`;
}

function click(a, el, h) {
  switch (a) {
    case 'avPick': h.act('avPick', { target: el.dataset.id }); return true;
    case 'avPropose': h.act('avPropose'); return true;
    case 'avVote': h.act('avVote', { approve: el.dataset.approve === '1' }); return true;
    case 'avQuest': {
      const fail = el.dataset.fail === '1';
      if (confirm(fail ? 'Chọn Thất bại?' : 'Chọn Thành công?')) h.act('avQuest', { fail });
      return true;
    }
    case 'avAssassinate':
      if (confirm(`Ám sát ${h.nameOnly(el.dataset.id)}? Trúng Merlin là phe Ác thắng.`)) h.act('avAssassinate', { target: el.dataset.id });
      return true;
    case 'avToggle': h.act('gameConfig', { [el.dataset.key]: el.checked }); return true;
  }
  return false;
}

export const avalonUI = {
  rules: RULES,
  lobby,
  title,
  subtitle,
  stage,
  card,
  click,
  handHint: 'Vai và những gì bạn biết',
  sides: [['good', 'Phe Thiện', 'v'], ['evil', 'Phe Ác', 'w']]
};
