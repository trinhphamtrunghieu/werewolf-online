// "Ai là gián điệp" (Spyfall): the places, and the settings the host can change.
// Shared by the server and the browser (everyone sees the list of places).

export const LOCATIONS = [
  { name: 'Bãi biển', icon: '🏖️' },
  { name: 'Bệnh viện', icon: '🏥' },
  { name: 'Trường học', icon: '🏫' },
  { name: 'Nhà hàng', icon: '🍽️' },
  { name: 'Ngân hàng', icon: '🏦' },
  { name: 'Sân bay', icon: '✈️' },
  { name: 'Rạp chiếu phim', icon: '🎬' },
  { name: 'Siêu thị', icon: '🛒' },
  { name: 'Khách sạn', icon: '🏨' },
  { name: 'Tàu ngầm', icon: '🚢' },
  { name: 'Trạm vũ trụ', icon: '🚀' },
  { name: 'Đồn công an', icon: '🚓' },
  { name: 'Chợ nổi', icon: '🛶' },
  { name: 'Đám cưới', icon: '💍' },
  { name: 'Sở thú', icon: '🦒' },
  { name: 'Phòng gym', icon: '🏋️' },
  { name: 'Chùa', icon: '🛕' },
  { name: 'Rạp xiếc', icon: '🎪' },
  { name: 'Tàu hoả', icon: '🚆' },
  { name: 'Quán karaoke', icon: '🎤' },
  { name: 'Bến xe', icon: '🚌' },
  { name: 'Công viên nước', icon: '💦' },
  { name: 'Doanh trại quân đội', icon: '🪖' },
  { name: 'Phim trường', icon: '🎥' },
  { name: 'Tiệm cắt tóc', icon: '💈' },
  { name: 'Quán cà phê', icon: '☕' },
  { name: 'Bảo tàng', icon: '🏛️' },
  { name: 'Trạm xăng', icon: '⛽' },
  { name: 'Lớp học lái xe', icon: '🚗' },
  { name: 'Tiệm bánh mì', icon: '🥖' }
];

export const SPYFALL_DEFAULTS = {
  roundTime: 480, // seconds of questions
  voteTime: 60, // the final vote when time is up
  accuseTime: 30 // an accusation during the round
};

export const SPYFALL_LIMITS = {
  roundTime: [120, 900],
  voteTime: [20, 180],
  accuseTime: [10, 90]
};
