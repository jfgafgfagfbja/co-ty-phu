'use strict';

/* Luật chơi và trạng thái ván. Phần hiển thị nằm trong ui.js, phần chơi online trong net.js.
 *
 * Mọi thứ của một ván nằm trong G.s và lưu được bằng JSON, kể cả chuỗi đang chạy dở, nên ván có
 * thể dừng ở một câu hỏi rồi chạy tiếp trên máy khác:
 * - s.pending: câu hỏi đang chờ (ai phải quyết định gì), null nếu không có.
 * - s.tasks:   các bước còn lại của chuỗi đang chạy, bước đầu mảng làm trước.
 * - s.busy:    đang trong chuỗi đổ xúc xắc → di chuyển → xử lý ô.
 * - s.fx:      hiệu ứng gần đây (xúc xắc, quân đi, thông báo) để mọi máy phát lại giống nhau.
 * Mỗi hành động chạy đồng bộ đến khi gặp câu hỏi mới hoặc hết chuỗi, rồi mới lưu (một máy) hoặc
 * ghi lên phòng (online). Tên người chơi trong nhật ký được ghi dạng ‹id›, thay bằng tên khi hiển thị.
 */

const SAVE_KEY = 'coTyPhu.save.v1';
const GO_SALARY = 200;
const JAIL_POS = 10;
const JAIL_FINE = 50;
const DECK_NAME = { chance: 'Cơ hội', chest: 'Khí vận' };
const FX_KEEP = 80;
const BUYOUT_RATE = 1.5; // mua lại đất của người khác: gấp 1,5 lần giá đất + nhà

const G = {
  s: null,          // trạng thái ván, lưu được bằng JSON
  stable: null,     // bản JSON của lần lưu gần nhất (chế độ một máy)
  diceQueue: [],    // xúc xắc định sẵn để kiểm thử, ví dụ G.diceQueue.push([3, 4])
  stepMs: 130,      // thời gian mỗi bước đi của quân cờ
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fmt = n => '$' + Math.round(n).toLocaleString('vi-VN');
const cleanName = s => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 16);
const randomId = () => Math.random().toString(36).slice(2, 10);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Tên người chơi trong nhật ký và thông báo, thay bằng tên thật khi hiển thị (xem sub trong ui.js). */
const N = p => `‹${p.id}›`;

/* ---------- Truy vấn trạng thái ---------- */

const cur = () => G.s.players[G.s.current];
const alive = () => G.s.players.filter(p => !p.bankrupt);
const cardsOf = deck => (deck === 'chance' ? CHANCE : CHEST);
const mortgageValue = i => BOARD[i].price / 2;
const mortgageInterest = i => Math.ceil(mortgageValue(i) / 10);
const unmortgageCost = i => mortgageValue(i) + mortgageInterest(i);
const houseCost = i => BOARD[i].house;
const isOnline = () => !!(G.s && G.s.room);

/** Giá mua lại ô i từ chủ đất (đất + nhà, gấp BUYOUT_RATE). */
function buyoutPrice(i) {
  const pr = G.s.props[i];
  const houses = BOARD[i].type === 'property' ? pr.houses * houseCost(i) : 0;
  return Math.round((BOARD[i].price + houses) * BUYOUT_RATE / 10) * 10;
}

/** Ô i có mua lại được không: đã có chủ khác, không thế chấp, chưa có khách sạn. */
const canBuyout = (i, pid) => {
  const pr = G.s.props[i];
  return pr.owner != null && pr.owner !== pid && !pr.mortgaged && pr.houses < 5;
};

/** Máy này có được bấm thay người chơi pid không: chơi một máy thì luôn được, online thì chỉ chính người đó. */
function mine(pid) {
  if (!G.s || pid == null) return false;
  return !isOnline() || G.s.players[pid].uid === Net.uid;
}

/** Người chơi của máy này trong ván online (null nếu chỉ xem hoặc chơi một máy). */
const myPlayer = () => (isOnline() ? G.s.players.find(p => p.uid === Net.uid) || null : null);

/** Người phải trả lời câu hỏi đang chờ. */
function answerer(pd) {
  if (!pd) return null;
  if (pd.kind === 'auction') return pd.order[pd.k];
  if (pd.kind === 'trade') return pd.t.b;
  return pd.pid;
}

/** Người đang được xây nhà / thế chấp: người tới lượt khi không bận, hoặc người đang được hỏi mua đất / đang thiếu tiền. */
function managerId() {
  const s = G.s;
  if (!s || s.phase === 'over') return null;
  const pd = s.pending;
  if (pd) return pd.kind === 'buy' || pd.kind === 'buyout' || pd.kind === 'funds' ? pd.pid : null;
  return s.busy ? null : s.current;
}

function ownedBy(pid) {
  return Object.keys(G.s.props).map(Number).filter(i => G.s.props[i].owner === pid);
}

function sortProps(list) {
  const key = i => {
    const q = BOARD[i];
    if (q.type === 'property') return GROUP_ORDER.indexOf(q.group) * 100 + i;
    return (q.type === 'airport' ? 900 : 1000) + i;
  };
  return [...list].sort((a, b) => key(a) - key(b));
}

