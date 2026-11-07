// The games on the table. Shared by the server and the browser.
//   ready: playable now; a game not ready yet shows as "sắp có".

export const GAMES_INFO = [
  {
    id: 'werewolf',
    name: 'Ma Sói',
    icon: '🐺',
    min: 4,
    max: 18,
    time: '20–40 phút',
    blurb: 'Dân làng tìm Sói trước khi bị cắn hết. Có quản trò đọc lời dẫn.',
    ready: true
  },
  {
    id: 'spyfall',
    name: 'Ai là gián điệp',
    icon: '🕵️',
    min: 3,
    max: 12,
    time: '8–10 phút',
    blurb: 'Ai cũng biết mình đang ở đâu, trừ gián điệp. Hỏi đáp để lật mặt kẻ lạ.',
    ready: true
  },
  {
    id: 'undercover',
    name: 'Ai là nội gián',
    icon: '🗝️',
    min: 4,
    max: 12,
    time: '10–15 phút',
    blurb: 'Mỗi người một từ khoá, nội gián nhận từ gần giống. Mô tả rồi bỏ phiếu loại.',
    ready: true
  },
  {
    id: 'avalon',
    name: 'Avalon',
    icon: '🛡️',
    min: 5,
    max: 10,
    time: '30 phút',
    blurb: 'Hiệp sĩ đi làm nhiệm vụ, kẻ phản bội lẫn trong đội. Bỏ phiếu bí mật.',
    ready: true
  }
];

export const gameInfo = (id) => GAMES_INFO.find(g => g.id === id) || GAMES_INFO[0];
