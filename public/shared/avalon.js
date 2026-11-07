// Avalon (The Resistance: Avalon): the parts, the table sizes and the settings.
// Shared by the server and the browser.

export const AVALON_ROLES = {
  merlin: { name: 'Merlin', side: 'good', icon: '🧙', desc: 'Bạn biết ai thuộc phe Ác (trừ Mordred). Dẫn dắt phe Thiện mà không để lộ mình: cuối ván, Sát Thủ đoán trúng bạn là phe Ác thắng.' },
  percival: { name: 'Percival', side: 'good', icon: '🛡️', desc: 'Bạn thấy Merlin (và Morgana, nếu có) nhưng không biết ai là ai. Hãy bảo vệ Merlin.' },
  servant: { name: 'Hiệp sĩ trung thành', side: 'good', icon: '⚔️', desc: 'Bạn không biết gì thêm. Chọn đội đáng tin và giúp nhiệm vụ thành công.' },
  assassin: { name: 'Sát Thủ', side: 'evil', icon: '🗡️', desc: 'Phe Ác. Nếu phe Thiện thắng 3 nhiệm vụ, bạn được đoán ai là Merlin: trúng là phe Ác thắng.' },
  morgana: { name: 'Morgana', side: 'evil', icon: '🔮', desc: 'Phe Ác. Với Percival, bạn trông giống Merlin.' },
  mordred: { name: 'Mordred', side: 'evil', icon: '👑', desc: 'Phe Ác. Merlin không biết bạn.' },
  oberon: { name: 'Oberon', side: 'evil', icon: '🌑', desc: 'Phe Ác, nhưng không biết đồng bọn, và đồng bọn cũng không biết bạn.' },
  minion: { name: 'Tay sai của Mordred', side: 'evil', icon: '😈', desc: 'Phe Ác. Bạn biết đồng bọn (trừ Oberon). Làm nhiệm vụ thất bại mà không bị lộ.' }
};

// Good and evil players for a table of n.
export const AVALON_SIDES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };

// Team size for each of the five quests, by table size.
export const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};

// The fourth quest needs two fail cards to fail from seven players up.
export const failsNeeded = (n, quest) => (quest === 3 && n >= 7 ? 2 : 1);

export const AVALON_DEFAULTS = {
  percival: true, // Percival and Morgana
  mordred: false,
  oberon: false,
  lady: false, // Tiên Nữ Hồ (Lady of the Lake)
  pickTime: 120, // the leader chooses a team
  voteTime: 45, // everyone approves or rejects it
  questTime: 30, // the team plays success or fail
  assassinTime: 120,
  ladyTime: 60
};

export const AVALON_LIMITS = {
  pickTime: [30, 600],
  voteTime: [15, 180],
  questTime: [10, 120],
  assassinTime: [30, 600],
  ladyTime: [15, 300]
};

// Tiên Nữ Hồ looks after these quests (the 2nd, 3rd and 4th).
export const LADY_AFTER = [1, 2, 3];
