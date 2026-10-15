// Giả lập window.claude (db + user) để thử chế độ online trên máy; không dùng khi đăng lên claude.ai.
// Mở trang với ?u=an, ?u=binh… (mỗi tab một người). Các tab cùng trình duyệt dùng chung "db" qua localStorage.
// ?ro=1: người xem chỉ có quyền xem (can('data.write') = false).
(function () {
  const params = new URLSearchParams(location.search);
  const who = params.get('u');
  if (!who) return;
  const PREFIX = 'mockdb:';
  const NAMES = { an: 'An', binh: 'Bình', chi: 'Chi', dung: 'Dũng', em: 'Em' };
  const uid = 'u_' + who;
  const listeners = new Map();
  const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const read = p => {
    const raw = localStorage.getItem(PREFIX + p);
    return raw ? JSON.parse(raw) : null;
  };
  const snap = (p, data) => Object.freeze({
    id: p.split('/').pop(),
    exists: data != null,
    data: () => (data == null ? undefined : copy(data)),
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const notify = p => (listeners.get(p) || new Set()).forEach(fn => setTimeout(() => fn(snap(p, read(p))), 0));
  const write = (p, data) => {
    if (data == null) localStorage.removeItem(PREFIX + p);
    else localStorage.setItem(PREFIX + p, JSON.stringify(data));
    notify(p);
  };
  window.addEventListener('storage', e => { if (e.key && e.key.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length)); });
  const merge = (a, b) => {
    const out = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
    return out;
  };
  const delay = () => new Promise(r => setTimeout(r, 40 + Math.random() * 80));
  const denied = () => ({ code: 'invalid_argument', message: 'mock: read-only viewer' });
  const ro = !!params.get('ro');
  const doc = p => ({
    id: p.split('/').pop(),
    path: p,
    async get() { await delay(); return snap(p, read(p)); },
    async set(data) { await delay(); if (ro) throw denied(); write(p, copy(data)); },
    async update(data) {
      await delay();
      if (ro) throw denied();
      const curr = read(p);
      if (!curr) throw { code: 'invalid_argument', message: 'mock: document does not exist' };
      write(p, merge(curr, copy(data)));
    },
    async delete() { await delay(); if (ro) throw denied(); write(p, null); },
    onSnapshot(next) {
      if (!listeners.has(p)) listeners.set(p, new Set());
      listeners.get(p).add(next);
      setTimeout(() => next(snap(p, read(p))), 20);
      return () => listeners.get(p).delete(next);
    },
  });
  const db = Object.freeze({ doc, collection() { throw new Error('mock: collection() chưa hỗ trợ'); } });
  const profile = id => ({ id, name: NAMES[id.slice(2)] || '', avatarUrl: '', color: '#888', email: null, isMe: id === uid, guest: false });
  const user = Object.freeze({
    id: async () => uid,
    isOwner: async () => who === 'an',
    canEdit: async () => who === 'an',
    can: async () => !ro,
    me: async () => ({ ...profile(uid), isOwner: who === 'an', canEdit: who === 'an' }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(id => [id, profile(id)])),
  });
  window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : null) };
})();