function hasMonopoly(pid, group) {
  return pid != null && GROUP_SQUARES[group].every(i => G.s.props[i].owner === pid);
}

function countType(pid, type) {
  return ownedBy(pid).filter(i => BOARD[i].type === type).length;
}

/** Dòng tiền thuê đang áp dụng trong giấy chủ quyền (-1 nếu chưa có chủ). */
function rentLevel(i) {
  const q = BOARD[i], pr = G.s.props[i];
  if (pr.owner == null) return -1;
  if (q.type === 'property') return pr.houses > 0 ? pr.houses + 1 : hasMonopoly(pr.owner, q.group) ? 1 : 0;
  return countType(pr.owner, q.type) - 1;
}

function rentFor(i, ctx = {}) {
  const q = BOARD[i], pr = G.s.props[i];
  if (q.type === 'property') {
    if (pr.houses > 0) return q.rent[pr.houses];
    return hasMonopoly(pr.owner, q.group) ? q.rent[0] * 2 : q.rent[0];
  }
  if (q.type === 'airport') {
    const rent = AIRPORT_RENT[countType(pr.owner, 'airport') - 1];
    return ctx.doubleRent ? rent * 2 : rent;
  }
  return UTILITY_MULT[countType(pr.owner, 'utility') - 1] * (ctx.diceTotal || 7);
}

function netWorth(p) {
  return p.money + ownedBy(p.id).reduce((sum, i) => {
    const pr = G.s.props[i];
    let v = pr.mortgaged ? mortgageValue(i) : BOARD[i].price;
    if (BOARD[i].type === 'property') v += pr.houses * houseCost(i);
    return sum + v;
  }, 0);
}

/** Số tiền tối đa gom được nếu bán hết nhà và thế chấp hết đất. */
function liquidValue(p) {
  return p.money + ownedBy(p.id).reduce((sum, i) => {
    const pr = G.s.props[i];
    let v = pr.mortgaged ? 0 : mortgageValue(i);
    if (BOARD[i].type === 'property') v += pr.houses * houseCost(i) / 2;
    return sum + v;
  }, 0);
}

function ranking() {
  return [...G.s.players].sort((a, b) =>
    (a.bankrupt - b.bankrupt) || (a.bankrupt ? b.outOrder - a.outOrder : netWorth(b) - netWorth(a)));
}

/* ---------- Nhật ký, hiệu ứng & lưu ván ---------- */

function log(msg, pid = null) {
  const s = G.s;
  s.log.unshift({ r: s.round, msg, pid });
  if (s.log.length > 150) s.log.length = 150;
}

/** Ghi một hiệu ứng để mọi máy phát lại: dice, move, jump, hl, toast, money, wait, over. */
function fx(e) {
  const s = G.s;
  e.n = ++s.fxSeq;
  s.fx.push(e);
  if (s.fx.length > FX_KEEP) s.fx.splice(0, s.fx.length - FX_KEEP);
}

const toast = (msg, kind = '') => fx({ t: 'toast', msg, kind });

function save() {
  if (!G.s || isOnline()) return;
  if (G.s.phase === 'over') {
    clearSave();
    return;
  }
  G.stable = JSON.stringify(G.s);
  try { localStorage.setItem(SAVE_KEY, G.stable); } catch (e) { /* trình duyệt chặn lưu trữ */ }
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === 1 && s.phase !== 'over' ? s : null;
  } catch (e) {
    return null;
  }
}

function clearSave() {
  G.stable = null;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* bỏ qua */ }
}

/* ---------- Khởi tạo ván ---------- */

/** cfg.players: [{ name, token }] khi chơi một máy, [{ uid, token }] khi chơi online (cfg.room = mã phòng). */
function createState(cfg) {
  const list = cfg.players.map((p, i) => ({ name: p.name || '', uid: p.uid, token: p.token, color: PLAYER_COLORS[i] }));
  if (cfg.shuffle) shuffle(list);
  const props = {};
  BOARD.forEach((q, i) => { if (q.price) props[i] = { owner: null, houses: 0, mortgaged: false }; });
  return {
    v: 1,
    gid: randomId(),
    room: cfg.room || null,
    players: list.map((p, id) => ({
      id, ...p, money: cfg.start, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false, outOrder: 0,
    })),
    props,
    current: 0,
    phase: 'roll',            // 'roll' | 'end' | 'over'
    dice: [5, 2],
    doubles: 0,
    round: 1,
    housesLeft: 32,
    hotelsLeft: 12,
    pot: 0,
    outCount: 0,
    decks: { chance: shuffle(CHANCE.map((_, i) => i)), chest: shuffle(CHEST.map((_, i) => i)) },
    settings: { start: cfg.start, auction: cfg.auction, parkingPot: cfg.parkingPot },
    busy: false,
    pending: null,
    tasks: [],
    fx: [],
    fxSeq: 0,
    askSeq: 0,
    log: [],
  };
}

