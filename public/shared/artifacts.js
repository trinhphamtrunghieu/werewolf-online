// Ultimate Werewolf: Artifacts (Bézier Games), shared between the browser and
// the server. Each player gets one face-down Artifact card on top of their role
// card, and may turn it over during the day's discussion to use its power.
//
//   once  : "1" on the card, one-time use upon reveal
//   !once : "∞" on the card, always in effect after reveal
//   gem   : the gem cards, which act on other Artifact cards (1 for every 4
//           other cards in a game, as the rules advise)
//   dawn  : an "each day at dawn" card: from the day after it was revealed,
//           its owner makes a choice every morning before the vote
//   pick  : how many players the owner chooses on reveal, and among whom:
//             alive      a living player other than you
//             unrevealed a living player other than you with an unrevealed card
//             forever    a living player other than you with a revealed ∞ card
//             dead       a player who died since yesterday morning
//   ordered: the order of the picks matters (Ruby of Kismet)
//
// Six cards are left out because a phone cannot keep them, only the players'
// honour could: the Coin of Youth (saying your role name aloud every day), the
// Mirror of the Doppelgänger (waking a second time at night as another role),
// the Mask of Spellcasting (someone may not speak), the Shroud of Shame
// (someone must face away), the Bow of Hunting (nobody may speak until the
// shot) and the Vote from Beyond (the dead voter may not speak).

