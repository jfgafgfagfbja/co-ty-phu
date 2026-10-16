'use strict';

/* Hiển thị: bàn cờ, bảng điều khiển, người chơi, nhật ký và các hộp thoại. */

const $ = (sel, root = document) => root.querySelector(sel);

/** Tạo phần tử DOM: el('div', { class: 'x', text: 'y', onclick: fn }, ...con). */
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  }
  return e;
}

function btn(label, onClick, opts = {}) {
  const cls = ['btn', opts.primary && 'primary', opts.danger && 'danger', opts.small && 'sm'].filter(Boolean).join(' ');
  return el('button', { type: 'button', class: cls, title: opts.title || null, disabled: !!opts.disabled, onclick: onClick }, label);
}

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Tên hiển thị. Online trên claude.ai: lấy từ hồ sơ của người đó (ván chỉ lưu user id); qua Firebase: tên tự nhập. */
function pn(p) {
  if (!p.uid) return p.name;
  return UI.names[p.uid] || p.name || `Người chơi ${p.id + 1}`;
}

/** Thay ‹id› trong nhật ký / thông báo bằng tên người chơi. */
function sub(text) {
  return String(text).replace(/‹(\d+)›/g, (m, id) => (G.s && G.s.players[id] ? pn(G.s.players[id]) : m));
}

/** Như sub nhưng cho đoạn HTML: tên người chơi được thoát ký tự. */
function subHtml(html) {
  return String(html).replace(/‹(\d+)›/g, (m, id) => (G.s && G.s.players[id] ? esc(pn(G.s.players[id])) : m));
}

const youTag = p => (isOnline() && mine(p.id) ? ' (bạn)' : '');

const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function setDie(node, v) {
  node.replaceChildren(...Array.from({ length: 9 }, (_, k) => el('i', { class: PIPS[v].includes(k) ? 'on' : null })));
  node.setAttribute('aria-label', String(v));
}

/** Vị trí ô trên lưới 11×11: [hàng, cột, cạnh]. Ô 0 ở góc dưới phải, đi ngược chiều kim đồng hồ. */
function cellPos(i) {
  if (i === 0) return [11, 11, 'corner'];
  if (i < 10) return [11, 11 - i, 'bottom'];
  if (i === 10) return [11, 1, 'corner'];
  if (i < 20) return [11 - (i - 10), 1, 'left'];
  if (i === 20) return [1, 1, 'corner'];
  if (i < 30) return [1, 1 + (i - 20), 'top'];
  if (i === 30) return [1, 11, 'corner'];
  return [1 + (i - 30), 11, 'right'];
}

function deedHead(q) {
  if (q.type === 'property') {
    const g = GROUPS[q.group];
    return { bg: g.color, fg: g.text, kind: 'Nhóm ' + g.name };
  }
  if (q.type === 'airport') return { bg: '#2d3436', fg: '#fff', kind: 'Sân bay' };
  return { bg: '#495057', fg: '#fff', kind: 'Công ty' };
}

function chipFor(i) {
  const q = BOARD[i], pr = G.s.props[i];
  const isProp = q.type === 'property';
  const bg = isProp ? GROUPS[q.group].color : q.type === 'airport' ? '#2d3436' : '#6c757d';
  const label = isProp ? (pr.houses === 5 ? 'KS' : pr.houses || '') : q.icon;
  return el('span', {
    class: 'chip' + (pr.mortgaged ? ' m' : ''),
    style: `background-color:${bg};color:${isProp ? GROUPS[q.group].text : '#fff'}`,
    title: q.name + (pr.mortgaged ? ' (đang thế chấp)' : ''),
    text: String(label),
  });
}

function turnHeader(p, tone) {
  return el('div', { class: 'turn' + (tone ? ' ' + tone : ''), style: `--pc:${p.color}` },
    el('span', { class: 'ptok', text: p.token }),
    el('div', {},
      el('div', { class: 'who', text: pn(p) + youTag(p) }),
      el('div', { class: 'muted small', text: p.inJail ? 'Đang ở tù' : `Đang ở ${BOARD[p.pos].name}` })),
    el('span', { class: 'money', text: fmt(p.money) }));
}

/* ---------- Bàn cờ ---------- */

function cornerContent(q) {
  switch (q.type) {
    case 'go':
      return [el('div', { class: 'clabel', text: 'XUẤT PHÁT' }), el('div', { class: 'arrow', text: '⟵' }), el('div', { class: 'csub', text: `Nhận ${fmt(GO_SALARY)} khi đi qua` })];
    case 'jail':
      return [el('div', { class: 'cicon', text: q.icon }), el('div', { class: 'clabel', text: 'NHÀ TÙ' }), el('div', { class: 'csub', text: 'Chỉ thăm tù' })];
    case 'parking':
      return [el('div', { class: 'cicon', text: q.icon }), el('div', { class: 'clabel', text: 'BÃI ĐỖ XE' }), el('div', { class: 'pot' })];
    default:
      return [el('div', { class: 'cicon', text: q.icon }), el('div', { class: 'clabel', text: 'VÀO TÙ' }), el('div', { class: 'csub', text: 'Đi thẳng vào tù' })];
  }
}

function buildBoard() {
  const board = $('#board');
  UI.cells = BOARD.map((q, i) => {
    const [row, col, side] = cellPos(i);
    const cell = el('div', {
      class: `cell ${side} t-${q.type}`,
      style: `grid-row:${row};grid-column:${col}`,
      title: q.name,
      role: 'button',
      tabindex: '0',
    });
    if (side === 'corner') {
      cell.append(...cornerContent(q));
    } else {
      if (q.type === 'property') cell.append(el('div', { class: 'bar', style: `background:${GROUPS[q.group].color}` }));
      const price = q.price ? fmt(q.price) : q.amount ? 'Nộp ' + fmt(q.amount) : '';
      cell.append(el('div', { class: 'body' },
        q.icon ? el('div', { class: 'icon', text: q.icon }) : null,
        el('div', { class: 'txt' }, el('div', { class: 'nm', text: q.short || q.name }), price ? el('div', { class: 'pr', text: price }) : null)));
    }
    cell.append(el('div', { class: 'own' }), el('div', { class: 'tokens' }));
    cell.addEventListener('click', () => UI.openSquare(i));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); UI.openSquare(i); }
    });
    board.append(cell);
    return cell;
  });
}

function renderBoard() {
  const s = G.s;
  BOARD.forEach((q, i) => {
    const pr = s.props[i];
    if (!pr) return;
    const cell = UI.cells[i];
    const owner = pr.owner != null ? s.players[pr.owner] : null;
    cell.classList.toggle('owned', !!owner);
    cell.classList.toggle('mortgaged', pr.mortgaged);
    if (owner) cell.style.setProperty('--oc', owner.color);
    const bar = cell.querySelector('.bar');
    if (bar) {
      bar.replaceChildren(...(pr.houses === 5
        ? [el('i', { class: 'hotel' })]
        : Array.from({ length: pr.houses }, () => el('i', { class: 'house' }))));
    }
  });
  const pot = $('.pot');
  if (pot) pot.textContent = s.settings.parkingPot ? `Quỹ: ${fmt(s.pot)}` : 'Nghỉ chân';
}

function renderTokens() {
  if (!G.s) return;
  UI.cells.forEach(c => c.querySelector('.tokens').replaceChildren());
  G.s.players.forEach(p => {
    if (p.bankrupt) return;
    const active = p.id === G.s.current && G.s.phase !== 'over';
    const pos = UI.tokPos[p.id] ?? p.pos; // trong lúc phát hiệu ứng, quân đứng ở vị trí đang vẽ
    UI.cells[pos].querySelector('.tokens').append(el('div', {
      class: 'tok' + (p.inJail ? ' jailed' : '') + (active ? ' cur' : ''),
      style: `--pc:${p.color}`,
      title: pn(p),
      text: p.token,
    }));
  });
}

