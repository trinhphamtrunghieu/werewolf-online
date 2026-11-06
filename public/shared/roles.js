// Shared between the browser and the Vercel function (plain ES module, no deps).

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 18;

// Night wake-up order. `role` is the card that makes the step happen; steps are
// called even when that card's holder is dead so nothing leaks. The couple and
// the charmed are not woken: they find each other's names on their cards.
export const NIGHT_STEPS = [
  { id: 'thief', role: 'thief', firstNightOnly: true },
  { id: 'cupid', role: 'cupid', firstNightOnly: true },
  { id: 'doppelganger', role: 'doppelganger', firstNightOnly: true },
  { id: 'hoodlum', role: 'hoodlum', firstNightOnly: true },
  { id: 'blesser', role: 'blesser' },
  { id: 'guard', role: 'guard' },
  // The Wolf Cub, the Avenger and the Lone Wolf wake with the pack.
  { id: 'werewolf', role: 'werewolf', also: ['wolf_cub', 'avenger', 'lone_wolf'] },
  { id: 'avenger', role: 'avenger' },
  { id: 'martyr', role: 'martyr' },
  // The Apprentice Seer takes the Seer's turn once the Seer is dead.
  { id: 'seer', role: 'seer', also: ['apprentice_seer'] },
  { id: 'aura_seer', role: 'aura_seer' },
  { id: 'detective', role: 'detective' },
  { id: 'pi', role: 'pi' },
  { id: 'sorcerer', role: 'sorcerer' },
  { id: 'priest', role: 'priest' },
  { id: 'witch', role: 'witch' },
  { id: 'medium', role: 'medium' },
  { id: 'piper', role: 'piper' },
  { id: 'ghost', role: 'ghost' },
  { id: 'spellcaster', role: 'spellcaster' },
  { id: 'old_hag', role: 'old_hag' },
  { id: 'troublemaker', role: 'troublemaker' },
  { id: 'elder', role: 'elder', firstNightOnly: true },
  { id: 'hunter', role: 'hunter' }
];

// Card art for the roles added from Ultimate Werewolf: the role's emblem in
// a ring, in the card's colour.
const glyph = (emoji) => `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="38" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="3"/>
      <circle cx="50" cy="50" r="30" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.6"/>
      <text x="50" y="64" font-size="38" text-anchor="middle" fill="currentColor">${emoji}</text>
    </svg>`;

// Cards dealt beyond the player count when the Thief is in the game.
export const THIEF_EXTRA_CARDS = 2;

