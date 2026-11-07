// "Ai là nội gián" (Undercover): the word pairs and the settings.
// Shared by the server and the browser.

// Two close words: the village gets one, the undercover the other (which is
// which is drawn each game).
export const WORD_PAIRS = [
  ['Cà phê', 'Trà sữa'], ['Phở', 'Bún bò'], ['Xe máy', 'Xe đạp'], ['Con mèo', 'Con chó'],
  ['Biển', 'Hồ'], ['Bác sĩ', 'Y tá'], ['Điện thoại', 'Máy tính bảng'], ['Tết', 'Trung thu'],
  ['Bánh chưng', 'Bánh tét'], ['Bánh mì', 'Bánh bao'], ['Mưa', 'Tuyết'], ['Cầu lông', 'Quần vợt'],
  ['Bóng đá', 'Bóng rổ'], ['Giáo viên', 'Hiệu trưởng'], ['Sách', 'Tạp chí'], ['Đàn guitar', 'Đàn piano'],
  ['Kem', 'Sữa chua'], ['Rạp chiếu phim', 'Nhà hát'], ['Máy bay', 'Trực thăng'], ['Tàu hoả', 'Xe buýt'],
  ['Hoa hồng', 'Hoa sen'], ['Cam', 'Quýt'], ['Dưa hấu', 'Dưa lưới'], ['Gà rán', 'Gà nướng'],
  ['Lẩu', 'Nướng'], ['Karaoke', 'Quán bar'], ['Facebook', 'Zalo'], ['Youtube', 'TikTok'],
  ['Siêu thị', 'Chợ'], ['Ngân hàng', 'Tiệm vàng'], ['Bệnh viện', 'Phòng khám'], ['Công an', 'Bảo vệ'],
  ['Ca sĩ', 'Diễn viên'], ['Đám cưới', 'Sinh nhật'], ['Nhẫn', 'Vòng tay'], ['Áo dài', 'Áo bà ba'],
  ['Nón lá', 'Mũ bảo hiểm'], ['Kính râm', 'Kính cận'], ['Son môi', 'Phấn má'], ['Dầu gội', 'Sữa tắm'],
  ['Bàn chải', 'Lược'], ['Tủ lạnh', 'Máy giặt'], ['Quạt', 'Điều hoà'], ['Gối', 'Chăn'],
  ['Ma', 'Zombie'], ['Siêu nhân', 'Người nhện'], ['Rồng', 'Khủng long'], ['Hổ', 'Sư tử'],
  ['Khỉ', 'Đười ươi'], ['Cá heo', 'Cá mập'], ['Ong', 'Bướm'], ['Muỗi', 'Ruồi'],
  ['Mặt trời', 'Mặt trăng'], ['Núi', 'Đồi'], ['Sông', 'Suối'], ['Rừng', 'Công viên'],
  ['Bút bi', 'Bút chì'], ['Thước kẻ', 'Compa'], ['Bảng đen', 'Máy chiếu'], ['Kỳ thi', 'Bài kiểm tra'],
  ['Pizza', 'Hamburger'], ['Sushi', 'Gỏi cuốn'], ['Mì tôm', 'Miến'], ['Nước mắm', 'Xì dầu'],
  ['Bia', 'Rượu vang'], ['Coca', 'Pepsi'], ['Socola', 'Kẹo'], ['Bỏng ngô', 'Khoai tây chiên']
];

export const UNDERCOVER_DEFAULTS = {
  undercovers: 0, // 0: by the number of players (1, or 2 from 7 players)
  mrWhite: false, // one player with no word at all
  speakTime: 30, // seconds each player has to describe their word
  voteTime: 60,
  guessTime: 45 // Mr. White's last guess at the village's word
};

export const UNDERCOVER_LIMITS = {
  undercovers: [0, 3],
  speakTime: [10, 120],
  voteTime: [20, 180],
  guessTime: [15, 120]
};

// How many undercover players for a table of n, when the host leaves it to us.
export const autoUndercovers = (n) => (n >= 7 ? 2 : 1);

// Comparing a guess with the word, ignoring case and extra spaces (accents count).
export const sameWord = (a, b) => {
  const norm = (w) => String(w || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
};
