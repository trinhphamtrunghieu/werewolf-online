// Narrator script. Each key has one or more variants; the server picks a variant
// so the on-screen text always matches the audio that the host device plays.
//
// Audio files live in public/audio/<key>_<variant>.mp3 (variant starts at 0) and
// are listed in public/audio/manifest.json. Generate them with
// `npm run voice` (see README) or record your own voice with the same names.
// Any line without an audio file falls back to the browser's speech engine.
//
// Keep lines short and plain: who wakes up, then what to do. Three variants
// per line is enough to avoid sounding repetitive.

import { CLIP_MS } from './voice-durations.js';

const NUMBERS = [
  '', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười',
  'mười một', 'mười hai', 'mười ba', 'mười bốn', 'mười lăm', 'mười sáu', 'mười bảy', 'mười tám'
];

export const LINES = {
  game_start: [
    'Ván mới bắt đầu. Hãy xem lá bài của mình, và giữ bí mật.',
    'Chào mừng đến ngôi làng. Mỗi người hãy xem lá bài của mình.',
    'Sói đang ẩn trong làng. Xem lá bài của mình, đừng để ai thấy.'
  ],
  night_start: [
    'Màn đêm buông xuống. Cả làng nhắm mắt.',
    'Trời tối rồi. Mọi người nhắm mắt lại.',
    'Đêm đã về. Cả làng hãy nhắm mắt.'
  ],
  thief_wake: [
    'Ăn Trộm, mở mắt. Xem hai lá dư, đổi hoặc giữ.',
    'Ăn Trộm, thức dậy. Có muốn đổi lá bài không?',
    'Ăn Trộm, mở mắt. Chọn đổi bài, hoặc giữ nguyên.'
  ],
  thief_sleep: [
    'Ăn Trộm, nhắm mắt.',
    'Ăn Trộm, nhắm mắt lại.',
    'Ăn Trộm, đi ngủ.'
  ],
  cupid_wake: [
    'Thần Tình Yêu, mở mắt. Chọn hai người làm cặp đôi.',
    'Thần Tình Yêu, thức dậy. Hãy ghép đôi hai người.',
    'Thần Tình Yêu, mở mắt. Đêm nay se duyên cho ai?'
  ],
  cupid_sleep: [
    'Thần Tình Yêu, nhắm mắt.',
    'Thần Tình Yêu, nhắm mắt lại.',
    'Thần Tình Yêu, đi ngủ.'
  ],
  lovers_note: [
    'Cặp đôi: tên người kia đã ở trên lá bài. Sáng mai hãy xem.',
    'Hai người được ghép đôi, sáng mai hãy xem lá bài để biết nửa kia.',
    'Tên nửa kia đã hiện trên lá bài. Thức dậy rồi hãy xem.'
  ],
  guard_wake: [
    'Bảo Vệ, mở mắt. Chọn người để bảo vệ.',
    'Bảo Vệ, thức dậy. Đêm nay bảo vệ ai?',
    'Bảo Vệ, mở mắt. Hãy che chở một người.'
  ],
  guard_sleep: [
    'Bảo Vệ, nhắm mắt.',
    'Bảo Vệ, nhắm mắt lại.',
    'Bảo Vệ, đi ngủ.'
  ],
  werewolf_wake: [
    'Bầy Sói, mở mắt. Chọn con mồi.',
    'Bầy Sói, thức dậy. Đêm nay cắn ai?',
    'Bầy Sói, mở mắt. Hãy thống nhất nạn nhân.'
  ],
  werewolf_sleep: [
    'Bầy Sói, nhắm mắt.',
    'Bầy Sói, nhắm mắt lại.',
    'Bầy Sói, đi ngủ.'
  ],
  avenger_wake: [
    'Sói Báo Thù, mở mắt. Chọn người chết theo nếu bạn bị treo cổ.',
    'Sói Báo Thù, thức dậy. Bạn sẽ kéo ai theo?',
    'Sói Báo Thù, mở mắt. Chọn mục tiêu báo thù.'
  ],
  avenger_sleep: [
    'Sói Báo Thù, nhắm mắt.',
    'Sói Báo Thù, nhắm mắt lại.',
    'Sói Báo Thù, đi ngủ.'
  ],
  seer_wake: [
    'Tiên Tri, mở mắt. Chọn một người để soi.',
    'Tiên Tri, thức dậy. Đêm nay soi ai?',
    'Tiên Tri, mở mắt. Hãy xem phe của một người.'
  ],
  seer_sleep: [
    'Tiên Tri, nhắm mắt.',
    'Tiên Tri, nhắm mắt lại.',
    'Tiên Tri, đi ngủ.'
  ],
  detective_wake: [
    'Thám Tử, mở mắt. Chọn hai người để so sánh.',
    'Thám Tử, thức dậy. Hãy điều tra hai người.',
    'Thám Tử, mở mắt. Hai người nào cùng phe?'
  ],
  detective_sleep: [
    'Thám Tử, nhắm mắt.',
    'Thám Tử, nhắm mắt lại.',
    'Thám Tử, đi ngủ.'
  ],
  priest_wake: [
    'Mục Sư, mở mắt. Có vẩy nước thánh không?',
    'Mục Sư, thức dậy. Dùng nước thánh, hay chờ?',
    'Mục Sư, mở mắt. Nước thánh chỉ có một lần.'
  ],
  priest_sleep: [
    'Mục Sư, nhắm mắt.',
    'Mục Sư, nhắm mắt lại.',
    'Mục Sư, đi ngủ.'
  ],
  witch_wake: [
    'Phù Thủy, mở mắt. Có dùng bình thuốc không?',
    'Phù Thủy, thức dậy. Bình cứu, bình độc, hay bỏ qua?',
    'Phù Thủy, mở mắt. Đêm nay có dùng thuốc không?'
  ],
  witch_sleep: [
    'Phù Thủy, nhắm mắt.',
    'Phù Thủy, nhắm mắt lại.',
    'Phù Thủy, đi ngủ.'
  ],
  medium_wake: [
    'Thầy Đồng, mở mắt. Có hồi sinh ai không?',
    'Thầy Đồng, thức dậy. Gọi một linh hồn trở về?',
    'Thầy Đồng, mở mắt. Hồi sinh chỉ dùng được một lần.'
  ],
  medium_sleep: [
    'Thầy Đồng, nhắm mắt.',
    'Thầy Đồng, nhắm mắt lại.',
    'Thầy Đồng, đi ngủ.'
  ],
  piper_wake: [
    'Người Thổi Sáo, mở mắt. Chọn hai người để thôi miên.',
    'Người Thổi Sáo, thức dậy. Hãy thôi miên hai người.',
    'Người Thổi Sáo, mở mắt. Đêm nay mê hoặc ai?'
  ],
  piper_sleep: [
    'Người Thổi Sáo, nhắm mắt.',
    'Người Thổi Sáo, nhắm mắt lại.',
    'Người Thổi Sáo, đi ngủ.'
  ],
  charmed_note: [
    'Ai bị thôi miên: tên những người cùng cảnh ngộ đã ở trên lá bài. Sáng mai hãy xem.',
    'Người bị thôi miên, sáng mai hãy xem lá bài của mình.',
    'Tên những người bị thôi miên đã hiện trên lá bài. Thức dậy rồi hãy xem.'
  ],
  elder_wake: [
    'Già Làng, mở mắt cho quản trò biết.',
    'Già Làng, thức dậy. Quản trò đã thấy bạn.',
    'Già Làng, mở mắt. Quản trò ghi nhận bạn.'
  ],
  elder_sleep: [
    'Già Làng, nhắm mắt.',
    'Già Làng, nhắm mắt lại.',
    'Già Làng, đi ngủ.'
  ],
  hunter_wake: [
    'Thợ Săn, mở mắt. Chĩa súng vào ai?',
    'Thợ Săn, thức dậy. Chọn người để chĩa súng.',
    'Thợ Săn, mở mắt. Đêm nay nhắm vào ai?'
  ],
  hunter_sleep: [
    'Thợ Săn, nhắm mắt.',
    'Thợ Săn, nhắm mắt lại.',
    'Thợ Săn, đi ngủ.'
  ],
  morning_peace: [
    'Trời sáng. Đêm qua không ai chết.',
    'Mọi người mở mắt. Đêm qua bình yên.',
    'Trời sáng rồi. Không ai thiệt mạng.'
  ],
  morning_deaths: [
    'Trời sáng. Đêm qua đã chết...',
    'Mọi người mở mắt. Người chết đêm qua là...',
    'Trời sáng rồi. Làng đã mất...'
  ],
  and: [
    'và'
  ],
  revived: [
    'Người được hồi sinh là...',
    'Có người sống lại...',
    'Trở về từ cõi chết là...'
  ],
  discussion_start: [
    'Bắt đầu thảo luận. Ai là Sói?',
    'Thảo luận nào. Hãy tìm ra Ma Sói.',
    'Cả làng thảo luận. Ai đáng ngờ nhất?'
  ],
  vote_start: [
    'Hết giờ. Bỏ phiếu người bạn nghi nhất.',
    'Bỏ phiếu nào. Bạn nghi ai?',
    'Hết giờ thảo luận. Hãy bỏ phiếu.'
  ],
  defense_intro: [
    'Người bị nghi nhiều nhất là...',
    'Lên bục biện hộ là...',
    'Nhiều phiếu nhất là...'
  ],
  defense_outro: [
    'Mời lên bục biện hộ.',
    'Hãy thuyết phục cả làng.',
    'Bạn có thời gian để biện hộ.'
  ],
  no_defendant: [
    'Phiếu chưa thống nhất. Không ai lên bục.',
    'Hôm nay không ai lên bục.',
    'Làng chưa thống nhất. Không ai lên bục.'
  ],
  game_soon: [
    'Trò chơi sẽ bắt đầu sau mười giây. Hãy xem lá bài của mình.',
    'Mười giây nữa trò chơi bắt đầu. Xem lại lá bài của bạn.',
    'Hãy xem lá bài. Trò chơi bắt đầu sau mười giây.'
  ],
  night_soon: [
    'Mười giây nữa trời tối.',
    'Đêm xuống sau mười giây.',
    'Chuẩn bị, mười giây nữa là đêm.'
  ],
  judge_start: [
    'Treo cổ hay tha? Hãy bỏ phiếu.',
    'Biện hộ xong. Treo hay tha?',
    'Cả làng quyết định: treo cổ, hay tha mạng.'
  ],
  verdict_kill: [
    'đã bị treo cổ.',
    'bị dân làng treo cổ.',
    'đã bị xử treo cổ.'
  ],
  verdict_spare: [
    'được tha.',
    'được dân làng tha mạng.',
    'thoát án treo cổ.'
  ],
  also_died: [
    'Cũng đã chết...',
    'Ra đi cùng là...',
    'Thêm một người chết...'
  ],
  win_village: [
    'Hết Sói rồi. Phe Dân Làng thắng!',
    'Ngôi làng bình yên. Dân Làng chiến thắng!',
    'Ma Sói đã bị tiêu diệt. Dân Làng thắng!'
  ],
  win_werewolf: [
    'Sói đã áp đảo. Phe Sói thắng!',
    'Không ai cản được bầy Sói. Phe Sói chiến thắng!',
    'Bóng tối bao trùm. Phe Sói thắng!'
  ],
  win_piper: [
    'Cả làng đã bị thôi miên. Người Thổi Sáo thắng!',
    'Tiếng sáo đã thắng. Người Thổi Sáo chiến thắng!',
    'Tất cả nghe theo tiếng sáo. Người Thổi Sáo thắng!'
  ],
  win_lovers: [
    'Chỉ còn cặp đôi. Tình Nhân thắng!',
    'Tình yêu chiến thắng. Cặp Tình Nhân thắng!',
    'Cặp đôi sống sót đến cuối. Tình Nhân thắng!'
  ],
  win_fool: [
    'Treo nhầm Kẻ Cuồng Loạn rồi. Kẻ Cuồng Loạn thắng!',
    'Kẻ Cuồng Loạn đã lừa được cả làng. Hắn thắng!',
    'Đúng ý Kẻ Cuồng Loạn. Hắn chiến thắng!'
  ]
};

