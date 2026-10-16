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

## Chơi online ngoài claude.ai (GitHub Pages + Firebase)

Khi trang không chạy trong claude.ai, chế độ online dùng Firestore và đăng nhập ẩn danh của Firebase
(gói Spark miễn phí). Người chơi không cần tài khoản, chỉ cần nhập tên khi tạo hoặc vào phòng.

1. Tạo project trên https://console.firebase.google.com.
2. Authentication → Sign-in method → bật **Anonymous**; Settings → Authorized domains → thêm tên miền của trang
   (ví dụ `jfgafgfagfbja.github.io`).
3. Firestore Database → Create database (Production mode), tab **Rules** dán:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /games/{code} {
         allow read: if true;
         allow create, update: if request.auth != null && request.resource.data.app == 'co-ty-phu';
       }
     }
   }
   ```
4. Project settings → Your apps → Web app, chép `firebaseConfig` vào `js/firebase-config.js`
   (`const FIREBASE_CONFIG = { ... }`). Cấu hình này không phải mật khẩu; quyền ghi do Rules ở trên giới hạn.

Thêm `?rieng` vào link để mỗi tab là một người chơi riêng khi thử trên một máy.

GitHub Pages cho trình duyệt giữ file trong bộ nhớ đệm 10 phút. Mỗi lần cập nhật, tăng số `?v=` ở các thẻ
`<link>` / `<script>` trong `index.html` để điện thoại tải bản mới.

## Cách lưu phòng

Phòng là document `games/<mã>` (db của artifact trên claude.ai, hoặc Firestore):
`{ host, status, seats: { <user id>: { token, at, name? } }, settings, state, rev, wid }`.
Trên claude.ai ghế chỉ lưu user id, tên lấy qua `user.profiles()`; qua Firebase thì ghế lưu tên tự nhập.
`state` là toàn bộ trạng thái ván (`G.s`), gồm câu hỏi đang chờ (`pending`), các bước còn lại của chuỗi
(`tasks`) và hiệu ứng gần đây (`fx`).
Chỉ máy có quyền trả lời câu hỏi đang chờ (hoặc của người tới lượt) mới chạy luật và ghi lại document;
các máy khác nhận qua `onSnapshot` rồi phát lại xúc xắc, đường đi của quân và thông báo.

## Tính năng

- Bàn cờ 40 ô với địa danh Việt Nam, 8 nhóm màu, 4 sân bay, 2 công ty.
- 16 thẻ Cơ hội và 16 thẻ Khí vận.
- Luật: ra đôi được đổ tiếp, 3 lần đôi vào tù, nhà tù (đổ đôi / nộp $50 / thẻ ra tù),
  khách sạn, giới hạn 32 nhà / 12 khách sạn, thế chấp và chuộc lại (+10%),
  đấu giá khi không mua, phá sản và chuyển tài sản cho chủ nợ.
- Luật riêng của bản này:
  - Sở hữu ô nào là xây nhà được ô đó, không cần đủ nhóm màu (đủ nhóm thì đất trống thu gấp đôi).
  - Giá xây mỗi nhà bằng giá đất; mỗi nhà làm tiền thuê tăng 35% giá xây, nên tiền thuê luôn thấp hơn
    tiền bán lại số nhà đó (chỉnh ở `HOUSE_PRICE_RATE`, `RENT_PER_HOUSE_RATE` trong `js/data.js`).
  - Dừng ở đất người khác: trả thuê xong, nếu đủ tiền được mua lại ô đó (cả nhà) với giá gấp 1,5 lần
    giá đất + nhà, tiền trả cho chủ đất. Ô có khách sạn hoặc đang thế chấp thì không mua lại được
    (`BUYOUT_RATE` trong `js/game.js`).
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
| `js/firebase-config.js` | Cấu hình Firebase cho chế độ online ngoài claude.ai (null = chỉ chơi một máy) |
| `js/net.js` | Chơi online: tạo / vào phòng, phòng chờ, đồng bộ trạng thái qua db của claude.ai hoặc Firestore |
| `js/models.js` | Mô hình 3D của quân cờ (🛵 🚗 🚢 ✈️ 🐉 🐱 🎩 🚀) dựng bằng three.js, chụp thành ảnh theo 4 hướng đi |
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