export const ARTIFACTS = {
  amber: {
    name: 'Hổ Phách Bình Minh', en: 'The Amber of Dawn', icon: '🟡', gem: true, once: true,
    desc: 'Mọi người đã lật lá Artifact dùng một lần (kể cả bạn) trả các lá đó về chồng bài và mỗi người nhận một lá Artifact mới (úp).'
  },
  amulet: {
    name: 'Bùa Hộ Mệnh', en: 'The Amulet of Protection', icon: '🧿', once: false, dawn: true, guard: true,
    desc: 'Người đang giữ Bùa không thể bị loại. Mỗi sáng, người giữ Bùa phải trao nó cho một người chưa từng giữ.'
  },
  amethyst: {
    name: 'Thạch Anh Tím Tri Thức', en: 'The Amethyst of Knowledge', icon: '🟣', gem: true, once: true,
    pick: { n: 1, from: 'unrevealed' },
    desc: 'Chọn 1 người có lá Artifact chưa lật và bí mật xem lá đó. Sau đó quyết định có bắt họ lật lá đó ngay không (không bắt bây giờ thì về sau không bắt được).'
  },
  blood: {
    name: 'Máu Người Bệnh', en: 'The Blood of the Diseased', icon: '🩸', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người nhiễm bệnh. Nếu Sói cắn chết người đó, đêm tiếp theo bầy Sói không được cắn ai. Người đó bị loại ban ngày thì không có tác dụng.'
  },
  brand: {
    name: 'Dấu Ấn Dân Làng', en: 'The Brand of the Villager', icon: '🪧', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người: người đó mất chức năng đặc biệt đến hết ván (Sói mất chức năng thì không còn thức dậy cùng đàn).'
  },
  breath: {
    name: 'Hơi Thở Ông Lão', en: 'The Breath of the Old Man', icon: '🌬️', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người sẽ bị loại vào đêm sau ngày mai (còn ở lại hôm nay, đêm nay và ngày mai, trừ khi bị loại cách khác).'
  },
  cap: {
    name: 'Mũ Gã Khờ', en: 'The Cap of Idiocy', icon: '🤪', once: false,
    desc: 'Lúc phán quyết, phiếu của bạn luôn là "treo cổ".'
  },
  cauldron: {
    name: 'Vạc Phép Thuật', en: 'The Cauldron of Sorcery', icon: '🍲', once: true, info: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người: quản trò bí mật cho bạn biết người đó có phải Dân Làng thường hay không (không nói vai cụ thể).'
  },
  citrine: {
    name: 'Thạch Anh Vàng May Mắn', en: 'The Citrine of Fortune', icon: '🟠', gem: true, once: true,
    desc: 'Đổi lá này lấy một lá Artifact mới, lá mới phải lật ngay.'
  },
  claw: {
    name: 'Vuốt Ma Sói', en: 'The Claw of the Werewolf', icon: '🐾', once: false,
    desc: 'Bạn trở thành Sói: thức dậy và cắn cùng đàn Sói, vẫn giữ chức năng của vai cũ. Bạn sang phe Sói, thắng thua cùng Sói. Kim Cương Chối Bỏ không lấy được lá này.'
  },
  cloak: {
    name: 'Áo Choàng Hoàng Tử', en: 'The Cloak of the Prince', icon: '🧥', once: false, guard: true,
    desc: 'Bạn không thể bị loại vào ban ngày.'
  },
  cudgel: {
    name: 'Gậy Mụ Già', en: 'The Cudgel of the Old Hag', icon: '🪵', once: false, dawn: true,
    desc: 'Mỗi sáng, chọn 1 người phải rời làng hôm đó: không ai được bỏ phiếu cho người đó. Không chọn một người hai lần.'
  },
  diamond: {
    name: 'Kim Cương Chối Bỏ', en: 'The Diamond of Denial', icon: '💎', gem: true, once: true,
    pick: { n: 1, from: 'forever' },
    desc: 'Chọn 1 người có lá Artifact "luôn có tác dụng" đã lật: lấy lá đó trả về chồng bài, người đó mất tác dụng của lá. Không lấy được Vuốt Ma Sói.'
  },
  diary: {
    name: 'Nhật Ký Kẻ Mất Ngủ', en: 'The Diary of the Insomniac', icon: '📔', once: true,
    desc: 'Quản trò bí mật cho bạn biết đêm qua có người ngồi cạnh bạn (bên trái hoặc phải) thức dậy hay không, nhưng không nói là ai.'
  },
  emerald: {
    name: 'Ngọc Lục Bảo Ghen Tị', en: 'The Emerald of Jealousy', icon: '🟢', gem: true, once: true,
    pick: { n: 1, from: 'unrevealed' },
    desc: 'Chọn 1 người có lá Artifact chưa lật: lấy lá đó và lật nó cho bạn dùng. Người kia nhận một lá Artifact mới.'
  },
  eye: {
    name: 'Mắt Người Quan Sát', en: 'The Eye of the Beholder', icon: '👁️', once: false, info: true,
    desc: 'Mỗi đêm bạn thức dậy cùng Tiên Tri: thấy Tiên Tri soi ai và người đó có phải Sói không. Tiên Tri không được ra hiệu cho bạn.'
  },
  flask: {
    name: 'Bình Giấc Mơ', en: 'The Flask of Dreams', icon: '⚗️', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người mất chức năng trong 2 ngày (hôm nay, đêm nay, ngày mai và đêm mai). Sáng ngày thứ ba người đó có lại chức năng.'
  },
  heart: {
    name: 'Trái Tim Thờ Ơ', en: 'The Heart of Indifference', icon: '🖤', once: false, dawn: true,
    desc: 'Mỗi sáng, chọn 1 người không được bỏ phiếu hôm đó. Không chọn một người hai lần.'
  },
  mark: {
    name: 'Dấu Ấn Trưởng Làng', en: 'The Mark of the Mayor', icon: '🎖️', once: false,
    desc: 'Phiếu của bạn tính là 2 phiếu khi bỏ phiếu loại người.'
  },
  mist: {
    name: 'Sương Hào Quang', en: 'The Mist of Aura', icon: '🌫️', once: true, info: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người: quản trò bí mật cho bạn biết người đó có vai đặc biệt hay không (không phải Ma Sói thường hay Dân Làng thường).'
  },
  onyx: {
    name: 'Mã Não Huỷ Diệt', en: 'The Onyx of Destruction', icon: '⚫', gem: true, once: true,
    pick: { n: 1, from: 'unrevealed' },
    desc: 'Chọn 1 người có lá Artifact chưa lật: lá đó bị loại khỏi ván mà không ai được xem.'
  },
  orb: {
    name: 'Quả Cầu Phán Đoán', en: 'The Orb of Speculation', icon: '🔮', once: true,
    pick: { n: 2, from: 'alive' },
    desc: 'Chọn 2 người. Nếu cả hai đều là Sói, phe Dân thắng ngay. Nếu không, bạn bị loại ngay. Quản trò chỉ nói bạn đúng hay sai.'
  },
  pendant: {
    name: 'Mặt Dây Kiêu Hãnh', en: 'The Pendant of Pride', icon: '🪬', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người và bí mật cho người đó xem lá vai trò của bạn.'
  },
  prism: {
    name: 'Lăng Kính Quyền Năng', en: 'The Prism of Power', icon: '🔺', once: true,
    pick: { n: 3, from: 'alive' },
    desc: 'Chọn 3 người. Đêm nay bầy Sói chỉ được cắn một trong ba người đó. Nếu không ai trong ba người cắn được (đã chết hoặc là Sói), đêm nay Sói không cắn ai.'
  },
  ring: {
    name: 'Nhẫn Sự Thật', en: 'The Ring of Truth', icon: '💍', once: true, info: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người: quản trò bí mật cho bạn biết người đó có phải Sói không.'
  },
  rod: {
    name: 'Gậy Luân Hồi', en: 'The Rod of Reincarnation', icon: '🪄', once: true, onDeath: true, guard: true,
    desc: 'Khi bạn bị loại, lá này tự lật và bạn ở lại ván… nhưng khác đi. Nếu là Sói, bạn mất chức năng (không thức dậy nữa). Nếu không, bạn nhận một vai mới ngẫu nhiên, không ai biết. Lật trước khi bị loại thì không có tác dụng.'
  },
  ruby: {
    name: 'Hồng Ngọc Định Mệnh', en: 'The Ruby of Kismet', icon: '🔴', gem: true, once: true,
    pick: { n: 2, from: 'unrevealed', ordered: true },
    desc: 'Chọn 2 người có lá Artifact chưa lật: họ phải lật lá của mình theo thứ tự bạn chọn, và lá đó có tác dụng như thể chính họ lật.'
  },
  sapphire: {
    name: 'Lam Ngọc Số Phận', en: 'The Sapphire of Fate', icon: '🔵', gem: true, once: true,
    pick: { n: 1, from: 'unrevealed' },
    desc: 'Chọn 1 người có lá Artifact chưa lật và bí mật xem lá đó. Khi người đó lật lá này, cả hai cùng được dùng (người giữ lá dùng trước).'
  },
  scepter: {
    name: 'Quyền Trượng Tái Sinh', en: 'The Scepter of Rebirth', icon: '🔱', once: true, onDeath: true, guard: true,
    desc: 'Khi bạn bị loại, lá này tự lật và bạn ở lại ván. Lật trước khi bị loại thì không có tác dụng.'
  },
  sheet: {
    name: 'Tấm Vải Hồn Ma', en: 'The Sheet of the Ghost', icon: '🏳️', once: true,
    pick: { n: 1, from: 'dead' },
    desc: 'Hỏi một người vừa bị loại (từ sáng hôm qua) để họ cho bạn một chữ cái.'
  },
  shield: {
    name: 'Khiên Vệ Sĩ', en: 'The Shield of the Bodyguard', icon: '🔰', once: false, dawn: true, guard: true,
    desc: 'Mỗi sáng, chọn 1 người khác nhau: người đó không thể bị loại đêm hôm đó.'
  },
  skimmer: {
    name: 'Mũ Kẻ Bị Nguyền', en: 'The Skimmer of the Cursed', icon: '🎩', once: false,
    desc: 'Bạn bị nguyền: nếu Sói cắn bạn vào ban đêm, bạn không chết mà hoá Sói và sang phe Sói.'
  },
  spear: {
    name: 'Giáo Cuồng Nộ', en: 'The Spear of Fury', icon: '⚔️', once: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người bị loại ngay, và lật lá vai trò của bạn cho cả làng xem.'
  },
  staff: {
    name: 'Gậy Tiên Tri', en: 'The Staff of the Seer', icon: '🦯', once: true, info: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người và bí mật xem lá vai trò của người đó.'
  },
  stone: {
    name: 'Đá Biến Đổi', en: 'The Stone of Alteration', icon: '🪨', once: true,
    desc: 'Bí mật đổi lá vai trò của bạn lấy một lá khác. Nếu là Sói, bạn nhận một lá Sói khác; nếu không, bạn nhận một lá ngẫu nhiên (có thể là Sói).'
  },
  talisman: {
    name: 'Bùa Rắc Rối', en: 'The Talisman of Trouble', icon: '🧨', once: true,
    desc: 'Hôm nay làng loại 2 người: sau lần treo cổ thứ nhất, cả làng bỏ phiếu thêm một lần.'
  },
  void: {
    name: 'Hư Không', en: 'The Void of Nothingness', icon: '🕳️', once: false,
    desc: 'Lá này không có tác dụng gì.'
  },
  // --- Lá tự chế (homebrew): không có trong bộ gốc, để khắc chế các lá
  // phòng thủ và tránh ván bị khoá. Chủ phòng tắt được.
  sword: {
    name: 'Kiếm Công Lý', en: 'The Sword of Justice', icon: '🗡️', once: true, homebrew: true, counter: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người bị loại ngay. Không Artifact nào cứu được người đó (Áo Choàng, Bùa, Khiên, Quyền Trượng, Gậy Luân Hồi).'
  },
  vial: {
    name: 'Lọ Độc', en: 'The Vial of Poison', icon: '🧴', once: true, homebrew: true, counter: true, night: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người: người đó chết vào cuối đêm nay. Bảo Vệ, Bùa Hộ Mệnh và Khiên Vệ Sĩ không cứu được.'
  },
  silverbow: {
    name: 'Cung Bạc', en: 'The Silver Bow', icon: '🏹', once: true, homebrew: true, counter: true, night: true,
    pick: { n: 1, from: 'alive' },
    desc: 'Chọn 1 người. Đêm nay mũi tên bạc bắn trúng: nếu người đó là Sói thì chết vào cuối đêm (không Artifact nào cứu được); nếu không phải Sói thì không sao.'
  },
  gloves: {
    name: 'Găng Tay Kẻ Trộm', en: 'The Gloves of the Thief', icon: '🧤', once: true, homebrew: true, counter: true,
    pick: { n: 1, from: 'forever' },
    desc: 'Chọn 1 người có lá Artifact "luôn có tác dụng" đã lật: cướp lá đó về cho bạn dùng (trừ Vuốt Ma Sói).'
  },
  mirror: {
    name: 'Gương Phá Phép', en: 'The Mirror of Negation', icon: '🪞', once: true, homebrew: true, counter: true,
    pick: { n: 1, from: 'forever' },
    desc: 'Chọn 1 người có lá Artifact "luôn có tác dụng" đã lật: lá đó bị huỷ khỏi ván (trừ Vuốt Ma Sói).'
  },
  wreath: {
    name: 'Vòng Hoa Hoà Bình', en: 'The Wreath of Peace', icon: '🌿', once: false,
    desc: 'Lúc phán quyết, phiếu của bạn luôn là "tha".'
  }
};

