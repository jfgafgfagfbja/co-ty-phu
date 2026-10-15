# Cờ Tỷ Phú — Hành trình khắp Việt Nam

Game Cờ Tỷ Phú (Monopoly) chạy trên trình duyệt, 2–6 người chơi: chuyền tay trên một máy,
hoặc mỗi người một điện thoại khi trang được đăng trên claude.ai.
Không cần cài đặt: mở `index.html` bằng Chrome, Edge hoặc Firefox là chơi được (chế độ một máy).

## Cách chạy

- Nhấp đúp vào `index.html`, hoặc
- Chạy máy chủ tĩnh rồi mở `http://localhost:8000`:

  ```bash
  python -m http.server 8000
  ```

Ván chơi tự lưu vào trình duyệt sau mỗi bước (kể cả khi đang dừng ở một câu hỏi);
mở lại trang sẽ có nút "Tiếp tục ván cũ".

## Chơi online (trang đăng trên claude.ai)

Trang khai báo capability `db` và `user` của artifact:

- Mỗi người mở cùng link trên điện thoại của mình, đăng nhập claude.ai, chọn **Chơi online**.
- Một người bấm **Tạo phòng mới** và gửi mã 5 ký tự; những người khác nhập mã để vào phòng chờ.
- Chủ phòng chọn luật và bấm **Bắt đầu chơi**. Chỉ máy của người tới lượt mới bấm được đổ xúc xắc,
  mua đất, xây nhà, kết thúc lượt; câu hỏi dành cho người khác (trả giá đấu giá, thiếu tiền,
  chấp nhận giao dịch, mừng sinh nhật) hiện trên máy của chính người đó.
- Người chơi cần quyền ghi db: người ngoài tổ chức của chủ trang phải được mời **qua email với quyền Editor**
  (và trang không được đồng thời chia sẻ bằng link công khai); thành viên cùng tổ chức (gói Team/Enterprise)
  chỉ cần **Contributor**. Người chỉ có quyền xem vẫn vào xem được ván. Người xem chưa đăng nhập (db không có)
  chỉ dùng được chế độ một máy.

Phòng là document `games/<mã>` trong db: `{ host, status, seats: { <user id>: { token, at } }, settings, state, rev, wid }`.
Ghế chỉ lưu user id, tên lấy qua `user.profiles()` khi hiển thị. `state` là toàn bộ trạng thái ván
(`G.s`), gồm câu hỏi đang chờ (`pending`), các bước còn lại của chuỗi (`tasks`) và hiệu ứng gần đây (`fx`).
Chỉ máy có quyền trả lời câu hỏi đang chờ (hoặc của người tới lượt) mới chạy luật và ghi lại document;
các máy khác nhận qua `onSnapshot` rồi phát lại xúc xắc, đường đi của quân và thông báo.

## Tính năng

- Bàn cờ 40 ô với địa danh Việt Nam, 8 nhóm màu, 4 sân bay, 2 công ty.
- 16 thẻ Cơ hội và 16 thẻ Khí vận.
- Luật gốc: ra đôi được đổ tiếp, 3 lần đôi vào tù, nhà tù (đổ đôi / nộp $50 / thẻ ra tù),
  xây nhà đều theo nhóm màu, khách sạn, giới hạn 32 nhà / 12 khách sạn, thế chấp và chuộc lại (+10%),
  đấu giá khi không mua, phá sản và chuyển tài sản cho chủ nợ.
- Giao dịch giữa người chơi (đất, tiền, thẻ ra tù).
- Tùy chọn: tiền khởi đầu, bật/tắt đấu giá, quỹ Bãi đỗ xe, xáo trộn thứ tự đi.
- Phím Space bấm nút chính; bấm vào một ô để xem giấy chủ quyền.

## Cấu trúc

| File | Nội dung |
|---|---|
| `index.html` | Khung trang |
| `css/style.css` | Giao diện bàn cờ, bảng điều khiển, hộp thoại, phòng chờ |
| `js/data.js` | Dữ liệu bàn cờ, giá đất, tiền thuê, bộ thẻ |
| `js/game.js` | Luật chơi dạng máy trạng thái lưu được bằng JSON (đổ xúc xắc, di chuyển, thuê, thẻ, tù, đấu giá, phá sản, giao dịch, lưu ván) |
| `js/net.js` | Chơi online: tạo / vào phòng, phòng chờ, đồng bộ trạng thái qua db |
| `js/ui.js` | Vẽ bàn cờ, người chơi, nhật ký, câu hỏi, phát lại hiệu ứng, các hộp thoại |
| `tools/build.js` | Gộp thành một trang HTML duy nhất để đăng lên claude.ai |
| `tools/mock-claude.js` | db và user giả để thử chế độ online trên máy |

## Đóng gói và thử

```bash
node tools/build.js
```

ghi `build/co-ty-phu.html` (không có doctype/html/head/body, CSS và JS nhúng inline) để đăng lên claude.ai.

Thử chế độ online trên máy: build kèm db giả rồi mở hai tab cùng trình duyệt với `?u=an` và `?u=binh`
(thêm `&ro=1` để thử người chỉ có quyền xem):

```bash
node tools/build.js build/thu-online.html --mock tools/mock-claude.js
```

Mẹo kiểm thử trong console trình duyệt: `G.diceQueue.push([3, 4])` để định sẵn kết quả xúc xắc lần đổ tới
(ở chế độ online, gõ trên máy của người sắp đổ).