function renderCenter() {
  const s = G.s;
  const bits = [`Vòng ${s.round}`, `Nhà còn ${s.housesLeft}`, `Khách sạn còn ${s.hotelsLeft}`];
  if (s.settings.parkingPot) bits.push(`Quỹ bãi đỗ xe ${fmt(s.pot)}`);
  $('#center-info').textContent = bits.join(' · ');
}

/* ---------- Người chơi & nhật ký ---------- */

function buildPlayers() {
  const box = $('#players');
  box.replaceChildren();
  UI.pcards = G.s.players.map(p => {
    const card = el('div', { class: 'pcard', style: `--pc:${p.color}`, title: 'Xem tài sản' },
      el('div', { class: 'ph' },
        el('span', { class: 'ptok', text: p.token }),
        el('span', { class: 'pname' }),
        el('span', { class: 'pmoney' })),
      el('div', { class: 'ptags' }),
      el('div', { class: 'chips' }));
    card.addEventListener('click', () => UI.openManage(p.id));
    box.append(card);
    return card;
  });
  setDie($('#die1'), G.s.dice[0]);
  setDie($('#die2'), G.s.dice[1]);
}

function renderPlayers() {
  const s = G.s;
  s.players.forEach((p, k) => {
    const card = UI.pcards[k];
    card.classList.toggle('active', k === s.current && s.phase !== 'over');
    card.classList.toggle('out', p.bankrupt);
    card.querySelector('.pname').textContent = pn(p) + youTag(p);
    card.querySelector('.pmoney').textContent = p.bankrupt ? 'Phá sản' : fmt(p.money);
    const tags = p.bankrupt ? [] : [
      `Tài sản ${fmt(netWorth(p))}`,
      p.inJail && '🔒 Đang ở tù',
      p.jailCards.length && `🎫 Thẻ ra tù ×${p.jailCards.length}`,
    ].filter(Boolean);
    card.querySelector('.ptags').replaceChildren(...tags.map(t => el('span', { text: t })));
    card.querySelector('.chips').replaceChildren(...sortProps(ownedBy(p.id)).map(i => {
      const chip = chipFor(i);
      chip.addEventListener('click', e => { e.stopPropagation(); UI.openDeed(i); });
      return chip;
    }));
  });
}

function renderLog() {
  const s = G.s;
  if (!s) return;
  $('#log').replaceChildren(...s.log.slice(0, 80).map(e => el('li',
    { style: e.pid != null ? `--pc:${s.players[e.pid].color}` : null },
    el('span', { class: 'lr', text: `V${e.r}` }),
    el('span', { text: sub(e.msg) }))));
}

/* ---------- Bảng điều khiển ---------- */

function renderPanel() {
  const panel = $('#panel');
  panel.replaceChildren();
  const s = G.s;
  if (!s) {
    if (Net.code) {
      panel.append(el('p', { class: 'panel-msg', text: `Bạn đang ở phòng ${Net.code}. Bàn cờ sẽ hiện ván khi chủ phòng bấm bắt đầu.` }),
        el('div', { class: 'btns' }, btn('Mở phòng chờ', () => Room.showLobby(), { primary: true })));
      return;
    }
    panel.append(el('p', { class: 'panel-msg', text: 'Chưa có ván nào đang chơi.' }),
      el('div', { class: 'btns' }, btn('✨ Bắt đầu ván mới', () => UI.showSetup(), { primary: true })));
    return;
  }
  const p = cur(), pd = s.pending;
  if (UI.playing) {
    panel.append(turnHeader(p), el('p', { class: 'panel-msg muted', text: 'Đang di chuyển…' }));
    return;
  }
  if (pd && pd.kind !== 'trade') {
    renderPrompt(panel, promptFor(pd));
    return;
  }
  if (s.phase === 'over') {
    const w = ranking()[0];
    panel.append(el('p', { class: 'panel-msg', html: `Ván đã kết thúc. Người thắng: <b>${w.token} ${esc(pn(w))}</b>.` }),
      el('div', { class: 'btns' },
        btn('✨ Ván mới', () => UI.showSetup(), { primary: true }),
        btn('🏆 Bảng xếp hạng', () => UI.showGameOver(ranking(), true))));
    return;
  }
  panel.append(turnHeader(p));
  if (s.busy) {
    panel.append(el('p', { class: 'panel-msg muted', text: 'Đang di chuyển…' }));
    return;
  }
  if (pd) {
    renderTradeWait(panel, pd);
    return;
  }
  if (!mine(p.id)) {
    const me = myPlayer();
    panel.append(el('p', { class: 'panel-msg muted wait', html: `Đang chờ <b>${esc(pn(p))}</b> ${s.phase === 'roll' ? 'đổ xúc xắc' : 'kết thúc lượt'}…` }));
    if (me && !me.bankrupt) panel.append(el('div', { class: 'btns' }, btn('🏠 Tài sản của bạn', () => UI.openManage(me.id))));
    return;
  }
  const main = el('div', { class: 'btns' });
  if (s.phase === 'roll' && p.inJail) {
    panel.append(el('p', { class: 'panel-msg', text: `Bạn đang ở tù (đã thử ${p.jailTurns}/3 lượt). Đổ ra đôi để ra tù, nộp phạt ${fmt(JAIL_FINE)} hoặc dùng thẻ ra tù.` }));
    main.append(
      btn('🎲 Đổ tìm đôi', actionRoll, { primary: true }),
      btn(`Nộp phạt ${fmt(JAIL_FINE)}`, actionPayJail, { disabled: p.money < JAIL_FINE }),
      p.jailCards.length ? btn('🎫 Dùng thẻ ra tù', actionUseJailCard) : null);
  } else if (s.phase === 'roll') {
    if (s.doubles) panel.append(el('p', { class: 'panel-msg', text: `Bạn vừa đổ ra đôi nên được đổ tiếp! (${s.doubles}/3 — đôi 3 lần liên tiếp sẽ vào tù)` }));
    main.append(btn(s.doubles ? '🎲 Đổ tiếp' : '🎲 Đổ xúc xắc', actionRoll, { primary: true }));
  } else {
    main.append(btn('Kết thúc lượt ➜', actionEndTurn, { primary: true }));
  }
  panel.append(main, el('div', { class: 'btns' },
    btn('🏠 Quản lý tài sản', () => UI.openManage(p.id)),
    btn('🤝 Giao dịch', () => UI.openTrade())));
  panel.append(el('div', { class: 'hint', text: 'Phím Space: bấm nút chính. Bấm vào một ô trên bàn cờ để xem chi tiết.' }));
}

function renderTradeWait(panel, pd) {
  const A = G.s.players[pd.t.a], B = G.s.players[pd.t.b];
  panel.append(el('p', { class: 'panel-msg wait', html: `🤝 ${esc(pn(A))} gửi đề nghị giao dịch cho <b>${esc(pn(B))}</b>. Đang chờ ${esc(pn(B))} trả lời…` }));
  const row = el('div', { class: 'btns' });
  if (mine(B.id)) row.append(btn('Xem đề nghị', () => UI.openTradeReview(), { primary: true }));
  if (mine(A.id)) row.append(btn('Hủy đề nghị', () => cancelTrade(pd.id), { danger: true }));
  if (row.children.length) panel.append(row);
}