for (let n = 1; n < NUMBERS.length; n++) {
  LINES[`seat_${n}`] = [`Người chơi số ${NUMBERS[n]}`];
}

export function lineText(key, variant = 0) {
  const list = LINES[key];
  if (!list) return '';
  return list[variant] ?? list[0];
}

export function audioFileName(key, variant = 0) {
  return `${key}_${variant}.mp3`;
}

// ---------------------------------------------------------------------------
// Timing, shared by the server (to wait for the narrator) and the host phone
// (to pace playback), so both agree on how long a narration lasts.
// ---------------------------------------------------------------------------

// Every phone that speaks starts a narration this long after the server
// created it (on the server clock), so all phones read together. It covers the
// time a phone needs to hear about the update and fetch it.
export const PLAYBACK_LEAD_MS = 800;

export const CLIP_GAP_MS = 350;
export const TIGHT_GAP_MS = 100;

const flowsOn = (key) => key.startsWith('seat_') || key === 'and';

// Pause after a clip. Seat numbers run straight into their sentence.
export function gapAfter(clip, next) {
  if (!next || clip.k === 'pause' || next.k === 'pause') return 0; // a pause is its own gap
  return flowsOn(clip.k) || flowsOn(next.k) ? TIGHT_GAP_MS : CLIP_GAP_MS;
}

// Browser speech fallback: roughly 13 characters a second at the narrator's
// slow rate, plus the pauses the narrator inserts at punctuation.
export function estimateSpeechMs(text) {
  const t = String(text || '');
  const ellipses = (t.match(/\.\.\.|…/g) || []).length;
  const commas = (t.match(/,/g) || []).length;
  const stops = (t.match(/[.!?](\s|$)/g) || []).length;
  return Math.round(300 + t.length * 75 + ellipses * 520 + commas * 140 + stops * 300);
}

// A silent beat inside a narration: { k: 'pause', ms }.
export const pauseClip = (ms) => ({ k: 'pause', v: 0, t: '', ms });

export function clipMs(clip) {
  if (clip.ms != null) return clip.ms;
  return CLIP_MS[`${clip.k}_${clip.v}`] ?? estimateSpeechMs(clip.t);
}

export function narrationMs(clips) {
  return clips.reduce((sum, clip, i) => sum + clipMs(clip) + gapAfter(clip, clips[i + 1]), 0);
}