/** Ván lưu từ bản cũ chưa có các trường của máy trạng thái. */
function normalize(s) {
  return { busy: false, pending: null, tasks: [], fx: [], fxSeq: 0, askSeq: 0, room: null, ...s, gid: s.gid || randomId() };
}

function startGame(cfg) {
  G.s = createState(cfg);
  log(`Ván mới bắt đầu! ${N(cur())} đi trước.`);
  save();
  UI.show();
}

function resumeGame(s) {
  G.s = normalize(s);
  save();
  UI.show();
}

/* ---------- Chạy hành động ---------- */

/** Chạy hành động fn nếu máy này được phép (ok), chạy tiếp chuỗi luật rồi lưu hoặc gửi lên phòng. fn trả false = không hợp lệ. */
function act(ok, fn) {
  if (!ok || !G.s || UI.playing || Net.writing) return false;
  const before = JSON.stringify(G.s);
  if (fn() === false) {
    G.s = JSON.parse(before);
    return false;
  }
  runTasks();
  commit();
  return true;
}

function commit() {
  if (isOnline()) Net.push(G.s);
  else save();
  UI.show();
}

/** Đặt các bước tiếp theo lên đầu hàng đợi (giữ đúng thứ tự). */
function queue(...tasks) {
  G.s.tasks.unshift(...tasks);
}

/** Dừng chuỗi để hỏi một người chơi. */
function ask(pd) {
  pd.id = ++G.s.askSeq;
  G.s.pending = pd;
}

function runTasks() {
  const s = G.s;
  while (!s.pending && s.tasks.length) {
    const t = s.tasks.shift();
    if (t.pid != null && s.players[t.pid].bankrupt) continue; // người đã phá sản thì bỏ các bước còn lại của họ
    OPS[t.op](t);
  }
  if (s.busy && !s.pending && !s.tasks.length) {
    s.busy = false;
    afterFlow();
  }
}

/** Các bước có thể phải chờ câu hỏi ở giữa, nên được lưu thành dữ liệu trong s.tasks. */
const OPS = {
  pay: t => pay(G.s.players[t.pid], t.amount, t.to, t.reason, t.pot),
  payNow: t => payNow(t),
  payEachNow: t => payEachNow(t),
  leaveJail: t => {
    const p = G.s.players[t.pid];
    Object.assign(p, { inJail: false, jailTurns: 0 });
    moveSteps(p, t.steps);
    land(p, { diceTotal: t.steps });
  },
  endRoll: t => {
    const p = G.s.players[t.player];
    G.s.phase = t.dbl && !p.inJail && !p.bankrupt ? 'roll' : 'end';
  },
  offerBuyout: t => { // chỉ hỏi khi đủ tiền mua lại
    if (canBuyout(t.sq, t.pid) && G.s.players[t.pid].money >= buyoutPrice(t.sq)) ask({ kind: 'buyout', pid: t.pid, sq: t.sq });
  },
};

/** Xử lý câu trả lời cho từng loại câu hỏi. Trả false nếu câu trả lời không hợp lệ. */
const RESOLVE = {
  buy(pd, v) {
    const s = G.s, p = s.players[pd.pid], q = BOARD[pd.sq];
    if (v === 'buy') {
      if (p.money < q.price) return false;
      p.money -= q.price;
      s.props[pd.sq].owner = p.id;
      fx({ t: 'money', pid: p.id, d: -q.price });
      log(`${N(p)} mua ${q.name} với giá ${fmt(q.price)}.`, p.id);
      toast(`${p.token} ${N(p)} đã mua ${q.name}`);
    } else if (v !== 'skip') {
      return false;
    } else if (s.settings.auction) {
      log(`${N(p)} không mua ${q.name}, đem ra đấu giá.`, p.id);
      startAuction(pd.sq);
    } else {
      log(`${N(p)} không mua ${q.name}.`, p.id);
    }
  },

  /** Mua lại đất của người khác: trả giá mua lại cho chủ đất, nhận cả ô đất lẫn nhà trên đó. */
  buyout(pd, v) {
    const s = G.s, p = s.players[pd.pid], q = BOARD[pd.sq];
    if (v === 'skip') return;
    if (v !== 'buy' || !canBuyout(pd.sq, p.id)) return false;
    const price = buyoutPrice(pd.sq), owner = s.players[s.props[pd.sq].owner];
    if (p.money < price) return false;
    p.money -= price;
    owner.money += price;
    s.props[pd.sq].owner = p.id;
    fx({ t: 'money', pid: p.id, d: -price });
    fx({ t: 'money', pid: owner.id, d: price });
    log(`${N(p)} mua lại ${q.name} của ${N(owner)} với giá ${fmt(price)}.`, p.id);
    toast(`🏷️ ${N(p)} mua lại ${q.name} giá ${fmt(price)}`);
  },

  card(pd, v) {
    if (v !== 'ok') return false;
    applyCard(G.s.players[pd.pid], cardsOf(pd.deck)[pd.idx], pd.deck);
  },

  auction(a, v) {
    const p = G.s.players[a.order[a.k]];
    if (v === 'pass') {
      a.order.splice(a.k, 1);
      log(`${N(p)} rút khỏi phiên đấu giá.`, p.id);
    } else {
      const n = Math.floor(Number(v));
      if (!(n > a.high && n <= p.money)) return false;
      a.high = n;
      a.leader = p.id;
      a.k++;
      log(`${N(p)} trả ${fmt(n)} cho ${BOARD[a.sq].name}.`, p.id);
    }
    auctionStep(a);
  },

  funds(pd, v) {
    const p = G.s.players[pd.pid];
    if (v === 'pay') {
      if (p.money < pd.amount) return false;
      queue(pd.then);
    } else if (v === 'bankrupt') {
      declareBankrupt(p, pd.to);
    } else {
      return false;
    }
  },

  trade(pd, v) {
    const t = pd.t, A = G.s.players[t.a], B = G.s.players[t.b];
    if (v === 'accept') {
      if (executeTrade(t)) toast('🤝 Giao dịch thành công!');
      else toast('Giao dịch không còn hợp lệ', 'danger');
    } else if (v === 'reject') {
      log(`${N(B)} từ chối giao dịch với ${N(A)}.`, B.id);
      toast(`${N(B)} đã từ chối`);
    } else {
      return false;
    }
  },
};

