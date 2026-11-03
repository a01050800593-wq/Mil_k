/* 웹(claude.ai) 실시간 공유 계층
   공유 상태를 db 문서(시각·차량·상품·주문·처리 내역)로 나눠 저장하고, 다른 기기의 변경을 받아 화면과 알림에 반영한다.
   로그인·장바구니·알림 목록은 기기마다 따로 둔다. db를 쓸 수 없으면(로컬 파일, 로그아웃 상태 등) 기존 저장 방식으로 동작한다. */
const Sync = (() => {
  const LOCAL_KEY = 'smartpx_device_v1';
  const COLLECTIONS = ['meta', 'products', 'orders', 'actions'];
  const MAX_INFLIGHT = 6;
  const SOLDIERS = SPX_DATA.buildSoldiers();
  let db = null;
  let status = 'local';             // local | connecting | empty | live | offline
  let writeErr = '';
  const remote = new Map();         // path -> 확인된 원격 값 (정렬된 JSON)
  const pending = new Map();        // path -> 아직 보내지 않은 값 (null = 삭제)
  const inflight = new Map();       // path -> 보내는 중인 값
  const delivered = new Set();
  let basePaths = new Set();        // 마지막으로 반영·저장한 상태의 문서 경로
  let applyQueued = false;
  let primed = false, epoch = null;
  const seenHistory = new Map(), seenActions = new Map(), seenStock = new Map();
  let seenVehicle = null;
  let local = loadLocal();

  function loadLocal() {
    try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); if (v && v.session) return v; } catch (e) { /* 기기 저장소를 못 쓰면 새로 시작 */ }
    return { session: { soldierId: null, admin: false }, carts: {}, notices: [] };
  }
  function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) { /* 저장 불가 무시 */ } }

  // 키 순서와 관계없이 같은 내용이면 같은 문자열
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  function docsOf(s) {
    const m = new Map();
    m.set('meta/clock', stable({ now: s.now, lastCheck: s.lastCheck, epoch: s.epoch }));
    m.set('meta/vehicle', stable(s.vehicle));
    s.products.forEach(p => m.set('products/' + p.id, stable(p)));
    s.orders.forEach(o => m.set('orders/' + o.id, stable(o)));
    s.actions.forEach(a => m.set('actions/' + a.id, stable(a)));
    return m;
  }
  const current = path => pending.has(path) ? pending.get(path) : inflight.has(path) ? inflight.get(path) : remote.has(path) ? remote.get(path) : null;
  const knownPaths = () => new Set([...remote.keys(), ...inflight.keys(), ...pending.keys()]);

  /* ---------- 저장: 바뀐 문서만, 문서마다 한 번에 하나씩 ---------- */
  function push(s) {
    local.session = s.session; local.carts = s.carts; local.notices = s.notices;
    saveLocal();
    const docs = docsOf(s);
    docs.forEach((j, path) => { if (current(path) !== j) pending.set(path, j); });
    basePaths.forEach(path => { if (!docs.has(path) && current(path) !== null) pending.set(path, null); });
    basePaths = new Set(docs.keys());
    if (s.epoch !== epoch) resetSeen(s);
    pump();
  }

  function pump() {
    for (const [path, j] of pending) {
      if (inflight.size >= MAX_INFLIGHT) break;
      if (inflight.has(path)) continue;
      pending.delete(path);
      inflight.set(path, j);
      const ref = db.doc(path);
      (j === null ? ref.delete() : ref.set(JSON.parse(j))).then(() => done(path, j), e => fail(path, j, e));
    }
    App.renderSync();
  }
  function done(path, j) {
    inflight.delete(path);
    if (j === null) remote.delete(path); else remote.set(path, j);
    pump();
  }
  function fail(path, j, e) {
    inflight.delete(path);
    const code = e && e.code;
    if (code === 'unavailable' || code === 'resource_exhausted') {
      if (!pending.has(path)) pending.set(path, j);
      setTimeout(pump, 600 + Math.random() * 900);
      return;
    }
    writeErr = code === 'invalid_argument' ? '이 계정은 시연 데이터를 바꿀 수 없습니다. 공유 설정에서 Contributor 이상으로 초대받아야 합니다.'
      : code === 'quota_exceeded' ? '저장 공간 한도에 도달했습니다. 데이터 초기화로 정리하세요.'
        : '변경 내용을 저장하지 못했습니다. 잠시 후 다시 시도하세요.';
    App.toast('all', '⚠️ ' + writeErr, 'warn');
    scheduleApply(); // 저장되지 않은 변경은 공유 데이터 기준으로 되돌림
    pump();
  }

  /* ---------- 수신: 다른 기기의 변경을 상태로 반영 ---------- */
  function subscribe() {
    COLLECTIONS.forEach(col => {
      db.collection(col).onSnapshot(snap => {
        const prefix = col + '/';
        [...remote.keys()].forEach(k => { if (k.startsWith(prefix)) remote.delete(k); });
        snap.docs.forEach(d => remote.set(prefix + d.id, stable(d.data())));
        delivered.add(col);
        scheduleApply();
      }, () => { status = 'offline'; App.render(); });
    });
  }
  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(apply);
  }

  function apply() {
    applyQueued = false;
    if (COLLECTIONS.some(c => !delivered.has(c))) return;
    const paths = [...knownPaths()];
    const get = path => { const j = current(path); return j === null ? null : JSON.parse(j); };
    const pick = prefix => paths.filter(p => p.startsWith(prefix)).map(get).filter(Boolean);
    const clock = get('meta/clock'), vehicle = get('meta/vehicle'), products = pick('products/');
    if (!clock || !vehicle || !products.length) {
      status = 'empty';
      App.render();
      return;
    }
    const s = {
      version: 1, epoch: clock.epoch, now: clock.now, lastCheck: clock.lastCheck, vehicle,
      products: products.sort((a, b) => a.id.localeCompare(b.id)),
      orders: pick('orders/').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
      actions: pick('actions/').sort((a, b) => a.id.localeCompare(b.id)),
      soldiers: SOLDIERS, seq: { order: {}, action: 0, notice: 0 },
      session: local.session, carts: local.carts, notices: local.notices,
    };
    if (primed && s.epoch === epoch) detect(s); else resetSeen(s);
    basePaths = new Set(docsOf(s).keys());
    Store.adopt(s);
    status = 'live';
    // 출발시킨 기기가 도착 처리를 못 하고 닫힌 경우
    if (vehicle.status === '운행' && Date.now() - (vehicle.movedAt || 0) > 5000) Store.vehArrive();
    App.render();
  }

  // 초기화(또는 첫 연결) 직후에는 기존 데이터를 '본 것'으로만 기록하고 알림을 띄우지 않는다
  function resetSeen(s) {
    if (epoch !== null && s.epoch !== epoch) { local.notices = []; s.notices = local.notices; saveLocal(); }
    epoch = s.epoch;
    seenHistory.clear(); seenActions.clear(); seenStock.clear();
    s.orders.forEach(o => seenHistory.set(o.id, o.history.length));
    s.actions.forEach(a => seenActions.set(a.id, a.status));
    s.products.forEach(p => seenStock.set(p.id, p.stock));
    seenVehicle = { stopIdx: s.vehicle.stopIdx, status: s.vehicle.status };
    primed = true;
  }

  const ACTION_TEXT = {
    자동발주: a => [`🤖 자동 발주 생성 · ${a.name} ${a.qty}개`, 'warn'],
    입고: a => [`📦 입고 완료 · ${a.name} +${a.qty}`, 'ok'],
    할인: a => [`🏷️ 자동 할인 적용 · ${a.name}`, 'info'],
    폐기: a => a.status === '처리대기' ? [`⛔ 폐기 대상 지정 · ${a.name}`, 'warn'] : [`🗑️ 폐기 완료 · ${a.name} ${a.qty}개`, 'muted'],
    차량보충: a => [`🚚 이동 PX 보충 · ${a.name} ${a.qty}개`, 'ok'],
  };

  // 공유 데이터의 변화에서 장병 알림과 관리자 토스트를 만든다 (어느 기기에서 바꿨든 똑같이)
  function detect(s) {
    const sid = s.session.soldierId, mine = [], admin = [];
    const who = id => { const x = SOLDIERS.find(y => y.id === id); return x ? `${x.rank} ${x.name}` : ''; };
    s.orders.forEach(o => {
      const from = seenHistory.has(o.id) ? seenHistory.get(o.id) : 0;
      for (let i = from; i < o.history.length; i++) {
        const st = o.history[i].status;
        if (o.sid === sid) { const t = Store.noticeFor(o, st); if (t) mine.push(t); }
        if (i === 0) admin.push(o.method === 'mobile' ? [`🚚 이동 PX 현장 결제 · ${who(o.sid)} ${U.won(o.amount)}`, 'info'] : [`🆕 새 주문 ${o.id} · ${who(o.sid)} · ${U.won(o.amount)} → 재고 즉시 차감`, 'info']);
        else if (st === '수령완료') admin.push([`✅ 수령완료 ${o.id} · ${who(o.sid)}`, 'ok']);
        else if (st === '취소') admin.push([`↩️ 주문 취소 ${o.id} · 재고 복원`, 'muted']);
      }
      seenHistory.set(o.id, o.history.length);
    });
    s.actions.forEach(a => {
      const prev = seenActions.get(a.id);
      if (prev === undefined || (a.type === '폐기' && prev !== a.status)) admin.push(ACTION_TEXT[a.type](a));
      seenActions.set(a.id, a.status);
    });
    s.products.forEach(p => {
      if (seenStock.has(p.id) && seenStock.get(p.id) !== p.stock) Store.flash[p.id] = Date.now();
      seenStock.set(p.id, p.stock);
    });
    const v = s.vehicle, pv = seenVehicle;
    if (pv && (pv.stopIdx !== v.stopIdx || pv.status !== v.status)) {
      const me = sid && SOLDIERS.find(x => x.id === sid);
      if (v.status === '정차' && me && v.alerts[sid] && SPX_DATA.BARRACKS_STOP[me.barracks] === v.stopIdx) mine.push(`🚚 이동 PX가 ${SPX_DATA.STOPS[v.stopIdx].name}에 도착했습니다 (10분 정차)`);
      if (v.status === '복귀') admin.push(['🏁 이동 PX 본점 복귀 · 자동 보충 목록 생성', 'warn']);
      if (v.status === '중지' && pv.status !== '중지') admin.push(['⛔ 이동 PX 원격 운행 중지', 'warn']);
      if (pv.status === '중지' && v.status !== '중지') admin.push(['▶️ 이동 PX 운행 재개', 'ok']);
    }
    seenVehicle = { stopIdx: v.stopIdx, status: v.status };

    if (mine.length) {
      mine.forEach(text => local.notices.push({ id: Date.now() + Math.random(), sid, at: s.now, text, read: false }));
      local.notices = local.notices.slice(-60);
      s.notices = local.notices;
      saveLocal();
    }
    mine.forEach(t => App.toast('soldier', t, 'info'));
    admin.forEach(([t, tone]) => App.toast('admin', t, tone));
  }

  /* ---------- 시작 ---------- */
  async function start() {
    status = 'connecting';
    try { db = await window.claude.use('db'); } catch (e) { db = null; }
    if (!db) { status = 'local'; Store.load(); App.render(); return; }
    Store.setSaver(push);
    subscribe();
    setTimeout(() => { if (status === 'connecting') { status = 'offline'; App.render(); } }, 10000);
  }

  function label() {
    if (status === 'local') return { text: db === null && window.claude ? '개인 모드 · 실시간 공유 꺼짐' : '오프라인 파일', tone: 'muted' };
    if (status === 'offline') return { text: '연결 확인 중…', tone: 'warn' };
    const n = pending.size + inflight.size;
    if (n) return { text: `저장 중 ${n}건`, tone: 'busy' };
    return { text: '실시간 공유 중', tone: 'live' };
  }

  return {
    start, label,
    get status() { return status; },
    get web() { return status !== 'local'; },
    get busy() { return pending.size + inflight.size; },
  };
})();
