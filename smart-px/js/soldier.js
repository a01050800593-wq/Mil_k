/* 장병용 모바일 화면 (PRD 8.1 U1~U5 + 16장 이동 PX) */

// 장병·관리자 화면이 함께 쓰는 표시 요소
function statusBadge(s) {
  const cls = { 접수: 'b-gray', 준비중: 'b-blue', 배송중: 'b-amber', 창고도착: 'b-green', 수령완료: 'b-done', 취소: 'b-red' }[s] || 'b-gray';
  return `<span class="sbadge ${cls}">${s}</span>`;
}
function vehStatusLabel(v) {
  return { 대기: '출발 대기', 운행: '이동 중', 정차: '정차 중', 복귀: '본점 복귀', 중지: '운행 중지' }[v.status] || v.status;
}
function routeMapSVG(mine) {
  const v = Store.state.vehicle, ST = SPX_DATA.STOPS, pts = ST.slice(0, ST.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + ' Z';
  const from = ST[v.fromIdx], to = ST[v.stopIdx];
  const here = v.status === '운행' ? -1 : v.stopIdx % pts.length;
  return `<svg class="route" viewBox="0 0 380 250" role="img" aria-label="이동 PX 노선도">
    <path d="${d}" class="route-line"/><path d="${d}" class="route-dash"/>
    ${pts.map((p, i) => `<g class="stop${i === mine ? ' mine' : ''}${i === here ? ' here' : ''}"><circle cx="${p.x}" cy="${p.y}" r="8"/><text x="${p.tx}" y="${p.ty}" text-anchor="${p.anchor}">${i === mine ? '★ ' : ''}${p.short}</text></g>`).join('')}
    <g class="veh${v.status === '중지' ? ' stopped' : ''}" data-to="${to.x},${to.y}" style="transform:translate(${from.x}px,${from.y}px)"><circle r="16"/><text y="6" text-anchor="middle">🚚</text></g>
  </svg>`;
}

const SoldierUI = (() => {
  const ui = {
    tab: 'home', cat: '전체', err: '',
    method: 'shuttle', warehouse: null, roundKey: null, pickupKey: null, pay: null,
    payStage: 'form', payingLabel: '', lastIds: [],
    qrId: null, notices: false, mobile: null,
  };
  const st = () => Store.state;
  const me = () => st().session.soldierId ? Store.soldier(st().session.soldierId) : null;
  const bg = p => SPX_DATA.CAT_RULE[p.cat].bg;
  const cartCount = s => Object.values(Store.cart(s.id)).reduce((a, b) => a + b, 0);
  const subHead = (title, back) => `<div class="p-subhead">${back ? `<button class="icon-btn" data-act="s-tab" data-tab="${back}" aria-label="뒤로">‹</button>` : '<span></span>'}<b>${title}</b><span></span></div>`;
  const stepper = (act, pid, q, max) => `<div class="stepper"><button data-act="${act}" data-pid="${pid}" data-d="-1" aria-label="빼기">−</button><b>${q}</b><button data-act="${act}" data-pid="${pid}" data-d="1" ${q >= max ? 'disabled' : ''} aria-label="더하기">＋</button></div>`;

  function resetCheckout() {
    Object.assign(ui, { method: 'shuttle', warehouse: null, roundKey: null, pickupKey: null, pay: null, payStage: 'form', err: '' });
  }

  function render() {
    const s = me();
    if (!s) return loginView();
    const pages = { home: homeView, cart: cartView, pay: payView, orders: ordersView, mobile: mobileView };
    return `<div class="p-app">
      <div class="p-status"><b>${U.time(st().now)}</b><span>LTE ▮▮▮ 🔋</span></div>
      <div class="p-body" data-scroll-key="p-${ui.tab}">${(pages[ui.tab] || homeView)(s)}</div>
      ${navView(s)}${ui.qrId ? qrModal() : ''}${ui.notices ? noticeModal(s) : ''}${ui.mobile ? mobileModal(s) : ''}
    </div>`;
  }

  /* ---------- U1 로그인 ---------- */
  function loginView() {
    const samples = st().soldiers.slice(0, 5);
    return `<div class="p-app"><div class="p-status"><b>${U.time(st().now)}</b><span>LTE ▮▮▮ 🔋</span></div>
      <div class="p-body p-login">
        <div class="login-hero"><div class="logo lg">PX</div><h1>스마트 PX</h1><p>국군 복지몰 · 사전주문 무인수령</p></div>
        <label class="flabel" for="lgId">군번</label>
        <input id="lgId" class="finput" data-bind="lgId" value="${U.esc(Binds.lgId || '')}" placeholder="예) 26-70001234" autocomplete="off">
        <label class="flabel" for="lgPin">PIN (4자리)</label>
        <input id="lgPin" class="finput" data-bind="lgPin" value="${U.esc(Binds.lgPin || '')}" type="password" inputmode="numeric" maxlength="4" placeholder="••••" data-enter="s-login">
        ${ui.err ? `<div class="err">${ui.err}</div>` : ''}
        <button class="btn primary block lg" data-act="s-login">로그인</button>
        <div class="samples"><div class="samples-title">시연용 샘플 계정 (눌러서 입력)</div>
          ${samples.map(s => `<button class="sample" data-act="s-fill" data-id="${s.id}" data-pin="${s.pin}"><span>${s.rank} ${s.name} · ${s.barracks}</span><small>${s.id} / ${s.pin}</small></button>`).join('')}
        </div>
        <p class="fine">모의 인증 · 가상 장병 100명 데이터</p>
      </div></div>`;
  }

  /* ---------- U2 복지몰 홈 ---------- */
  function nextShuttleText() {
    const today = U.dateStr(st().now);
    const r = ROUNDS.find(x => st().now < U.at(today, x.min - 30));
    return r ? `${r.label} (${U.hm(r.min - 30)} 마감)` : '내일 12:30';
  }

  function homeView(s) {
    const unread = st().notices.filter(n => n.sid === s.id && !n.read).length;
    const cats = ['전체', ...SPX_DATA.CATEGORIES];
    const list = st().products.filter(p => !Store.info(p).dispose && (ui.cat === '전체' || p.cat === ui.cat));
    const c = cartCount(s);
    return `<div class="p-head">
        <div><div class="p-hello">${s.rank} ${s.name}님</div><div class="p-sub">${s.barracks} · ${s.id} <button class="link" data-act="s-logout">로그아웃</button></div></div>
        <div class="p-icons">
          <button class="icon-btn" data-act="s-notices" aria-label="알림">🔔${unread ? `<i>${unread}</i>` : ''}</button>
          <button class="icon-btn" data-act="s-tab" data-tab="cart" aria-label="장바구니">🛒${c ? `<i>${c}</i>` : ''}</button>
        </div>
      </div>
      <div class="p-banner"><b>🌙 판매원 부재 · 무인 운영 중</b><span>미리 주문하고 PX 픽업 또는 무인셔틀로 받으세요</span></div>
      <div class="p-chips"><span class="chip">🚐 다음 셔틀 ${nextShuttleText()}</span><span class="chip">🛍️ 픽업 12:00~21:00</span></div>
      <div class="p-cats">${cats.map(k => `<button class="${k === ui.cat ? 'on' : ''}" data-act="s-cat" data-cat="${k}">${k}</button>`).join('')}</div>
      <div class="p-grid">${list.map(p => productCard(p, s)).join('')}</div>`;
  }

  function productCard(p, s) {
    const i = Store.info(p), q = Store.cart(s.id)[p.id] || 0;
    const badges = (p.pickupOnly ? '<span class="bdg pick">픽업전용</span>' : '') + (i.discount ? '<span class="bdg sale">할인 30%</span>' : '') + (i.soldout ? '<span class="bdg out">품절</span>' : '');
    const meta = i.soldout ? '품절 · 입고 예정' : `재고 ${p.stock}개${i.discount ? ` · 유통기한 D-${i.dday}` : ''}`;
    const btn = i.soldout ? '<button class="btn sm block" disabled>품절</button>'
      : q ? stepper('s-qty', p.id, q, p.stock)
        : `<button class="btn sm block primary" data-act="s-qty" data-pid="${p.id}" data-d="1">담기</button>`;
    return `<div class="pcard${i.soldout ? ' soldout' : ''}">
      <div class="pimg" style="background:${bg(p)}"><span>${p.emoji}</span><div class="bdgs">${badges}</div></div>
      <div class="pname">${p.name}</div>
      <div class="pprice">${i.discount ? `<s>${U.won(p.price)}</s>` : ''}<b class="${i.discount ? 'sale' : ''}">${U.won(i.price)}</b></div>
      <div class="pmeta${!i.soldout && p.stock < 5 ? ' few' : ''}">${meta}</div>
      ${btn}
    </div>`;
  }

  /* ---------- U3 장바구니·수령 방식 ---------- */
  // 수령 방식에 따라 주문을 나눈다 (PRD F1-8: 픽업전용 상품은 픽업 주문으로 자동 분리)
  function buildPlan(s, lines) {
    const shOpts = Store.shuttleOptions(), pickOpts = Store.pickupOptions();
    if (!ui.warehouse) ui.warehouse = `${s.barracks} 무인배송창고`;
    const openSh = shOpts.filter(o => !o.disabled);
    if (!openSh.some(o => o.key === ui.roundKey)) ui.roundKey = openSh[0].key;
    if (!pickOpts.some(o => o.key === ui.pickupKey)) ui.pickupKey = pickOpts[0].key;
    const parse = k => { const [d, m] = k.split('|'); return { dlvDate: d, slot: +m }; };
    const group = (method, ls, split) => ({
      method, split,
      place: method === 'shuttle' ? ui.warehouse : PICKUP_PLACE,
      ...parse(method === 'shuttle' ? ui.roundKey : ui.pickupKey),
      items: ls.map(l => ({ pid: l.p.id, qty: l.qty, p: l.p, price: l.info.price })),
      amount: ls.reduce((a, l) => a + l.info.price * l.qty, 0),
    });
    const bulky = lines.filter(l => l.p.pickupOnly), normal = lines.filter(l => !l.p.pickupOnly);
    let groups;
    if (ui.method === 'pickup') groups = [group('pickup', lines, false)];
    else if (!normal.length) groups = [group('pickup', lines, true)];
    else if (bulky.length) groups = [group('shuttle', normal, false), group('pickup', bulky, true)];
    else groups = [group('shuttle', lines, false)];
    return { groups, bulky, shOpts, pickOpts, closedToday: shOpts.some(o => o.today && o.disabled), total: groups.reduce((a, g) => a + g.amount, 0) };
  }
  const groupLabel = g => `${g.method === 'shuttle' ? g.place : 'PX 픽업대'} · ${Store.dayLabel(g.dlvDate)} ${U.hm(g.slot)}${g.method === 'shuttle' ? ' 회차' : ''}`;

  function cartView(s) {
    const lines = Store.cartLines(s.id);
    if (!lines.length) return subHead('장바구니', 'home') + `<div class="empty"><div class="empty-ico">🛒</div><p>장바구니가 비어 있습니다</p><button class="btn primary" data-act="s-tab" data-tab="home">상품 보러 가기</button></div>`;
    const plan = buildPlan(s, lines);
    const lineHtml = lines.map(l => `<div class="cline">
        <div class="cimg" style="background:${bg(l.p)}">${l.p.emoji}</div>
        <div class="cinfo"><div class="cname">${l.p.name}${l.p.pickupOnly ? ' <span class="bdg pick">픽업전용</span>' : ''}${l.info.discount ? ' <span class="bdg sale">할인</span>' : ''}</div>
          <div class="cprice">${U.won(l.info.price)} × ${l.qty} = <b>${U.won(l.info.price * l.qty)}</b></div>
          <div class="cctl">${stepper('s-qty', l.p.id, l.qty, l.p.stock)}<button class="link" data-act="s-remove" data-pid="${l.p.id}">삭제</button></div></div>
      </div>`).join('');
    const pickSel = label => `<label class="flabel">${label}</label><select class="fsel" data-change="s-pickup">${plan.pickOpts.map(o => `<option value="${o.key}"${o.key === ui.pickupKey ? ' selected' : ''}>${o.label}</option>`).join('')}</select>`;
    let opts;
    if (ui.method === 'shuttle') {
      const cur = plan.shOpts.find(o => o.key === ui.roundKey);
      opts = `<label class="flabel">배송지 (생활관별 무인배송창고)</label>
        <select class="fsel" data-change="s-warehouse">${WAREHOUSES.map(w => `<option${w === ui.warehouse ? ' selected' : ''}>${w}</option>`).join('')}</select>
        <label class="flabel">배송 회차 <small>회차 30분 전 주문 마감</small></label>
        <div class="rounds">${plan.shOpts.map(o => `<button class="round${o.key === ui.roundKey ? ' on' : ''}" ${o.disabled ? 'disabled' : ''} data-act="s-round" data-key="${o.key}"><b>${o.label}</b><small>${o.sub}</small></button>`).join('')}</div>
        ${plan.closedToday ? `<div class="note">⏱️ 마감된 회차는 선택할 수 없어 다음 회차(<b>${cur.label}</b>)로 자동 안내합니다.</div>` : ''}
        ${plan.bulky.length ? `<div class="warnbox"><b>📦 픽업전용 상품 자동 분리</b><p>${plan.bulky.map(l => l.p.name).join(', ')}은(는) 부피가 커서 셔틀로 배송하지 않습니다. <b>PX 픽업 주문으로 자동 분리</b>됩니다.</p>${pickSel('분리된 픽업 주문 수령 시간')}</div>` : ''}`;
    } else {
      opts = pickSel('픽업 희망 시간 (12:00~21:00, 30분 단위)') + '<div class="note">🛍️ 판매원이 없어도 PX 픽업대 QR 단말로 수령합니다.</div>';
    }
    return subHead('장바구니', 'home') + `<div class="p-pad">${lineHtml}
        <h4 class="sec">수령 방식</h4>
        <div class="seg">
          <button class="${ui.method === 'shuttle' ? 'on' : ''}" data-act="s-method" data-m="shuttle"><b>🚐 무인셔틀</b><small>생활관 무인배송창고</small></button>
          <button class="${ui.method === 'pickup' ? 'on' : ''}" data-act="s-method" data-m="pickup"><b>🛍️ PX 픽업</b><small>원하는 시간에 픽업대</small></button>
        </div>
        ${opts}
        <h4 class="sec">주문 요약</h4>${summaryBox(plan)}
      </div>
      <div class="p-cta"><button class="btn primary block lg" data-act="s-tab" data-tab="pay">결제하기 · ${U.won(plan.total)}</button></div>`;
  }

  function summaryBox(plan, detail) {
    return `<div class="sumbox">${plan.groups.map((g, i) => `<div class="sumrow">
        <div class="sumtop"><span><span class="tag ${g.method}">${g.method === 'shuttle' ? '셔틀' : '픽업'}</span> 주문 ${i + 1}${g.split ? ' · 자동 분리' : ''}</span><b>${U.won(g.amount)}</b></div>
        <small>${groupLabel(g)}</small>
        ${detail ? `<small class="items">${g.items.map(it => `${it.p.emoji} ${it.p.name} x${it.qty}`).join(' · ')}</small>` : ''}
      </div>`).join('')}<div class="sumtotal"><span>결제 금액</span><b>${U.won(plan.total)}</b></div></div>`;
  }

  /* ---------- U4 결제 ---------- */
  function payView(s) {
    if (ui.payStage === 'done') return payDone();
    if (ui.payStage === 'paying') return subHead('결제') + `<div class="paying"><div class="spinner"></div><b>${ui.payingLabel} 승인 요청 중…</b><small>모의 결제 · 실제 결제는 이루어지지 않습니다</small></div>`;
    const lines = Store.cartLines(s.id);
    if (!lines.length) return cartView(s);
    const plan = buildPlan(s, lines), pay = ui.pay || s.pay;
    const methods = [
      ['나라사랑카드', '💳', `나라사랑카드 ****-${s.id.slice(-4)}`, '본인 명의 등록 카드'],
      ['간편결제', '📲', '군 복지 간편결제', '휴대폰 간편 인증'],
    ];
    return subHead('결제', 'cart') + `<div class="p-pad">
        <h4 class="sec">주문 내역</h4>${summaryBox(plan, true)}
        <h4 class="sec">결제 수단</h4>
        ${methods.map(([k, ico, t, sub]) => `<button class="paym${pay === k ? ' on' : ''}" data-act="s-paymethod" data-m="${k}"><span class="paym-ico">${ico}</span><span class="paym-txt"><b>${t}</b><small>${sub}${s.pay === k ? ' · 기본 결제수단' : ''}</small></span><i class="radio"></i></button>`).join('')}
        ${ui.err ? `<div class="err">${ui.err}</div>` : ''}
        <div class="note">🔒 모의 결제 연계 화면입니다. 결제가 끝나면 주문별 수령용 QR코드가 생성됩니다.</div>
      </div>
      <div class="p-cta"><button class="btn primary block lg" data-act="s-pay">${U.won(plan.total)} 결제하기</button></div>`;
  }

  function payDone() {
    const orders = ui.lastIds.map(Store.order).filter(Boolean);
    return subHead('결제 완료') + `<div class="p-pad center">
        <div class="done-ico">✅</div><h3>결제가 완료되었습니다</h3>
        <p class="muted">${orders.length > 1 ? `픽업전용 상품이 분리되어 주문 ${orders.length}건이 생성되었습니다.` : '수령할 때 아래 QR코드를 단말에 대세요.'}</p>
        ${orders.map(o => `<div class="qrcard">${QR.svg(o.qr)}<div><b>${o.id}</b><small>${Store.placeLabel(o)}</small><small>${Store.itemsText(o)} · ${U.won(o.amount)}</small></div></div>`).join('')}
        <button class="btn primary block" data-act="s-tab" data-tab="orders">내 주문에서 확인</button>
        <button class="btn ghost block" data-act="s-tab" data-tab="home">쇼핑 계속하기</button>
      </div>`;
  }

  /* ---------- U5 내 주문·QR ---------- */
  function ordersView(s) {
    const list = st().orders.filter(o => o.sid === s.id).sort((a, b) => b.createdAt - a.createdAt);
    return subHead('내 주문') + `<div class="p-pad">${list.length ? list.map(orderCard).join('') : '<div class="empty"><div class="empty-ico">🧾</div><p>주문 내역이 없습니다</p></div>'}</div>`;
  }

  function orderCard(o) {
    const flow = Store.flowOf(o), idx = flow.indexOf(o.status);
    const canNext = o.method !== 'mobile' && idx >= 0 && idx < flow.length - 2;
    const ready = (o.method === 'shuttle' && o.status === '창고도착') || (o.method === 'pickup' && o.status === '준비중');
    const steps = o.method === 'mobile' || o.status === '취소' ? ''
      : `<div class="steps">${flow.map((f, i) => `<div class="step${i < idx ? ' done' : i === idx ? ' cur' : ''}"><i></i><span>${f}</span></div>`).join('')}</div>`;
    const tag = o.method === 'shuttle' ? '셔틀' : o.method === 'pickup' ? '픽업' : '현장구매';
    return `<div class="ocard${ready ? ' ready' : ''}${o.status === '취소' ? ' cancelled' : ''}">
      <div class="ohead"><span><span class="tag ${o.method}">${tag}</span> <b>${o.id}</b></span>${statusBadge(o.status)}</div>
      <div class="oitems">${o.items.map(it => `${it.emoji} ${it.name} x${it.qty}`).join(' · ')}</div>
      <div class="ometa">${U.won(o.amount)} · ${o.pay}<br>${Store.placeLabel(o)}</div>
      ${steps}
      ${ready ? `<div class="oready">${o.method === 'shuttle' ? '📦 창고에 도착했습니다. QR로 수령하세요' : '🛍️ 픽업대에 준비되었습니다. QR로 수령하세요'}</div>` : ''}
      ${o.receivedAt ? `<div class="ometa small">수령 ${U.stamp(o.receivedAt)}</div>` : ''}
      <div class="oacts">
        ${o.qr && o.status !== '취소' ? `<button class="btn sm${ready ? ' primary' : ''}" data-act="s-qr" data-id="${o.id}">▦ QR 보기</button>` : ''}
        ${canNext ? `<button class="btn sm ghost" data-act="s-next" data-id="${o.id}" title="시연용 상태 진행">다음 단계로 ▶</button>` : ''}
        ${o.status === '접수' ? `<button class="btn sm danger-ghost" data-act="s-cancel" data-id="${o.id}">주문 취소</button>` : ''}
      </div>
    </div>`;
  }

  function qrModal() {
    const o = Store.order(ui.qrId);
    if (!o) return '';
    const used = o.status === '수령완료';
    return `<div class="p-modal" data-act="s-qr-close"><div class="p-sheet" data-stop>
      <div class="sheet-head"><b>수령용 QR코드</b><button class="icon-btn" data-act="s-qr-close" aria-label="닫기">✕</button></div>
      <div class="qr-big${used ? ' used' : ''}">${QR.svg(o.qr)}${used ? '<div class="stamp">수령완료</div>' : ''}</div>
      <div class="center"><b>${o.id}</b><div class="muted">${Store.placeLabel(o)}</div><div class="mt8">${statusBadge(o.status)}</div>
        <p class="muted small">${o.method === 'pickup' ? 'PX 픽업대' : o.place} 단말에 QR을 대면 수령이 완료됩니다.</p></div>
    </div></div>`;
  }

  function noticeModal(s) {
    const list = st().notices.filter(n => n.sid === s.id).slice().reverse();
    return `<div class="p-modal" data-act="s-notices-close"><div class="p-sheet" data-stop>
      <div class="sheet-head"><b>알림</b><button class="icon-btn" data-act="s-notices-close" aria-label="닫기">✕</button></div>
      <div class="nlist">${list.length ? list.map(n => `<div class="nitem"><span>${n.text}</span><small>${U.stamp(n.at)}</small></div>`).join('') : '<p class="muted center">새 알림이 없습니다</p>'}</div>
    </div></div>`;
  }

  /* ---------- 이동 PX ---------- */
  function mobileView(s) {
    const v = st().vehicle, ST = SPX_DATA.STOPS, mine = SPX_DATA.BARRACKS_STOP[s.barracks], myStop = ST[mine];
    const round = SPX_DATA.VEH_ROUNDS[v.round];
    let eta;
    if (v.status === '중지') eta = '운행이 중지되어 도착 시각을 안내할 수 없습니다.';
    else if (v.status === '정차' && v.stopIdx === mine) eta = `<b>지금 ${myStop.name}에 정차 중!</b> (10분 정차)`;
    else if (v.status === '운행' && v.stopIdx === mine) eta = `<b>곧 도착</b> · 다음 정차지가 ${myStop.name}입니다`;
    else if (v.status === '복귀' || v.stopIdx > mine) eta = v.round === 0 ? `이번 회차는 지나갔습니다 · 다음 회차 <b>${U.hm(Store.vehEta(mine, 1))}</b> 도착 예정` : `오늘 운행이 끝났습니다 · 내일 <b>${U.hm(Store.vehEta(mine, 0))}</b> 도착 예정`;
    else eta = `<b>${mine - v.stopIdx}정거장</b> 남음 · <b>${U.hm(Store.vehEta(mine))}</b> 도착 예정`;
    const alertOn = !!v.alerts[s.id];
    const canOpen = v.status === '정차';
    return subHead('이동 PX') + `<div class="p-pad">
      <div class="veh-card">
        <div class="veh-top"><b>🚚 ${v.name}</b><span class="vpill v-${v.status}">${vehStatusLabel(v)}</span></div>
        <div class="veh-sub">${v.round + 1}회차 ${round.label} 출발 · 현재 <b>${ST[v.stopIdx].name}</b> · 🔋 ${v.battery}%</div>
        ${routeMapSVG(mine)}
      </div>
      ${v.status === '중지' ? '<div class="errbox">⛔ 기상·안전 사유로 운행이 중지되었습니다. 진열장 문 열기가 비활성화됩니다.</div>' : ''}
      <div class="eta-box"><div>★ 내 생활관 앞 (${myStop.name})</div><div>${eta}</div></div>
      <button class="toggle-row" data-act="s-alert"><span>🔔 내 생활관 앞 도착 알림</span><i class="switch${alertOn ? ' on' : ''}"></i></button>
      <h4 class="sec">차량 적재 상품 <small>남은 수량</small></h4>
      <div class="load-grid">${v.load.map(l => { const p = Store.product(l.pid); return `<div class="load-item${l.qty === 0 ? ' empty' : ''}"><span class="li-emo" style="background:${bg(p)}">${p.emoji}</span><span class="li-name">${p.name}</span><small>${U.won(p.price)}</small><b>${l.qty}개</b></div>`; }).join('')}</div>
      <div class="note">차량 측면 단말에 개인 QR을 대면 진열장 문이 열립니다. 꺼낸 상품은 문을 닫을 때 자동 결제됩니다.</div>
    </div>
    <div class="p-cta"><button class="btn primary block lg" data-act="s-m-open" ${canOpen ? '' : 'disabled'}>${canOpen ? '📱 QR로 진열장 문 열기' : v.status === '중지' ? '운행 중지 · 문 열기 불가' : '차량 정차 시 이용 가능'}</button></div>`;
  }

  function mobileModal(s) {
    const m = ui.mobile, v = st().vehicle, stop = SPX_DATA.STOPS[v.stopIdx];
    let body;
    if (m.step === 'qr') {
      body = `<div class="center"><p class="muted">${stop.name} · ${v.name}</p>
        <div class="qr-big">${QR.svg(`SPX-M|${s.id}|${v.name}`)}</div>
        <p>차량 측면 단말에 개인 QR을 대세요</p>
        <button class="btn primary block" data-act="s-m-tag">단말에 태그 (시연)</button></div>`;
    } else if (m.step === 'open') {
      const total = Object.entries(m.picks).reduce((a, [pid, q]) => a + Store.product(pid).price * q, 0);
      body = `<div class="door-open">🔓 진열장 문이 열렸습니다</div>
        <p class="muted small">꺼낸 상품을 선택하세요 (실제 차량은 무게·카메라 센서로 자동 인식)</p>
        <div class="pick-list">${v.load.map(l => { const p = Store.product(l.pid), q = m.picks[l.pid] || 0; return `<div class="pick-row${l.qty === 0 ? ' empty' : ''}"><span>${p.emoji} ${p.name}<small>${U.won(p.price)} · 남은 ${l.qty}개</small></span>${l.qty ? stepper('s-m-qty', l.pid, q, l.qty) : '<small>소진</small>'}</div>`; }).join('')}</div>
        ${m.err ? `<div class="err">${m.err}</div>` : ''}
        <button class="btn primary block lg" data-act="s-m-pay" ${total ? '' : 'disabled'}>🚪 문 닫기 · ${U.won(total)} 자동결제</button>`;
    } else if (m.step === 'paying') {
      body = `<div class="paying"><div class="spinner"></div><b>문 닫힘 · 꺼낸 상품 확인 중…</b><small>${s.pay} 자동결제 (모의)</small></div>`;
    } else {
      const o = Store.order(m.orderId);
      body = `<div class="center"><div class="done-ico">🧾</div><h3>자동결제 완료</h3>
        <p>${Store.itemsText(o)}</p><p><b>${U.won(o.amount)}</b> · ${o.pay}</p>
        <p class="muted small">${o.id} · 내 주문에 현장 구매로 기록되었습니다</p>
        <button class="btn primary block" data-act="s-m-close">확인</button></div>`;
    }
    const closable = m.step !== 'paying';
    return `<div class="p-modal"${closable ? ' data-act="s-m-close"' : ''}><div class="p-sheet tall" data-stop>
      <div class="sheet-head"><b>이동 PX 무인결제</b>${closable ? '<button class="icon-btn" data-act="s-m-close" aria-label="닫기">✕</button>' : ''}</div>${body}</div></div>`;
  }

  function navView(s) {
    const c = cartCount(s);
    const ready = st().orders.filter(o => o.sid === s.id && ((o.method === 'shuttle' && o.status === '창고도착') || (o.method === 'pickup' && o.status === '준비중'))).length;
    const items = [['home', '🏠', '홈', 0], ['cart', '🛒', '장바구니', c], ['orders', '🧾', '내 주문', ready], ['mobile', '🚚', '이동 PX', 0]];
    return `<nav class="p-nav">${items.map(([t, ico, label, n]) => `<button class="${ui.tab === t || (t === 'cart' && ui.tab === 'pay') ? 'on' : ''}" data-act="s-tab" data-tab="${t}"><span>${ico}${n ? `<i>${n}</i>` : ''}</span>${label}</button>`).join('')}</nav>`;
  }

  /* ---------- 동작 ---------- */
  const actions = {
    's-fill': el => { Binds.lgId = el.dataset.id; Binds.lgPin = el.dataset.pin; ui.err = ''; },
    's-login': () => {
      if (!Store.login(Binds.lgId || '', Binds.lgPin || '')) { ui.err = '군번 또는 PIN이 올바르지 않습니다.'; return; }
      Binds.lgPin = '';
      ui.tab = 'home';
      resetCheckout();
    },
    's-logout': () => { Store.logout(); Object.assign(ui, { tab: 'home', qrId: null, notices: false, mobile: null }); },
    's-tab': el => {
      ui.tab = el.dataset.tab;
      ui.notices = false;
      if (ui.tab === 'pay' && ui.payStage !== 'paying') ui.payStage = 'form';
      if (ui.tab !== 'pay') ui.err = '';
    },
    's-cat': el => { ui.cat = el.dataset.cat; },
    's-qty': el => Store.addToCart(me().id, el.dataset.pid, +el.dataset.d),
    's-remove': el => Store.removeFromCart(me().id, el.dataset.pid),
    's-method': el => { ui.method = el.dataset.m; },
    's-round': el => { ui.roundKey = el.dataset.key; },
    's-paymethod': el => { ui.pay = el.dataset.m; },
    's-pay': () => {
      const s = me(), plan = buildPlan(s, Store.cartLines(s.id));
      const groups = plan.groups.map(g => ({ method: g.method, place: g.place, dlvDate: g.dlvDate, slot: g.slot, split: g.split, items: g.items.map(it => ({ pid: it.pid, qty: it.qty })) }));
      const pay = ui.pay || s.pay;
      ui.payStage = 'paying';
      ui.payingLabel = pay;
      ui.err = '';
      setTimeout(() => {
        const res = Store.placeOrders(s.id, groups, pay);
        if (res.error) { ui.payStage = 'form'; ui.err = res.error; } else { ui.payStage = 'done'; ui.lastIds = res.orders.map(o => o.id); }
        App.render();
      }, 1500);
    },
    's-qr': el => { ui.qrId = el.dataset.id; },
    's-qr-close': () => { ui.qrId = null; },
    's-next': el => Store.nextStep(el.dataset.id),
    's-cancel': el => Store.cancelOrder(el.dataset.id),
    's-notices': () => { ui.notices = true; Store.markNoticesRead(me().id); },
    's-notices-close': () => { ui.notices = false; },
    's-alert': () => Store.vehToggleAlert(me().id),
    's-m-open': () => { ui.mobile = { step: 'qr', picks: {}, err: '' }; },
    's-m-tag': () => { ui.mobile.step = 'open'; },
    's-m-qty': el => {
      const m = ui.mobile, l = st().vehicle.load.find(x => x.pid === el.dataset.pid);
      m.picks[l.pid] = Math.max(0, Math.min(l.qty, (m.picks[l.pid] || 0) + +el.dataset.d));
    },
    's-m-pay': () => {
      const s = me(), m = ui.mobile;
      m.step = 'paying';
      setTimeout(() => {
        const res = Store.mobilePurchase(s.id, m.picks, s.pay);
        if (res.error) { m.step = 'open'; m.err = res.error; } else { m.step = 'done'; m.orderId = res.order.id; }
        App.render();
      }, 1200);
    },
    's-m-close': () => { ui.mobile = null; },
  };
  const changes = {
    's-warehouse': el => { ui.warehouse = el.value; },
    's-pickup': el => { ui.pickupKey = el.value; },
  };

  // 시연 가이드 체크 (화면 왼쪽 패널)
  function progress() {
    const sid = st().session.soldierId || st().soldiers[0].id;
    const today = U.dateStr(st().now);
    const mine = st().orders.filter(o => o.sid === sid && U.dateStr(o.createdAt) === today && o.method !== 'mobile');
    return {
      login: !!st().session.soldierId,
      cart: cartCount({ id: sid }) > 0 || mine.length > 0,
      shuttle: mine.some(o => o.method === 'shuttle') || (ui.method === 'shuttle' && cartCount({ id: sid }) > 0 && ['cart', 'pay'].includes(ui.tab)),
      paid: mine.length > 0,
      arrived: mine.some(o => ['창고도착', '수령완료'].includes(o.status) && o.method === 'shuttle'),
      received: mine.some(o => o.status === '수령완료'),
    };
  }

  return { ui, render, actions, changes, progress, resetCheckout };
})();
