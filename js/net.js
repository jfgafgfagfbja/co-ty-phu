'use strict';

/* Chơi online: mỗi người mở cùng link trên máy của mình và vào chung một phòng.
 *
 * Một phòng là document `games/<mã>` trong db của artifact:
 *   { app, v, code, host, status: 'lobby' | 'playing' | 'over',
 *     seats: { <user id>: { token, at } | null }, settings, state: G.s | null, rev, wid, at }
 * Ghế chỉ lưu user id; tên lấy từ user.profiles() khi hiển thị.
 * Ở phòng chờ, mỗi người chỉ ghi ghế của mình (update gộp theo khoá). Trong ván, chỉ máy được trả lời
 * câu hỏi đang chờ (hoặc của người tới lượt) mới chạy luật và ghi lại cả document; các máy khác nhận
 * qua onSnapshot rồi phát lại hiệu ứng. Không dùng được db (chưa đăng nhập) thì chỉ chơi một máy.
 */

const ROOM_KEY = 'coTyPhu.room';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
const ONLINE_DEFAULTS = { start: 1500, auction: true, parkingPot: false, shuffle: false };
// Người ngoài tổ chức của chủ trang chỉ ghi được db khi được mời qua email với quyền Editor
const ACCESS_HINT = 'Để cùng chơi, hãy nhờ chủ trang mời bạn qua email với quyền Editor (người cùng tổ chức chỉ cần Contributor).';

