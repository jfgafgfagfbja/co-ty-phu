'use strict';

/* Dữ liệu cố định: bàn cờ 40 ô, nhóm màu, bộ thẻ Cơ hội / Khí vận. */

const GROUPS = {
  brown:     { name: 'Nâu',       color: '#8d5a3b', text: '#fff' },
  lightblue: { name: 'Xanh nhạt', color: '#8fd3f4', text: '#1f2933' },
  pink:      { name: 'Hồng',      color: '#d6489a', text: '#fff' },
  orange:    { name: 'Cam',       color: '#f08a24', text: '#fff' },
  red:       { name: 'Đỏ',        color: '#e03131', text: '#fff' },
  yellow:    { name: 'Vàng',      color: '#f5c518', text: '#1f2933' },
  green:     { name: 'Xanh lá',   color: '#2f9e44', text: '#fff' },
  darkblue:  { name: 'Xanh đậm',  color: '#1c4fb0', text: '#fff' },
};
const GROUP_ORDER = Object.keys(GROUPS);

const AIRPORT_RENT = [25, 50, 100, 200];
const UTILITY_MULT = [4, 10];

// Giá xây mỗi nhà (kể cả nâng lên khách sạn) bằng giá đất. Mỗi nhà làm tiền thuê tăng thêm 35% giá xây,
// nên tiền thuê luôn thấp hơn số tiền bán lại số nhà đó cho ngân hàng (nửa giá xây).
const HOUSE_PRICE_RATE = 1;
const RENT_PER_HOUSE_RATE = 0.35;
const round10 = n => Math.round(n / 10) * 10;

// base: tiền thuê đất trống. rent: [đất trống, 1 nhà, 2 nhà, 3 nhà, 4 nhà, khách sạn]
const prop = (name, group, price, base) => {
  const house = round10(price * HOUSE_PRICE_RATE);
  const step = round10(house * RENT_PER_HOUSE_RATE);
  return { type: 'property', name, group, price, house, rent: [0, 1, 2, 3, 4, 5].map(n => base + n * step) };
};
const airport = (name, short) => ({ type: 'airport', name, short, price: 200, icon: '✈️' });
const utility = (name, short, icon) => ({ type: 'utility', name, short, price: 150, icon });
const CHANCE_SQ = { type: 'chance', name: 'Cơ hội', icon: '❓' };
const CHEST_SQ = { type: 'chest', name: 'Khí vận', icon: '🧧' };

const BOARD = [
  { type: 'go', name: 'Xuất phát', icon: '🏁' },
  prop('Hà Giang', 'brown', 60, 2),
  CHEST_SQ,
  prop('Cao Bằng', 'brown', 60, 4),
  { type: 'tax', name: 'Thuế thu nhập', amount: 200, icon: '💸' },
  airport('Sân bay Nội Bài', 'Nội Bài'),
  prop('Lào Cai', 'lightblue', 100, 6),
  CHANCE_SQ,
  prop('Sơn La', 'lightblue', 100, 6),
  prop('Điện Biên', 'lightblue', 120, 8),
  { type: 'jail', name: 'Nhà tù', icon: '🔒' },
  prop('Ninh Bình', 'pink', 140, 10),
  utility('Công ty Điện lực', 'Điện lực', '💡'),
  prop('Thanh Hóa', 'pink', 140, 10),
  prop('Nghệ An', 'pink', 160, 12),
  airport('Sân bay Phú Bài', 'Phú Bài'),
  prop('Quảng Bình', 'orange', 180, 14),
  CHEST_SQ,
  prop('Huế', 'orange', 180, 14),
  prop('Hội An', 'orange', 200, 16),
  { type: 'parking', name: 'Bãi đỗ xe', icon: '🅿️' },
  prop('Quy Nhơn', 'red', 220, 18),
  CHANCE_SQ,
  prop('Nha Trang', 'red', 220, 18),
  prop('Đà Lạt', 'red', 240, 20),
  airport('Sân bay Cam Ranh', 'Cam Ranh'),
  prop('Vũng Tàu', 'yellow', 260, 22),
  prop('Cần Thơ', 'yellow', 260, 22),
  utility('Công ty Cấp nước', 'Cấp nước', '🚰'),
  prop('Phú Quốc', 'yellow', 280, 24),
  { type: 'gotojail', name: 'Vào tù', icon: '👮' },
  prop('Hải Phòng', 'green', 300, 26),
  prop('Hạ Long', 'green', 300, 26),
  CHEST_SQ,
  prop('Đà Nẵng', 'green', 320, 28),
  airport('Sân bay Tân Sơn Nhất', 'Tân Sơn Nhất'),
  CHANCE_SQ,
  prop('Hà Nội', 'darkblue', 350, 35),
  { type: 'tax', name: 'Thuế xa xỉ', amount: 100, icon: '💍' },
  prop('TP. Hồ Chí Minh', 'darkblue', 400, 50),
];