export const ROLES = {
  werewolf: {
    id: 'werewolf',
    points: -6,
    name: 'Ma Sói',
    team: 'werewolf',
    icon: '🐺',
    color: '#ff6b6b',
    short: 'Mỗi đêm cùng đàn Sói chọn 1 người để cắn.',
    description: 'Mỗi đêm thức dậy cùng đàn Sói và thống nhất chọn 1 người để cắn (cắn cả đồng bọn cũng được), hoặc chọn không cắn ai. "Không cắn ai" không tính là phiếu: nếu cả đàn chọn khác nhau, người được chọn nhiều nhất bị cắn (bằng phiếu thì bốc ngẫu nhiên); chỉ khi không con nào chọn ai thì đêm đó không ai bị cắn. Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại.',
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
    points: 7,
    name: 'Tiên Tri',
    team: 'village',
    icon: '🔮',
    color: '#c39bff',
    short: 'Mỗi đêm soi 1 người: biết có phải phe Dân hay không.',
    description: 'Mỗi đêm chọn 1 người để soi. Bạn chỉ biết người đó có phải phe Dân hay không (Sói, phe thứ ba, Tay Sai và Pháp Sư Hắc Ám đều là "không phải Dân"), không biết chức năng cụ thể.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="46" r="28" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M26 50C34 38 66 38 74 50C66 62 34 62 26 50Z" stroke="#fde047" stroke-width="2.5"/>
      <circle cx="50" cy="50" r="6" fill="#fde047"/>
      <path d="M32 76H68L62 84H38L32 76Z" fill="currentColor" opacity="0.6"/>
    </svg>`
  },
  guard: {
    id: 'guard',
    points: 3,
    name: 'Bảo Vệ',
    team: 'village',
    icon: '🛡️',
    color: '#5cc8ff',
    short: 'Mỗi đêm bảo vệ 1 người khỏi bị Sói cắn.',
    description: 'Mỗi đêm chọn 1 người để bảo vệ khỏi Sói. Từ đêm thứ hai được tự bảo vệ mình (đêm đầu thì không). Không được bảo vệ cùng một người 2 đêm liên tiếp.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 16L80 28V52C80 70 67 82 50 88C33 82 20 70 20 52V28L50 16Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M50 30V72M34 48H66" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  witch: {
    id: 'witch',
    points: 4,
    name: 'Phù Thủy',
    team: 'village',
    icon: '🧪',
    color: '#4fe0a6',
    short: 'Có 1 bình cứu và 1 bình độc cho cả ván.',
    description: 'Có 1 bình Cứu và 1 bình Độc, mỗi bình dùng 1 lần trong cả ván (còn cả 2 bình thì được dùng cả 2 trong cùng một đêm). Bạn không biết ai bị Sói cắn: bình Cứu sẽ cứu người bị cắn đêm đó (nếu có, kể cả 2 người vào đêm Sói cắn đôi) và vẫn mất nếu đêm đó không ai bị cắn. Bình Độc giết 1 người bạn chọn.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M42 20H58M46 20V34L26 68C23 74 27 82 34 82H66C73 82 77 74 74 68L54 34V20" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M31 62H69" stroke="#6ee7b7" stroke-width="2.5"/>
      <circle cx="45" cy="70" r="3" fill="#a7f3d0"/>
      <circle cx="56" cy="65" r="2.5" fill="#a7f3d0"/>
    </svg>`
  },
  hunter: {
    id: 'hunter',
    points: 3,
    name: 'Thợ Săn',
    team: 'village',
    icon: '🎯',
    color: '#ffc861',
    short: 'Mỗi đêm chĩa súng vào 1 người; chết thì người đó chết theo.',
    description: 'Mỗi đêm thức dậy (lượt cuối cùng) và chĩa súng vào 1 người. Nếu bạn chết vì bất kỳ lý do gì, người đang bị chĩa súng chết theo. Bạn không được biết ai bị Sói cắn. Nếu đêm nào không chọn, súng vẫn chĩa vào người của đêm trước. Súng chỉ nổ một lần cả ván, kể cả khi bạn được hồi sinh.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="32" stroke="currentColor" stroke-width="3"/>
      <circle cx="50" cy="50" r="16" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
      <circle cx="50" cy="50" r="4" fill="#fde047"/>
      <path d="M50 10V26M50 74V90M10 50H26M74 50H90" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  thief: {
    id: 'thief',
    points: 1,
    name: 'Ăn Trộm',
    team: 'village',
    icon: '🦝',
    color: '#d7b48a',
    short: 'Đêm đầu được đổi lấy 1 trong 2 lá bài dư.',
    description: 'Có Ăn Trộm thì chia dư 2 lá. Đêm đầu bạn xem 2 lá dư và có thể đổi lấy 1 lá, rồi chơi theo vai trò mới ngay đêm đó. Nếu cả 2 lá đều là Sói (Ma Sói, Sói Con, Sói Báo Thù) thì bắt buộc phải lấy 1 lá. Giữ nguyên, hoặc hết giờ mà chưa chọn, thì bạn chơi như Dân Làng.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M22 44C22 30 34 22 50 22C66 22 78 30 78 44V48H22V44Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <rect x="18" y="46" width="64" height="14" rx="7" fill="currentColor" fill-opacity="0.85"/>
      <circle cx="38" cy="53" r="4" fill="#161b36"/><circle cx="62" cy="53" r="4" fill="#161b36"/>
      <path d="M34 74C40 80 60 80 66 74" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  cupid: {
    id: 'cupid',
    points: -3,
    name: 'Thần Tình Yêu',
    team: 'village',
    icon: '💘',
    color: '#ff8cc6',
    short: 'Đêm đầu ghép đôi 2 người thành Tình Nhân.',
    description: 'Đêm đầu tiên chọn 2 người làm Tình Nhân (có thể chọn chính mình). Cặp đôi không bị gọi dậy: tên và vai của người kia hiện trên lá bài của họ. Nếu 1 người chết, người kia chết theo. Cặp đôi cùng phe thì thắng cùng phe đó. Cặp đôi khác phe thành một phe riêng (không còn tính vào phe cũ) và chỉ thắng khi là 2 người cuối cùng còn sống.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 78C50 78 22 58 22 38C22 27 31 20 40 20C46 20 50 25 50 28C50 25 54 20 60 20C69 20 78 27 78 38C78 58 50 78 50 78Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="3"/>
      <path d="M22 76L78 24M78 24H64M78 24V38" stroke="#fbcfe8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  piper: {
    id: 'piper',
    points: 1,
    name: 'Người Thổi Sáo',
    team: 'piper',
    icon: '🪈',
    color: '#9fd3ff',
    short: 'Mỗi đêm thôi miên 2 người. Phe riêng.',
    description: 'Bạn chơi một mình. Mỗi đêm thôi miên 2 người chưa bị thôi miên. Người bị thôi miên không bị gọi dậy: họ thấy tên nhau trên lá bài. Bạn thắng khi tất cả những người còn sống (trừ bạn) đều đã bị thôi miên.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M18 70L74 22" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
      <circle cx="38" cy="53" r="2.5" fill="#161b36"/><circle cx="48" cy="44" r="2.5" fill="#161b36"/><circle cx="58" cy="36" r="2.5" fill="#161b36"/>
      <path d="M70 58C76 52 82 56 80 62M74 70C80 64 88 68 86 74" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
    </svg>`
  },
  elder: {
    id: 'elder',
    points: 1,
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
  wolf_cub: {
    id: 'wolf_cub',
    points: -8,
    name: 'Sói Con',
    team: 'werewolf',
    icon: '🐺',
    color: '#ff9a8a',
    short: 'Thức dậy cùng Sói. Sói Con chết thì đêm sau Sói được cắn 2 người.',
    description: 'Thuộc phe Sói, mỗi đêm thức dậy và chọn nạn nhân cùng đàn Sói. Khi Sói Con chết (vì bất kỳ lý do gì), đêm tiếp theo đàn Sói được cắn 2 người. Chỉ một lần cả ván, kể cả khi Sói Con được hồi sinh rồi chết lại.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M32 74L36 50L28 32L44 42L50 36L56 42L72 32L64 50L68 74H32Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="43" cy="55" r="3" fill="#fef08a"/><circle cx="57" cy="55" r="3" fill="#fef08a"/>
      <path d="M46 66Q50 69 54 66" stroke="#fecaca" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`
  },
  priest: {
    id: 'priest',
    points: 3,
    name: 'Mục Sư',
    team: 'village',
    icon: '✝️',
    color: '#f5e6a8',
    short: 'Một lần mỗi ván vẩy nước thánh: trúng Sói thì Sói chết, trúng phe Dân thì Mục Sư chết.',
    description: 'Một lần trong cả ván, ban đêm bạn vẩy nước thánh vào 1 người. Nếu người đó là Sói (Sói thường, Sói Con, Sói Báo Thù), họ chết vào sáng hôm sau. Nếu người đó thuộc phe Dân, chính bạn sẽ chết. Nếu người đó thuộc phe thứ ba thì không có gì xảy ra.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 16V84M30 36H70" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      <path d="M70 62C70 70 78 70 78 62C78 56 74 52 74 52C74 52 70 56 70 62Z" fill="#bae6fd"/>
    </svg>`
  },
  detective: {
    id: 'detective',
    points: 3,
    name: 'Thám Tử',
    team: 'village',
    icon: '🕵️',
    color: '#8fd3c8',
    short: 'Mỗi đêm chọn 2 người, biết họ có cùng phe không.',
    description: 'Mỗi đêm chọn 2 người. Bạn sẽ biết hai người đó có cùng phe hay không (các phe: Sói, Dân, phe thứ ba như Người Thổi Sáo, Kẻ Cuồng Loạn, Kẻ Côn Đồ; cặp Tình Nhân khác phe còn sống cả hai được tính là một phe riêng), nhưng không biết họ thuộc phe nào. Phe được xét theo hiện tại (Sói Nguyền đã hoá Sói tính là Sói).',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="44" cy="44" r="20" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="4"/>
      <path d="M58 58L78 78" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
      <path d="M36 44H52" stroke="#a7f3d0" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  medium: {
    id: 'medium',
    points: 3,
    name: 'Thầy Đồng',
    team: 'village',
    icon: '🕯️',
    color: '#d6b4ff',
    short: 'Một lần mỗi ván hồi sinh 1 người đã chết.',
    description: 'Một lần trong cả ván, ban đêm bạn chọn 1 người đã chết để hồi sinh. Sáng hôm sau người đó sống lại với vai trò cũ, nhưng kỹ năng nào đã dùng thì không dùng lại được (bình thuốc, nước thánh, phát súng của Thợ Săn…). Bạn chỉ được gọi dậy khi đã có người chết và chưa dùng năng lực.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <rect x="38" y="44" width="24" height="40" rx="4" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M50 18C56 26 58 32 50 40C42 32 44 26 50 18Z" fill="#fde68a" stroke="#fbbf24" stroke-width="2"/>
    </svg>`
  },
  fool: {
    id: 'fool',
    points: 1,
    name: 'Kẻ Cuồng Loạn',
    team: 'fool',
    icon: '🤡',
    color: '#c58cff',
    short: 'Phe thứ ba. Thắng riêng nếu bị dân làng treo cổ.',
    description: 'Bạn thuộc phe thứ ba và không có chức năng ban đêm. Nếu bạn bị dân làng treo cổ, ván chơi kết thúc ngay và bạn thắng một mình. Hãy khiến cả làng nghi ngờ bạn!',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="56" r="24" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M26 44L34 18L50 34L66 18L74 44" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <path d="M40 62Q50 72 60 62" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  avenger: {
    id: 'avenger',
    points: -7,
    name: 'Sói Báo Thù',
    team: 'werewolf',
    icon: '🗡️',
    color: '#ff9f6b',
    short: 'Phe Sói. Bị treo cổ thì người đã chọn chết theo.',
    description: 'Thuộc phe Sói: mỗi đêm thức dậy và cắn cùng đàn Sói. Sau đó bạn được gọi riêng để chọn 1 người (đêm nào không chọn thì giữ người cũ). Nếu bạn bị dân làng treo cổ, người đó chết theo ngay (chỉ một lần cả ván, kể cả khi được hồi sinh).',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M30 70L66 34L74 26L70 38L36 74Z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <path d="M26 64L36 74M22 78L30 70" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
    </svg>`
  },
  cursed: {
    id: 'cursed',
    points: -3,
    name: 'Sói Nguyền',
    team: 'village',
    icon: '🌑',
    color: '#b8a4d9',
    short: 'Phe Dân. Bị Sói cắn thì không chết mà hoá Sói.',
    description: 'Bạn bắt đầu ở phe Dân và không có chức năng ban đêm (Tiên Tri soi ra Dân). Nếu bị Sói cắn, bạn không chết mà hoá thành Ma Sói: từ đêm sau bạn thức dậy, cắn cùng đàn Sói và thắng cùng phe Sói. Được Bảo Vệ che chở hoặc Phù Thủy cứu thì bạn vẫn là Dân.',
    art: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="30" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>
      <path d="M62 24C48 30 42 46 48 60C53 72 66 78 78 74C72 82 62 86 50 86" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <polygon points="40,46 47,50 40,52" fill="#fef08a"/>
      <path d="M34 66L38 70L41 66L44 70L48 66" stroke="#fecaca" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`
  },
  // ---- Roles from Ultimate Werewolf (points = Village Impact on the card).
  apprentice_seer: {
    id: 'apprentice_seer', points: 4, name: 'Tiên Tri Tập Sự', team: 'village', icon: '🔭', color: '#b8a2ff',
    short: 'Khi Tiên Tri chết, bạn trở thành Tiên Tri.',
    description: 'Ban đầu bạn không có chức năng. Khi Tiên Tri chết, từ đêm sau bạn được gọi dậy thay Tiên Tri: mỗi đêm soi 1 người để biết có phải phe Dân hay không.',
    art: glyph('🔭')
  },
  aura_seer: {
    id: 'aura_seer', points: 3, name: 'Tiên Tri Hào Quang', team: 'village', icon: '✨', color: '#f0d77a',
    short: 'Mỗi đêm soi 1 người: có chức năng đặc biệt hay không.',
    description: 'Mỗi đêm chọn 1 người. Bạn biết người đó có vai đặc biệt hay chỉ là Dân Làng / Ma Sói thường. Không biết họ thuộc phe nào.',
    art: glyph('✨')
  },
  pi: {
    id: 'pi', points: 3, name: 'Nhà Ngoại Cảm', team: 'village', icon: '🧿', color: '#7fd6e8',
    short: 'Một lần mỗi ván: biết có Sói trong 1 người và 2 người ngồi cạnh hay không.',
    description: 'Một lần trong cả ván, ban đêm bạn chọn 1 người. Bạn biết trong người đó và 2 người ngồi hai bên (theo số ghế, chỉ tính người còn sống) có ít nhất 1 Sói hay không, nhưng không biết là ai.',
    art: glyph('🧿')
  },
  blesser: {
    id: 'blesser', points: 3, name: 'Thầy Tu', team: 'village', icon: '📿', color: '#e8dcb0',
    short: 'Một lần mỗi ván ban phước cho 1 người: lần đầu bị giết người đó sống sót.',
    description: 'Một lần trong cả ván, ban đêm bạn ban phước cho 1 người khác. Lần đầu tiên người đó bị giết (Sói cắn, bình Độc, nước thánh, súng, treo cổ…) thì không chết. Phước vẫn còn kể cả khi bạn đã chết.',
    art: glyph('📿')
  },
  martyr: {
    id: 'martyr', points: 3, name: 'Người Tử Đạo', team: 'village', icon: '🕊️', color: '#d9e4ff',
    short: 'Một lần mỗi ván: chết thay người bị Sói cắn.',
    description: 'Mỗi đêm sau lượt Sói, bạn được biết Sói cắn ai và có thể chết thay người đó (chỉ một lần cả ván). Bảo Vệ hoặc bình Cứu vẫn có thể cứu bạn.',
    art: glyph('🕊️')
  },
  tough_guy: {
    id: 'tough_guy', points: 3, name: 'Gã Cứng Cựa', team: 'village', icon: '💪', color: '#ffb37a',
    short: 'Bị Sói cắn thì sống thêm một ngày, đêm sau mới chết.',
    description: 'Nếu bị Sói cắn, bạn không chết ngay: sáng hôm đó cả làng nghe "không ai chết", và bạn chết vào đêm tiếp theo. Bạn được báo trong Nhật ký để tranh thủ một ngày cuối.',
    art: glyph('💪')
  },
  prince: {
    id: 'prince', points: 3, name: 'Hoàng Tử', team: 'village', icon: '🤴', color: '#ffd76b',
    short: 'Lần đầu bị treo cổ: lộ là Hoàng Tử và không chết.',
    description: 'Lần đầu dân làng biểu quyết treo cổ bạn, bạn được lật bài là Hoàng Tử và không bị treo. Lần sau thì không còn được tha.',
    art: glyph('🤴')
  },
  diseased: {
    id: 'diseased', points: 3, name: 'Người Bệnh', team: 'village', icon: '🤒', color: '#a8e6a1',
    short: 'Sói ăn phải bạn thì đêm sau cả đàn ốm, cắn ai cũng không chết.',
    description: 'Nếu Sói cắn chết bạn, cả đàn bị lây bệnh: đêm tiếp theo Sói vẫn chọn người như thường nhưng người bị cắn không chết.',
    art: glyph('🤒')
  },
  mayor: {
    id: 'mayor', points: 2, name: 'Trưởng Làng', team: 'village', icon: '🎖️', color: '#ffcf70',
    short: 'Phiếu của bạn được tính gấp đôi (bí mật).',
    description: 'Khi bỏ phiếu nghi phạm và khi biểu quyết treo cổ, phiếu của bạn được tính là 2 phiếu. Không ai biết điều này ngoài bạn.',
    art: glyph('🎖️')
  },
  troublemaker: {
    id: 'troublemaker', points: 2, name: 'Kẻ Gây Rối', team: 'village', icon: '🔥', color: '#ff8a5c',
    short: 'Một lần mỗi ván: hôm sau làng treo cổ 2 lần.',
    description: 'Một lần trong cả ván, ban đêm bạn có thể "gây rối": ngày hôm sau, sau lần treo cổ đầu tiên, cả làng phải bỏ phiếu thêm một lần nữa.',
    art: glyph('🔥')
  },
  idiot: {
    id: 'idiot', points: 2, name: 'Gã Khờ', team: 'village', icon: '🥴', color: '#e5c98f',
    short: 'Luôn biểu quyết "treo cổ".',
    description: 'Phe Dân. Khi cả làng biểu quyết treo cổ hay tha, phiếu của bạn luôn là "treo cổ".',
    art: glyph('🥴')
  },
  mason: {
    id: 'mason', points: 2, name: 'Hội Kín', team: 'village', icon: '🤝', color: '#9fc5e8',
    short: 'Các Hội Kín biết nhau ngay từ đầu. Phải có ít nhất 2 lá.',
    description: 'Phe Dân. Tên các thành viên Hội Kín khác hiện trên lá bài của bạn. Theo luật gốc, ai nhắc tới Hội Kín sẽ bị phạt, hãy giữ bí mật.',
    art: glyph('🤝')
  },
  ghost: {
    id: 'ghost', points: 2, name: 'Hồn Ma', team: 'village', icon: '👻', color: '#cfd8ff',
    short: 'Chết ngay đêm đầu; mỗi đêm để lại 1 chữ cái cho cả làng.',
    description: 'Bạn chết ngay đêm đầu tiên. Mỗi đêm (kể cả đêm đầu) bạn chọn 1 chữ cái, sáng ra cả làng thấy chữ đó. Không được dùng chữ để chỉ thẳng tên ai. Bạn không được nói chuyện với người còn sống.',
    art: glyph('👻')
  },
  spellcaster: {
    id: 'spellcaster', points: 1, name: 'Pháp Sư Phong Ấn', team: 'village', icon: '🤐', color: '#b5a8ff',
    short: 'Mỗi đêm có thể làm 1 người bị câm vào ngày hôm sau.',
    description: 'Mỗi đêm bạn có thể chọn 1 người (kể cả mình): ngày hôm sau người đó không được nói, chỉ được ra hiệu và vẫn được bỏ phiếu. Mỗi người chỉ bị câm một lần trong cả ván.',
    art: glyph('🤐')
  },
  old_hag: {
    id: 'old_hag', points: 1, name: 'Mụ Già', team: 'village', icon: '🧙‍♀️', color: '#c9b38a',
    short: 'Mỗi đêm đuổi 1 người ra khỏi làng vào ngày hôm sau.',
    description: 'Mỗi đêm chọn 1 người khác: ngày hôm sau người đó phải rời khỏi làng, không được thảo luận, không được bỏ phiếu và cũng không bị bỏ phiếu.',
    art: glyph('🧙‍♀️')
  },
  old_man: {
    id: 'old_man', points: 0, name: 'Ông Lão', team: 'village', icon: '👨‍🦳', color: '#d6d0c4',
    short: 'Chết vì tuổi già vào đêm thứ (số Sói còn sống + 1).',
    description: 'Phe Dân. Bạn sẽ chết vì tuổi già vào đêm thứ X, với X là số Sói còn sống cộng 1. Mỗi khi một con Sói chết, ngày của bạn đến sớm hơn.',
    art: glyph('👨‍🦳')
  },
  lycan: {
    id: 'lycan', points: -1, name: 'Người Lai Sói', team: 'village', icon: '🐾', color: '#d39a7a',
    short: 'Phe Dân, nhưng Tiên Tri soi ra không phải Dân.',
    description: 'Bạn là người phe Dân mang dòng máu Sói: Tiên Tri soi bạn sẽ thấy không phải Dân. Hãy thuyết phục cả làng rằng bạn vô tội.',
    art: glyph('🐾')
  },
  pacifist: {
    id: 'pacifist', points: -2, name: 'Người Hoà Bình', team: 'village', icon: '☮️', color: '#a7e3c9',
    short: 'Luôn biểu quyết "tha".',
    description: 'Phe Dân. Khi cả làng biểu quyết treo cổ hay tha, phiếu của bạn luôn là "tha".',
    art: glyph('☮️')
  },
  doppelganger: {
    id: 'doppelganger', points: -2, name: 'Kẻ Song Trùng', team: 'village', icon: '🎭', color: '#c7a6e8',
    short: 'Đêm đầu chọn 1 người; người đó chết thì bạn nhận vai của họ.',
    description: 'Đêm đầu chọn 1 người. Khi người đó chết, bạn bí mật nhận vai (và phe) của họ, kể cả nếu đó là Sói. Trước đó bạn thuộc phe Dân.',
    art: glyph('🎭')
  },
  drunk: {
    id: 'drunk', points: -3, name: 'Kẻ Say', team: 'village', icon: '🍺', color: '#e8c36a',
    short: 'Hai ngày đầu nghĩ mình là Dân; đêm thứ ba tỉnh rượu và biết vai thật.',
    description: 'Lá bài của bạn hiện là Dân Làng cho đến đêm thứ ba, khi bạn tỉnh rượu và biết vai thật của mình (Ma Sói, Dân Làng hoặc một vai không có chức năng ban đêm). Tiên Tri soi bạn thấy vai thật.',
    art: glyph('🍺')
  },
  sorcerer: {
    id: 'sorcerer', points: -3, name: 'Pháp Sư Hắc Ám', team: 'werewolf', icon: '🌘', color: '#e07ac0',
    short: 'Phe Sói. Mỗi đêm đi tìm Tiên Tri.',
    description: 'Thuộc phe Sói nhưng không thức dậy cùng Sói và Sói không biết bạn. Mỗi đêm chọn 1 người để biết người đó có phải Tiên Tri không. Tiên Tri soi bạn thấy không phải Dân.',
    art: glyph('🌘')
  },
  lone_wolf: {
    id: 'lone_wolf', points: -5, name: 'Sói Đơn Độc', team: 'werewolf', icon: '🌕', color: '#b4b4c8',
    short: 'Cắn cùng đàn Sói, nhưng chỉ thắng khi là con Sói cuối cùng.',
    description: 'Thức dậy và cắn cùng đàn Sói. Nhưng bạn chỉ thắng khi là con Sói duy nhất còn sống và số người còn lại bằng bạn (1 chọi 1). Nếu đàn Sói thắng khi còn con Sói khác, bạn thua.',
    art: glyph('🌕')
  },
  minion: {
    id: 'minion', points: -6, name: 'Tay Sai', team: 'werewolf', icon: '🦹', color: '#e88f8f',
    short: 'Phe Sói, biết ai là Sói nhưng không thức dậy cùng.',
    description: 'Bạn thuộc phe Sói: tên các con Sói hiện trên lá bài của bạn, nhưng Sói không biết bạn và bạn không thức dậy ban đêm. Tiên Tri soi bạn thấy không phải Dân. Phe Sói thắng thì bạn thắng.',
    art: glyph('🦹')
  },
  hoodlum: {
    id: 'hoodlum', points: 0, name: 'Kẻ Côn Đồ', team: 'hoodlum', icon: '🔪', color: '#c99a6b',
    short: 'Đêm đầu chọn 2 người; thắng nếu cả hai chết mà bạn còn sống.',
    description: 'Đêm đầu chọn 2 người. Khi ván kết thúc, nếu cả hai người đó đã chết còn bạn vẫn sống thì bạn cũng thắng (cùng với phe thắng).',
    art: glyph('🔪')
  },
  villager: {
    id: 'villager',
    points: 1,
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
  piper: 'Phe riêng của Người Thổi Sáo',
  fool: 'Phe thứ ba (Kẻ Cuồng Loạn)',
  hoodlum: 'Phe thứ ba (Kẻ Côn Đồ)'
};

// Display info for a night step.
export function stepInfo(stepId) {
  return ROLES[stepId] || null;
}

// Every special role is one card, except the Masons (at least two).
const UNIQUE_ROLES = Object.keys(ROLES).filter(id => !['werewolf', 'villager', 'mason'].includes(id));

// Cards that belong to the wolf pack (they wake together and know each other).
export const PACK_ROLES = ['werewolf', 'wolf_cub', 'avenger', 'lone_wolf'];

export function emptyRoleCounts() {
  return Object.fromEntries(ROLE_IDS.map(id => [id, 0]));
}

// Balance follows the "Village Impact" printed on Ultimate Werewolf cards
// (each role's `points`): positive helps the village, negative the wolves,
// and a game is fair when the cards add up to about zero. Roles that game
// does not have carry an estimate: Thief +1 (usually ends up a villager),
// Elder +1, Medium +3 (like the Witch's heal), Priest +3, Detective +3 (like
// the P.I.), Avenger -7 (a Werewolf plus the revenge), Fool +1 (the Tanner),
// Piper +1 (the Cult Leader).
export function balanceScore(counts) {
  return ROLE_IDS.reduce((sum, id) => sum + (ROLES[id].points || 0) * (counts[id] || 0), 0);
}

// What a score means, for the lobby.
export function balanceLabel(score) {
  if (score >= 6) return 'nghiêng nhiều về phe Dân';
  if (score >= 3) return 'hơi nghiêng về phe Dân';
  if (score <= -6) return 'nghiêng nhiều về phe Sói';
  if (score <= -3) return 'hơi nghiêng về phe Sói';
  return 'cân bằng';
}

// Special roles of the suggested game for each player count. From 12
// players: the house set (Sói Báo Thù, Tiên Tri, Bảo Vệ, Phù Thủy, Thợ Săn,
// Thám Tử, Thầy Đồng, Mục Sư, Kẻ Cuồng Loạn).
const HOUSE_PICKS_12 = ['avenger', 'seer', 'guard', 'witch', 'hunter', 'detective', 'medium', 'priest', 'fool'];
export function defaultPicks(playerCount) {
  const n = playerCount;
  if (n >= 12) return [...HOUSE_PICKS_12];
  const picks = [];
  if (n >= 2) picks.push('seer');
  if (n >= 4) picks.push('guard');
  if (n >= 6) picks.push('witch');
  if (n >= 7) picks.push('cupid');
  if (n >= 8) picks.push('hunter');
  if (n >= 9) picks.push('thief');
  if (n >= 11) picks.push('piper');
  return picks;
}

// Given the special roles the host wants (one card each), fill the deck with
// Werewolves and Villagers so the points add up as close to zero as
// possible: at least one wolf, never more than a third of the players, and
// never so many that the game is not playable. Ties go to the wolf count
// nearest a quarter of the table.
export function balanceRoles(picks, playerCount) {
  const n = Math.max(0, playerCount);
  const c = emptyRoleCounts();
  if (n === 0) return c;
  // One card per picked role; the Masons come as a pair (a lone Mason has
  // nobody to know).
  new Set(picks).forEach(id => { if (ROLES[id] && id !== 'werewolf' && id !== 'villager') c[id] = id === 'mason' ? 2 : 1; });
  const needed = cardsNeeded(c, n);
  const special = totalRoles(c);
  const packSpecials = PACK_ROLES.reduce((sum, id) => sum + c[id], 0);
  const maxPack = Math.max(1, Math.floor(n / 3));
  let best = null;
  for (let w = packSpecials ? 0 : 1; special + w <= needed; w++) {
    const trial = { ...c, werewolf: w, villager: needed - special - w };
    if (packSpecials + w > maxPack && best) break;
    if (validateRoleCounts(trial, n)) continue;
    const score = Math.abs(balanceScore(trial));
    const spread = Math.abs(packSpecials + w - n / 4);
    if (!best || score < best.score || (score === best.score && spread < best.spread)) best = { trial, score, spread };
  }
  // Nothing playable (too many roles picked for the table): still return a
  // full deck so the lobby can explain what is wrong.
  return best ? best.trial : { ...c, werewolf: packSpecials ? 0 : 1, villager: Math.max(0, needed - special - (packSpecials ? 0 : 1)) };
}

export function computeBalancedRoles(playerCount) {
  return balanceRoles(defaultPicks(playerCount), playerCount);
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
  const wolves = PACK_ROLES.reduce((sum, id) => sum + (counts[id] || 0), 0);
  const needed = cardsNeeded(counts, playerCount);
  const dup = UNIQUE_ROLES.find(id => (counts[id] || 0) > 1);
  if (dup) return `Chỉ được có 1 lá ${ROLES[dup].name}.`;
  if (counts.mason === 1) return 'Hội Kín cần ít nhất 2 lá (hoặc không có lá nào).';
  if (total !== needed) {
    return counts.thief
      ? `Có Ăn Trộm nên cần ${needed} lá bài (${playerCount} người + 2 lá dư), hiện có ${total}.`
      : `Số lá bài (${total}) phải bằng số người chơi (${playerCount}).`;
  }
  if (wolves < 1) return 'Cần ít nhất 1 Ma Sói.';
  if (wolves >= total - wolves) return 'Phe Sói đang đông bằng hoặc hơn phe Dân, hãy giảm bớt Sói.';
  return null;
}