const randomCode = () => Array.from({ length: CODE_LEN }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const clone = v => JSON.parse(JSON.stringify(v));

function lastRoom() {
  try { return localStorage.getItem(ROOM_KEY) || ''; } catch (e) { return ''; }
}

function rememberRoom(code) {
  try {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else localStorage.removeItem(ROOM_KEY);
  } catch (e) { /* trình duyệt chặn lưu trữ */ }
}

const Net = {
  status: 'checking',   // 'checking' | 'on' | 'off' (không dùng được db: chỉ chơi một máy)
  db: null,
  user: null,
  uid: null,
  canWrite: null,       // user.can('data.write'): true, false, hoặc null khi nền tảng không cho biết
  code: null,           // mã phòng đang ở
  doc: null,            // bản mới nhất của document phòng
  confirmed: null,      // bản mới nhất đã nằm trên máy chủ (không còn ghi dở)
  unsub: null,
  writing: false,
  wid: null,            // mã lần ghi của trạng thái đang hiển thị
  busy: '',             // đang tạo / vào phòng
  error: '',
  retries: 0,

  async init(room) {
    const c = window.claude;
    try {
      if (!c || typeof c.use !== 'function') throw new Error('no claude');
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) throw new Error('no db');
      const uid = await user.id();
      if (!uid) throw new Error('no user id');
      Object.assign(Net, { db, user, uid, canWrite: await user.can('data.write') });
    } catch (e) {
      Net.status = 'off';
      if (UI.setupModal) UI.setupModal.refresh();
      return;
    }
    Net.status = 'on';
    if (room) Net.join(room);
    else if (UI.setupModal) UI.setupModal.refresh();
  },

  ref(code) {
    return Net.db.doc('games/' + code);
  },

  isHost() {
    return !!(Net.doc && Net.doc.host === Net.uid);
  },

  setBusy(busy, error = '') {
    Net.busy = busy;
    Net.error = error;
    if (UI.setupModal) UI.setupModal.refresh();
  },

  errorText(e, fallback) {
    switch (e && e.code) {
      case 'invalid_argument':
      case 'not_granted':
        return 'Bạn chưa có quyền ghi dữ liệu của trang này. ' + ACCESS_HINT;
      case 'resource_exhausted':
        return 'Thao tác quá nhanh, hãy thử lại sau vài giây.';
      case 'quota_exceeded':
        return 'Bộ nhớ dữ liệu của trang đã đầy, không tạo thêm phòng được.';
      default:
        return fallback + ' Kiểm tra kết nối mạng rồi thử lại.';
    }
  },

  async create() {
    if (Net.busy || Net.status !== 'on') return;
    Net.setBusy('Đang tạo phòng…');
    try {
      let code = null;
      for (let k = 0; k < 6 && !code; k++) {
        const c = randomCode();
        if (!(await Net.ref(c).get()).exists) code = c;
      }
      if (!code) throw new Error('no free code');
      const now = Date.now();
      await Net.ref(code).set({
        app: 'co-ty-phu', v: 1, code, host: Net.uid, status: 'lobby',
        seats: { [Net.uid]: { token: TOKENS[0], at: now } },
        settings: { ...ONLINE_DEFAULTS }, state: null, rev: 0, wid: '', at: now,
      });
      Net.setBusy('');
      Net.enter(code);
    } catch (e) {
      Net.setBusy('', Net.errorText(e, 'Không tạo được phòng.'));
    }
  },

  /** Vào phòng: còn ở phòng chờ và còn chỗ thì nhận ghế, không thì vào xem. */
  async join(raw) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (Net.busy || Net.status !== 'on') return;
    if (code.length !== CODE_LEN) {
      Net.setBusy('', `Mã phòng gồm ${CODE_LEN} chữ và số, ví dụ K7Q2M.`);
      return;
    }
    Net.setBusy('Đang vào phòng…');
    let d;
    try {
      const snap = await Net.ref(code).get();
      if (!snap.exists) {
        if (lastRoom() === code) rememberRoom('');
        Net.setBusy('', `Không tìm thấy phòng ${code}. Kiểm tra lại mã.`);
        return;
      }
      d = snap.data();
    } catch (e) {
      Net.setBusy('', Net.errorText(e, 'Không vào được phòng.'));
      return;
    }
    const seats = Room.seats(d);
    if (d.status === 'lobby' && !(d.seats && d.seats[Net.uid]) && seats.length < MAX_PLAYERS && Net.canWrite !== false) {
      const used = seats.map(x => x.token);
      try {
        await Net.ref(code).update({ seats: { [Net.uid]: { token: TOKENS.find(t => !used.includes(t)), at: Date.now() } } });
      } catch (e) {
        UI.toast(Net.errorText(e, 'Không nhận được chỗ trong phòng.'), 'danger'); // vẫn vào để xem
      }
    }
    Net.setBusy('');
    Net.enter(code);
  },

  /** Theo dõi phòng code trên máy này. */
  enter(code) {
    Net.stop();
    Object.assign(Net, { code, doc: null, confirmed: null, wid: null, retries: 0 });
    rememberRoom(code);
    if (G.s && !isOnline()) G.s = null; // ván một máy vẫn còn trong bộ nhớ trình duyệt để chơi tiếp sau
    if (UI.setupModal) UI.setupModal.close();
    Net.listen();
    UI.render();
  },

  listen() {
    Net.unsub = Net.ref(Net.code).onSnapshot(snap => Net.onSnap(snap), err => Net.onError(err));
  },

  stop() {
    if (Net.unsub) Net.unsub();
    Net.unsub = null;
  },

  onError(err) {
    Net.unsub = null;
    if (err && err.code === 'unavailable' && Net.code && Net.retries < 3) {
      Net.retries++;
      setTimeout(() => { if (Net.code && !Net.unsub) Net.listen(); }, 1500 * Net.retries);
      return;
    }
    UI.toast('Mất kết nối với phòng. Hãy mở lại trang rồi chọn "Vào lại phòng".', 'danger');
  },

  onSnap(snap) {
    if (!snap.exists) {
      if (snap.metadata.fromCache) return; // chờ bản từ máy chủ
      if (Net.doc) UI.toast('Phòng này không còn nữa.', 'danger');
      Net.leave();
      return;
    }
    Net.retries = 0;
    Net.doc = clone(snap.data());
    if (!snap.metadata.hasPendingWrites) Net.confirmed = Net.doc;
    if (!Net.writing) Net.adopt();
  },

  /** Hiển thị bản mới nhất của phòng: phòng chờ, hoặc trạng thái ván (phát lại hiệu ứng chưa xem). */
  adopt() {
    const d = Net.doc;
    if (!d) return;
    if (d.status === 'lobby' || !d.state) {
      if (isOnline()) {
        G.s = null;
        UI.closeGameModals();
      }
      UI.render();
      Room.showLobby();
      return;
    }
    Room.closeLobby();
    if (isOnline() && G.s.gid === d.state.gid && d.wid === Net.wid) return; // bản này đang hiển thị rồi
    Net.wid = d.wid;
    G.s = clone(d.state);
    UI.show();
  },

  /** Ghi trạng thái ván vừa chạy xong trên máy này (máy có quyền với câu hỏi / lượt hiện tại). */
  async push(state) {
    const base = Net.doc;
    if (!base || !Net.code) return;
    const wid = randomId();
    const next = { ...base, state: clone(state), status: state.phase === 'over' ? 'over' : 'playing', rev: (base.rev || 0) + 1, wid, at: Date.now() };
    Object.assign(Net, { wid, doc: next, writing: true });
    try {
      await Net.ref(Net.code).set(next);
    } catch (e) {
      UI.toast(Net.errorText(e, 'Không gửi được nước đi.'), 'danger');
      Net.wid = null;
      if (Net.confirmed) Net.doc = Net.confirmed;
    } finally {
      Net.writing = false;
      Net.adopt();
    }
  },

  async patch(data) {
    if (!Net.code) return;
    try {
      await Net.ref(Net.code).update(data);
    } catch (e) {
      UI.toast(Net.errorText(e, 'Không lưu được thay đổi.'), 'danger');
    }
  },

  /** Rời phòng trên máy này. Ở phòng chờ thì trả lại ghế; chủ phòng rời thì giao phòng cho người vào sớm nhất. */
  leave(quiet) {
    const d = Net.doc, code = Net.code;
    Net.stop();
    Object.assign(Net, { code: null, doc: null, confirmed: null, wid: null });
    rememberRoom('');
    Room.closeLobby();
    if (isOnline()) G.s = null;
    UI.closeGameModals();
    UI.render();
    if (d && d.status === 'lobby' && d.seats && d.seats[Net.uid]) {
      const patch = { seats: { [Net.uid]: null } };
      const next = Room.seats(d).find(x => x.uid !== Net.uid);
      if (d.host === Net.uid && next) patch.host = next.uid;
      Net.ref(code).update(patch).catch(() => {});
    }
    if (!quiet) UI.showSetup('online');
  },
};

