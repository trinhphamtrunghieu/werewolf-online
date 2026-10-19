// Shared between the browser and the Vercel function (plain ES module, no deps).

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 18;

// Night wake-up order. `role` is the card that makes the step happen; steps are
// called even when that card's holder is dead so nothing leaks. The couple and
// the charmed are not woken: they find each other's names on their cards.
export const NIGHT_STEPS = [
  { id: 'thief', role: 'thief', firstNightOnly: true },
  { id: 'cupid', role: 'cupid', firstNightOnly: true },
  { id: 'guard', role: 'guard' },
  { id: 'werewolf', role: 'werewolf' },
  { id: 'seer', role: 'seer' },
  { id: 'witch', role: 'witch' },
  { id: 'piper', role: 'piper' },
  { id: 'elder', role: 'elder', firstNightOnly: true },
  { id: 'hunter', role: 'hunter' }
];

// Cards dealt beyond the player count when the Thief is in the game.
export const THIEF_EXTRA_CARDS = 2;

export const ROLES = {
  werewolf: {
    id: 'werewolf',
    name: 'Ma Sói',
    team: 'werewolf',
    icon: '🐺',
    color: '#ff6b6b',
    short: 'Mỗi đêm cùng đàn Sói chọn 1 người để cắn.',
    description: 'Mỗi đêm thức dậy cùng đàn Sói và thống nhất chọn 1 người để cắn. Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" opacity="0.5"/>
      <path d="M26 78L32 45L22 20L42 34L50 26L58 34L78 20L68 45L74 78H26Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="38,50 45,54 38,56" fill="#fef08a"/>
      <polygon points="62,50 55,54 62,56" fill="#fef08a"/>
      <path d="M43 68L47 73L50 69L53 73L57 68" stroke="#fecaca" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`
  },
  seer: {
    id: 'seer',
    name: 'Tiên Tri',
    team: 'village',
    icon: '🔮',
    color: '#c39bff',
    short: 'Mỗi đêm soi 1 người để xem thuộc phe nào.',
    description: 'Mỗi đêm chọn 1 người để soi. Bạn sẽ biết người đó thuộc phe nào (Phe Sói, Phe Dân hoặc phe riêng của Người Thổi Sáo), không biết chức năng cụ thể.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="46" r="28" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M26 50C34 38 66 38 74 50C66 62 34 62 26 50Z" stroke="#fde047" stroke-width="2.5"/>
      <circle cx="50" cy="50" r="6" fill="#fde047"/>
      <path d="M32 76H68L62 84H38L32 76Z" fill="currentColor" opacity="0.6"/>
    </svg>`
  },
  guard: {
    id: 'guard',
    name: 'Bảo Vệ',
    team: 'village',
    icon: '🛡️',
    color: '#5cc8ff',
    short: 'Mỗi đêm bảo vệ 1 người khỏi bị Sói cắn.',
    description: 'Mỗi đêm chọn 1 người (có thể là chính mình) để bảo vệ khỏi Sói. Không được bảo vệ cùng một người 2 đêm liên tiếp.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 16L80 28V52C80 70 67 82 50 88C33 82 20 70 20 52V28L50 16Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M50 30V72M34 48H66" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  witch: {
    id: 'witch',
    name: 'Phù Thủy',
    team: 'village',
    icon: '🧪',
    color: '#4fe0a6',
    short: 'Có 1 bình cứu và 1 bình độc cho cả ván.',
    description: 'Có 1 bình Cứu và 1 bình Độc, mỗi bình dùng 1 lần trong cả ván. Bạn không biết ai bị Sói cắn: bình Cứu sẽ cứu người bị cắn đêm đó (nếu có). Bình Độc giết 1 người bạn chọn.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M42 20H58M46 20V34L26 68C23 74 27 82 34 82H66C73 82 77 74 74 68L54 34V20" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M31 62H69" stroke="#6ee7b7" stroke-width="2.5"/>
      <circle cx="45" cy="70" r="3" fill="#a7f3d0"/>
      <circle cx="56" cy="65" r="2.5" fill="#a7f3d0"/>
    </svg>`
  },
  hunter: {
    id: 'hunter',
    name: 'Thợ Săn',
    team: 'village',
    icon: '🎯',
    color: '#ffc861',
    short: 'Mỗi đêm chĩa súng vào 1 người; chết thì người đó chết theo.',
    description: 'Mỗi đêm thức dậy (lượt cuối cùng) và chĩa súng vào 1 người. Nếu bạn chết vì bất kỳ lý do gì, người đang bị chĩa súng chết theo. Bạn không được biết ai bị Sói cắn. Nếu đêm nào không chọn, súng vẫn chĩa vào người của đêm trước.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="32" stroke="currentColor" stroke-width="3"/>
      <circle cx="50" cy="50" r="16" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
      <circle cx="50" cy="50" r="4" fill="#fde047"/>
      <path d="M50 10V26M50 74V90M10 50H26M74 50H90" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  thief: {
    id: 'thief',
    name: 'Ăn Trộm',
    team: 'village',
    icon: '🦝',
    color: '#d7b48a',
    short: 'Đêm đầu được đổi lấy 1 trong 2 lá bài dư.',
    description: 'Có Ăn Trộm thì chia dư 2 lá. Đêm đầu bạn xem 2 lá dư và có thể đổi lấy 1 lá, rồi chơi theo vai trò mới ngay đêm đó. Nếu cả 2 lá đều là Ma Sói thì bắt buộc phải lấy 1 lá. Giữ nguyên thì bạn là Dân Làng.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M22 44C22 30 34 22 50 22C66 22 78 30 78 44V48H22V44Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <rect x="18" y="46" width="64" height="14" rx="7" fill="currentColor" fill-opacity="0.85"/>
      <circle cx="38" cy="53" r="4" fill="#161b36"/><circle cx="62" cy="53" r="4" fill="#161b36"/>
      <path d="M34 74C40 80 60 80 66 74" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  cupid: {
    id: 'cupid',
    name: 'Thần Tình Yêu',
    team: 'village',
    icon: '💘',
    color: '#ff8cc6',
    short: 'Đêm đầu ghép đôi 2 người thành Tình Nhân.',
    description: 'Đêm đầu tiên chọn 2 người làm Tình Nhân. Nếu 1 người chết, người kia chết theo. Nếu cặp đôi khác phe và là 2 người cuối cùng còn sống, họ cùng thắng.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 78C50 78 22 58 22 38C22 27 31 20 40 20C46 20 50 25 50 28C50 25 54 20 60 20C69 20 78 27 78 38C78 58 50 78 50 78Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="3"/>
      <path d="M22 76L78 24M78 24H64M78 24V38" stroke="#fbcfe8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  piper: {
    id: 'piper',
    name: 'Người Thổi Sáo',
    team: 'piper',
    icon: '🪈',
    color: '#9fd3ff',
    short: 'Mỗi đêm thôi miên 2 người. Phe riêng.',
    description: 'Bạn chơi một mình. Mỗi đêm thôi miên 2 người chưa bị thôi miên. Bạn thắng khi tất cả những người còn sống (trừ bạn) đều đã bị thôi miên.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M18 70L74 22" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
      <circle cx="38" cy="53" r="2.5" fill="#161b36"/><circle cx="48" cy="44" r="2.5" fill="#161b36"/><circle cx="58" cy="36" r="2.5" fill="#161b36"/>
      <path d="M70 58C76 52 82 56 80 62M74 70C80 64 88 68 86 74" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
    </svg>`
  },
  elder: {
    id: 'elder',
    name: 'Già Làng',
    team: 'village',
    icon: '👴',
    color: '#e3c9a0',
    short: 'Chịu được 1 lần Sói cắn. Dân giết nhầm thì cả làng mất chức năng.',
    description: 'Đêm đầu mở mắt để quản trò biết bạn là Già Làng. Lần đầu bị Sói cắn bạn không chết. Nhưng nếu chính dân làng giết bạn (treo cổ, bình Độc của Phù Thủy, súng Thợ Săn), mọi vai trò phe Dân sẽ mất chức năng đến hết ván.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="46" cy="32" r="14" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M36 40C38 50 54 50 56 40" stroke="currentColor" stroke-width="3"/>
      <path d="M24 84C24 66 34 56 46 56C58 56 66 64 68 74" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <path d="M74 30V86" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      <path d="M68 30C68 24 80 24 80 30" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  villager: {
    id: 'villager',
    name: 'Dân Làng',
    team: 'village',
    icon: '🧑‍🌾',
    color: '#c9d1e8',
    short: 'Ngủ cả đêm, ban ngày tìm ra Sói.',
    description: 'Không có chức năng ban đêm. Ban ngày hãy quan sát, thảo luận và bỏ phiếu để tìm ra Ma Sói.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="36" r="16" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M24 82C24 66 35 56 50 56C65 56 76 66 76 82" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  }
};

export const ROLE_IDS = Object.keys(ROLES);

export const TEAM_LABEL = {
  werewolf: 'Phe Ma Sói',
  village: 'Phe Dân Làng',
  piper: 'Phe riêng của Người Thổi Sáo'
};

// Display info for a night step.
export function stepInfo(stepId) {
  return ROLES[stepId] || null;
}

const UNIQUE_ROLES = ['thief', 'cupid', 'piper', 'elder', 'seer', 'witch', 'guard', 'hunter'];

export function emptyRoleCounts() {
  return Object.fromEntries(ROLE_IDS.map(id => [id, 0]));
}

export function computeBalancedRoles(playerCount) {
  const n = Math.max(0, playerCount);
  const c = emptyRoleCounts();
  if (n === 0) return c;
  c.werewolf = 1;
  if (n >= 2) c.seer = 1;
  if (n >= 4) c.guard = 1;
  if (n >= 6) { c.werewolf = 2; c.witch = 1; }
  if (n >= 7) c.cupid = 1;
  if (n >= 8) c.hunter = 1;
  if (n >= 9) c.thief = 1;
  if (n >= 10) c.werewolf = 3;
  if (n >= 11) c.piper = 1;
  if (n >= 12) c.elder = 1;
  if (n >= 13) c.werewolf = 4;
  if (n >= 16) c.werewolf = 5;
  const special = ROLE_IDS.reduce((sum, id) => sum + (id === 'villager' ? 0 : c[id]), 0);
  // The Thief brings two spare cards, filled with Villagers.
  c.villager = Math.max(0, cardsNeeded(c, n) - special);
  return c;
}

export function totalRoles(counts) {
  return ROLE_IDS.reduce((sum, id) => sum + (counts[id] || 0), 0);
}

export function cardsNeeded(counts, playerCount) {
  return playerCount + (counts.thief ? THIEF_EXTRA_CARDS : 0);
}

// Returns a Vietnamese error message, or null when the role setup is playable.
export function validateRoleCounts(counts, playerCount) {
  const total = totalRoles(counts);
  const wolves = counts.werewolf || 0;
  const needed = cardsNeeded(counts, playerCount);
  const dup = UNIQUE_ROLES.find(id => (counts[id] || 0) > 1);
  if (dup) return `Chỉ được có 1 lá ${ROLES[dup].name}.`;
  if (total !== needed) {
    return counts.thief
      ? `Có Ăn Trộm nên cần ${needed} lá bài (${playerCount} người + 2 lá dư), hiện có ${total}.`
      : `Số lá bài (${total}) phải bằng số người chơi (${playerCount}).`;
  }
  if (wolves < 1) return 'Cần ít nhất 1 Ma Sói.';
  if (wolves >= total - wolves) return 'Phe Sói đang đông bằng hoặc hơn phe Dân, hãy giảm bớt Sói.';
  return null;
}
