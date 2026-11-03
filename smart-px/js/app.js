/* 앱 셸: 상단 시연 바, 화면 전환(장병/관리자/동시 보기), 이벤트 연결 */
const App = (() => {
  const $ = id => document.getElementById(id);
  let mode = 'soldier';
  try { mode = localStorage.getItem('smartpx_mode') || 'soldier'; } catch (e) { /* 기본값 사용 */ }
  let resetArmed = false, resetTimer = null, moving = false;

  function syncBadge() {
    const l = Sync.label();
    return `<span id="syncStatus" class="sync sync-${l.tone}"><i></i>${l.text}</span>`;
  }

  function topbar() {
    const now = Store.state.now, d = U.dateStr(now);
    const modes = [['soldier', '📱 장병 화면'], ['admin', '🖥️ 관리자 화면'], ['split', '⇆ 동시 보기']];
    return `<div class="tb-brand"><div class="logo">PX</div><div><b>스마트 PX</b><small>사전주문 · 무인수령 시연</small></div></div>
      <div class="tb-modes">${modes.map(([m, l]) => `<button class="${mode === m ? 'on' : ''}" data-act="mode" data-mode="${m}">${l}</button>`).join('')}</div>
      <div class="tb-right">
        ${syncBadge()}
        <div class="tb-clock"><small>시연 시각</small><b>${U.md(d)}(${U.dow(d)}) ${U.time(now)}</b></div>
        <button class="tb-btn" data-act="t-30" title="시연 시각을 30분 진행">+30분</button>
        <button class="tb-btn" data-act="t-round" title="다음 셔틀 회차의 창고 도착 시각(회차+10분)으로 이동">다음 회차 ▶</button>
        <button class="tb-btn" data-act="t-day" title="다음 날 08:00으로 이동 (06:00 일일 점검·익일 입고 실행)">다음 날 ▶▶</button>
        <button class="tb-btn reset${resetArmed ? ' armed' : ''}" data-act="t-reset" title="${Sync.web ? '모든 기기의 시연 데이터를 처음 상태로 되돌림' : '모든 데이터를 처음 상태로 되돌림'}">${resetArmed ? '한 번 더 누르면 초기화' : '↺ 데이터 초기화'}</button>
      </div>`;
  }

  function guide() {
    const p = SoldierUI.progress();
    const steps = [
      [p.login, '로그인', '샘플 계정 26-70001234 / 1234'],
      [p.cart, '라면·음료 담기', '생수 묶음의 "픽업전용" 배지 확인'],
      [p.shuttle, '무인셔틀 선택', '3생활관 무인배송창고 · 18:00 회차'],
      [p.paid, '결제 → QR 생성', '나라사랑카드 (모의 결제)'],
      [p.arrived, '상단 [다음 회차 ▶]', '"3생활관 창고 도착" 알림 확인'],
      [p.received, '관리자 QR 수령 처리', '단말 스캔 → 수령완료'],
    ];
    const tip = Sync.web
      ? '💡 <b>같은 링크를 휴대폰으로 여세요.</b> 휴대폰에서 주문하면 이 노트북의 관리자 화면 재고와 알림이 바로 바뀝니다.'
      : '💡 <b>동시 보기</b>로 바꾸면 주문하는 순간 관리자 재고가 줄고 자동 발주가 생기는 장면을 함께 보여줄 수 있습니다.';
    return `<h3>시연 시나리오 · 장병</h3>
      <ol class="g-steps">${steps.map(([done, t, s], i) => `<li class="${done ? 'done' : ''}"><i>${done ? '✓' : i + 1}</i><div><b>${t}</b><small>${s}</small></div></li>`).join('')}</ol>
      <div class="g-box"><b>운영 규칙</b><ul>
        <li>셔틀 12:30 · 18:00 · 21:00 (회차 30분 전 마감)</li>
        <li>PX 픽업 12:00~21:00, 30분 단위</li>
        <li>유통기한 D-7~D-2 30% 할인 · D-1 판매 중지</li>
        <li>안전재고 미만이 되면 즉시 자동 발주</li></ul></div>
      <div class="g-tip">${tip}</div>`;
  }

  // 실시간 데이터에 연결 중이거나 데이터가 아직 없을 때의 화면
  function gateView() {
    if (Sync.status === 'connecting' || (Sync.status === 'offline' && !Store.state)) {
      return `<div class="gate"><div class="gate-card"><div class="logo lg">PX</div><h2>실시간 데이터에 연결하는 중</h2>
        <p>${Sync.status === 'offline' ? '공유 데이터에 아직 연결되지 않았습니다. 네트워크를 확인하면 자동으로 이어집니다.' : '장병 화면과 관리자 화면이 같은 데이터를 함께 쓰도록 연결합니다.'}</p><div class="spinner"></div></div></div>`;
    }
    return `<div class="gate"><div class="gate-card"><div class="logo lg">PX</div><h2>시연 데이터가 아직 없습니다</h2>
      <p>가상 장병 100명, 상품 50종, 오늘 주문 36건과 자동 발주·할인 내역을 만들어 모든 기기가 함께 씁니다. 한 번만 만들면 되고, 나중에 상단 [데이터 초기화]로 다시 처음 상태로 돌릴 수 있습니다.</p>
      <button class="btn primary lg" data-act="sync-init">시연 데이터 만들기</button>
      <small class="muted">실제 장병 정보가 아닌 가상 데이터입니다</small></div></div>`;
  }

  /* ---------- 렌더 ---------- */
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.id || a.tagName !== 'INPUT') return null;
    return { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    const el = f && $(f.id);
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(f.s, f.e); } catch (e) { /* password 등 선택 범위 미지원 */ }
  }
  function captureScroll() {
    const m = {};
    document.querySelectorAll('[data-scroll-key]').forEach(el => { m[el.dataset.scrollKey] = el.scrollTop; });
    return m;
  }
  function restoreScroll(m) {
    document.querySelectorAll('[data-scroll-key]').forEach(el => { if (m[el.dataset.scrollKey]) el.scrollTop = m[el.dataset.scrollKey]; });
  }
  // 노선도 차량 아이콘을 이전 정차지에서 새 정차지로 이동시키는 애니메이션
  function animateVehicles() {
    document.querySelectorAll('.veh[data-to]').forEach(g => {
      const [x, y] = g.dataset.to.split(',');
      requestAnimationFrame(() => requestAnimationFrame(() => { g.style.transform = `translate(${x}px,${y}px)`; }));
    });
  }

  function render() {
    const gated = Sync.status === 'connecting' || Sync.status === 'empty' || !Store.state;
    document.body.dataset.mode = mode;
    document.body.classList.toggle('gated', gated);
    if (gated) {
      $('topbar').innerHTML = `<div class="tb-brand"><div class="logo">PX</div><div><b>스마트 PX</b><small>사전주문 · 무인수령 시연</small></div></div><div class="tb-right">${syncBadge()}</div>`;
      $('gate').innerHTML = gateView();
      return;
    }
    const focus = captureFocus(), scroll = captureScroll();
    $('topbar').innerHTML = topbar();
    if (mode !== 'admin') { $('phoneApp').innerHTML = SoldierUI.render(); $('guide').innerHTML = guide(); }
    if (mode !== 'soldier') { $('adminPane').innerHTML = AdminUI.render(); AdminUI.afterRender(); }
    restoreScroll(scroll);
    restoreFocus(focus);
    animateVehicles();
    flushEvents();
  }
  // 저장 진행 상태만 바꿀 때 (전체 화면을 다시 그리지 않음)
  function renderSync() {
    const el = $('syncStatus');
    if (el) el.outerHTML = syncBadge();
  }

  function addToast(layer, text, tone) {
    const box = $(layer);
    while (box.children.length >= 4) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = `toast t-${tone || 'info'}`;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4200);
  }
  // kind: soldier(로그인한 장병 휴대폰 화면) · admin(관리자 화면) · all
  function toast(kind, text, tone) {
    const s = Store.state && Store.state.session;
    if ((kind === 'soldier' || kind === 'all') && mode !== 'admin' && (kind === 'all' || (s && s.soldierId))) addToast('phoneToasts', text, tone);
    if ((kind === 'admin' && s && s.admin && mode !== 'soldier') || (kind === 'all' && mode === 'admin')) addToast('pageToasts', text, tone);
  }
  function flushEvents() {
    const s = Store.state.session;
    Store.drain().forEach(e => {
      if (e.kind === 'soldier' && e.sid === s.soldierId && mode !== 'admin') addToast('phoneToasts', e.text, 'info');
      if (e.kind === 'admin' && s.admin && mode !== 'soldier') addToast('pageToasts', e.text, e.tone);
    });
  }

  /* ---------- 이동 PX 진행 ---------- */
  function vehicleStep() {
    if (moving) return;
    if (Store.vehDepart() === 'moving') {
      moving = true;
      setTimeout(() => { moving = false; Store.vehArrive(); render(); }, 1500);
    }
  }
  // 자동 운행은 관리자 화면을 띄운 기기에서만 진행 (여러 기기가 동시에 움직이지 않도록)
  setInterval(() => {
    if (!Store.state || mode === 'soldier' || !Store.state.session.admin) return;
    const v = Store.state.vehicle;
    if (v.auto && (v.status === '정차' || v.status === '대기')) { vehicleStep(); render(); }
  }, 12000);

  /* ---------- 상단 바 동작 ---------- */
  function doReset() {
    AdminUI.stopCam();
    Store.reset();
    Object.keys(Binds).forEach(k => delete Binds[k]);
    SoldierUI.resetCheckout();
    Object.assign(SoldierUI.ui, { tab: 'home', cat: '전체', qrId: null, notices: false, mobile: null, lastIds: [] });
    Object.assign(AdminUI.ui, { tab: 'dash', filter: '전체', actType: '전체', roundKey: null, scanSel: null, scanPlace: PICKUP_PLACE, scanning: false, result: null, err: '' });
    $('phoneToasts').innerHTML = '';
    $('pageToasts').innerHTML = '';
  }
  const TOP = {
    mode: el => {
      mode = el.dataset.mode;
      if (mode === 'soldier') AdminUI.stopCam();
      try { localStorage.setItem('smartpx_mode', mode); } catch (e) { /* 저장 불가 무시 */ }
    },
    't-30': () => Store.addMinutes(30),
    't-round': () => Store.nextRound(),
    't-day': () => Store.nextDay(),
    't-reset': () => {
      clearTimeout(resetTimer);
      if (!resetArmed) {
        resetArmed = true;
        resetTimer = setTimeout(() => { resetArmed = false; render(); }, 3000);
        return;
      }
      resetArmed = false;
      doReset();
    },
    'sync-init': () => doReset(),
  };
  const findAction = k => TOP[k] || SoldierUI.actions[k] || AdminUI.actions[k];

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act],[data-stop]');
    if (!el || !el.dataset.act || el.disabled) return;
    const fn = findAction(el.dataset.act);
    if (!fn) return;
    fn(el, e);
    render();
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const k = el.dataset.change;
    (SoldierUI.changes[k] || AdminUI.changes[k])(el);
    render();
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind) return;
    Binds[el.dataset.bind] = el.value;
    if (el.id === 'invSearch') render();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.enter) return;
    const fn = findAction(e.target.dataset.enter);
    if (!fn) return;
    fn(e.target, e);
    render();
  });

  // claude.ai에서 열면 실시간 공유 데이터에, 로컬 파일로 열면 이 브라우저 저장소에 연결
  setTimeout(() => {
    if (window.claude && typeof window.claude.use === 'function') Sync.start();
    else Store.load();
    render();
  });

  return { render, renderSync, toast, vehicleStep };
})();