/* ---------- Giao diện phòng: tạo / vào phòng, phòng chờ ---------- */

const Room = {
  modal: null,
  draft: '',

  /** Ghế đang có người, theo thứ tự vào phòng (cũng là thứ tự màu quân). */
  seats(d = Net.doc) {
    return Object.entries((d && d.seats) || {})
      .filter(([, v]) => v)
      .map(([uid, v]) => ({ uid, token: v.token, at: v.at || 0 }))
      .sort((a, b) => a.at - b.at);
  },

  copyCode() {
    const code = Net.code;
    const shown = () => UI.toast(`Mã phòng: ${code}`);
    try {
      navigator.clipboard.writeText(code).then(() => UI.toast(`Đã sao chép mã ${code}`), shown);
    } catch (e) {
      shown();
    }
  },

  /** Phần "Chơi online" trong màn hình bắt đầu. */
  setupView(m) {
    const wrap = el('div', { class: 'online' });
    if (Net.code) {
      const playing = isOnline() && myPlayer() && G.s.phase !== 'over';
      wrap.append(el('div', { class: 'resume' },
        el('div', {},
          el('b', { text: `Bạn đang ở phòng ${Net.code}` }),
          el('div', { class: 'muted small', text: playing
            ? 'Nếu rời phòng, mọi người sẽ phải chờ khi tới lượt bạn. Bạn có thể vào lại bằng mã phòng.'
            : 'Quay lại phòng, hoặc rời phòng để tạo / vào phòng khác.' })),
        el('div', { class: 'btns' },
          btn('Quay lại phòng', () => {
            m.close();
            if (Net.doc && Net.doc.status === 'lobby') Room.showLobby();
          }, { small: true, primary: true }),
          btn('Rời phòng', () => {
            m.close();
            Net.leave();
          }, { small: true, danger: true }))));
    }
    wrap.append(el('p', { class: 'muted', text: 'Mỗi người mở link trang này trên điện thoại của mình (cần tài khoản claude.ai) rồi vào chung một phòng bằng mã 5 ký tự. Chỉ máy của người tới lượt mới bấm được.' }));
    if (Net.canWrite === false) {
      wrap.append(el('p', { class: 'warn small', text: 'Bạn đang chỉ có quyền xem trang này nên chỉ xem được ván của người khác. ' + ACCESS_HINT }));
    }
    const busy = !!Net.busy;
    wrap.append(el('h4', { text: 'Tạo phòng' }),
      el('div', { class: 'join' },
        btn('🌐 Tạo phòng mới', () => Net.create(), { primary: true, disabled: busy || Net.canWrite === false }),
        el('span', { class: 'muted small', text: 'Bạn làm chủ phòng: chọn luật và bấm bắt đầu khi mọi người đã vào.' })));
    const input = el('input', {
      id: 'room-code', type: 'text', maxlength: CODE_LEN, placeholder: 'Mã phòng', value: Room.draft,
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Mã phòng',
    });
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase();
      Room.draft = input.value;
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') Net.join(input.value); });
    wrap.append(el('h4', { text: 'Vào phòng' }),
      el('div', { class: 'join' }, input, btn(Net.canWrite === false ? 'Xem phòng' : 'Vào phòng', () => Net.join(input.value), { disabled: busy })));
    const last = lastRoom();
    if (last && last !== Net.code) wrap.append(el('div', { class: 'btns' }, btn(`↩ Vào lại phòng ${last}`, () => Net.join(last), { disabled: busy })));
    if (Net.busy) wrap.append(el('p', { class: 'muted small wait', text: Net.busy }));
    if (Net.error) wrap.append(el('div', { class: 'err', text: Net.error }));
    return wrap;
  },

  showLobby() {
    if (Room.modal) {
      Room.modal.refresh();
      return;
    }
    Room.modal = UI.modal(() => Room.lobbyView(), { live: true, closable: false, wide: true, onClose: () => { Room.modal = null; } });
  },

  closeLobby() {
    if (Room.modal) Room.modal.close();
  },

  lobbyView() {
    const d = Net.doc;
    if (!d) return el('p', { class: 'muted', text: 'Đang tải phòng…' });
    const host = Net.isHost(), seats = Room.seats(d).slice(0, MAX_PLAYERS);
    const seated = seats.some(x => x.uid === Net.uid);
    const set = { ...ONLINE_DEFAULTS, ...d.settings };
    const wrap = el('div', { class: 'lobby' },
      el('h2', { text: 'Phòng chờ' }),
      el('div', { class: 'room-code-box' },
        el('div', {}, el('div', { class: 'muted small', text: 'Mã phòng' }), el('div', { class: 'room-code', text: d.code })),
        btn('Sao chép mã', () => Room.copyCode(), { small: true })),
      el('p', { class: 'muted small', text: 'Gửi mã này cho bạn bè. Mỗi người mở cùng link này trên điện thoại (cần tài khoản claude.ai), chọn "Chơi online" rồi nhập mã.' }),
      el('h4', { text: `Người chơi (${seats.length}/${MAX_PLAYERS})` }));

    seats.forEach((x, k) => {
      const me = x.uid === Net.uid;
      let tok;
      if (me) {
        const taken = seats.filter(o => !(o.uid === x.uid)).map(o => o.token);
        tok = el('select', { id: 'seat-token', 'aria-label': 'Quân cờ của bạn' },
          TOKENS.map(t => el('option', { value: t, selected: t === x.token, disabled: taken.includes(t) }, t)));
        tok.addEventListener('change', () => Net.patch({ seats: { [Net.uid]: { token: tok.value } } }));
      } else {
        tok = el('span', { class: 'seat-tok', text: x.token });
      }
      wrap.append(el('div', { class: 'prow seat' },
        el('span', { class: 'dot', style: `background:${PLAYER_COLORS[k]}` }),
        tok,
        el('span', { class: 'seat-name', text: UI.names[x.uid] || (me ? 'Bạn' : `Người chơi ${k + 1}`) }),
        me ? el('span', { class: 'badge', text: 'bạn' }) : null,
        x.uid === d.host ? el('span', { class: 'badge host', text: 'chủ phòng' }) : null,
        host && !me ? btn('✕', () => Net.patch({ seats: { [x.uid]: null } }), { small: true, title: 'Mời ra khỏi phòng' }) : null));
    });

    if (!seated) {
      const full = seats.length >= MAX_PLAYERS;
      wrap.append(el('p', { class: 'warn small', text: Net.canWrite === false
        ? 'Bạn chỉ có quyền xem trang này nên chỉ xem được phòng. ' + ACCESS_HINT
        : full ? `Phòng đã đủ ${MAX_PLAYERS} người, bạn đang xem.` : 'Bạn đang xem phòng này.' }));
      if (!full && Net.canWrite !== false) wrap.append(el('div', { class: 'btns' }, btn('Vào chơi', () => Net.join(d.code), { primary: true })));
    }

    const startSel = el('select', { id: 'lobby-start', disabled: !host }, [1000, 1500, 2000, 3000].map(v => el('option', { value: v, selected: v === set.start }, fmt(v))));
    startSel.addEventListener('change', () => Net.patch({ settings: { start: Number(startSel.value) } }));
    const opt = (key, label) => {
      const cb = el('input', { id: `lobby-${key}`, type: 'checkbox', checked: !!set[key], disabled: !host });
      cb.addEventListener('change', () => Net.patch({ settings: { [key]: cb.checked } }));
      return el('label', { class: 'opt' }, cb, label);
    };
    wrap.append(el('h4', { text: 'Tùy chọn' }), el('div', { class: 'opts' },
      el('label', { class: 'opt' }, 'Tiền khởi đầu:', startSel),
      opt('auction', 'Đấu giá khi người chơi không mua đất (luật gốc)'),
      opt('parkingPot', 'Dồn tiền thuế / phạt vào Bãi đỗ xe, ai dừng ở đó nhận hết (luật thêm)'),
      opt('shuffle', 'Xáo trộn thứ tự đi')));
    if (!host) wrap.append(el('p', { class: 'muted small', text: 'Chỉ chủ phòng đổi được tùy chọn.' }));

    const enough = seats.length >= 2;
    if (!host) wrap.append(el('p', { class: 'panel-msg muted wait', text: 'Đang chờ chủ phòng bắt đầu…' }));
    else if (!enough) wrap.append(el('p', { class: 'panel-msg muted', text: 'Cần ít nhất 2 người trong phòng để bắt đầu.' }));
    wrap.append(el('div', { class: 'btns end' },
      btn('Rời phòng', () => Net.leave()),
      host ? btn('🎲 Bắt đầu chơi', () => Room.start(), { primary: true, disabled: !enough }) : null));
    return wrap;
  },

  /** Chủ phòng tạo ván từ các ghế (máy chủ phòng chạy luật lần đầu và ghi lên phòng). */
  start() {
    const d = Net.doc;
    if (!d || !Net.isHost() || d.status !== 'lobby' || Net.writing) return;
    const seats = Room.seats(d).slice(0, MAX_PLAYERS);
    if (seats.length < 2) return;
    const used = new Set();
    const players = seats.map(x => {
      const token = TOKENS.includes(x.token) && !used.has(x.token) ? x.token : TOKENS.find(t => !used.has(t));
      used.add(token);
      return { uid: x.uid, token };
    });
    G.s = createState({ ...ONLINE_DEFAULTS, ...d.settings, players, room: d.code });
    log(`Ván mới bắt đầu! ${N(cur())} đi trước.`);
    Room.closeLobby();
    commit();
  },

  /** Ván xong: chủ phòng đưa cả phòng về phòng chờ để chơi ván mới. */
  async again() {
    const d = Net.doc;
    if (!d || !Net.isHost()) return;
    try {
      await Net.ref(Net.code).update({ status: 'lobby', state: null, rev: (d.rev || 0) + 1, wid: randomId(), at: Date.now() });
    } catch (e) {
      UI.toast(Net.errorText(e, 'Không mở lại được phòng chờ.'), 'danger');
    }
  },
};
