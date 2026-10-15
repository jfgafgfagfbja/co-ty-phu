'use strict';

/* Cấu hình Firebase cho chế độ online khi trang chạy ngoài claude.ai (ví dụ GitHub Pages).
 * Lấy từ Firebase console → Project settings → Your apps → Web app. Để null thì ngoài claude.ai chỉ chơi một máy.
 * Đây không phải mật khẩu: quyền ghi được giới hạn bằng Rules của Firestore (xem README). */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCp6RR-BgoXpt6QoCs9Wm0Vd7Mzga05dmw',
  authDomain: 'co-ty-phu-24fb8.firebaseapp.com',
  projectId: 'co-ty-phu-24fb8',
  storageBucket: 'co-ty-phu-24fb8.firebasestorage.app',
  messagingSenderId: '308318358512',
  appId: '1:308318358512:web:10f252c5be45f9ad7e6b35',
};
