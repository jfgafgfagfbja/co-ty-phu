// Gộp index.html + css + js thành một trang duy nhất để đăng lên claude.ai (không có doctype/html/head/body,
// trình đăng tự thêm). Cách dùng:
//   node tools/build.js [đầu-ra.html]                      → mặc định build/co-ty-phu.html
//   node tools/build.js thu.html --mock tools/mock-claude.js  → trang đầy đủ kèm db giả để thử chơi online trên máy
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const mockAt = args.indexOf('--mock');
const mock = mockAt >= 0 ? args.splice(mockAt, 2)[1] : null;
const out = path.resolve(args[0] || path.join(root, 'build', 'co-ty-phu.html'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = html.match(/<link [^>]*fonts\.g[^>]*>/g).join('\n');
const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
// Bỏ phần ?v=… (dùng để điện thoại không giữ bản cũ trong bộ nhớ đệm) khi đọc file
const scripts = [...html.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m => read(m[1]));
const code = scripts.join('\n');
if (code.includes('</script')) throw new Error('Mã JS chứa "</script", không nhúng inline được.');

const style = `<style>\n${read('css/style.css')}</style>`;
const script = `<script>\n${code}</script>`;
let page;
if (mock) {
  const fake = fs.readFileSync(path.resolve(mock), 'utf8');
  page = `<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `${title}\n${links}\n${style}\n<script>\n${fake}</script>\n</head>\n<body>\n${body}\n${script}\n</body>\n</html>\n`;
} else {
  page = `${title}\n${links}\n${style}\n${body}\n${script}\n`;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Đã ghi ${out} (${(Buffer.byteLength(page) / 1024).toFixed(1)} KB)`);