export const ARTIFACT_IDS = Object.keys(ARTIFACTS);

// How many gem cards go into a game of n players: 1 for every 4 other cards.
export const gemsFor = (n) => Math.floor(n / 5);

// Building the Artifact deck for a game (see lib/artifacts.js):
//   guard   cards that keep a player alive. They only go in when the table has
//           at least 2 independent ways of killing at night (Phù Thủy, Thợ
//           Săn, Mục Sư, Lọ Độc, Cung Bạc, Hơi Thở Ông Lão), so a protected
//           wolf can still be dealt with.
//   info    cards that read someone's role or side: at most 1 of them when
//           the deck already has a role that reads players at night, else 2.
export const NIGHT_KILL_ROLES = ['witch', 'hunter', 'priest'];
export const NIGHT_KILL_ARTIFACTS = ['vial', 'silverbow', 'breath'];
export const SEER_ROLES = ['seer', 'apprentice_seer', 'aura_seer', 'pi', 'detective'];
export const MIN_NIGHT_KILLS_FOR_GUARDS = 2;
export const infoCap = (hasSeers) => (hasSeers ? 1 : 2);

// The general rules, shown in the rules sheet.
export const ARTIFACT_RULES = [
  'Đầu ván, mỗi người được chia 2 lá Artifact và bí mật chọn giữ 1 lá; lá kia trả về chồng bài. Hết giờ chưa chọn thì quản trò chọn ngẫu nhiên giúp, nhưng bạn vẫn đổi sang lá kia được cho tới khi đêm xuống. Chủ phòng không cắt ngang được lúc mọi người đang chọn. Chỉ mình bạn xem được lá của mình.',
  'Chủ phòng có thể chỉ cho một số người giữ Artifact (chọn ngẫu nhiên mỗi ván). Ai cũng được chia 2 lá và chọn 1 như nhau; người không được giữ chỉ biết điều đó (một mình) khi chọn xong, lá trả về chồng bài. Không ai biết những người khác có lá hay không: màn hình của người không có lá trông giống hệt (vẫn có một lá úp).',
  'Cặp Tình Nhân khác phe luôn có lá Artifact: người yêu nào không được giữ lá thì nhận lại lá mình đã chọn ngay khi thành cặp (chỉ một lần, lúc đầu ván).',
  'Bộ bài được xếp để tránh ván bị khoá: lá phòng thủ chỉ có khi bàn có ít nhất 2 cách giết ban đêm (Phù Thủy, Thợ Săn, Mục Sư, Lọ Độc, Cung Bạc, Hơi Thở Ông Lão); nếu bộ bài đã có vai soi người ban đêm (Tiên Tri, Thám Tử…) thì chỉ có tối đa 1 lá soi vai/phe, không thì tối đa 2.',
  'Lá tự chế (không có trong bộ gốc, chủ phòng tắt được): Kiếm Công Lý, Lọ Độc, Cung Bạc, Găng Tay Kẻ Trộm, Gương Phá Phép, để khắc chế các lá phòng thủ.',
  'Lá Artifact chỉ được lật trong lúc cả làng thảo luận ban ngày, khi bạn còn sống. Không lật được ban đêm hay sau khi đã bị loại (trừ Gậy Luân Hồi và Quyền Trượng Tái Sinh, tự lật khi bạn bị loại).',
  'Mỗi lần chỉ một lá được dùng: lá trước phải xong (kể cả lựa chọn đi kèm) thì người khác mới lật được. Lật lá thì thảo luận được thêm ít nhất 20 giây.',
  'Lá "1" chỉ dùng một lần khi lật. Lá "∞" có tác dụng mãi từ lúc lật. Lá đã lật để ngửa, cả làng đều thấy.',
  'Cả làng chỉ được báo ai vừa lật (hoặc dùng) lá Artifact nào; bạn chọn ai và kết quả ra sao thì không công bố (chỉ người liên quan được báo trong 📜 Nhật ký). Riêng người phải rời làng (Gậy Mụ Già) hay không được bỏ phiếu (Trái Tim Thờ Ơ) vẫn hiện cho cả làng, vì mọi người phải tuân theo. Người bị loại ban ngày vẫn được báo. Không được chọn chính mình; với lá "∞", không chọn một người hai lần trong ván.',
  'Lá "mỗi sáng" (Bùa Hộ Mệnh, Gậy Mụ Già, Trái Tim Thờ Ơ, Khiên Vệ Sĩ) được dùng từ sáng hôm sau ngày lật, trước khi bỏ phiếu. Hết thảo luận mà chưa chọn thì Bùa Hộ Mệnh được trao ngẫu nhiên, các lá khác bỏ lượt hôm đó.',
  'Hết giờ thảo luận mà lựa chọn của một lá vẫn chưa xong thì quản trò chọn ngẫu nhiên giúp.',
  'Lá chưa lật của người bị loại được trả về chồng bài. Artifact luôn mạnh hơn vai trò (ví dụ Mũ Gã Khờ bắt Người Hoà Bình bỏ phiếu treo cổ). Tiên Tri và các vai soi đêm luôn thấy lá vai trò gốc.',
  'Có thể nói dối về lá Artifact của mình khi chưa lật.',
  'Không dùng 6 lá chỉ giữ được bằng tự giác, điện thoại không theo dõi được: Đồng Xu Tuổi Trẻ (Coin of Youth), Gương Song Trùng (Mirror of the Doppelgänger), Mặt Nạ Phong Ấn (Mask of Spellcasting), Khăn Choàng Hổ Thẹn (Shroud of Shame), Cung Săn (Bow of Hunting) và Lá Phiếu Từ Cõi Chết (Vote from Beyond).'
];
