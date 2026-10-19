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

import { CLIP_MS } from './voice-durations.js';

const NUMBERS = [
  '', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười',
  'mười một', 'mười hai', 'mười ba', 'mười bốn', 'mười lăm', 'mười sáu', 'mười bảy', 'mười tám'
];

export const LINES = {
  game_start: [
    'Chào mừng các bạn đến với ngôi làng... Hãy lặng lẽ xem lá bài của mình, và giữ kín bí mật ấy.',
    'Ngôi làng nhỏ của chúng ta... đang ẩn giấu những con sói. Mỗi người, hãy xem thật kỹ lá bài của mình.',
    'Đêm nay, ngôi làng sẽ không còn yên bình nữa... Hãy xem lá bài của mình, và đừng để ai nhìn thấy.',
    'Có những kẻ khoác lốt người, đang sống giữa chúng ta... Mỗi người, hãy lặng lẽ xem vai trò của mình.',
    'Một ván mới bắt đầu. Ai là dân làng, ai là sói... chỉ lá bài trong tay bạn mới biết.',
    'Ngôi làng đã bị nguyền rủa... Hãy xem lá bài của mình, và giữ bí mật cho đến phút cuối cùng.'
  ],
  night_start: [
    'Màn đêm buông xuống... Cả làng hãy nhắm mắt lại, và chìm vào giấc ngủ.',
    'Trời đã tối rồi. Mọi người hãy nhắm mắt lại... Ngôi làng chìm vào im lặng.',
    'Đêm nay trăng tròn, gió rít qua từng mái nhà... Cả làng, hãy nhắm mắt lại.',
    'Mặt trời đã lặn sau rặng núi... Cả làng, hãy nhắm mắt lại.',
    'Tiếng côn trùng rả rích khắp nơi... Đêm đã về. Mọi người, hãy nhắm mắt.',
    'Đèn trong làng lần lượt tắt hết... Cả làng hãy nhắm mắt, và đừng hé nhìn.'
  ],
  thief_wake: [
    'Ăn Trộm, hãy thức dậy. Có hai lá bài đang nằm úp trên bàn... Bạn có muốn đổi không?',
    'Ăn Trộm ơi, mở mắt ra nào. Hãy xem hai lá bài dư, và quyết định số phận của mình.',
    'Ăn Trộm, hãy thức dậy. Hai lá bài bí ẩn đang chờ bạn... Đổi, hay không đổi?',
    'Kẻ trộm trong đêm, hãy mở mắt ra. Bạn có muốn trộm một số phận khác không?',
    'Ăn Trộm, mở mắt ra nào. Hãy nhìn hai lá bài dư... và chọn cho mình một con đường.',
    'Ăn Trộm ơi, đến lượt bạn rồi. Hãy xem thật nhanh hai lá bài còn lại.'
  ],
  thief_sleep: [
    'Ăn Trộm, hãy nhắm mắt lại.',
    'Ăn Trộm, nhắm mắt lại nào.',
    'Ăn Trộm, hãy đi ngủ đi.',
    'Xong rồi. Ăn Trộm, hãy nhắm mắt lại.',
    'Ăn Trộm, hãy giữ kín lựa chọn của mình, và nhắm mắt lại.',
    'Ăn Trộm, quay về giấc ngủ thôi.'
  ],
  cupid_wake: [
    'Thần Tình Yêu ơi, hãy thức dậy. Hãy chọn hai người, để se duyên cho họ.',
    'Thần Tình Yêu, mở mắt ra nào... Đêm nay, mũi tên của bạn sẽ gắn kết hai trái tim nào?',
    'Thần Tình Yêu, hãy thức dậy. Hãy giương cung, và chọn hai người sẽ yêu nhau.',
    'Thần Tình Yêu ơi, đến lượt bạn rồi. Hai trái tim nào sẽ gắn bó với nhau mãi mãi?',
    'Thần Tình Yêu, mở mắt ra. Đêm nay, hãy se sợi chỉ đỏ cho hai người.',
    'Thần Tình Yêu, hãy thức dậy... Ai sẽ là cặp đôi định mệnh của ngôi làng?'
  ],
  cupid_sleep: [
    'Thần Tình Yêu, hãy nhắm mắt lại.',
    'Thần Tình Yêu, nhắm mắt lại nào.',
    'Mũi tên đã bay đi. Thần Tình Yêu, hãy đi ngủ.',
    'Thần Tình Yêu, hãy quay về giấc ngủ.',
    'Xong rồi. Thần Tình Yêu, hãy nhắm mắt lại.',
    'Thần Tình Yêu, hãy giữ kín bí mật này, và nhắm mắt lại.'
  ],
  lovers_note: [
    'Hai người vừa trúng mũi tên tình yêu... tên của người kia đã hiện trên lá bài của bạn. Sáng mai thức dậy, hãy xem lá bài nhé.',
    'Cặp đôi của đêm nay, tên nửa kia đã xuất hiện trên lá bài của bạn. Khi thức dậy, hãy xem lá bài của mình.',
    'Những trái tim vừa được se duyên... tên người ấy đã nằm trên lá bài của bạn. Hãy xem lá bài khi trời sáng.',
    'Mũi tên đã trúng đích. Tên người mình yêu đã hiện trên lá bài. Sau khi thức dậy, hai bạn hãy xem lá bài nhé.',
    'Hai người được chọn, tên của nhau đã có trên lá bài. Sáng mai, hãy mở lá bài ra xem.',
    'Sợi chỉ đỏ đã được buộc. Tên nửa kia đã xuất hiện trên lá bài của bạn. Thức dậy rồi, hãy xem lá bài.'
  ],
  guard_wake: [
    'Bảo Vệ, hãy thức dậy. Đêm nay, bạn muốn che chở cho ai?',
    'Bảo Vệ ơi, mở mắt ra nào. Hãy chọn một người, để bảo vệ trong đêm nay.',
    'Bảo Vệ, mở mắt ra. Đêm nay, tấm khiên của bạn sẽ che chở cho ai?',
    'Người Bảo Vệ của làng, hãy thức dậy. Ai cần được bảo vệ trong đêm nay?',
    'Bảo Vệ ơi, đến lượt bạn rồi. Hãy chọn người mà bạn sẽ canh giữ.',
    'Bảo Vệ, hãy thức dậy... Đêm nay nguy hiểm lắm. Bạn sẽ đứng gác trước cửa nhà ai?'
  ],
  guard_sleep: [
    'Bảo Vệ, hãy nhắm mắt lại.',
    'Bảo Vệ, nhắm mắt lại nào.',
    'Bảo Vệ, hãy đi ngủ đi.',
    'Xong rồi. Bảo Vệ, hãy nhắm mắt lại.',
    'Bảo Vệ, hãy quay về giấc ngủ.',
    'Bảo Vệ, hãy nhắm mắt, và cầu mong lựa chọn của bạn là đúng.'
  ],
  werewolf_wake: [
    'Bầy Sói... hãy thức dậy. Hãy nhìn nhau, và chọn con mồi cho đêm nay.',
    'Những con sói đói khát... hãy mở mắt ra. Đêm nay, các ngươi muốn săn ai?',
    'Bầy sói ơi, hãy thức dậy. Hãy nhận ra đồng bọn, và chọn nạn nhân cho đêm nay.',
    'Bầy Sói, mở mắt ra nào... Mùi máu đang lan trong gió. Đêm nay, ai sẽ là con mồi?',
    'Những con sói, hãy thức dậy. Hãy nhìn nhau thật nhanh, và thống nhất mục tiêu.',
    'Trăng đã lên cao... Bầy Sói, hãy mở mắt. Các ngươi đói rồi phải không?'
  ],
  werewolf_sleep: [
    'Bầy Sói, hãy nhắm mắt lại.',
    'Cuộc săn đã xong... Sói, hãy quay về giấc ngủ.',
    'Sói, hãy nhắm mắt lại.',
    'Bầy Sói, nhắm mắt lại nào. Hãy giấu đi nanh vuốt của mình.',
    'Bầy sói đã no nê... Hãy quay về giấc ngủ.',
    'Sói ơi, hãy nhắm mắt, và trở lại làm dân làng hiền lành.'
  ],
  seer_wake: [
    'Tiên Tri, hãy thức dậy. Đêm nay, bạn muốn soi ai?',
    'Tiên Tri ơi, mở mắt ra nào. Hãy chọn một người, để nhìn thấu bản chất của họ.',
    'Tiên Tri, mở mắt ra. Quả cầu pha lê đang chờ bạn... Đêm nay, bạn muốn nhìn thấu ai?',
    'Tiên Tri ơi, đến lượt bạn rồi. Hãy chọn một người, và sự thật sẽ hiện ra.',
    'Tiên Tri, hãy thức dậy. Kẻ nào đang giấu mặt? Hãy chỉ tay vào người bạn nghi ngờ.',
    'Tiên Tri, mở mắt ra nào... Đôi mắt của bạn là hy vọng của cả làng.'
  ],
  seer_sleep: [
    'Tiên Tri, hãy nhắm mắt lại.',
    'Tiên Tri, nhắm mắt lại nào.',
    'Tiên Tri, hãy ghi nhớ điều bạn thấy, và nhắm mắt lại.',
    'Tiên Tri, hãy đi ngủ đi.',
    'Xong rồi. Tiên Tri, hãy nhắm mắt lại.',
    'Tiên Tri, hãy quay về giấc ngủ.'
  ],
  witch_wake: [
    'Phù Thủy, hãy thức dậy. Đêm nay... bạn có muốn dùng thuốc không?',
    'Phù Thủy ơi, mở mắt ra nào. Bình cứu, hay bình độc... hãy quyết định đi.',
    'Phù Thủy, hãy thức dậy. Hai lọ thuốc đang chờ trên kệ... Bạn sẽ dùng chúng chứ?',
    'Phù Thủy ơi, đến lượt bạn rồi. Cứu một mạng người, hay lấy đi một mạng người?',
    'Phù Thủy, mở mắt ra. Đêm nay, bạn có muốn can thiệp vào số phận không?',
    'Phù Thủy, hãy thức dậy... Hãy suy nghĩ thật kỹ, mỗi lọ thuốc chỉ dùng được một lần.'
  ],
  witch_sleep: [
    'Phù Thủy, hãy nhắm mắt lại.',
    'Phù Thủy, nhắm mắt lại nào.',
    'Phù Thủy, hãy cất thuốc đi, và nhắm mắt lại.',
    'Phù Thủy, hãy đi ngủ đi.',
    'Xong rồi. Phù Thủy, hãy nhắm mắt lại.',
    'Phù Thủy, hãy quay về giấc ngủ.'
  ],
  piper_wake: [
    'Người Thổi Sáo, hãy thức dậy. Tiếng sáo đêm nay... sẽ mê hoặc hai người nào?',
    'Người Thổi Sáo ơi, mở mắt ra nào. Hãy chọn hai người để thôi miên.',
    'Người Thổi Sáo, mở mắt ra. Hãy cất tiếng sáo, và chọn hai người sẽ nghe theo bạn.',
    'Người Thổi Sáo ơi, đến lượt bạn rồi. Đêm nay, hai linh hồn nào sẽ bị mê hoặc?',
    'Người Thổi Sáo, hãy thức dậy... Tiếng sáo du dương đang vang lên trong đêm.',
    'Người Thổi Sáo, mở mắt ra nào. Cả làng sắp thuộc về bạn rồi.'
  ],
  piper_sleep: [
    'Người Thổi Sáo, hãy nhắm mắt lại.',
    'Người Thổi Sáo, nhắm mắt lại nào.',
    'Tiếng sáo đã ngừng. Người Thổi Sáo, hãy đi ngủ.',
    'Người Thổi Sáo, hãy quay về giấc ngủ.',
    'Xong rồi. Người Thổi Sáo, hãy nhắm mắt lại.',
    'Người Thổi Sáo, hãy cất cây sáo đi, và nhắm mắt lại.'
  ],
  charmed_note: [
    'Những ai đã bị thôi miên... tên những người cùng cảnh ngộ đã hiện trên lá bài của bạn. Sáng mai thức dậy, hãy xem lá bài nhé.',
    'Ai đã nghe thấy tiếng sáo, tên những người bị thôi miên khác đã xuất hiện trên lá bài. Khi thức dậy, hãy xem lá bài của mình.',
    'Tiếng sáo đã để lại dấu vết. Tên những người cùng cảnh ngộ đã nằm trên lá bài của bạn. Hãy xem lá bài khi trời sáng.',
    'Những người bị mê hoặc, tên của nhau đã hiện trên lá bài. Sau khi thức dậy, hãy xem lá bài nhé.',
    'Những linh hồn nghe theo tiếng sáo, các bạn không hề đơn độc. Sáng mai, hãy mở lá bài ra xem tên nhau.',
    'Ai đã bị thôi miên, tên những người chung số phận đã có trên lá bài. Thức dậy rồi, hãy xem lá bài.'
  ],
  elder_wake: [
    'Già Làng, hãy thức dậy... và cho quản trò biết bạn là ai.',
    'Già Làng, mở mắt ra nào. Hãy cho quản trò biết bạn đang ở đây.',
    'Già Làng kính mến, hãy thức dậy... và giơ tay cho quản trò thấy.',
    'Già Làng, hãy thức dậy. Ngôi làng này cần sự từng trải của bạn.',
    'Già Làng ơi, đến lượt bạn rồi. Hãy mở mắt trong giây lát.',
    'Già Làng, hãy mở mắt... Bạn đã sống qua nhiều mùa trăng sói rồi.'
  ],
  elder_sleep: [
    'Già Làng, hãy nhắm mắt lại.',
    'Già Làng, nhắm mắt lại nào.',
    'Già Làng, hãy đi ngủ đi.',
    'Già Làng, hãy quay về giấc ngủ.',
    'Xong rồi. Già Làng, hãy nhắm mắt lại.',
    'Già Làng, hãy nghỉ ngơi đi.'
  ],
  morning_peace: [
    'Trời đã sáng! Mọi người hãy mở mắt ra. Thật may mắn... đêm qua không có ai thiệt mạng.',
    'Gà đã gáy, trời sáng rồi! Một đêm bình yên... không ai bị hại cả.',
    'Mặt trời đã lên! Mọi người hãy mở mắt. Thật bất ngờ... đêm qua không ai chết cả.',
    'Trời sáng rồi! Cả làng hãy thức dậy. Đêm qua, tất cả vẫn bình an.',
    'Bình minh đã đến... Hãy mở mắt ra. Một phép màu, không ai bị hại trong đêm qua.',
    'Trời đã sáng! Hãy nhìn quanh xem... Đêm qua, không có ai ra đi.'
  ],
  morning_deaths: [
    'Trời đã sáng... Mọi người hãy mở mắt ra. Thật đau buồn, đêm qua chúng ta đã mất đi...',
    'Trời sáng rồi. Nhưng đêm qua... máu đã đổ. Người đã ra đi là...',
    'Trời đã sáng... Hãy mở mắt ra. Đêm qua, ngôi làng đã mất đi...',
    'Bình minh lên, nhưng không mang theo niềm vui... Người đã ra đi là...',
    'Trời sáng rồi. Cả làng hãy mở mắt... và tiễn biệt...',
    'Mặt trời đã lên... Đêm qua, bầy sói đã không bỏ qua cơ hội. Người đã chết là...'
  ],
  and: ['và'],
  discussion_start: [
    'Hãy bắt đầu thảo luận. Ai trong số các bạn... mới là Ma Sói?',
    'Cả làng hãy cùng bàn bạc. Kẻ giấu mặt đang ngồi ngay giữa chúng ta.',
    'Thời gian thảo luận bắt đầu. Hãy lắng nghe... và tìm ra kẻ nói dối.',
    'Bây giờ là lúc bàn bạc. Ai có điều gì muốn nói, hãy lên tiếng.',
    'Hãy cùng nhau thảo luận. Mỗi lời nói đều có thể là manh mối... hoặc là cái bẫy.',
    'Cả làng hãy bàn bạc. Sói đang ở đâu đó quanh đây thôi.'
  ],
  vote_start: [
    'Hết giờ thảo luận! Hãy bỏ phiếu cho người mà bạn nghi ngờ nhất.',
    'Đã đến lúc lựa chọn. Hãy bỏ phiếu cho kẻ đáng ngờ nhất.',
    'Thảo luận kết thúc! Mỗi người, hãy chọn một người đáng nghi nhất.',
    'Hết giờ! Hãy bỏ phiếu cho người mà bạn tin là Ma Sói.',
    'Đã đến giờ bỏ phiếu. Hãy chỉ ra kẻ đáng ngờ nhất ngôi làng.',
    'Hết thời gian thảo luận. Hãy bỏ phiếu... theo lý trí, hoặc theo linh cảm của bạn.'
  ],
  defense_intro: [
    'Người bị nghi ngờ nhiều nhất là...',
    'Cả làng đã chỉ tay về phía...',
    'Người nhận nhiều phiếu nhất là...',
    'Ngôi làng đã gọi tên...',
    'Kẻ bị nghi ngờ hôm nay là...',
    'Mọi ánh mắt đang đổ dồn về phía...'
  ],
  defense_outro: [
    'Mời bạn lên bục, và đưa ra lời biện hộ của mình.',
    'Bạn có lời nào để tự bào chữa không?',
    'Hãy lên bục, và nói lời biện hộ của mình.',
    'Đây là cơ hội cuối cùng để bạn tự cứu mình.',
    'Hãy thuyết phục cả làng rằng bạn vô tội.',
    'Mời bạn lên tiếng. Cả làng đang lắng nghe.'
  ],
  no_defendant: [
    'Dân làng chưa thể thống nhất. Hôm nay, không ai phải lên bục.',
    'Phiếu bầu bị chia đều... Hôm nay, làng tạm tha cho tất cả.',
    'Không ai nhận đủ phiếu. Hôm nay, không ai phải lên bục.',
    'Ngôi làng còn do dự... Hôm nay, không ai bị đưa lên giá treo cổ.',
    'Phiếu bầu quá phân tán. Hôm nay làng tạm hoãn phán xét.',
    'Không có kết quả rõ ràng. Hãy cẩn thận trong đêm nay.'
  ],
  night_soon: [
    'Màn đêm sẽ buông xuống sau mười giây nữa. Mọi người, hãy chuẩn bị.',
    'Mặt trời sắp lặn... Mười giây nữa, cả làng sẽ chìm vào bóng đêm.',
    'Trời đang tối dần... Mười giây nữa, màn đêm sẽ buông xuống.',
    'Hãy chuẩn bị... Mười giây nữa, cả làng sẽ đi ngủ.',
    'Ngày sắp tàn. Còn mười giây nữa, đêm sẽ đến.',
    'Hoàng hôn đã xuống... Mười giây nữa, bầy sói sẽ thức giấc.'
  ],
  judge_start: [
    'Lời biện hộ đã kết thúc. Cả làng hãy quyết định: treo cổ... hay tha mạng?',
    'Hết giờ biện hộ. Treo cổ, hay tha mạng? Cả làng hãy bỏ phiếu.',
    'Lời biện hộ đã xong. Giờ là lúc phán quyết.',
    'Cả làng đã nghe đủ rồi. Hãy quyết định: treo cổ... hay tha mạng?',
    'Đã đến lúc phán xét. Hãy bỏ phiếu theo lương tâm của mình.',
    'Số phận của người trên bục, giờ nằm trong tay các bạn.'
  ],
  verdict_kill: [
    'đã bị dân làng treo cổ. Mong rằng... đó là một con sói.',
    'đã bị đưa lên giá treo cổ. Sự thật, sẽ sớm được phơi bày.',
    'đã bị treo cổ theo phán quyết của cả làng.',
    'đã phải lên giá treo cổ. Liệu cả làng có chọn đúng không?',
    'đã bị xử treo cổ. Cầu mong đó không phải một người vô tội.',
    'đã bị dân làng kết án, và treo cổ.'
  ],
  verdict_spare: [
    'đã được dân làng tha mạng. Hãy cảnh giác nhé.',
    'đã được tha mạng. Nhưng mọi ánh mắt vẫn đang dõi theo.',
    'được tha bổng. Hôm nay, không ai phải chết.',
    'thoát chết trong gang tấc. Hãy cẩn thận nhé.',
    'được cả làng tha mạng. Liệu đó có phải là một sai lầm?',
    'đã được tha. Ngôi làng chọn tin tưởng, ít nhất là hôm nay.'
  ],
  hunter_wake: [
    'Thợ Săn, hãy thức dậy. Đêm nay, bạn sẽ chĩa súng vào ai?',
    'Thợ Săn ơi, mở mắt ra nào. Hãy chọn người mà bạn sẽ kéo theo... nếu bạn phải ngã xuống.',
    'Thợ Săn, mở mắt ra. Hãy nạp đạn, và chĩa súng vào một người.',
    'Thợ Săn ơi, đến lượt bạn rồi. Nếu đêm nay bạn ngã xuống, ai sẽ đi cùng bạn?',
    'Thợ Săn, hãy thức dậy. Hãy chọn mục tiêu cho phát súng cuối cùng.',
    'Thợ Săn, mở mắt ra nào... Họng súng của bạn đang hướng về ai?'
  ],
  hunter_sleep: [
    'Thợ Săn, hãy nhắm mắt lại.',
    'Thợ Săn, nhắm mắt lại nào.',
    'Thợ Săn, hãy hạ súng, và nhắm mắt lại.',
    'Thợ Săn, hãy đi ngủ đi.',
    'Xong rồi. Thợ Săn, hãy nhắm mắt lại.',
    'Thợ Săn, hãy quay về giấc ngủ.'
  ],
  also_died: [
    'Cùng ra đi với họ là...',
    'Ra đi cùng với họ còn có...',
    'Người cũng đã ngã xuống là...',
    'Không chỉ một người... mà còn có...',
    'Cùng chung số phận là...',
    'Theo sau họ là...'
  ],
  win_village: [
    'Ma Sói cuối cùng đã bị tiêu diệt! Ngôi làng đã trở lại bình yên. Phe Dân Làng, chiến thắng!',
    'Con sói cuối cùng đã gục ngã! Phe Dân Làng, chiến thắng!',
    'Ngôi làng đã sạch bóng sói. Dân làng đã chiến thắng!',
    'Bình yên đã trở lại! Phe Dân Làng, giành chiến thắng!',
    'Không còn con sói nào nữa... Dân làng, chiến thắng vẻ vang!',
    'Sự thật đã được phơi bày. Phe Dân Làng, chiến thắng!'
  ],
  win_werewolf: [
    'Bóng tối đã bao trùm ngôi làng... Không còn ai ngăn được bầy sói nữa. Phe Sói, chiến thắng!',
    'Bầy sói đã thống trị ngôi làng... Phe Sói, chiến thắng!',
    'Không còn ai đủ sức chống lại bầy sói. Sói, chiến thắng!',
    'Tiếng tru vang khắp ngôi làng... Phe Sói đã giành chiến thắng!',
    'Dân làng đã thua... Phe Sói, chiến thắng!',
    'Những kẻ giấu mặt đã thắng. Phe Sói, chiến thắng!'
  ],
  win_piper: [
    'Tiếng sáo vang lên khắp ngôi làng... Tất cả đã bị thôi miên. Người Thổi Sáo, chiến thắng!',
    'Cả làng đã chìm trong tiếng sáo... Người Thổi Sáo, chiến thắng!',
    'Không ai còn tỉnh táo nữa. Người Thổi Sáo đã chiến thắng!',
    'Mọi người đều đã bị mê hoặc... Người Thổi Sáo, giành chiến thắng!',
    'Tiếng sáo đã khuất phục cả ngôi làng. Người Thổi Sáo, chiến thắng!',
    'Một mình chống lại tất cả... Người Thổi Sáo đã chiến thắng!'
  ],
  win_lovers: [
    'Tình yêu đã vượt qua tất cả! Cặp Tình Nhân là những người cuối cùng còn sống, và họ đã chiến thắng!',
    'Chỉ còn lại hai người yêu nhau... Cặp đôi, chiến thắng!',
    'Tình yêu đã thắng tất cả! Cặp đôi là người chiến thắng!',
    'Vượt qua mọi chia rẽ... Cặp Tình Nhân, chiến thắng!',
    'Hai trái tim đã cùng nhau sống sót. Cặp đôi, chiến thắng!',
    'Bất chấp phe phái, tình yêu đã chiến thắng!'
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
