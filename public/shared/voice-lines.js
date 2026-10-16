// Narrator script. Each key has one or more variants; the server picks a variant
// so the on-screen text always matches the audio that the host device plays.
//
// Audio files live in public/audio/<key>_<variant>.mp3 (variant starts at 0) and
// are listed in public/audio/manifest.json. Generate them with
// `npm run voice` (see README) or record your own voice with the same names.
// Any line without an audio file falls back to the browser's speech engine.
//
// Writing tips for a natural, emotional read: short clauses, commas for breath,
// "..." for a dramatic pause, and "!" only where the narrator should lift.

const NUMBERS = [
  '', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười',
  'mười một', 'mười hai', 'mười ba', 'mười bốn', 'mười lăm', 'mười sáu', 'mười bảy', 'mười tám'
];

export const LINES = {
  game_start: [
    'Chào mừng các bạn đến với ngôi làng... Hãy lặng lẽ xem lá bài của mình, và giữ kín bí mật ấy.',
    'Ngôi làng nhỏ của chúng ta... đang ẩn giấu những con sói. Mỗi người, hãy xem thật kỹ lá bài của mình.'
  ],
  night_start: [
    'Màn đêm buông xuống... Cả làng hãy nhắm mắt lại, và chìm vào giấc ngủ.',
    'Trời đã tối rồi. Mọi người hãy nhắm mắt lại... Ngôi làng chìm vào im lặng.',
    'Đêm nay trăng tròn, gió rít qua từng mái nhà... Cả làng, hãy nhắm mắt lại.'
  ],
  cupid_wake: [
    'Thần Tình Yêu ơi, hãy thức dậy. Hãy chọn hai người, để se duyên cho họ.',
    'Thần Tình Yêu, mở mắt ra nào... Đêm nay, mũi tên của bạn sẽ gắn kết hai trái tim nào?'
  ],
  cupid_sleep: ['Thần Tình Yêu, hãy nhắm mắt lại.'],
  guard_wake: [
    'Bảo Vệ, hãy thức dậy. Đêm nay, bạn muốn che chở cho ai?',
    'Bảo Vệ ơi, mở mắt ra nào. Hãy chọn một người, để bảo vệ trong đêm nay.'
  ],
  guard_sleep: ['Bảo Vệ, hãy nhắm mắt lại.'],
  werewolf_wake: [
    'Ma Sói... hãy thức dậy. Hãy nhìn nhau, và chọn con mồi cho đêm nay.',
    'Những con sói đói khát... hãy mở mắt ra. Đêm nay, các ngươi muốn săn ai?'
  ],
  werewolf_sleep: [
    'Ma Sói, hãy nhắm mắt lại.',
    'Cuộc săn đã xong... Ma Sói, hãy quay về giấc ngủ.'
  ],
  seer_wake: [
    'Tiên Tri, hãy thức dậy. Đêm nay, bạn muốn soi ai?',
    'Tiên Tri ơi, mở mắt ra nào. Hãy chọn một người, để nhìn thấu bản chất của họ.'
  ],
  seer_sleep: ['Tiên Tri, hãy nhắm mắt lại.'],
  witch_wake: [
    'Phù Thủy, hãy thức dậy. Đêm nay có người gặp nạn... Bạn có muốn dùng thuốc không?',
    'Phù Thủy ơi, mở mắt ra nào. Bình cứu, hay bình độc... hãy quyết định đi.'
  ],
  witch_sleep: ['Phù Thủy, hãy nhắm mắt lại.'],
  morning_peace: [
    'Trời đã sáng! Mọi người hãy mở mắt ra. Thật may mắn... đêm qua không có ai thiệt mạng.',
    'Gà đã gáy, trời sáng rồi! Một đêm bình yên... không ai bị hại cả.'
  ],
  morning_deaths: [
    'Trời đã sáng... Mọi người hãy mở mắt ra. Thật đau buồn, đêm qua chúng ta đã mất đi...',
    'Trời sáng rồi. Nhưng đêm qua... máu đã đổ. Người đã ra đi là...'
  ],
  and: ['và'],
  lover_death: [
    'Vì quá đau buồn... người yêu của họ cũng đã ra đi theo.'
  ],
  discussion_start: [
    'Hãy bắt đầu thảo luận. Ai trong số các bạn... mới là Ma Sói?',
    'Cả làng hãy cùng bàn bạc. Kẻ giấu mặt đang ngồi ngay giữa chúng ta.'
  ],
  vote_start: [
    'Hết giờ thảo luận! Hãy bỏ phiếu cho người mà bạn nghi ngờ nhất.',
    'Đã đến lúc lựa chọn. Hãy bỏ phiếu cho kẻ đáng ngờ nhất.'
  ],
  defense_intro: [
    'Người bị nghi ngờ nhiều nhất là...',
    'Cả làng đã chỉ tay về phía...'
  ],
  defense_outro: [
    'Mời bạn lên bục, và đưa ra lời biện hộ của mình.',
    'Bạn có lời nào để tự bào chữa không?'
  ],
  no_defendant: [
    'Dân làng chưa thể thống nhất. Hôm nay, không ai phải lên bục.',
    'Phiếu bầu bị chia đều... Hôm nay, làng tạm tha cho tất cả.'
  ],
  judge_start: [
    'Lời biện hộ đã kết thúc. Cả làng hãy quyết định: treo cổ... hay tha mạng?'
  ],
  verdict_kill: [
    'đã bị dân làng treo cổ. Mong rằng... đó là một con sói.',
    'đã bị đưa lên giá treo cổ. Sự thật, sẽ sớm được phơi bày.'
  ],
  verdict_spare: [
    'đã được dân làng tha mạng. Hãy cảnh giác nhé.'
  ],
  hunter_wake: [
    'Thợ Săn đã ngã xuống... nhưng vẫn kịp giương súng lên. Hãy chọn người sẽ đi cùng bạn.'
  ],
  hunter_shot: [
    'đã trúng phát súng cuối cùng của Thợ Săn.'
  ],
  hunter_miss: [
    'Thợ Săn đã không bóp cò.'
  ],
  win_village: [
    'Ma Sói cuối cùng đã bị tiêu diệt! Ngôi làng đã trở lại bình yên. Phe Dân Làng, chiến thắng!'
  ],
  win_werewolf: [
    'Bóng tối đã bao trùm ngôi làng... Không còn ai ngăn được bầy sói nữa. Phe Ma Sói, chiến thắng!'
  ],
  win_lovers: [
    'Tình yêu đã vượt qua tất cả! Cặp Tình Nhân là những người cuối cùng còn sống, và họ đã chiến thắng!'
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
