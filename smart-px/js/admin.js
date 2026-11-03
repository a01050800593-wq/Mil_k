/* 관리자 콘솔 (PRD 8.2 A1~A5 + 16장 이동 PX 관제) */
const AdminUI = (() => {
  const ui = { tab: 'dash', filter: '전체', actType: '전체', roundKey: null, scanSel: null, scanPlace: PICKUP_PLACE, scanning: false, result: null, err: '', cam: null };
  const st = () => Store.state;
  const card = (title, body, opts = {}) => `<section class="card ${opts.cls || ''}"><div class="card-head"><h3>${title}</h3>${opts.right || ''}</div>${body}</section>`;
  const who = sid => { const s = Store.soldier(sid); return s ? `${s.rank} ${s.name}` : sid; };
  const today = () => U.dateStr(st().now);
  const readyOrders = () => st().orders.filter(o => (o.method === 'shuttle' && o.status === '창고도착') || (o.method === 'pickup' && o.status === '준비중'));

  function render() {
    if (!st().session.admin) return loginView();
    const s = Store.stats();
    const nav = [
      ['dash', '📊', '대시보드', 0],
      ['inv', '📦', '재고 현황', s.low.length],
      ['act', '🤖', '발주·재고처리', s.pendingPO + s.pendingDispose],
      ['scan', '📷', 'QR 수령 처리', readyOrders().length],
      ['mobile', '🚚', '이동 PX', 0],
    ];
    const pages = { dash: dashView, inv: invView, act: actView, scan: scanView, mobile: mobileView };
    return `<div class="admin">
      <aside class="a-side">
        <div class="a-brand"><div class="logo">PX</div><div><b>스마트 PX</b><small>관리자 콘솔</small></div></div>
        <nav>${nav.map(([t, ico, label, n]) => `<button class="${ui.tab === t ? 'on' : ''}" data-act="a-tab" data-tab="${t}"><span>${ico}</span><em>${label}</em>${n ? `<i>${n}</i>` : ''}</button>`).join('')}</nav>
        <div class="a-user"><b>PX 관리관</b><small>시범부대 ○○대대</small><button class="link" data-act="a-logout">로그아웃</button></div>
      </aside>
      <div class="a-main" data-scroll-key="a-${ui.tab}">${pages[ui.tab]()}</div>
    </div>`;
  }

  /* ---------- A1 로그인 ---------- */
  function loginView() {
    return `<div class="a-login"><div class="a-login-card">
      <div class="a-brand big"><div class="logo">PX</div><div><b>스마트 PX 관리자</b><small>재고·주문·배송 관리</small></div></div>
      <label class="flabel" for="alId">관리자 ID</label>
      <input id="alId" class="finput" data-bind="alId" value="${U.esc(Binds.alId || '')}" placeholder="admin" autocomplete="off">
      <label class="flabel" for="alPin">PIN</label>
      <input id="alPin" class="finput" type="password" data-bind="alPin" value="${U.esc(Binds.alPin || '')}" maxlength="4" placeholder="••••" data-enter="a-login">
      ${ui.err ? `<div class="err">${ui.err}</div>` : ''}
      <button class="btn primary block lg" data-act="a-login">로그인</button>
      <button class="sample" data-act="a-fill"><span>시연용 관리자 계정 (눌러서 입력)</span><small>admin / 0000</small></button>
    </div></div>`;
  }

  /* ---------- A2 대시보드 ---------- */
  function dashView() {
    const s = Store.stats(), lc = st().lastCheck;
    const byMethod = m => s.orders.filter(o => o.method === m).length;
    const disc = s.expiring.filter(p => Store.info(p).discount).length;
    const kpis = [
      ['🧾', '오늘 주문', `${s.orders.length}건`, `셔틀 ${byMethod('shuttle')} · 픽업 ${byMethod('pickup')} · 이동PX ${byMethod('mobile')}`, ''],
      ['💰', '오늘 매출', U.won(s.sales), `건당 평균 ${U.won(s.orders.length ? Math.round(s.sales / s.orders.length / 10) * 10 : 0)}`, ''],
      ['⚠️', '재고 부족', `${s.low.length}건`, `자동 발주 진행 ${s.pendingPO}건`, 'warn'],
      ['⏰', '유통기한 임박', `${s.expiring.length}건`, `할인 ${disc} · 폐기대상 ${s.expiring.length - disc}`, 'danger'],
    ];
    return `<div class="a-title"><h2>대시보드</h2><span class="muted">${U.md(today())}(${U.dow(today())}) ${U.time(st().now)} 기준</span></div>
      <div class="alert-banner">
        <div class="ab-icon">📢</div>
        <div class="ab-text"><div class="ab-title">일일 재고 알림 <small>${U.stamp(lc.at)} 자동 점검 · 실시간 반영</small></div>
          <div class="ab-body">재고 부족 <b>${s.low.length}건</b> · 유통기한 임박 <b>${s.expiring.length}건</b> · 오늘 주문 <b>${s.orders.length}건</b></div></div>
        <div class="ab-acts"><button class="btn sm" data-act="a-tab" data-tab="inv" data-filter="부족">부족 품목</button><button class="btn sm" data-act="a-tab" data-tab="inv" data-filter="임박">임박 품목</button></div>
      </div>
      <div class="kpis">${kpis.map(([ico, t, v, sub, cls]) => `<div class="kpi ${cls}"><div class="kpi-ico">${ico}</div><div><small>${t}</small><b>${v}</b><span>${sub}</span></div></div>`).join('')}</div>
      <div class="grid2">
        ${card('생활관별 셔틀 배송 현황', shuttleBoard(), { right: '<span class="muted small">오늘 · 12:30 / 18:00 / 21:00</span>' })}
        ${card('자동 처리 알림', feed(), { right: '<button class="link" data-act="a-tab" data-tab="act">전체 내역 ›</button>' })}
      </div>
      ${card('회차별 출고 목록', dispatch())}
      ${card('최근 주문', recentOrders())}`;
  }

  function roundPhase(min) {
    const t = U.at(today(), min), now = st().now;
    if (now < t - 30 * MIN) return `<span class="ph ph-open">${U.hm(min - 30)} 마감</span>`;
    if (now < t) return '<span class="ph ph-prep">출고 준비</span>';
    if (now < t + 10 * MIN) return '<span class="ph ph-move">배송중</span>';
    return '<span class="ph ph-done">도착</span>';
  }

  function shuttleBoard() {
    const sh = st().orders.filter(o => o.method === 'shuttle' && o.dlvDate === today() && o.status !== '취소');
    const short = { 접수: '접수', 준비중: '준비', 배송중: '배송', 창고도착: '도착', 수령완료: '수령' };
    const rows = BARRACKS.map(b => `<tr><th>${b}</th>${ROUNDS.map(r => {
      const list = sh.filter(o => o.place.startsWith(b) && o.slot === r.min);
      if (!list.length) return '<td class="dim">—</td>';
      const cnt = SHUTTLE_FLOW.map(f => [f, list.filter(o => o.status === f).length]).filter(([, n]) => n);
      return `<td><b>${list.length}건</b><small>${cnt.map(([f, n]) => `${short[f]} ${n}`).join(' · ')}</small></td>`;
    }).join('')}</tr>`).join('');
    return `<div class="tbl-wrap"><table class="tbl board"><thead><tr><th>생활관 창고</th>${ROUNDS.map(r => `<th>${r.label} 회차<br>${roundPhase(r.min)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const ACT_ICON = { 자동발주: '🤖', 입고: '📦', 할인: '🏷️', 폐기: '🗑️', 차량보충: '🚚' };
  function actPill(a) {
    const cls = { 발주중: 'b-amber', 입고완료: 'b-done', 처리완료: 'b-done', 처리대기: 'b-red' }[a.status] || 'b-gray';
    return `<span class="sbadge ${cls}">${a.status}</span>`;
  }
  function feed() {
    const list = st().actions.slice().sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, 7);
    return `<div class="feed">${list.map(a => `<div class="feed-item"><span class="fi-ico">${ACT_ICON[a.type]}</span><div><b>${a.type} · ${a.name} ${a.qty}개</b><small>${a.reason}</small></div><div class="fi-right">${actPill(a)}<small>${U.stamp(a.at)}</small></div></div>`).join('')}</div>`;
  }

  function dispatch() {
    const t = today(), now = st().now;
    const keys = ROUNDS.map(r => r.min);
    if (!keys.includes(ui.roundKey)) ui.roundKey = (ROUNDS.find(r => U.at(t, r.min + 10) > now) || ROUNDS[ROUNDS.length - 1]).min;
    const list = st().orders.filter(o => o.method === 'shuttle' && o.dlvDate === t && o.slot === ui.roundKey && o.status !== '취소');
    const pickTotal = {};
    list.forEach(o => o.items.forEach(it => { pickTotal[it.name] = (pickTotal[it.name] || 0) + it.qty; }));
    const tabs = `<div class="chips">${ROUNDS.map(r => `<button class="chipbtn${r.min === ui.roundKey ? ' on' : ''}" data-act="a-round" data-min="${r.min}">${r.label} 회차 · ${st().orders.filter(o => o.method === 'shuttle' && o.dlvDate === t && o.slot === r.min && o.status !== '취소').length}건</button>`).join('')}</div>`;
    if (!list.length) return tabs + '<p class="muted pad">이 회차에 배송할 주문이 없습니다.</p>';
    const byWh = WAREHOUSES.map(w => [w, list.filter(o => o.place === w)]).filter(([, l]) => l.length);
    return tabs + `<div class="picking"><b>출고 피킹 합계</b> ${Object.entries(pickTotal).map(([n, q]) => `<span class="pk">${n} x${q}</span>`).join('')}</div>
      <div class="wh-grid">${byWh.map(([w, l]) => `<div class="wh"><div class="wh-head"><b>${w}</b><span>${l.length}건</span></div>${l.map(o => `<div class="wh-row"><span><b>${o.id.slice(-4)}</b> ${who(o.sid)}</span><small>${Store.itemsText(o)}</small>${statusBadge(o.status)}</div>`).join('')}</div>`).join('')}</div>`;
  }

  function recentOrders() {
    const list = st().orders.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>주문번호</th><th>시각</th><th>장병</th><th>품목</th><th>금액</th><th>수령</th><th>상태</th><th></th></tr></thead><tbody>
      ${list.map(o => {
        const flow = Store.flowOf(o), i = flow.indexOf(o.status), canNext = o.method !== 'mobile' && i >= 0 && i < flow.length - 2;
        return `<tr><td class="mono">${o.id}</td><td>${U.time(o.createdAt)}</td><td>${who(o.sid)}</td><td class="ellipsis">${Store.itemsText(o)}</td><td>${U.won(o.amount)}</td><td class="small">${Store.placeLabel(o)}</td><td>${statusBadge(o.status)}</td><td>${canNext ? `<button class="btn xs" data-act="a-next" data-id="${o.id}">다음 단계 ▶</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /* ---------- A3 재고 현황 ---------- */
  const FILTERS = {
    전체: () => true,
    부족: (p, i) => i.low,
    임박: (p, i) => i.discount || i.dispose,
    품절: (p, i) => i.soldout,
    정상: (p, i) => i.status === '정상',
    픽업전용: p => p.pickupOnly,
  };
  function stockBadges(p, i) {
    const cls = { 정상: 'b-green', 부족: 'b-amber', 할인: 'b-blue', 폐기대상: 'b-red', 품절: 'b-red' }[i.status];
    return `<span class="sbadge ${cls}">${i.status}</span>${i.low && i.status !== '부족' && i.status !== '품절' ? ' <span class="sbadge b-amber">부족</span>' : ''}`;
  }
  function invView() {
    const q = (Binds.invSearch || '').trim();
    const rows = st().products.filter(p => FILTERS[ui.filter](p, Store.info(p)) && (!q || p.name.includes(q)));
    const pending = {};
    st().actions.forEach(a => { if (a.type === '자동발주' && a.status === '발주중') pending[a.pid] = a; });
    const now = Date.now();
    return `<div class="a-title"><h2>재고 현황</h2><span class="muted">상품 ${st().products.length}종 · 주문 시 즉시 차감</span></div>
      <div class="toolbar">
        <div class="chips">${Object.keys(FILTERS).map(f => `<button class="chipbtn${f === ui.filter ? ' on' : ''}" data-act="a-filter" data-filter="${f}">${f} <small>${st().products.filter(p => FILTERS[f](p, Store.info(p))).length}</small></button>`).join('')}</div>
        <input id="invSearch" class="finput sm" data-bind="invSearch" value="${U.esc(Binds.invSearch || '')}" placeholder="상품명 검색">
      </div>
      <section class="card"><div class="tbl-wrap"><table class="tbl inv"><thead><tr><th>상품</th><th>카테고리</th><th>판매가</th><th>현재고</th><th>안전 / 적정</th><th>유통기한</th><th>상태</th><th>작업</th></tr></thead><tbody>
      ${rows.map(p => {
        const i = Store.info(p), po = pending[p.id];
        const pct = Math.min(100, p.stock / p.optimal * 100), safePct = p.safety / p.optimal * 100;
        const act = i.dispose ? `<button class="btn xs danger" data-act="a-dispose" data-pid="${p.id}">폐기 완료</button>`
          : po ? `<button class="btn xs primary" data-act="a-receive" data-id="${po.id}">입고 처리 +${po.qty}</button>` : '<span class="muted">—</span>';
        return `<tr class="${now - (Store.flash[p.id] || 0) < 3000 ? 'flash' : ''}${i.dispose ? ' row-dispose' : ''}">
          <td><span class="emo" style="background:${SPX_DATA.CAT_RULE[p.cat].bg}">${p.emoji}</span><b>${p.name}</b> <small class="muted">${p.id}</small>${p.pickupOnly ? ' <span class="bdg pick">픽업전용</span>' : ''}</td>
          <td>${p.cat}</td>
          <td>${i.discount ? `<s class="muted">${U.won(p.price)}</s><br><b class="sale">${U.won(i.price)}</b>` : U.won(p.price)}</td>
          <td><div class="stockcell"><b class="${i.low ? 'warn-t' : ''}">${p.stock}</b><div class="bar"><i class="${i.low ? 'low' : ''}" style="width:${pct}%"></i><em style="left:${safePct}%"></em></div></div></td>
          <td>${p.safety} / ${p.optimal}</td>
          <td>${p.expiry ? `${U.md(p.expiry)} <span class="dd ${i.dday <= 1 ? 'dd-red' : i.dday <= 7 ? 'dd-amber' : ''}">D-${Math.max(0, i.dday)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${stockBadges(p, i)}${po ? '<br><small class="muted">발주중</small>' : ''}</td>
          <td>${act}</td></tr>`;
      }).join('')}</tbody></table>${rows.length ? '' : '<p class="muted pad">조건에 맞는 상품이 없습니다.</p>'}</div></section>`;
  }

  /* ---------- A4 자동 발주·재고처리 내역 ---------- */
  function actView() {
    const s = Store.stats();
    const all = st().actions.slice().sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    const pos = all.filter(a => a.type === '자동발주');
    const types = ['전체', '할인', '폐기', '입고', '차량보충'];
    const logs = all.filter(a => a.type !== '자동발주' && (ui.actType === '전체' || a.type === ui.actType));
    const t = today();
    return `<div class="a-title"><h2>자동 발주·재고처리</h2><span class="muted">규칙 기반 자동 처리 · 외부 발주 전송 없음(시연)</span></div>
      <div class="kpis small">
        <div class="kpi warn"><div class="kpi-ico">🤖</div><div><small>발주중</small><b>${s.pendingPO}건</b></div></div>
        <div class="kpi"><div class="kpi-ico">📦</div><div><small>오늘 입고</small><b>${all.filter(a => a.type === '입고' && U.dateStr(a.at) === t).length}건</b></div></div>
        <div class="kpi"><div class="kpi-ico">🏷️</div><div><small>할인 적용 중</small><b>${st().products.filter(p => Store.info(p).discount).length}종</b></div></div>
        <div class="kpi danger"><div class="kpi-ico">🗑️</div><div><small>폐기 대기</small><b>${s.pendingDispose}건</b></div></div>
      </div>
      ${card('자동 발주 목록', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>처리ID</th><th>일시</th><th>품목</th><th>수량</th><th>사유</th><th>상태</th><th>작업</th></tr></thead><tbody>
        ${pos.map(a => `<tr><td class="mono">${a.id}</td><td>${U.stamp(a.at)}</td><td>${a.name}</td><td>${a.qty}</td><td class="small">${a.reason}</td><td>${actPill(a)}${a.doneAt ? `<br><small class="muted">${U.stamp(a.doneAt)}</small>` : ''}</td><td>${a.status === '발주중' ? `<button class="btn xs primary" data-act="a-receive" data-id="${a.id}">입고 처리</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`, { right: '<span class="muted small">발주 수량 = 적정재고 − 현재고 · 같은 품목 중복 발주 방지</span>' })}
      ${card('할인·폐기·입고 처리 내역', `<div class="chips pad-b">${types.map(k => `<button class="chipbtn${k === ui.actType ? ' on' : ''}" data-act="a-act-type" data-type="${k}">${k}</button>`).join('')}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>처리ID</th><th>일시</th><th>유형</th><th>품목</th><th>수량</th><th>사유</th><th>상태</th><th>작업</th></tr></thead><tbody>
        ${logs.map(a => `<tr><td class="mono">${a.id}</td><td>${U.stamp(a.at)}</td><td>${ACT_ICON[a.type]} ${a.type}</td><td>${a.name}</td><td>${a.qty}</td><td class="small">${a.reason}</td><td>${actPill(a)}</td><td>${a.type === '폐기' && a.status === '처리대기' ? `<button class="btn xs danger" data-act="a-dispose" data-pid="${a.pid}">폐기 완료</button>` : ''}</td></tr>`).join('')}
        </tbody></table>${logs.length ? '' : '<p class="muted pad">내역이 없습니다.</p>'}</div>`)}
      ${card('자동 처리 규칙', `<div class="rules">
        <div><b>자동 발주</b><p>현재고가 안전재고 미만이 되는 즉시 1건 생성 · 수량 = 적정재고 − 현재고 · 발주중인 품목은 중복 생성 안 함 · 익일 06:00 자동 입고</p></div>
        <div><b>안전 / 적정재고</b><p>식품·간식 15/50 · 음료 20/60 · 생활용품 5/20 · 기타 5/15</p></div>
        <div><b>유통기한</b><p>D-7 ~ D-2: 30% 자동 할인 · D-1 이하: 판매 중지(복지몰 비노출), 폐기 대상</p></div>
      </div>`)}`;
  }

  /* ---------- A5 QR 수령 처리 ---------- */
  function scanView() {
    const ready = readyOrders().sort((a, b) => a.createdAt - b.createdAt);
    const coming = st().orders.filter(o => o.method === 'shuttle' && ['접수', '준비중', '배송중'].includes(o.status)).sort((a, b) => U.at(a.dlvDate, a.slot) - U.at(b.dlvDate, b.slot));
    const pickWait = st().orders.filter(o => o.method === 'pickup' && o.status === '접수');
    const row = (o, dim) => `<button class="srow${ui.scanSel === o.id ? ' on' : ''}${dim ? ' dim' : ''}" data-act="a-scan-select" data-id="${o.id}">
        <span><b>${o.id}</b> ${who(o.sid)}</span><small>${o.method === 'pickup' ? 'PX 픽업대' : o.place} · ${Store.dayLabel(o.dlvDate)} ${U.hm(o.slot)}</small>${statusBadge(o.status)}</button>`;
    const sel = ui.scanSel ? Store.order(ui.scanSel) : null;
    const r = ui.result;
    const camOk = 'BarcodeDetector' in window && navigator.mediaDevices;
    return `<div class="a-title"><h2>QR 수령 처리</h2><span class="muted">픽업대·생활관 창고 단말 역할</span></div>
      <div class="scan-grid">
        ${card('수령 대기 주문', `<div class="slist">
          <div class="sgroup">수령 가능 (${ready.length})</div>${ready.map(o => row(o)).join('') || '<p class="muted pad">수령 가능한 주문이 없습니다.</p>'}
          <div class="sgroup">셔틀 도착 전 (${coming.length})</div>${coming.slice(0, 12).map(o => row(o, true)).join('')}
          <div class="sgroup">픽업 준비 전 (${pickWait.length})</div>${pickWait.slice(0, 8).map(o => row(o, true)).join('')}
        </div>`, { right: '<span class="muted small">주문을 고르면 해당 단말 QR이 대기합니다</span>' })}
        <section class="terminal">
          <div class="term-head"><span>📟 무인 수령 단말</span>
            <select class="fsel dark" data-change="a-scan-place">${SCAN_PLACES.map(p => `<option${p === ui.scanPlace ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="viewfinder${ui.scanning ? ' scanning' : ''}">
            ${ui.cam ? '<video id="camVideo" playsinline muted></video>'
              : sel && sel.qr ? `<div class="vf-qr">${QR.svg(sel.qr)}</div>` : '<div class="vf-empty">QR을 단말에 대세요</div>'}
            <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><div class="scanline"></div>
          </div>
          <div class="term-acts">
            <button class="btn primary lg" data-act="a-scan-go" ${sel && !ui.scanning ? '' : 'disabled'}>${ui.scanning ? '인식 중…' : sel ? `${sel.id.slice(-4)}번 QR 스캔` : '왼쪽에서 주문 선택'}</button>
            ${camOk ? `<button class="btn ghost-dark" data-act="a-scan-cam">${ui.cam ? '카메라 끄기' : '📷 카메라로 스캔'}</button>` : ''}
          </div>
          <div class="term-token"><input id="scanToken" class="finput dark" data-bind="scanToken" value="${U.esc(Binds.scanToken || '')}" placeholder="QR 값 직접 입력 (예: SPX|ORD-…)" data-enter="a-scan-token"><button class="btn ghost-dark" data-act="a-scan-token">인식</button></div>
          ${r ? `<div class="term-result ${r.ok ? 'ok' : 'fail'}"><div class="tr-ico">${r.ok ? '✅' : '⚠️'}</div><div><b>${r.title}</b><p>${r.msg}</p>${r.order ? `<small>${r.order.id} · ${Store.placeLabel(r.order)}</small>` : ''}</div></div>` : ''}
          ${ui.err ? `<div class="term-result fail"><div class="tr-ico">⚠️</div><div><p>${ui.err}</p></div></div>` : ''}
        </section>
      </div>`;
  }

  function runScan(raw) {
    ui.result = Store.scan(raw, ui.scanPlace);
    if (ui.result.ok) ui.scanSel = null;
  }

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      ui.cam = { stream };
      ui.err = '';
      App.render();
      const loop = async () => {
        if (!ui.cam) return;
        const video = document.getElementById('camVideo');
        try {
          if (video && video.readyState >= 2) {
            const codes = await det.detect(video);
            if (codes.length) { stopCam(); runScan(codes[0].rawValue); App.render(); return; }
          }
        } catch (e) { /* 프레임 인식 실패는 다음 프레임에서 재시도 */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      ui.cam = null;
      ui.err = '카메라를 사용할 수 없습니다. 주문 선택 또는 QR 값 입력으로 처리하세요.';
      App.render();
    }
  }
  function stopCam() {
    if (ui.cam) ui.cam.stream.getTracks().forEach(t => t.stop());
    ui.cam = null;
  }
  // 화면을 다시 그리면 video 요소가 새로 만들어지므로 스트림을 다시 연결
  function afterRender() {
    const video = document.getElementById('camVideo');
    if (ui.cam && video && video.srcObject !== ui.cam.stream) { video.srcObject = ui.cam.stream; video.play().catch(() => {}); }
  }

  /* ---------- 이동 PX 관제 ---------- */
  function mobileView() {
    const v = st().vehicle, ST = SPX_DATA.STOPS, round = SPX_DATA.VEH_ROUNDS[v.round];
    const sales = v.sales.filter(x => U.dateStr(x.at) === today());
    const total = sales.reduce((a, x) => a + x.amount, 0);
    const next = v.stopIdx < ST.length - 1 ? ST[v.stopIdx + 1] : null;
    const stopRows = ST.slice(1, ST.length - 1).map((p, k) => {
      const i = k + 1, list = sales.filter(x => x.stopIdx === i);
      return `<tr><td>${p.name}</td><td>${U.hm(Store.vehEta(i))}</td><td>${list.length}건</td><td>${U.won(list.reduce((a, x) => a + x.amount, 0))}</td></tr>`;
    }).join('');
    const rep = Store.replenishList();
    const canRep = (v.status === '복귀' || v.status === '대기') && rep.length;
    const nextLabel = v.status === '복귀' ? '다음 회차 준비 (충전) ▶' : v.status === '대기' ? '출발 ▶' : '다음 정차지로 ▶';
    return `<div class="a-title"><h2>이동 PX 관제</h2><span class="muted">자율주행 이동 PX · 정해진 노선 순회 (확장 구상)</span></div>
      <div class="grid2 wide-left">
        ${card('노선 관제', `<div class="map-wrap">${routeMapSVG(-1)}</div>
          <div class="ctrl-row">
            <button class="btn primary" data-act="a-veh-next" ${v.status === '운행' || v.status === '중지' ? 'disabled' : ''}>${nextLabel}</button>
            <button class="btn${v.auto ? ' on' : ''}" data-act="a-veh-auto" ${v.status === '중지' || v.status === '복귀' ? 'disabled' : ''}>자동 운행 ${v.auto ? 'ON · 12초 간격' : 'OFF'}</button>
            ${v.status === '중지' ? '<button class="btn ok" data-act="a-veh-resume">▶ 운행 재개</button>' : '<button class="btn danger" data-act="a-veh-stop">⛔ 원격 운행 중지</button>'}
          </div>`)}
        ${card('차량 상태', `<div class="vstat">
            <div><small>차량</small><b>🚚 ${v.name}</b></div>
            <div><small>운행 상태</small><b><span class="vpill v-${v.status}">${vehStatusLabel(v)}</span></b></div>
            <div><small>회차</small><b>${v.round + 1}회차 · ${round.label} 출발</b></div>
            <div><small>현재 위치</small><b>${ST[v.stopIdx].name}</b></div>
            <div><small>다음 정차지</small><b>${next ? `${next.name} (${U.hm(Store.vehEta(v.stopIdx + 1))})` : '—'}</b></div>
            <div><small>배터리</small><b><span class="batt"><i style="width:${v.battery}%" class="${v.battery < 30 ? 'low' : ''}"></i></span> ${v.battery}%</b></div>
            <div><small>오늘 현장 판매</small><b>${sales.length}건 · ${U.won(total)}</b></div>
          </div>`)}
      </div>
      <div class="grid2">
        ${card('정차 지점별 판매', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>정차 지점</th><th>도착 예정</th><th>판매 건수</th><th>금액</th></tr></thead><tbody>${stopRows}</tbody></table></div>`)}
        ${card('차량 적재 재고', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>상품</th><th>적재 기준</th><th>잔량</th><th>판매</th><th></th></tr></thead><tbody>
          ${v.load.map(l => { const p = Store.product(l.pid); return `<tr><td>${p.emoji} ${p.name}</td><td>${l.std}</td><td><b>${l.qty}</b></td><td>${l.std - l.qty}</td><td><div class="bar mini"><i class="${l.qty / l.std < 0.3 ? 'low' : ''}" style="width:${l.qty / l.std * 100}%"></i></div></td></tr>`; }).join('')}
        </tbody></table></div>`)}
      </div>
      <div class="grid2">
        ${card('복귀 시 자동 보충 목록', rep.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>상품</th><th>보충 수량</th><th>본점 재고</th><th>보충 후 본점</th></tr></thead><tbody>
            ${rep.map(l => { const after = l.p.stock - Math.min(l.need, l.p.stock); return `<tr><td>${l.p.emoji} ${l.p.name}</td><td>${l.need}</td><td>${l.p.stock}</td><td class="${after < l.p.safety ? 'warn-t' : ''}">${after}${after < l.p.safety ? ' · 자동 발주' : ''}</td></tr>`; }).join('')}
          </tbody></table></div>
          <div class="ctrl-row"><button class="btn primary" data-act="a-veh-replenish" ${canRep ? '' : 'disabled'}>보충 완료 처리</button><span class="muted small">${canRep ? '본점 재고에서 차감되고 안전재고 미만이면 자동 발주됩니다' : '차량이 본점에 복귀하면 처리할 수 있습니다'}</span></div>`
          : '<p class="muted pad">보충할 품목이 없습니다. 적재 기준 수량을 모두 채웠습니다.</p>')}
        ${card('운행 규칙', `<div class="rules">
          <div><b>노선</b><p>PX 본점 → 1생활관 → 2생활관 → 연병장 → 3생활관 → 정비고 → 4생활관 → PX 본점</p></div>
          <div><b>회차·정차</b><p>하루 2회 (18:00, 20:00 출발) · 1회 약 100분 · 지점마다 10분 정차</p></div>
          <div><b>안전</b><p>최고 10km/h · 보행자·장애물 감지 시 자동 정지 · 탄약고·위병소 등 보안구역 노선 제외</p></div>
          <div><b>운행 중지</b><p>우천·결빙·시야 불량, 관리자 원격 정지 · 복귀 후 적재 재고 자동 보충 및 충전</p></div>
        </div>`)}
      </div>`;
  }

  /* ---------- 동작 ---------- */
  const actions = {
    'a-fill': () => { Binds.alId = 'admin'; Binds.alPin = '0000'; ui.err = ''; },
    'a-login': () => {
      if (!Store.adminLogin(Binds.alId || '', Binds.alPin || '')) { ui.err = 'ID 또는 PIN이 올바르지 않습니다.'; return; }
      ui.err = '';
      Binds.alPin = '';
    },
    'a-logout': () => { stopCam(); Store.adminLogout(); },
    'a-tab': el => {
      if (ui.tab === 'scan' && el.dataset.tab !== 'scan') stopCam();
      ui.tab = el.dataset.tab;
      if (el.dataset.filter) ui.filter = el.dataset.filter;
      ui.err = '';
    },
    'a-filter': el => { ui.filter = el.dataset.filter; },
    'a-act-type': el => { ui.actType = el.dataset.type; },
    'a-round': el => { ui.roundKey = +el.dataset.min; },
    'a-receive': el => Store.receivePO(el.dataset.id),
    'a-dispose': el => Store.dispose(el.dataset.pid),
    'a-next': el => Store.nextStep(el.dataset.id),
    'a-scan-select': el => {
      const o = Store.order(el.dataset.id);
      ui.scanSel = o.id;
      ui.scanPlace = o.method === 'pickup' ? PICKUP_PLACE : o.place;
      ui.result = null;
      ui.err = '';
    },
    'a-scan-go': () => {
      const o = Store.order(ui.scanSel);
      if (!o) return;
      ui.scanning = true;
      ui.result = null;
      setTimeout(() => { ui.scanning = false; runScan(o.qr); App.render(); }, 1100);
    },
    'a-scan-token': () => { ui.err = ''; runScan(Binds.scanToken || ''); if (ui.result.ok) Binds.scanToken = ''; },
    'a-scan-cam': () => { if (ui.cam) stopCam(); else startCam(); },
    'a-veh-next': () => App.vehicleStep(),
    'a-veh-auto': () => Store.vehToggleAuto(),
    'a-veh-stop': () => Store.vehStop(),
    'a-veh-resume': () => Store.vehResume(),
    'a-veh-replenish': () => Store.vehReplenish(),
  };
  const changes = {
    'a-scan-place': el => { ui.scanPlace = el.value; ui.result = null; },
  };

  return { ui, render, actions, changes, afterRender, stopCam };
})();
