/* 스마트 PX 상태 관리와 비즈니스 규칙 (PRD 7장)
   모든 데이터는 가상 샘플이며 브라우저 localStorage에만 저장된다.
   시간은 실제 시계가 아닌 '시연 시각(state.now)'을 기준으로 흐른다. */
const MIN = 60000, DAY = 86400000;
const STORE_KEY = 'smartpx_demo_v1';
const ROUNDS = [{ label: '12:30', min: 750 }, { label: '18:00', min: 1080 }, { label: '21:00', min: 1260 }];
const BARRACKS = ['1생활관', '2생활관', '3생활관', '4생활관'];
const PICKUP_PLACE = 'PX 픽업대';
const WAREHOUSES = BARRACKS.map(b => `${b} 무인배송창고`);
const SCAN_PLACES = [PICKUP_PLACE, ...WAREHOUSES];
const SHUTTLE_FLOW = ['접수', '준비중', '배송중', '창고도착', '수령완료'];
const PICKUP_FLOW = ['접수', '준비중', '수령완료'];
const DISCOUNT_RATE = 0.3;
const DAILY_CHECK_MIN = 360; // 매일 06:00 자동 점검
const Binds = {}; // 화면을 다시 그려도 입력 중인 값이 남도록 보관

const U = {
  pad: n => String(n).padStart(2, '0'),
  won: n => `${Number(n).toLocaleString('ko-KR')}원`,
  dateStr(t) { const d = new Date(t); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`; },
  minOf(t) { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); },
  at(date, min) { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime(); },
  addDays(date, n) { const [y, m, d] = date.split('-').map(Number); return U.dateStr(new Date(y, m - 1, d + n).getTime()); },
  diffDays(from, to) { return Math.round((U.at(to, 0) - U.at(from, 0)) / DAY); },
  hm: min => `${U.pad(Math.floor(min / 60) % 24)}:${U.pad(min % 60)}`,
  time: t => U.hm(U.minOf(t)),
  md(date) { const [, m, d] = date.split('-'); return `${+m}/${+d}`; },
  dow(date) { return '일월화수목금토'[new Date(U.at(date, 0)).getDay()]; },
  stamp: t => `${U.md(U.dateStr(t))} ${U.time(t)}`,
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
};

const Store = (() => {
  let state = null;
  let quiet = false;       // 샘플 데이터 생성 중에는 알림을 만들지 않음
  let saver = null;        // 웹 모드: 저장을 실시간 공유 계층(Sync)에 맡김
  const events = [];       // 화면에 토스트로 띄울 이벤트
  const flash = {};        // 재고가 바뀐 품목 (관리자 재고표 깜빡임)

  // 웹 모드에서는 알림·토스트를 Sync가 공유 데이터 변화에서 만들어 모든 기기에 똑같이 띄운다
  function emit(kind, text, extra) { if (!quiet && !saver) events.push(Object.assign({ kind, text }, extra)); }
  const product = id => state.products.find(p => p.id === id);
  const soldier = id => state.soldiers.find(s => s.id === id);
  const order = id => state.orders.find(o => o.id === id);
  const flowOf = o => o.method === 'shuttle' ? SHUTTLE_FLOW : PICKUP_FLOW;

  /* ---------- 상품 상태 (PRD 7.2) ---------- */
  function info(p) {
    const today = U.dateStr(state.now);
    const dday = p.expiry ? U.diffDays(today, p.expiry) : null;
    const dispose = dday !== null && p.stock > 0 && dday <= 1;
    const discount = !dispose && dday !== null && p.stock > 0 && dday <= 7;
    const soldout = p.stock <= 0;
    const low = !dispose && p.stock < p.safety;
    const status = dispose ? '폐기대상' : soldout ? '품절' : discount ? '할인' : low ? '부족' : '정상';
    const price = discount ? Math.round(p.price * (1 - DISCOUNT_RATE) / 10) * 10 : p.price;
    return { dday, dispose, discount, soldout, low, status, price };
  }

  function changeStock(p, delta) { p.stock += delta; flash[p.id] = Date.now(); }

  // 번호는 저장된 데이터에서 이어 붙인다 (여러 기기가 함께 쓰므로 별도 카운터를 두지 않음)
  function addAction(a) {
    const n = state.actions.reduce((m, x) => Math.max(m, +x.id.slice(3) || 0), 0);
    a.id = 'SA-' + String(n + 1).padStart(4, '0');
    state.actions.push(a);
    return a;
  }

  /* ---------- 자동 발주 (PRD 7.1) ---------- */
  function checkAutoOrder(p, at) {
    if (p.stock >= p.safety || info(p).dispose) return null;
    if (state.actions.some(a => a.type === '자동발주' && a.pid === p.id && a.status === '발주중')) return null;
    const a = addAction({
      at: at || state.now, type: '자동발주', pid: p.id, name: p.name, qty: p.optimal - p.stock,
      reason: p.stock === 0 ? `품절 · 안전재고(${p.safety})` : `안전재고(${p.safety}) 미만 · 현재고 ${p.stock}`, status: '발주중',
    });
    emit('admin', `🤖 자동 발주 생성 · ${p.name} ${a.qty}개`, { tone: 'warn' });
    return a;
  }

  function receivePO(id, at, note) {
    const a = state.actions.find(x => x.id === id);
    if (!a || a.status !== '발주중') return;
    const p = product(a.pid);
    a.status = '입고완료';
    a.doneAt = at || state.now;
    changeStock(p, a.qty);
    if (p.shelf) p.expiry = U.addDays(U.dateStr(a.doneAt), p.shelf); // 신규 입고분 유통기한
    addAction({ at: a.doneAt, type: '입고', pid: p.id, name: p.name, qty: a.qty, reason: note || `${a.id} 발주분 입고`, status: '처리완료' });
    emit('admin', `📦 입고 완료 · ${p.name} +${a.qty}`, { tone: 'ok' });
    save();
  }

  function dispose(pid) {
    const p = product(pid);
    if (!info(p).dispose) return;
    const qty = p.stock;
    let pending = state.actions.filter(a => a.type === '폐기' && a.pid === pid && a.status === '처리대기');
    if (!pending.length) pending = [addAction({ at: state.now, type: '폐기', pid, name: p.name, qty, reason: '유통기한 임박 · 판매 중지', status: '처리대기' })];
    pending.forEach(a => { a.status = '처리완료'; a.qty = qty; a.doneAt = state.now; });
    changeStock(p, -qty);
    p.expiry = null;
    emit('admin', `🗑️ 폐기 완료 · ${p.name} ${qty}개`, { tone: 'muted' });
    checkAutoOrder(p);
    save();
  }

  /* ---------- 일일 점검: 익일 입고, 할인·폐기 지정, 자동 발주 ---------- */
  function runDailyCheck(at) {
    const today = U.dateStr(at);
    state.actions
      .filter(a => a.type === '자동발주' && a.status === '발주중' && U.dateStr(a.at) < today)
      .forEach(a => receivePO(a.id, at, `${a.id} 발주분 익일 자동 입고`));
    const has = (type, p) => state.actions.some(a => a.type === type && a.pid === p.id && a.expiry === p.expiry);
    state.products.forEach(p => {
      const i = info(p);
      const dl = i.dday !== null && i.dday <= 0 ? '유통기한 경과' : `유통기한 D-${i.dday}`;
      if (i.discount && !has('할인', p)) {
        addAction({ at, type: '할인', pid: p.id, name: p.name, qty: p.stock, reason: `${dl} · 30% 자동 할인`, status: '처리완료', expiry: p.expiry });
        emit('admin', `🏷️ 자동 할인 적용 · ${p.name} (${dl})`, { tone: 'info' });
      }
      if (i.dispose && !has('폐기', p)) {
        addAction({ at, type: '폐기', pid: p.id, name: p.name, qty: p.stock, reason: `${dl} · 판매 중지(폐기 대상)`, status: '처리대기', expiry: p.expiry });
        emit('admin', `⛔ 폐기 대상 지정 · ${p.name} (${dl})`, { tone: 'warn' });
      }
      checkAutoOrder(p, at);
    });
    const s = stats();
    state.lastCheck = { date: today, at, low: s.low.length, expiring: s.expiring.length };
  }

  function stats() {
    const today = U.dateStr(state.now);
    const orders = state.orders.filter(o => U.dateStr(o.createdAt) === today && o.status !== '취소');
    const low = [], expiring = [];
    state.products.forEach(p => { const i = info(p); if (i.low) low.push(p); if (i.discount || i.dispose) expiring.push(p); });
    return {
      orders, low, expiring,
      sales: orders.reduce((s, o) => s + o.amount, 0),
      pendingPO: state.actions.filter(a => a.type === '자동발주' && a.status === '발주중').length,
      pendingDispose: state.actions.filter(a => a.type === '폐기' && a.status === '처리대기').length,
    };
  }

  /* ---------- 주문 ---------- */
  function nextOrderId(t) {
    const prefix = `ORD-${U.dateStr(t).replace(/-/g, '')}-`;
    const n = state.orders.reduce((m, o) => o.id.startsWith(prefix) ? Math.max(m, +o.id.slice(prefix.length) || 0) : m, 0);
    return prefix + String(n + 1).padStart(4, '0');
  }
  function token() { let s = ''; for (let i = 0; i < 8; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)]; return s; }

  function makeOrder(o) {
    const id = nextOrderId(o.createdAt), status = o.status || '접수';
    const ord = {
      id, sid: o.sid, items: o.items, amount: o.items.reduce((s, it) => s + it.price * it.qty, 0), pay: o.pay,
      method: o.method, place: o.place, dlvDate: o.dlvDate, slot: o.slot, status,
      createdAt: o.createdAt, history: [{ status, at: o.createdAt }],
      qr: o.method === 'mobile' ? null : `SPX|${id}|${token()}`, // 주문번호 기반 고유 토큰
      receivedAt: null, payId: o.payId || null, split: !!o.split,
    };
    state.orders.push(ord);
    return ord;
  }

  function dayLabel(date) {
    const today = U.dateStr(state.now);
    if (date === today) return '오늘';
    if (date === U.addDays(today, 1)) return '내일';
    if (date === U.addDays(today, -1)) return '어제';
    return U.md(date);
  }
  function placeLabel(o) {
    if (o.method === 'shuttle') return `${o.place} · ${dayLabel(o.dlvDate)} ${U.hm(o.slot)} 회차`;
    if (o.method === 'pickup') return `PX 픽업 · ${dayLabel(o.dlvDate)} ${U.hm(o.slot)}`;
    return `${o.place} · 현장 구매`;
  }
  const itemsText = o => o.items.map(it => `${it.name} x${it.qty}`).join(', ');

  function notify(sid, text) {
    if (quiet || saver) return;
    state.notices.push({ id: ++state.seq.notice, sid, at: state.now, text, read: false });
    emit('soldier', text, { sid });
  }

  function statusNotice(o, s) {
    if (o.method === 'shuttle' && s === '배송중') return `🚐 ${U.hm(o.slot)} 회차 셔틀이 출발했습니다 · ${o.id}`;
    if (o.method === 'shuttle' && s === '창고도착') return `📦 ${o.place.replace(' 무인배송창고', ' 창고')} 도착! QR로 수령하세요 · ${o.id}`;
    if (o.method === 'pickup' && s === '준비중') return `🛍️ PX 픽업대에 상품이 준비되었습니다 · ${o.id}`;
    if (s === '수령완료') return `✅ 수령이 완료되었습니다 · ${o.id}`;
    if (s === '취소') return `↩️ 주문이 취소되었습니다 · ${o.id}`;
    return null;
  }

  // 주문 이력 한 단계에 해당하는 장병 알림 문구 (웹 모드에서 Sync가 사용)
  function noticeFor(o, s) {
    if (o.method === 'mobile') return s === '수령완료' ? `🧾 이동 PX 자동결제 ${U.won(o.amount)} · ${o.id}` : null;
    if (s === '접수') return `💳 결제 완료 · ${o.id} (${placeLabel(o)})`;
    return statusNotice(o, s);
  }

  function setStatus(o, status, at) {
    o.status = status;
    o.history.push({ status, at });
    const msg = statusNotice(o, status);
    if (msg) notify(o.sid, msg);
  }

  // 시연 시각에 맞춰 상태 자동 진행 (셔틀: 회차 30분 전 준비, 정시 출발, 10분 후 창고 도착)
  function autoProgress(o) {
    if (o.method === 'mobile' || o.status === '수령완료' || o.status === '취소') return;
    const t = U.at(o.dlvDate, o.slot), flow = flowOf(o);
    const steps = o.method === 'shuttle'
      ? [['준비중', t - 30 * MIN], ['배송중', t], ['창고도착', t + 10 * MIN]]
      : [['준비중', t - 30 * MIN]];
    steps.forEach(([status, at]) => {
      if (state.now >= at && flow.indexOf(status) > flow.indexOf(o.status)) setStatus(o, status, Math.max(at, o.createdAt));
    });
  }
  const progressOrders = () => state.orders.forEach(autoProgress);

  function placeOrders(sid, groups, pay) {
    for (const g of groups) for (const it of g.items) {
      const p = product(it.pid);
      if (info(p).dispose || p.stock < it.qty) return { error: `${p.name} 재고가 부족합니다 (남은 수량 ${Math.max(0, p.stock)}개)` };
    }
    const payId = 'PAY-' + token();
    const orders = groups.map(g => makeOrder({
      sid, pay, payId, method: g.method, place: g.place, dlvDate: g.dlvDate, slot: g.slot, split: g.split, createdAt: state.now,
      items: g.items.map(it => { const p = product(it.pid); return { pid: p.id, name: p.name, emoji: p.emoji, qty: it.qty, price: info(p).price }; }),
    }));
    const sol = soldier(sid);
    orders.forEach(o => o.items.forEach(it => changeStock(product(it.pid), -it.qty)));
    orders.forEach(o => emit('admin', `🆕 새 주문 ${o.id} · ${sol.rank} ${sol.name} · ${U.won(o.amount)} → 재고 즉시 차감`, { tone: 'info' }));
    orders.forEach(o => o.items.forEach(it => checkAutoOrder(product(it.pid))));
    state.carts[sid] = {};
    orders.forEach(o => notify(sid, `💳 결제 완료 · ${o.id} (${placeLabel(o)})`));
    save();
    return { orders };
  }

  // "다음 단계로" 시연 버튼. 마지막 수령완료는 QR 스캔으로만 처리
  function nextStep(id) {
    const o = order(id);
    if (!o || o.method === 'mobile') return;
    const flow = flowOf(o), i = flow.indexOf(o.status);
    if (i < 0 || i >= flow.length - 2) return;
    setStatus(o, flow[i + 1], state.now);
    save();
  }

  function cancelOrder(id) {
    const o = order(id);
    if (!o || o.status !== '접수') return;
    o.items.forEach(it => changeStock(product(it.pid), it.qty));
    setStatus(o, '취소', state.now);
    emit('admin', `↩️ 주문 취소 ${o.id} · 재고 복원`, { tone: 'muted' });
    save();
  }

  function scan(raw, place) {
    const tok = String(raw || '').trim();
    const o = state.orders.find(x => x.qr && x.qr === tok);
    if (!o) return { ok: false, title: '인식 실패', msg: '등록되지 않은 QR코드입니다.' };
    const sol = soldier(o.sid), who = `${sol.rank} ${sol.name}`;
    const fail = (title, msg) => ({ ok: false, order: o, title, msg });
    if (o.status === '수령완료') return fail('이미 수령된 주문', `${U.stamp(o.receivedAt)}에 수령 완료된 주문입니다.`);
    if (o.status === '취소') return fail('취소된 주문', '취소된 주문은 수령할 수 없습니다.');
    const target = o.method === 'pickup' ? PICKUP_PLACE : o.place;
    if (target !== place) return fail('수령 장소 불일치', `이 주문은 [${target}]에서 수령합니다.`);
    if (o.method === 'shuttle' && o.status !== '창고도착') return fail('아직 도착 전', `현재 상태: ${o.status}. 창고에 도착한 뒤 수령할 수 있습니다.`);
    if (o.method === 'pickup' && o.status === '접수') return fail('상품 준비 전', '픽업대에 상품이 준비되면 수령할 수 있습니다.');
    o.receivedAt = state.now;
    setStatus(o, '수령완료', state.now);
    emit('admin', `✅ 수령완료 ${o.id} · ${who}`, { tone: 'ok' });
    save();
    return { ok: true, order: o, title: '수령 완료', msg: `${who} · ${itemsText(o)}` };
  }

  /* ---------- 장바구니·수령 옵션 ---------- */
  function cart(sid) { return state.carts[sid] || (state.carts[sid] = {}); }
  function addToCart(sid, pid, delta) {
    const c = cart(sid), p = product(pid);
    const q = info(p).dispose ? 0 : Math.max(0, Math.min(p.stock, (c[pid] || 0) + delta));
    if (q === 0) delete c[pid]; else c[pid] = q;
    save();
  }
  function removeFromCart(sid, pid) { delete cart(sid)[pid]; save(); }
  function cartLines(sid) {
    const c = cart(sid);
    return Object.keys(c).map(pid => {
      const p = product(pid), i = info(p);
      if (i.dispose || p.stock <= 0) { delete c[pid]; return null; }
      if (c[pid] > p.stock) c[pid] = p.stock;
      return { p, qty: c[pid], info: i };
    }).filter(Boolean);
  }

  // PRD 7.3: 셔틀 3회차, 회차 30분 전 마감
  function shuttleOptions() {
    const today = U.dateStr(state.now), tm = U.addDays(today, 1), out = [];
    ROUNDS.forEach(r => {
      const closed = state.now >= U.at(today, r.min - 30);
      out.push({ key: `${today}|${r.min}`, label: `오늘 ${r.label}`, sub: closed ? '마감' : `${U.hm(r.min - 30)} 마감`, disabled: closed, today: true });
    });
    ROUNDS.forEach(r => out.push({ key: `${tm}|${r.min}`, label: `내일 ${r.label}`, sub: `${U.hm(r.min - 30)} 마감`, disabled: false, today: false }));
    return out;
  }
  // 픽업: 12:00~21:00, 30분 단위, 지금부터 30분 이후
  function pickupOptions() {
    const today = U.dateStr(state.now), out = [];
    [[today, '오늘'], [U.addDays(today, 1), '내일']].forEach(([d, lbl]) => {
      for (let m = 720; m <= 1260; m += 30) if (U.at(d, m) >= state.now + 30 * MIN) out.push({ key: `${d}|${m}`, label: `${lbl} ${U.hm(m)}` });
    });
    return out;
  }

  /* ---------- 시연 시각 ---------- */
  function setNow(t) {
    if (t <= state.now) return;
    for (;;) {
      const d = U.dateStr(state.now), checkAt = U.at(d, DAILY_CHECK_MIN);
      if (state.lastCheck.date < d && checkAt <= t) {
        state.now = Math.max(state.now, checkAt);
        progressOrders();
        runDailyCheck(state.now);
        continue;
      }
      const nextDay = U.at(U.addDays(d, 1), 0);
      if (t < nextDay) { state.now = t; progressOrders(); break; }
      state.now = nextDay;
      progressOrders();
    }
    save();
  }
  const addMinutes = n => setNow(state.now + n * MIN);
  function nextRound() {
    const today = U.dateStr(state.now);
    const t = ROUNDS.map(r => U.at(today, r.min + 10)).find(x => x > state.now);
    setNow(t || U.at(U.addDays(today, 1), ROUNDS[0].min + 10));
  }
  const nextDay = () => setNow(U.at(U.addDays(U.dateStr(state.now), 1), 480));

  /* ---------- 이동 PX (PRD 16장) ---------- */
  const STOPS = () => SPX_DATA.STOPS;
  function vehEta(stopIdx, round) {
    const v = state.vehicle;
    return SPX_DATA.VEH_ROUNDS[round ?? v.round].min + STOPS()[stopIdx].off;
  }
  function vehDepart() {
    const v = state.vehicle;
    if (v.status === '중지' || v.status === '운행') return null;
    if (v.status === '복귀') {
      if (v.round === 0) v.round = 1; else { v.round = 0; v.day = U.addDays(v.day, 1); }
      v.stopIdx = 0; v.fromIdx = 0; v.status = '대기'; v.battery = 100;
      emit('admin', `🔋 충전 완료 · ${SPX_DATA.VEH_ROUNDS[v.round].label} 회차 출발 대기`, { tone: 'info' });
      save();
      return 'ready';
    }
    v.fromIdx = v.stopIdx;
    v.stopIdx += 1;
    v.status = '운행';
    v.movedAt = Date.now(); // 출발시킨 기기가 닫혀도 다른 기기가 도착 처리할 수 있도록
    v.battery = Math.max(8, v.battery - 6);
    save();
    return 'moving';
  }
  function vehArrive() {
    const v = state.vehicle;
    if (v.status !== '운행') return;
    v.fromIdx = v.stopIdx;
    const stop = STOPS()[v.stopIdx];
    if (v.stopIdx === STOPS().length - 1) {
      v.status = '복귀';
      v.auto = false;
      emit('admin', '🏁 이동 PX 본점 복귀 · 자동 보충 목록 생성', { tone: 'warn' });
    } else {
      v.status = '정차';
      Object.keys(v.alerts).forEach(sid => {
        const s = soldier(sid);
        if (v.alerts[sid] && s && SPX_DATA.BARRACKS_STOP[s.barracks] === v.stopIdx) notify(sid, `🚚 이동 PX가 ${stop.name}에 도착했습니다 (10분 정차)`);
      });
    }
    save();
  }
  function vehStop() {
    const v = state.vehicle;
    if (v.status === '중지') return;
    if (v.status === '운행') vehArrive();
    v.prevStatus = v.status;
    v.status = '중지';
    v.auto = false;
    emit('admin', '⛔ 이동 PX 원격 운행 중지', { tone: 'warn' });
    save();
  }
  function vehResume() {
    const v = state.vehicle;
    if (v.status !== '중지') return;
    v.status = v.prevStatus || '정차';
    v.prevStatus = null;
    emit('admin', '▶️ 이동 PX 운행 재개', { tone: 'ok' });
    save();
  }
  function vehToggleAuto() { state.vehicle.auto = !state.vehicle.auto; save(); }
  function vehToggleAlert(sid) { const a = state.vehicle.alerts; a[sid] = !a[sid]; save(); }
  function replenishList() {
    return state.vehicle.load.map(l => ({ ...l, need: l.std - l.qty, p: product(l.pid) })).filter(l => l.need > 0);
  }
  // 복귀 후 보충: 적재 기준 − 잔량만큼 본점 재고에서 차감 → 안전재고 미만이면 자동 발주
  function vehReplenish() {
    const v = state.vehicle;
    if (v.status !== '복귀' && v.status !== '대기') return;
    replenishList().forEach(l => {
      const p = l.p, give = Math.min(l.need, Math.max(0, p.stock));
      if (!give) return;
      changeStock(p, -give);
      v.load.find(x => x.pid === l.pid).qty += give;
      addAction({ at: state.now, type: '차량보충', pid: p.id, name: p.name, qty: give, reason: `${v.name} 적재 기준 ${l.std} − 잔량 ${l.qty}`, status: '처리완료' });
      checkAutoOrder(p);
    });
    emit('admin', `🚚 ${v.name} 보충 완료 · 본점 재고 차감`, { tone: 'ok' });
    save();
  }
  function mobilePurchase(sid, picks, pay) {
    const v = state.vehicle;
    if (v.status !== '정차') return { error: '차량이 정차 중일 때만 결제할 수 있습니다.' };
    const items = [];
    for (const [pid, qty] of Object.entries(picks)) {
      if (qty <= 0) continue;
      const l = v.load.find(x => x.pid === pid), p = product(pid);
      if (!l || l.qty < qty) return { error: `${p.name} 적재 수량이 부족합니다.` };
      items.push({ pid, name: p.name, emoji: p.emoji, qty, price: p.price });
    }
    if (!items.length) return { error: '꺼낸 상품이 없습니다.' };
    items.forEach(it => { v.load.find(x => x.pid === it.pid).qty -= it.qty; });
    const stop = STOPS()[v.stopIdx];
    const o = makeOrder({ sid, items, pay, method: 'mobile', place: `이동 PX · ${stop.name}`, dlvDate: U.dateStr(state.now), slot: U.minOf(state.now), status: '수령완료', createdAt: state.now });
    o.receivedAt = state.now;
    v.sales.push({ id: o.id, at: state.now, stopIdx: v.stopIdx, sid, amount: o.amount, qty: items.reduce((s, it) => s + it.qty, 0) });
    const sol = soldier(sid);
    emit('admin', `🚚 이동 PX 현장 결제 · ${stop.name} · ${sol.rank} ${sol.name} ${U.won(o.amount)}`, { tone: 'info' });
    notify(sid, `🧾 이동 PX 자동결제 ${U.won(o.amount)} · ${o.id}`);
    save();
    return { order: o };
  }

  /* ---------- 초기 데이터 ---------- */
  function seedOrders() {
    const r = SPX_DATA.rng(1102);
    const today = U.dateStr(state.now), yday = U.addDays(today, -1);
    const sellable = state.products.filter(p => p.stock > 0 && !info(p).dispose);
    const pick = (pool, n) => {
      const out = [];
      while (out.length < n) {
        const p = pool[Math.floor(r() * pool.length)];
        if (!out.some(it => it.pid === p.id)) out.push({ pid: p.id, name: p.name, emoji: p.emoji, qty: 1 + Math.floor(r() * 2), price: info(p).price });
      }
      return out;
    };
    // 시연 계정의 어제 주문 (수령완료) — "내 주문만 보인다" 확인용
    const demo = state.soldiers[0];
    const y = makeOrder({ sid: demo.id, pay: demo.pay, method: 'pickup', place: PICKUP_PLACE, dlvDate: yday, slot: 1230, createdAt: U.at(yday, 1180), items: pick(sellable.filter(p => !p.pickupOnly), 2) });
    y.history.push({ status: '준비중', at: U.at(yday, 1200) }, { status: '수령완료', at: U.at(yday, 1236) });
    y.status = '수령완료';
    y.receivedAt = U.at(yday, 1236);
    // 오늘 다른 장병들의 주문 36건 (현재고는 이미 차감된 값)
    const mins = Array.from({ length: 36 }, () => 510 + Math.floor(r() * 515)).sort((a, b) => a - b);
    mins.forEach(min => {
      const sol = state.soldiers[1 + Math.floor(r() * 99)];
      const shuttle = r() < 0.6;
      const pool = shuttle ? sellable.filter(p => !p.pickupOnly) : sellable;
      const slot = shuttle ? (min < 720 ? 750 : 1080) : Math.min(1260, Math.max(720, Math.ceil((min + 30) / 30) * 30 + 30 * Math.floor(r() * 4)));
      makeOrder({
        sid: sol.id, pay: sol.pay, method: shuttle ? 'shuttle' : 'pickup', place: shuttle ? `${sol.barracks} 무인배송창고` : PICKUP_PLACE,
        dlvDate: today, slot, createdAt: U.at(today, min), items: pick(pool, 1 + Math.floor(r() * 3)),
      });
    });
    progressOrders();
    state.orders.forEach(o => {
      if (o.status === '수령완료') return;
      const due = U.at(o.dlvDate, o.slot);
      const ready = o.status === '창고도착' || (o.method === 'pickup' && o.status === '준비중' && due <= state.now);
      if (ready && r() < 0.75) {
        const at = Math.min(state.now, due + (15 + Math.floor(r() * 60)) * MIN);
        o.receivedAt = at;
        setStatus(o, '수령완료', at);
      }
    });
  }

  function createInitialState() {
    const today = U.dateStr(Date.now());
    state = {
      version: 1,
      epoch: Date.now(), // 초기화할 때마다 바뀜 (다른 기기가 초기화를 알아차리는 기준)
      now: U.at(today, DAILY_CHECK_MIN),
      products: SPX_DATA.buildProducts(today),
      soldiers: SPX_DATA.buildSoldiers(),
      orders: [], actions: [], notices: [], carts: {},
      seq: { order: {}, action: 0, notice: 0 },
      session: { soldierId: null, admin: false },
      lastCheck: null,
      vehicle: {
        name: '이동PX-01', day: today, round: 0, stopIdx: 0, fromIdx: 0, status: '대기', prevStatus: null,
        battery: 100, auto: false, alerts: {}, sales: [],
        load: SPX_DATA.MOBILE_LOAD.map(([pid, std]) => ({ pid, std, qty: std })),
      },
    };
    quiet = true;
    runDailyCheck(state.now);              // 06:00 일일 점검: 자동 발주·할인·폐기 지정
    state.now = U.at(today, 17 * 60 + 10); // 시연 시작: 일과 후 17:10
    seedOrders();
    quiet = false;
    events.length = 0;
  }

  function save() {
    if (saver) { saver(state); return; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경에서도 시연은 계속 */ } }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.version === 1) {
        state = s;
        if (state.vehicle.status === '운행') vehArrive();
        return;
      }
    } catch (e) { /* 손상된 저장값은 무시하고 새로 만든다 */ }
    reset();
  }
  function reset() { createInitialState(); save(); }

  function login(id, pin) {
    const s = soldier(String(id).trim());
    if (!s || s.pin !== String(pin).trim()) return false;
    state.session.soldierId = s.id;
    save();
    return true;
  }
  function logout() { state.session.soldierId = null; save(); }
  function adminLogin(id, pin) {
    if (String(id).trim() !== 'admin' || String(pin).trim() !== '0000') return false;
    state.session.admin = true;
    save();
    return true;
  }
  function adminLogout() { state.session.admin = false; save(); }
  function markNoticesRead(sid) { state.notices.forEach(n => { if (n.sid === sid) n.read = true; }); save(); }

  return {
    get state() { return state; }, flash,
    load, save, reset, drain: () => events.splice(0),
    adopt: s => { state = s; }, setSaver: fn => { saver = fn; },
    info, product, soldier, order, stats, flowOf, placeLabel, dayLabel, itemsText, noticeFor,
    login, logout, adminLogin, adminLogout, markNoticesRead,
    cart, cartLines, addToCart, removeFromCart, shuttleOptions, pickupOptions,
    placeOrders, nextStep, cancelOrder, scan, receivePO, dispose,
    addMinutes, nextRound, nextDay,
    vehEta, vehDepart, vehArrive, vehStop, vehResume, vehToggleAuto, vehToggleAlert, replenishList, vehReplenish, mobilePurchase,
  };
})();