/** Trả lời câu hỏi đang chờ (id lấy từ câu hỏi lúc hiển thị, để bỏ qua cú bấm vào câu hỏi đã cũ). */
function actionAnswer(id, value) {
  const pd = G.s && G.s.pending;
  if (!pd || pd.id !== id) return;
  act(mine(answerer(pd)), () => {
    G.s.pending = null;
    return RESOLVE[pd.kind](pd, value);
  });
}

/* ---------- Tiền bạc ---------- */

function gain(p, amount, reason) {
  if (amount <= 0) return;
  p.money += amount;
  log(`${N(p)} nhận ${fmt(amount)} — ${reason}.`, p.id);
  fx({ t: 'money', pid: p.id, d: amount });
}

/** Trả tiền cho người chơi khác (toId) hoặc ngân hàng (toId = null). Thiếu tiền thì hỏi bán nhà / phá sản trước. */
function pay(p, amount, toId, reason, toPot = false) {
  if (amount <= 0) return;
  const t = { op: 'payNow', pid: p.id, amount, to: toId, reason, pot: toPot };
  if (p.money < amount) {
    raiseFunds(p, amount, toId, toId != null ? N(G.s.players[toId]) : 'Ngân hàng', reason, t);
    return;
  }
  payNow(t);
}

function payNow(t) {
  const s = G.s, p = s.players[t.pid];
  const to = t.to != null ? s.players[t.to] : null;
  p.money -= t.amount;
  fx({ t: 'money', pid: p.id, d: -t.amount });
  if (to) {
    to.money += t.amount;
    fx({ t: 'money', pid: to.id, d: t.amount });
    log(`${N(p)} trả ${fmt(t.amount)} cho ${N(to)} — ${t.reason}.`, p.id);
  } else {
    if (t.pot && s.settings.parkingPot) s.pot += t.amount;
    log(`${N(p)} trả ${fmt(t.amount)} — ${t.reason}.`, p.id);
  }
}

/** Người chơi thiếu tiền: được bán nhà / thế chấp rồi trả (chạy bước then), hoặc tuyên bố phá sản cho chủ nợ to. */
function raiseFunds(p, amount, to, creditor, reason, then) {
  ask({ kind: 'funds', pid: p.id, amount, to, creditor, reason, then });
}

function returnJailCard(deck) {
  G.s.decks[deck].push(cardsOf(deck).findIndex(c => c.action === 'jailCard'));
}

function declareBankrupt(p, toId) {
  const s = G.s;
  const to = toId != null ? s.players[toId] : null;
  const props = ownedBy(p.id);
  for (const i of props) {
    const pr = s.props[i];
    if (pr.houses > 0) {
      p.money += pr.houses * houseCost(i) / 2;
      if (pr.houses === 5) s.hotelsLeft++;
      else s.housesLeft += pr.houses;
      pr.houses = 0;
    }
  }
  if (to) {
    to.money += p.money;
    props.forEach(i => { s.props[i].owner = to.id; });
    to.jailCards.push(...p.jailCards);
    log(`${N(p)} phá sản! ${N(to)} nhận ${fmt(p.money)} và ${props.length} ô đất.`, p.id);
  } else {
    props.forEach(i => Object.assign(s.props[i], { owner: null, mortgaged: false }));
    p.jailCards.forEach(d => returnJailCard(d));
    log(`${N(p)} phá sản! Toàn bộ đất được trả về ngân hàng.`, p.id);
  }
  Object.assign(p, { money: 0, jailCards: [], inJail: false, bankrupt: true, outOrder: ++s.outCount });
  toast(`💥 ${N(p)} đã phá sản!`, 'danger');
}

/* ---------- Xúc xắc & di chuyển ---------- */