const GROUP_SQUARES = Object.fromEntries(
  GROUP_ORDER.map(g => [g, BOARD.flatMap((q, i) => (q.group === g ? [i] : []))])
);

const JAIL_CARD_TEXT = 'Thẻ RA TÙ MIỄN PHÍ. Giữ lại đến khi cần dùng, hoặc đem ra giao dịch.';
const GO_TO_JAIL_TEXT = 'Vào tù! Đi thẳng vào tù, không đi qua ô Xuất phát, không nhận $200.';

const CHANCE = [
  { text: 'Đi thẳng đến TP. Hồ Chí Minh.', action: 'moveTo', to: 39 },
  { text: 'Tiến về ô Xuất phát và nhận $200.', action: 'moveTo', to: 0 },
  { text: 'Đi đến Đà Lạt. Nếu đi qua ô Xuất phát, nhận $200.', action: 'moveTo', to: 24 },
  { text: 'Đi đến Ninh Bình. Nếu đi qua ô Xuất phát, nhận $200.', action: 'moveTo', to: 11 },
  { text: 'Đi đến sân bay gần nhất. Nếu sân bay đã có chủ, trả gấp đôi tiền thuê; nếu chưa, bạn có thể mua.', action: 'nearest', kind: 'airport' },
  { text: 'Đi đến sân bay gần nhất. Nếu sân bay đã có chủ, trả gấp đôi tiền thuê; nếu chưa, bạn có thể mua.', action: 'nearest', kind: 'airport' },
  { text: 'Đi đến công ty gần nhất. Nếu đã có chủ, đổ xúc xắc và trả 10 lần số chấm; nếu chưa, bạn có thể mua.', action: 'nearest', kind: 'utility' },
  { text: 'Ngân hàng trả cổ tức cho bạn $50.', action: 'gain', amount: 50 },
  { text: JAIL_CARD_TEXT, action: 'jailCard' },
  { text: 'Lùi lại 3 ô.', action: 'back', steps: 3 },
  { text: GO_TO_JAIL_TEXT, action: 'jail' },
  { text: 'Sửa chữa nhà cửa: trả $25 cho mỗi nhà và $100 cho mỗi khách sạn.', action: 'repairs', house: 25, hotel: 100 },
  { text: 'Bị phạt chạy quá tốc độ: trả $15.', action: 'pay', amount: 15 },
  { text: 'Bay một chuyến từ Sân bay Nội Bài. Nếu đi qua ô Xuất phát, nhận $200.', action: 'moveTo', to: 5 },
  { text: 'Bạn được bầu làm Chủ tịch Hội đồng quản trị. Trả mỗi người chơi $50.', action: 'payEach', amount: 50 },
  { text: 'Khoản vay xây dựng đáo hạn. Nhận $150.', action: 'gain', amount: 150 },
];

const CHEST = [
  { text: 'Tiến về ô Xuất phát và nhận $200.', action: 'moveTo', to: 0 },
  { text: 'Ngân hàng tính nhầm có lợi cho bạn. Nhận $200.', action: 'gain', amount: 200 },
  { text: 'Phí khám bệnh: trả $50.', action: 'pay', amount: 50 },
  { text: 'Bán cổ phiếu, thu về $50.', action: 'gain', amount: 50 },
  { text: JAIL_CARD_TEXT, action: 'jailCard' },
  { text: GO_TO_JAIL_TEXT, action: 'jail' },
  { text: 'Nhận lì xì Tết $100.', action: 'gain', amount: 100 },
  { text: 'Được hoàn thuế thu nhập. Nhận $20.', action: 'gain', amount: 20 },
  { text: 'Hôm nay là sinh nhật bạn! Mỗi người chơi mừng bạn $10.', action: 'collectEach', amount: 10 },
  { text: 'Bảo hiểm nhân thọ đáo hạn. Nhận $100.', action: 'gain', amount: 100 },
  { text: 'Trả viện phí $100.', action: 'pay', amount: 100 },
  { text: 'Đóng học phí $50.', action: 'pay', amount: 50 },
  { text: 'Nhận phí tư vấn $25.', action: 'gain', amount: 25 },
  { text: 'Đóng phí sửa đường: $40 cho mỗi nhà và $115 cho mỗi khách sạn.', action: 'repairs', house: 40, hotel: 115 },
  { text: 'Đoạt giải Nhì cuộc thi sắc đẹp. Nhận $10.', action: 'gain', amount: 10 },
  { text: 'Nhận thừa kế $100.', action: 'gain', amount: 100 },
];

const TOKENS = ['🛵', '🚗', '🚢', '✈️', '🐉', '🐱', '🎩', '🚀'];
const PLAYER_COLORS = ['#e03131', '#1971c2', '#2b8a3e', '#f08c00', '#9c36b5', '#0c8599'];
const MAX_PLAYERS = PLAYER_COLORS.length;