/** Dựng câu hỏi trong bảng điều khiển từ s.pending. can = máy này được trả lời; máy khác chỉ thấy dòng chờ (wait). */
function promptFor(pd) {
  const s = G.s, p = s.players[answerer(pd)], can = mine(p.id);
  const who = `<b>${N(p)}</b>`;
  switch (pd.kind) {
    case 'buy': {
      const q = BOARD[pd.sq];
      return {
        id: pd.id, player: p, can, title: q.name, deed: pd.sq,
        text: `Ô này chưa có chủ. Giá <b>${fmt(q.price)}</b>, ${can ? 'bạn' : N(p)} đang có <b>${fmt(p.money)}</b>.` +
          (p.money < q.price ? '<br><span class="warn">Không đủ tiền. Có thể thế chấp đất khác để mua.</span>' : ''),
        wait: `Đang chờ ${who} quyết định có mua không…`,
        buttons: [
          { label: `Mua ${fmt(q.price)}`, value: 'buy', primary: true, disabled: p.money < q.price },
          { label: s.settings.auction ? 'Không mua (đấu giá)' : 'Không mua', value: 'skip' },
          ...(ownedBy(p.id).length ? [{ label: '🏠 Quản lý tài sản', run: () => UI.openManage(p.id) }] : []),
        ],
      };
    }
    case 'card':
      return {
        id: pd.id, player: p, can, card: { deck: pd.deck, text: cardsOf(pd.deck)[pd.idx].text },
        wait: `Đang chờ ${who} đọc thẻ…`,
        buttons: [{ label: 'Tiếp tục', value: 'ok', primary: true }],
      };
    case 'auction': {
      const q = BOARD[pd.sq], leader = pd.leader != null ? s.players[pd.leader] : null;
      const canRaise = p.money > pd.high;
      const quick = [10, 50, 100].map(d => pd.high + d).filter(v => v <= p.money);
      return {
        id: pd.id, player: p, can, title: `Đấu giá: ${q.name}`, deed: pd.sq,
        text: (leader ? `Giá cao nhất: <b>${fmt(pd.high)}</b> (${N(leader)}).` : `Chưa ai trả giá. Giá niêm yết ${fmt(q.price)}.`) +
          ` Lượt của <b>${N(p)}</b> (có ${fmt(p.money)}).` +
          (canRaise ? '' : '<br><span class="warn">Không đủ tiền để trả cao hơn.</span>'),
        wait: `Đang chờ ${who} trả giá…`,
        input: canRaise ? { min: pd.high + 1, max: p.money, value: Math.min(p.money, pd.high + 10) } : null,
        buttons: [
          ...quick.map((v, n) => ({ label: `Trả ${fmt(v)}`, value: v, primary: n === 0 })),
          ...(canRaise ? [{ label: 'Trả giá đã nhập', useInput: true }] : []),
          { label: 'Rút lui', value: 'pass', danger: true },
        ],
      };
    }
    case 'buyout': {
      const q = BOARD[pd.sq], pr = s.props[pd.sq], owner = s.players[pr.owner], price = buyoutPrice(pd.sq);
      const built = q.type === 'property' && pr.houses ? ` cùng ${pr.houses} nhà` : '';
      return {
        id: pd.id, player: p, can, title: `Mua lại: ${q.name}`, deed: pd.sq,
        text: `Ô này của <b>${N(owner)}</b>${built}. ${can ? 'Bạn' : N(p)} có thể mua lại với giá <b>${fmt(price)}</b> ` +
          `(gấp ${String(BUYOUT_RATE).replace('.', ',')} lần giá đất và nhà), tiền trả cho ${N(owner)}. ${can ? 'Bạn' : N(p)} đang có <b>${fmt(p.money)}</b>.`,
        wait: `Đang chờ ${who} quyết định có mua lại không…`,
        buttons: [
          { label: `Mua lại ${fmt(price)}`, value: 'buy', primary: true, disabled: p.money < price },
          { label: 'Không mua', value: 'skip' },
        ],
      };
    }
    default: { // funds: thiếu tiền
      const max = liquidValue(p);
      return {
        id: pd.id, player: p, can, tone: 'danger', title: 'Không đủ tiền!',
        text: `Cần trả <b>${fmt(pd.amount)}</b> cho ${pd.creditor} (${pd.reason}) nhưng chỉ có <b>${fmt(p.money)}</b>. ` +
          'Hãy bán nhà hoặc thế chấp đất để gom đủ tiền.' +
          (max < pd.amount ? `<br><span class="warn">Bán hết tài sản cũng chỉ được ${fmt(max)}, không thể trả đủ.</span>` : ''),
        wait: `Đang chờ ${who} bán nhà, thế chấp đất hoặc tuyên bố phá sản…`,
        buttons: [
          { label: `Trả ${fmt(pd.amount)}`, value: 'pay', primary: true, disabled: p.money < pd.amount },
          { label: '🏠 Quản lý tài sản', run: () => UI.openManage(p.id) },
          { label: 'Tuyên bố phá sản', value: 'bankrupt', danger: true, confirm: `${N(p)} chắc chắn muốn tuyên bố phá sản? Bạn sẽ bị loại khỏi ván.` },
        ],
      };
    }
  }
}

function miniDeed(i) {
  const q = BOARD[i], head = deedHead(q);
  let rows;
  if (q.type === 'property') {
    rows = [['Tiền thuê', fmt(q.rent[0])], ['Có cả nhóm màu', fmt(q.rent[0] * 2)], ['Có khách sạn', fmt(q.rent[5])], ['Giá xây mỗi nhà', fmt(houseCost(i))]];
  } else if (q.type === 'airport') {
    rows = AIRPORT_RENT.map((r, k) => [`Chủ có ${k + 1} sân bay`, fmt(r)]);
  } else {
    rows = [['Chủ có 1 công ty', '4 × số chấm'], ['Chủ có 2 công ty', '10 × số chấm']];
  }
  return el('div', { class: 'mini-deed' },
    el('div', { class: 'dh', style: `background:${head.bg};color:${head.fg}` }, el('small', { text: head.kind }), q.name),
    el('div', { class: 'db' }, rows.map(([a, b]) => [el('span', { text: a }), el('b', { text: b })])));
}

function renderPrompt(panel, pr) {
  if (pr.player) panel.append(turnHeader(pr.player, pr.tone));
  if (pr.title) panel.append(el('h3', { class: 'prompt-title', text: pr.title }));
  if (pr.card) {
    panel.append(el('div', { class: 'gcard ' + pr.card.deck },
      el('div', { class: 'gh', text: (pr.card.deck === 'chance' ? '❓ ' : '🧧 ') + DECK_NAME[pr.card.deck].toUpperCase() }),
      el('div', { class: 'gt', text: pr.card.text })));
  }
  if (pr.deed != null) panel.append(miniDeed(pr.deed));
  if (pr.text) panel.append(el('p', { class: 'panel-msg', html: subHtml(pr.text) }));
  if (!pr.can) {
    panel.append(el('p', { class: 'panel-msg muted wait', html: subHtml(pr.wait) }));
    return;
  }

  let input = null, err = null;
  if (pr.input) {
    const draft = UI.draft && UI.draft.id === pr.id ? UI.draft.value : null;
    input = el('input', { id: 'bid-input', type: 'number', min: pr.input.min, max: pr.input.max, step: 1, value: draft ?? pr.input.value });
    input.addEventListener('input', () => { UI.draft = { id: pr.id, value: input.value }; });
    err = el('div', { class: 'err' });
    panel.append(el('label', { class: 'field' }, 'Giá của bạn ($)', input), err);
  }

  const box = el('div', { class: 'btns' });
  for (const b of pr.buttons) {
    box.append(btn(b.label, async () => {
      if (b.run) { b.run(); return; }
      if (b.confirm && !(await UI.confirm(sub(b.confirm), { ok: b.label, danger: true }))) return;
      let value = b.value;
      if (b.useInput) {
        const n = Math.floor(Number(input.value));
        if (!(n >= pr.input.min && n <= pr.input.max)) {
          err.textContent = `Hãy nhập số từ ${pr.input.min} đến ${pr.input.max}.`;
          return;
        }
        value = n;
      }
      actionAnswer(pr.id, value);
    }, { primary: b.primary, danger: b.danger, disabled: !!b.disabled }));
  }
  panel.append(box);
}