function rollDice() {
  const d = G.diceQueue.length
    ? G.diceQueue.shift()
    : [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
  G.s.dice = d;
  fx({ t: 'dice', d });
  return d;
}

/** Đi từng bước; đi qua ô Xuất phát thì nhận lương ngay lúc đó (hiệu ứng chia đoạn tại ô 0). */
function moveSteps(p, steps) {
  const dir = Math.sign(steps);
  let from = p.pos, seg = 0;
  const flush = () => {
    if (seg) fx({ t: 'move', pid: p.id, from, steps: seg * dir });
    from = p.pos;
    seg = 0;
  };
  for (let k = 0; k < Math.abs(steps); k++) {
    p.pos = (p.pos + dir + 40) % 40;
    seg++;
    if (dir > 0 && p.pos === 0) {
      flush();
      gain(p, GO_SALARY, 'đi qua ô Xuất phát');
    }
  }
  flush();
}

const advanceTo = (p, target) => moveSteps(p, (target - p.pos + 40) % 40);

function sendToJail(p) {
  fx({ t: 'jump', pid: p.id, from: p.pos, to: JAIL_POS });
  Object.assign(p, { pos: JAIL_POS, inJail: true, jailTurns: 0 });
  G.s.doubles = 0;
  log(`${N(p)} bị đưa vào tù!`, p.id);
  fx({ t: 'hl', i: JAIL_POS });
  toast(`🚔 ${N(p)} vào tù!`, 'danger');
  fx({ t: 'wait', ms: 500 });
}

/* ---------- Xử lý ô vừa dừng ---------- */

function land(p, ctx = {}) {
  const i = p.pos, q = BOARD[i], s = G.s;
  fx({ t: 'hl', i });
  switch (q.type) {
    case 'property':
    case 'airport':
    case 'utility':
      return landOnProperty(p, i, ctx);
    case 'tax':
      toast(`${q.icon} ${N(p)} nộp ${q.name} ${fmt(q.amount)}`);
      return pay(p, q.amount, null, q.name, true);
    case 'chance':
    case 'chest':
      return drawCard(p, q.type);
    case 'gotojail':
      return sendToJail(p);
    case 'parking':
      if (s.settings.parkingPot && s.pot > 0) {
        const amount = s.pot;
        s.pot = 0;
        gain(p, amount, 'quỹ Bãi đỗ xe');
        toast(`🅿️ ${N(p)} nhận quỹ bãi đỗ xe ${fmt(amount)}!`);
      }
      return;
    default:
      return;
  }
}

function landOnProperty(p, i, ctx) {
  const s = G.s, q = BOARD[i], pr = s.props[i];
  if (pr.owner == null) return offerPurchase(p, i);
  if (pr.owner === p.id) {
    log(`${N(p)} dừng ở ${q.name} (đất của mình).`, p.id);
    return;
  }
  const owner = s.players[pr.owner];
  if (pr.mortgaged) {
    log(`${q.name} đang thế chấp, ${N(p)} không phải trả tiền thuê.`, p.id);
    toast(`${q.name} đang thế chấp — miễn tiền thuê`);
    return;
  }
  let rent;
  if (q.type === 'utility' && ctx.utilityTen) {
    toast('Đổ xúc xắc để tính tiền thuê công ty…');
    fx({ t: 'wait', ms: 400 });
    const [a, b] = rollDice();
    rent = (a + b) * 10;
  } else {
    rent = rentFor(i, ctx);
  }
  toast(`${N(p)} trả ${fmt(rent)} tiền thuê cho ${N(owner)}`);
  // Trả thuê xong (có thể phải bán nhà / thế chấp trước) thì được hỏi mua lại ô này
  queue({ op: 'pay', pid: p.id, amount: rent, to: owner.id, reason: `thuê ${q.name}` }, { op: 'offerBuyout', pid: p.id, sq: i });
}

function offerPurchase(p, i) {
  ask({ kind: 'buy', pid: p.id, sq: i });
}

/** Đấu giá xoay vòng: mỗi người lần lượt trả cao hơn hoặc rút lui, người cuối cùng còn lại thắng. */
function startAuction(i) {
  const s = G.s;
  const order = [...s.players.slice(s.current), ...s.players.slice(0, s.current)].filter(p => !p.bankrupt).map(p => p.id);
  auctionStep({ kind: 'auction', sq: i, order, k: 0, high: 0, leader: null });
}

/** Tìm người trả giá kế tiếp và hỏi họ; hết người thì chốt phiên. */
function auctionStep(a) {
  while (a.order.length) {
    if (a.leader != null && a.order.length === 1) break;
    a.k %= a.order.length;
    if (a.order[a.k] === a.leader) {
      a.k++;
      continue;
    }
    ask(a);
    return;
  }
  const s = G.s, q = BOARD[a.sq];
  if (a.leader == null) {
    log(`Không ai mua ${q.name}.`);
    return;
  }
  const leader = s.players[a.leader];
  leader.money -= a.high;
  s.props[a.sq].owner = leader.id;
  fx({ t: 'money', pid: leader.id, d: -a.high });
  log(`${N(leader)} thắng đấu giá ${q.name} với ${fmt(a.high)}.`, leader.id);
  toast(`🔨 ${N(leader)} mua ${q.name} giá ${fmt(a.high)}`);
}

/* ---------- Thẻ Cơ hội / Khí vận ---------- */

function drawCard(p, deck) {
  const s = G.s;
  const idx = s.decks[deck].shift();
  const card = cardsOf(deck)[idx];
  if (card.action !== 'jailCard') s.decks[deck].push(idx);
  log(`${N(p)} rút thẻ ${DECK_NAME[deck]}: “${card.text}”`, p.id);
  ask({ kind: 'card', pid: p.id, deck, idx });
}

function applyCard(p, card, deck) {
  const s = G.s;
  switch (card.action) {
    case 'moveTo':
      advanceTo(p, card.to);
      return land(p);
    case 'nearest': {
      let t = p.pos;
      do { t = (t + 1) % 40; } while (BOARD[t].type !== card.kind);
      advanceTo(p, t);
      return land(p, card.kind === 'airport' ? { doubleRent: true } : { utilityTen: true });
    }
    case 'back':
      moveSteps(p, -card.steps);
      return land(p);
    case 'gain':
      gain(p, card.amount, `thẻ ${DECK_NAME[deck]}`);
      return;
    case 'pay':
      return pay(p, card.amount, null, `thẻ ${DECK_NAME[deck]}`, true);
    case 'jailCard':
      p.jailCards.push(deck);
      return;
    case 'jail':
      return sendToJail(p);
    case 'repairs': {
      let houses = 0, hotels = 0;
      ownedBy(p.id).forEach(i => {
        const h = s.props[i].houses;
        if (h === 5) hotels++;
        else houses += h;
      });
      const amount = houses * card.house + hotels * card.hotel;
      if (!amount) {
        log(`${N(p)} chưa có nhà nào nên không phải trả.`, p.id);
        return;
      }
      return pay(p, amount, null, `sửa ${houses} nhà, ${hotels} khách sạn`, true);
    }
    case 'payEach': {
      const total = card.amount * alive().filter(q => q.id !== p.id).length;
      const t = { op: 'payEachNow', pid: p.id, amount: card.amount };
      if (p.money < total) return raiseFunds(p, total, null, 'các người chơi', `${fmt(card.amount)} mỗi người`, t);
      return payEachNow(t);
    }
    case 'collectEach':
      queue(...alive().filter(q => q.id !== p.id)
        .map(q => ({ op: 'pay', pid: q.id, amount: card.amount, to: p.id, reason: `mừng sinh nhật ${N(p)}` })));
      return;
    default:
      return;
  }
}

function payEachNow(t) {
  const p = G.s.players[t.pid];
  const others = alive().filter(q => q.id !== p.id);
  others.forEach(q => {
    p.money -= t.amount;
    q.money += t.amount;
    fx({ t: 'money', pid: q.id, d: t.amount });
  });
  fx({ t: 'money', pid: p.id, d: -t.amount * others.length });
  log(`${N(p)} trả mỗi người chơi ${fmt(t.amount)}.`, p.id);
}

/* ---------- Lượt chơi ---------- */

function afterFlow() {
  if (checkGameOver()) return;
  if (cur().bankrupt) nextPlayer();
}

function checkGameOver() {
  const s = G.s;
  if (s.phase === 'over') return true;
  if (alive().length > 1) return false;
  s.phase = 'over';
  const r = ranking();
  log(`🏆 ${N(r[0])} chiến thắng!`, r[0].id);
  fx({ t: 'over', early: false });
  return true;
}

const canTurnAct = () => !!G.s && !G.s.busy && !G.s.pending && mine(G.s.current);

function actionRoll() {
  if (!G.s || G.s.phase !== 'roll') return;
  act(canTurnAct(), () => {
    const s = G.s, p = cur();
    s.busy = true;
    const [a, b] = rollDice();
    const dbl = a === b;
    log(`${N(p)} đổ được ${a} + ${b} = ${a + b}${dbl ? ' (đôi!)' : ''}.`, p.id);

    if (p.inJail) {
      s.phase = 'end';
      if (!dbl) {
        p.jailTurns++;
        if (p.jailTurns < 3) {
          log(`${N(p)} không ra đôi, ở lại tù (lần ${p.jailTurns}/3).`, p.id);
          toast(`${N(p)} chưa ra được tù (${p.jailTurns}/3)`);
          return;
        }
        log(`${N(p)} đã thử 3 lượt, phải nộp phạt ${fmt(JAIL_FINE)} để ra tù.`, p.id);
        queue({ op: 'pay', pid: p.id, amount: JAIL_FINE, to: null, reason: 'phạt ra tù', pot: true },
          { op: 'leaveJail', pid: p.id, steps: a + b });
        return;
      }
      toast(`🎉 ${N(p)} ra đôi, được ra tù!`);
      queue({ op: 'leaveJail', pid: p.id, steps: a + b });
      return;
    }

    if (dbl && ++s.doubles >= 3) {
      log(`${N(p)} ra đôi 3 lần liên tiếp!`, p.id);
      s.phase = 'end';
      sendToJail(p);
      return;
    }
    queue({ op: 'endRoll', player: p.id, dbl });
    moveSteps(p, a + b);
    land(p, { diceTotal: a + b });
  });
}

function actionPayJail() {
  const s = G.s;
  if (!s || s.phase !== 'roll') return;
  act(canTurnAct(), () => {
    const p = cur();
    if (!p.inJail || p.money < JAIL_FINE) return false;
    p.money -= JAIL_FINE;
    if (s.settings.parkingPot) s.pot += JAIL_FINE;
    Object.assign(p, { inJail: false, jailTurns: 0 });
    fx({ t: 'money', pid: p.id, d: -JAIL_FINE });
    log(`${N(p)} nộp ${fmt(JAIL_FINE)} để ra tù.`, p.id);
  });
}

function actionUseJailCard() {
  const s = G.s;
  if (!s || s.phase !== 'roll') return;
  act(canTurnAct(), () => {
    const p = cur();
    if (!p.inJail || !p.jailCards.length) return false;
    returnJailCard(p.jailCards.shift());
    Object.assign(p, { inJail: false, jailTurns: 0 });
    log(`${N(p)} dùng thẻ ra tù miễn phí.`, p.id);
  });
}

function actionEndTurn() {
  if (!G.s || G.s.phase !== 'end') return;
  act(canTurnAct(), nextPlayer);
}

function nextPlayer() {
  const s = G.s;
  s.doubles = 0;
  let i = s.current;
  do {
    i = (i + 1) % s.players.length;
    if (i === 0) s.round++;
  } while (s.players[i].bankrupt);
  s.current = i;
  s.phase = 'roll';
}

/** Chơi một máy: khi không đang trong chuỗi. Online: chủ phòng, kể cả khi ván đang kẹt chờ một người đã rời đi. */
function canEndGame() {
  const s = G.s;
  if (!s || s.phase === 'over' || UI.playing) return false;
  return isOnline() ? Net.isHost() : !s.busy;
}

async function endGameEarly() {
  if (!canEndGame()) return;
  if (!(await UI.confirm('Kết thúc ván ngay và xếp hạng theo tổng tài sản?', { ok: 'Kết thúc ván' }))) return;
  act(canEndGame(), () => {
    Object.assign(G.s, { phase: 'over', busy: false, pending: null, tasks: [] });
    const r = ranking();
    log(`Ván kết thúc sớm. ${N(r[0])} có nhiều tài sản nhất.`, r[0].id);
    fx({ t: 'over', early: true });
  });
}

/* ---------- Quản lý tài sản: xây / bán nhà, thế chấp ---------- */

const canManage = pid => pid != null && managerId() === pid && mine(pid);

function manageCheck(i) {
  const pr = G.s.props[i];
  if (pr.owner == null || !canManage(pr.owner)) return 'Chỉ chủ đất mới quản lý được, trong lượt của mình';
  return null;
}

/** Sở hữu ô nào là xây nhà được ô đó, không cần đủ nhóm màu (đủ nhóm thì đất trống được nhân đôi tiền thuê). */
function buildCheck(i) {
  const s = G.s, q = BOARD[i], pr = s.props[i];
  if (q.type !== 'property') return 'Không thể xây trên ô này';
  const m = manageCheck(i);
  if (m) return m;
  if (pr.mortgaged) return 'Ô đất đang thế chấp';
  if (pr.houses >= 5) return 'Đã có khách sạn';
  if (pr.houses === 4 ? s.hotelsLeft <= 0 : s.housesLeft <= 0) return `Ngân hàng đã hết ${pr.houses === 4 ? 'khách sạn' : 'nhà'}`;
  if (s.players[pr.owner].money < houseCost(i)) return 'Không đủ tiền';
  return null;
}

function sellCheck(i) {
  const s = G.s, q = BOARD[i], pr = s.props[i];
  const m = manageCheck(i);
  if (m) return m;
  if (q.type !== 'property' || pr.houses === 0) return 'Không có nhà để bán';
  if (pr.houses === 5 && s.housesLeft < 4) return 'Ngân hàng không đủ 4 nhà để đổi lại khách sạn';
  return null;
}

function mortgageCheck(i) {
  const pr = G.s.props[i];
  const m = manageCheck(i);
  if (m) return m;
  if (pr.mortgaged) return 'Đã thế chấp';
  if (pr.houses > 0) return 'Phải bán hết nhà trên ô này trước';
  return null;
}

function unmortgageCheck(i) {
  const pr = G.s.props[i];
  const m = manageCheck(i);
  if (m) return m;
  if (!pr.mortgaged) return 'Chưa thế chấp';
  if (G.s.players[pr.owner].money < unmortgageCost(i)) return 'Không đủ tiền';
  return null;
}

function doBuild(i) {
  act(true, () => {
    if (buildCheck(i)) return false;
    const s = G.s, pr = s.props[i], p = s.players[pr.owner];
    p.money -= houseCost(i);
    if (pr.houses === 4) {
      pr.houses = 5;
      s.hotelsLeft--;
      s.housesLeft += 4;
      log(`${N(p)} xây khách sạn ở ${BOARD[i].name}.`, p.id);
    } else {
      pr.houses++;
      s.housesLeft--;
      log(`${N(p)} xây nhà thứ ${pr.houses} ở ${BOARD[i].name}.`, p.id);
    }
  });
}

function doSell(i) {
  act(true, () => {
    if (sellCheck(i)) return false;
    const s = G.s, pr = s.props[i], p = s.players[pr.owner];
    p.money += houseCost(i) / 2;
    if (pr.houses === 5) {
      pr.houses = 4;
      s.hotelsLeft++;
      s.housesLeft -= 4;
      log(`${N(p)} bán khách sạn ở ${BOARD[i].name}.`, p.id);
    } else {
      pr.houses--;
      s.housesLeft++;
      log(`${N(p)} bán một nhà ở ${BOARD[i].name}.`, p.id);
    }
  });
}

function doMortgage(i) {
  act(true, () => {
    if (mortgageCheck(i)) return false;
    const pr = G.s.props[i], p = G.s.players[pr.owner];
    pr.mortgaged = true;
    p.money += mortgageValue(i);
    log(`${N(p)} thế chấp ${BOARD[i].name}, nhận ${fmt(mortgageValue(i))}.`, p.id);
  });
}

function doUnmortgage(i) {
  act(true, () => {
    if (unmortgageCheck(i)) return false;
    const pr = G.s.props[i], p = G.s.players[pr.owner];
    pr.mortgaged = false;
    p.money -= unmortgageCost(i);
    log(`${N(p)} chuộc lại ${BOARD[i].name} với ${fmt(unmortgageCost(i))}.`, p.id);
  });
}

/* ---------- Giao dịch giữa hai người chơi ---------- */

const canTradeNow = () => canTurnAct() && !UI.playing && (G.s.phase === 'roll' || G.s.phase === 'end');

function tradeCheck(i) {
  return G.s.props[i].houses > 0 ? 'Ô đất đang có nhà, phải bán nhà trước' : null;
}

const tradeInterest = list => list.filter(i => G.s.props[i].mortgaged).reduce((sum, i) => sum + mortgageInterest(i), 0);

/** t = { a, b, aProps, bProps, aMoney, bMoney, aCards, bCards } — a đưa cho b phần "a…", b đưa cho a phần "b…". */
function validateTrade(t) {
  const s = G.s, A = s.players[t.a], B = s.players[t.b];
  if (!t.aProps.length && !t.bProps.length && !t.aMoney && !t.bMoney && !t.aCards && !t.bCards) return 'Đề nghị đang trống.';
  if (t.aProps.some(i => s.props[i].owner !== A.id || tradeCheck(i)) || t.bProps.some(i => s.props[i].owner !== B.id || tradeCheck(i))) {
    return 'Có ô đất không thể giao dịch.';
  }
  if (t.aMoney > A.money) return `${N(A)} không có đủ ${fmt(t.aMoney)}.`;
  if (t.bMoney > B.money) return `${N(B)} không có đủ ${fmt(t.bMoney)}.`;
  if (t.aCards > A.jailCards.length || t.bCards > B.jailCards.length) return 'Số thẻ ra tù không hợp lệ.';
  if (A.money - t.aMoney + t.bMoney < tradeInterest(t.bProps)) return `${N(A)} không đủ tiền trả lãi 10% cho đất đang thế chấp.`;
  if (B.money - t.bMoney + t.aMoney < tradeInterest(t.aProps)) return `${N(B)} không đủ tiền trả lãi 10% cho đất đang thế chấp.`;
  return null;
}

/** Người tới lượt gửi đề nghị; người kia trả lời trên máy của họ (chơi một máy: đưa máy cho họ). */
function proposeTrade(t) {
  if (!canTradeNow() || validateTrade(t)) return false;
  return act(true, () => { ask({ kind: 'trade', t }); });
}

function cancelTrade(id) {
  const pd = G.s && G.s.pending;
  if (!pd || pd.kind !== 'trade' || pd.id !== id) return;
  act(mine(pd.t.a), () => {
    G.s.pending = null;
    toast(`${N(G.s.players[pd.t.a])} đã hủy đề nghị giao dịch`);
  });
}

function executeTrade(t) {
  if (validateTrade(t)) return false;
  const s = G.s, A = s.players[t.a], B = s.players[t.b];
  A.money += t.bMoney - t.aMoney - tradeInterest(t.bProps);
  B.money += t.aMoney - t.bMoney - tradeInterest(t.aProps);
  t.aProps.forEach(i => { s.props[i].owner = B.id; });
  t.bProps.forEach(i => { s.props[i].owner = A.id; });
  B.jailCards.push(...A.jailCards.splice(0, t.aCards));
  A.jailCards.push(...B.jailCards.splice(0, t.bCards));
  log(`${N(A)} và ${N(B)} hoàn tất giao dịch.`, A.id);
  return true;
}