/** Thứ máy này đang phải làm (để báo "đến lượt bạn" một lần): câu hỏi đang chờ hoặc lượt của mình. */
function actionKey() {
  const s = G.s;
  if (!s || s.phase === 'over') return '';
  const pd = s.pending, turn = `t${s.round}.${s.current}`;
  if (pd) {
    if (mine(answerer(pd))) return 'p' + pd.id;
    return pd.kind === 'trade' && mine(pd.t.a) ? turn : ''; // đang chờ người kia trả lời đề nghị của mình
  }
  if (s.busy || !mine(s.current)) return '';
  return turn;
}

/* ---------- Giấy chủ quyền ---------- */

function deedView(i) {
  const q = BOARD[i], head = deedHead(q), lvl = rentLevel(i);
  let rows;
  if (q.type === 'property') {
    rows = [['Tiền thuê đất trống', q.rent[0]], ['Có cả nhóm màu', q.rent[0] * 2], ['1 nhà', q.rent[1]], ['2 nhà', q.rent[2]],
      ['3 nhà', q.rent[3]], ['4 nhà', q.rent[4]], ['Khách sạn', q.rent[5]]].map(([a, b]) => [a, fmt(b)]);
  } else if (q.type === 'airport') {
    rows = AIRPORT_RENT.map((r, k) => [`Chủ có ${k + 1} sân bay`, fmt(r)]);
  } else {
    rows = [['Chủ có 1 công ty', '4 × số chấm xúc xắc'], ['Chủ có 2 công ty', '10 × số chấm xúc xắc']];
  }
  const extra = [
    ['Giá mua', fmt(q.price)],
    q.type === 'property' && ['Giá xây mỗi nhà / khách sạn', fmt(houseCost(i))],
    ['Giá trị thế chấp', fmt(mortgageValue(i))],
    ['Chuộc lại (thêm 10%)', fmt(unmortgageCost(i))],
  ].filter(Boolean);
  return el('div', { class: 'deed' },
    el('div', { class: 'deed-h', style: `background:${head.bg};color:${head.fg}` },
      el('small', { text: head.kind }), el('div', { class: 'deed-name', text: q.name })),
    el('table', { class: 'tbl' }, el('tbody', {},
      rows.map(([a, b], k) => el('tr', { class: k === lvl ? 'now' : null }, el('td', { text: a }), el('td', { class: 'num', text: b }))),
      extra.map(([a, b], k) => el('tr', { class: 'ex' + (k === 0 ? ' sep' : '') }, el('td', { text: a }), el('td', { class: 'num', text: b }))))));
}

function manageButtons(i, small) {
  const q = BOARD[i], pr = G.s.props[i], out = [];
  if (q.type === 'property' && pr.houses < 5) {
    const why = buildCheck(i);
    out.push(btn(`${pr.houses === 4 ? '🏨 Xây khách sạn' : '🏠 Xây nhà'} −${fmt(houseCost(i))}`, () => doBuild(i),
      { small, primary: !why, disabled: !!why, title: why }));
  }
  if (q.type === 'property' && pr.houses > 0) {
    const why = sellCheck(i);
    out.push(btn(`Bán ${pr.houses === 5 ? 'khách sạn' : 'nhà'} +${fmt(houseCost(i) / 2)}`, () => doSell(i), { small, disabled: !!why, title: why }));
  }
  if (pr.mortgaged) {
    const why = unmortgageCheck(i);
    out.push(btn(`Chuộc lại −${fmt(unmortgageCost(i))}`, () => doUnmortgage(i), { small, disabled: !!why, title: why }));
  } else {
    const why = mortgageCheck(i);
    out.push(btn(`Thế chấp +${fmt(mortgageValue(i))}`, () => doMortgage(i), { small, disabled: !!why, title: why }));
  }
  return out;
}

const SQUARE_INFO = {
  go: () => `Mỗi lần đi qua hoặc dừng ở ô này, bạn nhận ${fmt(GO_SALARY)} từ ngân hàng.`,
  jail: () => `Dừng ở đây thì chỉ là "thăm tù", không sao cả. Người bị giam ra tù bằng cách đổ ra đôi, nộp ${fmt(JAIL_FINE)} hoặc dùng thẻ ra tù. Sau 3 lượt không ra đôi phải nộp ${fmt(JAIL_FINE)} rồi đi tiếp. Người ở tù vẫn thu tiền thuê bình thường.`,
  parking: () => (G.s && G.s.settings.parkingPot
    ? 'Luật thêm đang bật: tiền thuế, tiền phạt và tiền thẻ được dồn vào quỹ. Ai dừng ở đây sẽ nhận toàn bộ quỹ.'
    : 'Ô nghỉ chân, không có gì xảy ra.'),
  gotojail: () => 'Dừng ở ô này sẽ bị đưa thẳng vào tù, không đi qua ô Xuất phát và không nhận tiền.',
  chance: () => 'Rút một thẻ Cơ hội và làm theo nội dung trên thẻ.',
  chest: () => 'Rút một thẻ Khí vận và làm theo nội dung trên thẻ.',
  tax: q => `Nộp ${fmt(q.amount)} cho ngân hàng.`,
};

/** Liệt kê phần một bên đưa ra trong giao dịch. */
function describeTrade(t, side) {
  const items = t[side + 'Props'].map(i => BOARD[i].name + (G.s.props[i].mortgaged ? ' (thế chấp)' : ''));
  if (t[side + 'Money']) items.push(fmt(t[side + 'Money']));
  if (t[side + 'Cards']) items.push(`${t[side + 'Cards']} thẻ ra tù`);
  return items.length ? items : ['(không có gì)'];
}

/* ---------- Đối tượng UI dùng chung với game.js ---------- */

const UI = {
  cells: [],
  pcards: [],
  modals: [],
  names: {},        // user id → tên hiển thị (chơi online)
  tokPos: {},       // vị trí quân đang vẽ trong lúc phát hiệu ứng di chuyển
  fxQueue: [],
  fxSeen: 0,        // số thứ tự hiệu ứng cuối cùng đã phát
  gid: null,        // ván đang hiển thị
  playing: false,   // đang phát hiệu ứng (xúc xắc, quân đi)
  draft: null,      // giá đấu đang gõ dở { id, value }
  lastKey: '',      // việc máy này đang phải làm (xem actionKey)
  noticeTurn: null, // lượt đã báo "đến lượt bạn"
  tradeModal: null,
  tradeSeen: null,
  setupModal: null,
  setupTab: null,   // 'online' | 'local'
  mq: matchMedia('(max-width: 980px), (max-height: 720px)'),

  init() {
    buildBoard();
    setDie($('#die1'), 5);
    setDie($('#die2'), 2);
    const placePanel = () => (UI.mq.matches ? $('#panel-slot') : $('#panel-home')).append($('#panel'));
    UI.mq.addEventListener('change', placePanel);
    placePanel();
    $('#btn-rules').addEventListener('click', () => UI.openRules());
    $('#btn-new').addEventListener('click', () => { if (!$('#btn-new').disabled) UI.showSetup(); });
    $('#btn-end').addEventListener('click', () => endGameEarly());
    $('#btn-room').addEventListener('click', () => {
      if (Net.doc && Net.doc.status === 'lobby') Room.showLobby();
      else UI.showSetup('online');
    });
    document.addEventListener('keydown', onKey);
    renderPanel();
    UI.showSetup();
  },

  render() {
    const s = G.s;
    $('#btn-end').disabled = !canEndGame();
    $('#btn-new').disabled = UI.playing || (!!s && !isOnline() && s.busy);
    const room = $('#btn-room');
    room.hidden = !Net.code;
    if (Net.code) {
      const watching = s && isOnline() && !myPlayer();
      room.replaceChildren(el('span', { class: 'lbl', text: watching ? '👀 ' : '🌐 ' }), Net.code);
      room.title = watching ? `Đang xem phòng ${Net.code}` : `Phòng ${Net.code}`;
    }
    if (s) {
      renderBoard();
      renderTokens();
      renderPlayers();
      renderCenter();
    }
    renderPanel();
    if (s) renderLog();
    UI.modals.forEach(m => m.live && m.refresh());
    UI.refreshNames();
  },

  buildPlayers,
  renderTokens,
  renderLog,

  /** Lấy tên (qua user.profiles) cho những người đang hiện trên màn hình; vẽ lại nếu có tên mới. */
  refreshNames() {
    if (!Net.user) return Promise.resolve();
    const ids = new Set();
    if (isOnline()) G.s.players.forEach(p => p.uid && ids.add(p.uid));
    if (Net.doc) Room.seats().forEach(x => ids.add(x.uid));
    if (!ids.size) return Promise.resolve();
    return Net.user.profiles([...ids]).then(ps => {
      let changed = false;
      for (const id of ids) {
        const name = (ps[id] && ps[id].name) || '';
        if ((UI.names[id] || '') !== name) {
          UI.names[id] = name;
          changed = true;
        }
      }
      if (changed) UI.render();
    }, () => {});
  },

  /** Vẽ G.s sau mỗi thay đổi: ván mới thì dựng lại, còn lại phát các hiệu ứng chưa phát rồi vẽ. */
  show() {
    const s = G.s;
    if (!s) {
      UI.render();
      return;
    }
    if (s.gid !== UI.gid) {
      Object.assign(UI, { gid: s.gid, fxSeen: s.fxSeq, fxQueue: [], tokPos: {}, lastKey: '', noticeTurn: null, draft: null, tradeSeen: null });
      buildPlayers();
      UI.render();
      // Chờ tên người chơi (online) rồi mới báo, để thông báo không hiện "Người chơi 1"
      const gid = s.gid, wait = new Promise(r => setTimeout(r, 1500));
      Promise.race([UI.refreshNames(), wait]).then(() => {
        if (!G.s || G.s.gid !== gid || G.s.phase === 'over') return;
        UI.toast(G.s.log.length > 1 ? `Tiếp tục ván — lượt của ${N(cur())}` : `${cur().token} ${N(cur())} đi trước!`);
        if (!UI.playing) UI.afterShow();
      });
      return;
    }
    if (s.fxSeq < UI.fxSeen) UI.fxSeen = s.fxSeq;
    const fresh = s.fx.filter(e => e.n > UI.fxSeen);
    UI.fxSeen = s.fxSeq;
    if (fresh.length) {
      UI.enqueue(fresh);
    } else {
      UI.render();
      if (!UI.playing) UI.afterShow();
    }
  },

  enqueue(list) {
    // Quân sắp di chuyển được vẽ ở chỗ cũ cho đến lượt hiệu ứng của nó
    for (const e of list) {
      if ((e.t === 'move' || e.t === 'jump') && !(e.pid in UI.tokPos)) UI.tokPos[e.pid] = e.from;
    }
    UI.fxQueue.push(...list);
    if (!UI.playing) UI.playLoop();
  },

  async playLoop() {
    UI.playing = true;
    UI.render();
    while (UI.fxQueue.length) await UI.playFx(UI.fxQueue.shift());
    UI.tokPos = {};
    UI.playing = false;
    UI.render();
    UI.afterShow();
  },

  async playFx(e) {
    switch (e.t) {
      case 'dice':
        await UI.animateDice(e.d);
        return;
      case 'move': {
        const dir = Math.sign(e.steps);
        let pos = e.from;
        for (let k = 0; k < Math.abs(e.steps); k++) {
          pos = (pos + dir + 40) % 40;
          UI.tokPos[e.pid] = pos;
          renderTokens();
          await sleep(G.stepMs);
        }
        return;
      }
      case 'jump':
        UI.tokPos[e.pid] = e.to;
        renderTokens();
        return;
      case 'hl':
        UI.highlight(e.i);
        return;
      case 'toast':
        UI.toast(e.msg, e.kind);
        return;
      case 'money':
        UI.moneyFx(e.pid, e.d);
        return;
      case 'wait':
        await sleep(e.ms);
        return;
      case 'over':
        if (G.s && G.s.phase === 'over') UI.showGameOver(ranking(), e.early);
        return;
      default:
        return;
    }
  },

  /** Sau khi vẽ xong: mở đề nghị giao dịch cho người được hỏi, báo khi tới lượt máy này. */
  afterShow() {
    const s = G.s;
    if (!s) return;
    const pd = s.pending;
    if (UI.tradeModal && (!pd || pd.id !== UI.tradeModal.pid)) UI.tradeModal.close();
    if (pd && pd.kind === 'trade' && mine(pd.t.b) && UI.tradeSeen !== pd.id) {
      UI.tradeSeen = pd.id;
      UI.openTradeReview();
    }
    const key = actionKey(), prev = UI.lastKey;
    UI.lastKey = key;
    if (!key || key === prev) return;
    if (UI.mq.matches && (key[0] === 'p' || (isOnline() && !prev))) $('#panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!isOnline()) return;
    // Online: báo một lần khi tới lượt mình, và khi người khác đang chơi mà có câu hỏi dành cho mình
    const turn = `${s.round}.${s.current}`;
    if (mine(s.current) && UI.noticeTurn !== turn) {
      UI.noticeTurn = turn;
      UI.toast('🔔 Đến lượt bạn!');
    } else if (!prev && pd) {
      UI.toast(pd.kind === 'auction' ? '🔔 Đến lượt bạn trả giá!' : '🔔 Có câu hỏi dành cho bạn!');
    }
  },

  toast(msg, kind = '') {
    const box = $('#toasts');
    const t = el('div', { class: 'toast ' + kind, text: sub(msg) });
    box.append(t);
    setTimeout(() => t.remove(), 2900);
    while (box.children.length > 4) box.firstChild.remove();
  },

  highlight(i) {
    const c = UI.cells[i];
    c.classList.remove('hl');
    void c.offsetWidth; // chạy lại hiệu ứng
    c.classList.add('hl');
  },

  moneyFx(pid, delta) {
    const card = UI.pcards[pid];
    if (!card || !delta) return;
    const fx = el('span', { class: 'fx ' + (delta > 0 ? 'plus' : 'minus'), text: (delta > 0 ? '+' : '−') + fmt(Math.abs(delta)) });
    card.append(fx);
    setTimeout(() => fx.remove(), 1500);
    renderPlayers();
  },

  async animateDice([a, b]) {
    const dice = [$('#die1'), $('#die2')];
    dice.forEach(d => d.classList.remove('dbl'));
    dice.forEach(d => d.classList.add('rolling'));
    for (let k = 0; k < 9; k++) {
      dice.forEach(d => setDie(d, 1 + Math.floor(Math.random() * 6)));
      await sleep(55);
    }
    dice.forEach(d => d.classList.remove('rolling'));
    setDie(dice[0], a);
    setDie(dice[1], b);
    if (a === b) dice.forEach(d => d.classList.add('dbl'));
    await sleep(350);
  },

  /* ----- Hộp thoại ----- */

  modal(render, { live = false, closable = true, wide = false, onClose = null } = {}) {
    const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    const overlay = el('div', { class: 'overlay' }, box);
    const m = {
      live,
      closable,
      refresh() {
        const kids = [render(m)];
        if (closable) kids.unshift(el('button', { type: 'button', class: 'x', 'aria-label': 'Đóng', text: '✕', onclick: () => m.close() }));
        box.replaceChildren(...kids);
      },
      close() {
        if (!overlay.isConnected) return;
        overlay.remove();
        UI.modals = UI.modals.filter(x => x !== m);
        if (onClose) onClose();
      },
    };
    overlay.addEventListener('mousedown', e => { if (e.target === overlay && closable) m.close(); });
    $('#modals').append(overlay);
    UI.modals.push(m);
    m.refresh();
    return m;
  },

  confirm(text, { ok = 'Đồng ý', danger = false } = {}) {
    return new Promise(resolve => {
      let done = false, m = null;
      const finish = v => {
        if (done) return;
        done = true;
        if (m) m.close();
        resolve(v);
      };
      m = UI.modal(() => el('div', {},
        el('h2', { text: 'Xác nhận' }),
        el('p', { text }),
        el('div', { class: 'btns end' }, btn('Hủy', () => finish(false)), btn(ok, () => finish(true), { primary: !danger, danger }))),
      { onClose: () => finish(false) });
    });
  },

  openSquare(i) {
    if (BOARD[i].price) UI.openDeed(i);
    else UI.openInfo(i);
  },

  openInfo(i) {
    const q = BOARD[i];
    const here = G.s ? alive().filter(p => p.pos === i) : [];
    UI.modal(() => el('div', {},
      el('h2', { text: `${q.icon} ${q.name}` }),
      el('p', { text: SQUARE_INFO[q.type](q) }),
      here.length ? el('p', { class: 'muted small', text: 'Đang đứng ở đây: ' + here.map(p => `${p.token} ${pn(p)}${p.inJail ? ' (bị giam)' : ''}`).join(', ') }) : null));
  },

  openDeed(i) {
    if (!G.s) return;
    UI.modal(() => {
      const q = BOARD[i], pr = G.s.props[i];
      const owner = pr.owner != null ? G.s.players[pr.owner] : null;
      const status = [owner
        ? el('div', {}, 'Chủ sở hữu: ', el('b', { style: `color:${owner.color}`, text: `${owner.token} ${pn(owner)}` }))
        : el('div', { text: 'Chưa có chủ.' })];
      if (q.type === 'property' && pr.houses) status.push(el('div', { text: pr.houses === 5 ? 'Đã xây: 1 khách sạn' : `Đã xây: ${pr.houses} nhà` }));
      if (pr.mortgaged) status.push(el('div', { class: 'warn', text: 'Đang thế chấp, không thu được tiền thuê.' }));
      const wrap = el('div', {}, deedView(i), el('div', { class: 'deed-status' }, status));
      if (owner && canManage(owner.id)) {
        wrap.append(el('div', { class: 'btns' }, manageButtons(i, false)));
        const why = q.type === 'property' && pr.houses < 5 ? buildCheck(i) : null;
        if (why) wrap.append(el('p', { class: 'muted small', text: 'Chưa xây được nhà: ' + why.toLowerCase() + '.' }));
      } else if (owner && !owner.bankrupt) {
        wrap.append(el('p', { class: 'muted small', text: 'Chủ đất chỉ xây nhà / thế chấp được trong lượt của mình.' }));
      }
      return wrap;
    }, { live: true });
  },

  openManage(pid) {
    if (!G.s) return;
    UI.modal(() => {
      const p = G.s.players[pid];
      const can = canManage(pid);
      const wrap = el('div', { class: 'manage' },
        el('h2', { text: 'Tài sản' }),
        el('div', { class: 'turn', style: `--pc:${p.color}` },
          el('span', { class: 'ptok', text: p.token }),
          el('div', {}, el('div', { class: 'who', text: pn(p) + youTag(p) }), el('div', { class: 'muted small', text: `Tổng tài sản ${fmt(netWorth(p))}` })),
          el('span', { class: 'money', text: fmt(p.money) })));
      if (!can) {
        wrap.append(el('p', { class: 'muted small', text: p.bankrupt
          ? 'Người chơi này đã phá sản.'
          : isOnline() && !mine(pid)
            ? 'Chỉ xem: đây là tài sản của người chơi khác.'
            : 'Chỉ xem: mỗi người chỉ quản lý được tài sản trong lượt của mình, hoặc khi đang thiếu tiền.' }));
      }
      const list = sortProps(ownedBy(pid));
      if (!list.length) wrap.append(el('p', { class: 'muted', text: 'Chưa sở hữu ô đất nào.' }));
      for (const i of list) {
        const q = BOARD[i], pr = G.s.props[i];
        let status = '';
        if (pr.mortgaged) status = 'Đang thế chấp';
        else if (q.type === 'property') {
          status = pr.houses === 5 ? '🏨 Khách sạn' : pr.houses ? '🏠'.repeat(pr.houses) : hasMonopoly(pid, q.group) ? 'Đủ nhóm màu' : 'Đất trống';
        }
        const rent = pr.mortgaged ? '' : q.type === 'utility'
          ? `Thuê ${UTILITY_MULT[countType(pid, 'utility') - 1]} × số chấm`
          : `Thuê ${fmt(rentFor(i))}`;
        wrap.append(el('div', { class: 'mrow' },
          chipFor(i),
          el('div', { class: 'minfo' },
            el('a', { href: '#', class: 'mname', text: q.name, onclick: e => { e.preventDefault(); UI.openDeed(i); } }),
            el('div', { class: 'muted small', text: [status, rent].filter(Boolean).join(' · ') })),
          can ? el('div', { class: 'acts' }, manageButtons(i, true)) : null));
      }
      if (p.jailCards.length) wrap.append(el('p', { class: 'small', text: `🎫 Thẻ ra tù miễn phí: ${p.jailCards.length}` }));
      return wrap;
    }, { live: true });
  },

  openTrade() {
    if (!canTradeNow()) return;
    const s = G.s, A = cur();
    const partners = alive().filter(q => q.id !== A.id);
    if (!partners.length) return;
    const t = { a: A.id, b: partners[0].id, aProps: [], bProps: [], aMoney: 0, bMoney: 0, aCards: 0, bCards: 0 };
    let error = '';

    const sideView = (pid, side) => {
      const p = s.players[pid];
      const props = t[side + 'Props'];
      const col = el('div', { class: 'tcol', style: `--pc:${p.color}` },
        el('h4', { text: `${p.token} ${pn(p)} đưa ra` }),
        el('div', { class: 'muted small', text: `Đang có ${fmt(p.money)}` }));
      const list = el('div', { class: 'tlist' });
      const mineProps = sortProps(ownedBy(pid));
      if (!mineProps.length) list.append(el('div', { class: 'muted small', text: 'Không có đất.' }));
      for (const i of mineProps) {
        const why = tradeCheck(i);
        const cb = el('input', { type: 'checkbox', disabled: !!why, checked: props.includes(i) });
        cb.addEventListener('change', () => {
          if (cb.checked) props.push(i);
          else props.splice(props.indexOf(i), 1);
        });
        list.append(el('label', { class: 'trow' + (why ? ' dis' : ''), title: why },
          cb, chipFor(i), el('span', { text: BOARD[i].name + (s.props[i].mortgaged ? ' (thế chấp)' : '') })));
      }
      const money = el('input', { type: 'number', min: 0, max: p.money, step: 10, value: t[side + 'Money'] });
      money.addEventListener('input', () => { t[side + 'Money'] = Math.max(0, Math.floor(Number(money.value) || 0)); });
      col.append(list, el('label', { class: 'tfield' }, 'Tiền ($)', money));
      if (p.jailCards.length) {
        const cards = el('input', { type: 'number', min: 0, max: p.jailCards.length, step: 1, value: t[side + 'Cards'] });
        cards.addEventListener('input', () => { t[side + 'Cards'] = Math.max(0, Math.floor(Number(cards.value) || 0)); });
        col.append(el('label', { class: 'tfield' }, `Thẻ ra tù (có ${p.jailCards.length})`, cards));
      }
      return col;
    };

    const m = UI.modal(() => {
      const B = s.players[t.b];
      return el('div', {},
        el('h2', { text: '🤝 Giao dịch' }),
        el('div', { class: 'seg' }, el('span', { class: 'muted small', style: 'align-self:center', text: 'Giao dịch với:' }),
          partners.map(q => btn(`${q.token} ${pn(q)}`, () => {
            Object.assign(t, { b: q.id, bProps: [], bMoney: 0, bCards: 0 });
            error = '';
            m.refresh();
          }, { small: true, primary: q.id === t.b }))),
        el('div', { class: 'tcols' }, sideView(t.a, 'a'), sideView(t.b, 'b')),
        el('p', { class: 'muted small', text: 'Không giao dịch được ô đất đang có nhà. Nhận đất đang thế chấp phải trả ngay 10% lãi.' }),
        error ? el('div', { class: 'err', text: sub(error) }) : null,
        el('div', { class: 'btns end' },
          btn('Hủy', () => m.close()),
          btn(`Gửi đề nghị cho ${pn(B)} ➜`, () => {
            error = validateTrade(t) || '';
            if (error) {
              m.refresh();
              return;
            }
            m.close();
            proposeTrade(JSON.parse(JSON.stringify(t)));
          }, { primary: true })));
    }, { wide: true });
  },

  /** Đề nghị giao dịch đang chờ, hiện trên máy của người được hỏi (chơi một máy: đưa máy cho họ). */
  openTradeReview() {
    const s = G.s, pd = s && s.pending;
    if (!pd || pd.kind !== 'trade' || !mine(pd.t.b) || UI.tradeModal) return;
    const t = pd.t, A = s.players[t.a], B = s.players[t.b];
    const answer = v => {
      m.close();
      actionAnswer(pd.id, v);
    };
    const m = UI.modal(() => {
      const interestA = tradeInterest(t.bProps), interestB = tradeInterest(t.aProps);
      return el('div', {},
        el('h2', { text: `${B.token} ${pn(B)}, bạn có đồng ý?` }),
        el('p', { class: 'muted', text: isOnline() ? `${pn(A)} gửi cho bạn đề nghị giao dịch này.` : `Hãy đưa máy cho ${pn(B)} xem đề nghị của ${pn(A)}.` }),
        el('div', { class: 'tsum', style: `--pc:${A.color}` }, el('b', { text: `${pn(A)} đưa:` }), el('ul', {}, describeTrade(t, 'a').map(x => el('li', { text: x })))),
        el('div', { class: 'tsum', style: `--pc:${B.color}` }, el('b', { text: `${pn(B)} đưa:` }), el('ul', {}, describeTrade(t, 'b').map(x => el('li', { text: x })))),
        interestA ? el('p', { class: 'small', text: `${pn(A)} trả thêm ${fmt(interestA)} lãi 10% cho đất thế chấp nhận về.` }) : null,
        interestB ? el('p', { class: 'small', text: `${pn(B)} trả thêm ${fmt(interestB)} lãi 10% cho đất thế chấp nhận về.` }) : null,
        el('div', { class: 'btns end' },
          btn('Từ chối', () => answer('reject'), { danger: true }),
          btn('✔ Chấp nhận', () => answer('accept'), { primary: true })));
    }, { onClose: () => { UI.tradeModal = null; } });
    m.pid = pd.id;
    UI.tradeModal = m;
  },

  openRules() {
    const sec = (title, items) => [el('h3', { text: title }), el('ul', {}, items.map(x => el('li', { text: x })))];
    UI.modal(() => el('div', { class: 'rules' },
      el('h2', { text: '📖 Luật chơi Cờ Tỷ Phú' }),
      sec('Mục tiêu', ['Mua đất, xây nhà, thu tiền thuê và làm các đối thủ phá sản. Người cuối cùng còn trụ lại là người thắng.']),
      sec('Mỗi lượt', [
        'Đổ 2 xúc xắc và đi theo tổng số chấm. Đi qua ô Xuất phát nhận $200.',
        'Ra đôi được đổ thêm một lần. Ra đôi 3 lần liên tiếp phải vào tù.',
        'Dừng ở đất chưa có chủ: mua theo giá niêm yết, hoặc để ngân hàng đem ra đấu giá (nếu bật luật đấu giá).',
        'Dừng ở đất của người khác: trả tiền thuê, trừ khi ô đó đang thế chấp.',
        `Trả thuê xong, nếu đủ tiền bạn được mua lại ô đó với giá gấp ${String(BUYOUT_RATE).replace('.', ',')} lần giá đất và nhà (tiền trả cho chủ đất). Ô đã có khách sạn hoặc đang thế chấp thì không mua lại được.`,
      ]),
      sec('Đất, nhà và khách sạn', [
        'Sở hữu ô nào là xây nhà được ô đó trong lượt của mình, không cần đủ nhóm màu. Đủ 4 nhà thì nâng lên khách sạn.',
        'Giá xây mỗi nhà bằng giá đất. Mỗi nhà làm tiền thuê tăng thêm 35% giá xây.',
        'Sở hữu cả nhóm màu thì tiền thuê đất trống (chưa có nhà) tăng gấp đôi.',
        'Ngân hàng chỉ có 32 nhà và 12 khách sạn.',
        'Sân bay: thuê $25 / $50 / $100 / $200 tùy chủ có 1–4 sân bay. Công ty: 4 lần số chấm (có 1 công ty) hoặc 10 lần (có cả 2).',
      ]),
      sec('Nhà tù', [
        'Vào tù khi dừng ở ô "Vào tù", rút thẻ vào tù, hoặc ra đôi 3 lần liên tiếp.',
        'Ra tù bằng cách nộp $50, dùng thẻ ra tù, hoặc đổ ra đôi (thử tối đa 3 lượt; lượt thứ 3 không ra đôi thì nộp $50 rồi đi).',
        'Người ở tù vẫn thu tiền thuê bình thường.',
      ]),
      sec('Thế chấp, thiếu tiền và phá sản', [
        'Thế chấp đất để nhận 50% giá mua. Chuộc lại phải trả thêm 10%. Phải bán hết nhà trên ô đó trước khi thế chấp.',
        'Bán nhà cho ngân hàng được nửa giá xây.',
        'Nếu không đủ tiền trả, bạn phải bán nhà / thế chấp. Không gom đủ thì phá sản: tài sản thuộc về chủ nợ (hoặc trả lại ngân hàng).',
      ]),
      sec('Giao dịch', [
        'Trong lượt của mình, bấm "Giao dịch" để đổi đất, tiền và thẻ ra tù với người khác. Người kia phải bấm chấp nhận.',
      ]),
      Net.status === 'on' ? sec('Chơi online', [
        `Mỗi người mở link trang này trên điện thoại của mình${accountNote()} và vào chung một phòng bằng mã 5 ký tự.`,
        'Chỉ máy của người tới lượt mới bấm được đổ xúc xắc, mua đất, xây nhà, kết thúc lượt.',
        'Câu hỏi dành cho người khác (trả giá đấu giá, thiếu tiền, chấp nhận giao dịch, mừng sinh nhật) hiện trên máy của chính người đó.',
        'Đóng trang giữa chừng cũng không sao: mở lại link, chọn "Vào lại phòng" để chơi tiếp. Chủ phòng có thể kết thúc ván bất cứ lúc nào.',
      ]) : null,
      sec('Mẹo', [
        'Nhóm Cam và Đỏ là các ô hay bị dừng nhất (vì ngay sau nhà tù).',
        'Xây khách sạn để giữ ô đất: ô có khách sạn không ai mua lại được.',
        'Phím Space bấm nút chính trong bảng điều khiển. Ván chơi được tự động lưu trên trình duyệt.',
      ])), { wide: true });
  },

  /** Màn hình bắt đầu: chơi online (khi có db) hoặc chơi trên một máy như trước. */
  showSetup(tab) {
    if (tab) UI.setupTab = tab;
    if (UI.setupModal) {
      UI.setupModal.refresh();
      return;
    }
    const saved = G.s ? null : loadSaved();
    const cfg = UI.lastCfg || {
      count: 4, start: 1500, auction: true, parkingPot: false, shuffle: false,
      players: Array.from({ length: MAX_PLAYERS }, (_, k) => ({ name: '', token: TOKENS[k] })),
    };
    const inGame = !!G.s && G.s.phase !== 'over';
    const touch = () => { UI.setupTab = UI.setupTab || 'local'; };
    // Có ván một máy lưu dở (và không có phòng online gần đây) thì mở sẵn tab một máy
    const fallback = saved && !lastRoom() ? 'local' : 'online';
    const m = UI.modal(self => {
      // Bản có Firebase thì luôn có tab online (kể cả lúc đang kết nối / lỗi); trên claude.ai chỉ khi db dùng được
      const canOnline = Net.status === 'on' || (firebaseConfigured() && Net.status !== 'off');
      const online = canOnline && (UI.setupTab || fallback) !== 'local';
      const wrap = el('div', { class: 'setup' },
        el('div', { class: 'setup-hero' },
          el('div', { class: 'logo', text: 'CỜ TỶ PHÚ' }),
          el('p', { class: 'muted', text: online
            ? 'Hành trình khắp Việt Nam · Mỗi người chơi trên điện thoại của mình'
            : 'Hành trình khắp Việt Nam · Nhiều người chơi trên cùng một máy' })));
      if (canOnline) {
        wrap.append(el('div', { class: 'tabs', role: 'tablist' },
          [['online', '🌐 Chơi online'], ['local', '📱 Chơi trên một máy']].map(([k, label]) => {
            const on = (k === 'online') === online;
            return el('button', { type: 'button', role: 'tab', class: 'tab' + (on ? ' on' : ''), 'aria-selected': String(on),
              onclick: () => { UI.setupTab = k; m.refresh(); } }, label);
          })));
      }
      if (online) {
        wrap.append(Room.setupView(self));
        return wrap;
      }
      if (saved) {
        wrap.append(el('div', { class: 'resume' },
          el('div', {},
            el('b', { text: 'Có ván đang chơi dở' }),
            el('div', { class: 'muted small', text: `Vòng ${saved.round} · ${saved.players.filter(p => !p.bankrupt).map(p => p.name).join(', ')}` })),
          btn('Tiếp tục ván cũ', () => {
            m.close();
            if (Net.code) Net.leave(true);
            resumeGame(saved);
          }, { primary: true })));
      }
      if (inGame) wrap.append(el('p', { class: 'warn small', text: isOnline()
        ? 'Bắt đầu ván trên máy này sẽ rời khỏi phòng online đang chơi.'
        : 'Bắt đầu ván mới sẽ thay thế ván đang chơi.' }));

      wrap.append(el('h4', { text: 'Số người chơi' }), el('div', { class: 'seg' },
        Array.from({ length: MAX_PLAYERS - 1 }, (_, k) => k + 2).map(n =>
          btn(`${n} người`, () => { touch(); cfg.count = n; m.refresh(); }, { small: true, primary: n === cfg.count }))));

      wrap.append(el('h4', { text: 'Người chơi' }));
      for (let k = 0; k < cfg.count; k++) {
        const pl = cfg.players[k];
        const sel = el('select', { id: `token-${k}`, 'aria-label': 'Quân cờ' }, TOKENS.map(tk => el('option', { value: tk, selected: tk === pl.token }, tk)));
        sel.addEventListener('change', () => {
          touch();
          const other = cfg.players.find((o, j) => j !== k && o.token === sel.value);
          if (other) other.token = pl.token;
          pl.token = sel.value;
          m.refresh();
        });
        const name = el('input', { id: `name-${k}`, type: 'text', maxlength: 16, placeholder: `Người chơi ${k + 1}`, value: pl.name, 'aria-label': 'Tên người chơi' });
        name.addEventListener('input', () => { touch(); pl.name = name.value; });
        wrap.append(el('div', { class: 'prow' }, el('span', { class: 'dot', style: `background:${PLAYER_COLORS[k]}` }), sel, name));
      }

      const startSel = el('select', { id: 'start-money' }, [1000, 1500, 2000, 3000].map(v => el('option', { value: v, selected: v === cfg.start }, fmt(v))));
      startSel.addEventListener('change', () => { touch(); cfg.start = Number(startSel.value); });
      const check = (key, label) => {
        const cb = el('input', { id: `opt-${key}`, type: 'checkbox', checked: cfg[key] });
        cb.addEventListener('change', () => { touch(); cfg[key] = cb.checked; });
        return el('label', { class: 'opt' }, cb, label);
      };
      wrap.append(el('h4', { text: 'Tùy chọn' }), el('div', { class: 'opts' },
        el('label', { class: 'opt' }, 'Tiền khởi đầu:', startSel),
        check('auction', 'Đấu giá khi người chơi không mua đất (luật gốc)'),
        check('parkingPot', 'Dồn tiền thuế / phạt vào Bãi đỗ xe, ai dừng ở đó nhận hết (luật thêm)'),
        check('shuffle', 'Xáo trộn thứ tự đi')));

      wrap.append(el('div', { class: 'btns end' },
        inGame ? btn('Quay lại ván đang chơi', () => m.close()) : null,
        btn('🎲 Bắt đầu chơi', () => {
          const players = cfg.players.slice(0, cfg.count)
            .map((p, k) => ({ name: cleanName(p.name) || `Người chơi ${k + 1}`, token: p.token }));
          UI.lastCfg = cfg;
          m.close();
          if (Net.code) Net.leave(true);
          startGame({ ...cfg, players });
        }, { primary: true })));
      return wrap;
    }, { wide: true, closable: inGame || !!Net.code, onClose: () => { UI.setupModal = null; } });
    UI.setupModal = m;
  },

  /** Đóng các hộp thoại của ván (khi phòng quay về phòng chờ hoặc rời phòng). */
  closeGameModals() {
    UI.modals.slice().forEach(m => { if (m !== Room.modal && m !== UI.setupModal) m.close(); });
  },

  showGameOver(list, early) {
    const w = list[0];
    const again = isOnline() && Net.isHost();
    UI.modal(m => el('div', { class: 'gameover' },
      el('div', { class: 'trophy', text: '🏆' }),
      el('h2', { text: `${w.token} ${pn(w)} chiến thắng!` }),
      el('p', { class: 'muted', text: early ? 'Xếp hạng theo tổng tài sản (tiền + đất + nhà).' : 'Tất cả đối thủ khác đã phá sản.' }),
      el('table', { class: 'tbl' }, el('tbody', {},
        list.map((p, k) => el('tr', {},
          el('td', { text: `#${k + 1}` }),
          el('td', {}, el('b', { style: `color:${p.color}`, text: `${p.token} ${pn(p)}${youTag(p)}` })),
          el('td', { class: 'num', text: p.bankrupt ? 'Phá sản' : fmt(netWorth(p)) }))))),
      el('div', { class: 'btns center' },
        again ? btn('🔁 Chơi lại với cả phòng', () => { m.close(); Room.again(); }, { primary: true }) : null,
        btn('✨ Ván mới', () => { m.close(); UI.showSetup(); }, { primary: !again }),
        btn('Xem lại bàn cờ', () => m.close()))));
  },
};

function onKey(e) {
  if (e.key === 'Escape') {
    const top = UI.modals[UI.modals.length - 1];
    if (top && top.closable) top.close();
    return;
  }
  if (e.key !== ' ' || UI.modals.length) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag) || document.activeElement.getAttribute('role') === 'button') return;
  const b = $('#panel .btn.primary:not(:disabled)');
  if (b) {
    e.preventDefault();
    b.click();
  }
}

/** Khởi động. Khi trang chạy trên claude.ai và được cập nhật, ván đang chơi (hoặc phòng đang ở) được giữ qua `claude.hot`. */
function boot(data) {
  UI.init();
  const s = data && data.state;
  if (s && s.v === 1 && s.phase !== 'over' && !data.room) {
    UI.modals.slice().forEach(m => m.close());
    resumeGame(s);
  }
  Net.init(data && data.room);
}

function start() {
  const hot = window.claude && window.claude.hot;
  try {
    if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ state: G.stable ? JSON.parse(G.stable) : null, room: Net.code }));
  } catch (e) { /* trình xem không hỗ trợ */ }
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
