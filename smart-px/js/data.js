/* 스마트 PX 시연용 가상 샘플 데이터 — 실제 장병·상품 정보가 아님 */
const SPX_DATA = (() => {
  // 시드 고정 난수: 초기화할 때마다 같은 데이터가 만들어진다
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CATEGORIES = ['식품·간식', '음료', '생활용품', '기타'];
  // PRD 7.1 카테고리별 안전재고·적정재고
  const CAT_RULE = {
    '식품·간식': { safety: 15, optimal: 50, bg: '#fff1df' },
    '음료': { safety: 20, optimal: 60, bg: '#e2f0ff' },
    '생활용품': { safety: 5, optimal: 20, bg: '#e4f5e8' },
    '기타': { safety: 5, optimal: 15, bg: '#eee8ff' },
  };
  const CAT_CODE = { F: '식품·간식', D: '음료', L: '생활용품', E: '기타' };

  // [상품명, 카테고리, 가격, 일러스트, 현재고, 유통기한(기준일+n일, 없으면 null), 픽업전용, 입고 시 유통기한 일수]
  // 시연 구성: 재고부족 5종(P007·P023·P031·P033·P048), 유통기한 임박 5종(P014~P016·P027·P028), 픽업전용 7종
  const PRODUCTS = [
    ['컵라면(대)', 'F', 1200, '🍜', 16, 90, 0, 120],
    ['컵라면(소)', 'F', 900, '🍜', 42, 100, 0, 120],
    ['봉지라면 5입', 'F', 4500, '🍝', 25, 120, 0, 150],
    ['라면 1박스(30입)', 'F', 19800, '📦', 22, 150, 1, 150],
    ['감자칩', 'F', 1500, '🥔', 38, 60, 0, 90],
    ['새우맛 과자', 'F', 1400, '🦐', 33, 60, 0, 90],
    ['초코파이(12입)', 'F', 4800, '🍪', 9, 45, 0, 90],
    ['초콜릿바', 'F', 1000, '🍫', 45, 120, 0, 180],
    ['젤리', 'F', 1200, '🍬', 30, 90, 0, 180],
    ['즉석밥', 'F', 1300, '🍚', 28, 180, 0, 240],
    ['참치캔', 'F', 2200, '🐟', 26, 365, 0, 720],
    ['소시지', 'F', 1500, '🌭', 24, 30, 0, 60],
    ['냉동만두', 'F', 4200, '🥟', 18, 90, 0, 180],
    ['삼각김밥', 'F', 1100, '🍙', 16, 1, 0, 3],
    ['샌드위치', 'F', 2500, '🥪', 18, 2, 0, 3],
    ['단팥빵', 'F', 1300, '🍞', 20, 5, 0, 7],
    ['아이스크림', 'F', 1000, '🍦', 40, 300, 0, 365],
    ['견과류 믹스', 'F', 2800, '🥜', 19, 120, 0, 180],
    ['과자 종합박스', 'F', 12000, '🎁', 17, 90, 1, 120],
    ['육포', 'F', 3500, '🥓', 21, 120, 0, 180],
    ['콜라', 'D', 1200, '🥤', 48, 200, 0, 300],
    ['사이다', 'D', 1200, '🥤', 44, 200, 0, 300],
    ['이온음료', 'D', 1300, '🧃', 12, 180, 0, 300],
    ['생수 500ml', 'D', 600, '💧', 55, 300, 0, 365],
    ['생수 2L 6입 묶음', 'D', 4800, '🚰', 26, 300, 1, 365],
    ['캔커피', 'D', 1000, '☕', 36, 200, 0, 300],
    ['흰우유', 'D', 1100, '🥛', 22, 3, 0, 10],
    ['바나나우유', 'D', 1400, '🍌', 25, 6, 0, 10],
    ['오렌지주스', 'D', 1500, '🍊', 30, 90, 0, 120],
    ['에너지음료', 'D', 1800, '⚡', 34, 240, 0, 300],
    ['탄산수', 'D', 1000, '💦', 0, null, 0, 300],
    ['음료 1박스(24캔)', 'D', 22000, '🧊', 21, 200, 1, 300],
    ['물티슈', 'L', 1500, '🧽', 3, null, 0, null],
    ['칫솔', 'L', 2000, '🪥', 14, null, 0, null],
    ['치약', 'L', 2500, '🦷', 12, null, 0, null],
    ['샴푸', 'L', 5500, '🧴', 9, null, 0, null],
    ['바디워시', 'L', 5000, '🧼', 8, null, 0, null],
    ['면도기', 'L', 4500, '🪒', 11, null, 0, null],
    ['세탁세제 대용량', 'L', 9800, '🧺', 8, null, 1, null],
    ['섬유유연제 대용량', 'L', 8800, '🌸', 7, null, 1, null],
    ['화장지 30롤', 'L', 13000, '🧻', 6, null, 1, null],
    ['로션', 'L', 7000, '🧴', 10, null, 0, null],
    ['선크림', 'L', 8000, '☀️', 13, null, 0, null],
    ['군용 양말(3켤레)', 'E', 4000, '🧦', 18, null, 0, null],
    ['건전지(AA 4입)', 'E', 3500, '🔋', 12, null, 0, null],
    ['유선 이어폰', 'E', 9900, '🎧', 7, null, 0, null],
    ['충전 케이블', 'E', 6500, '🔌', 9, null, 0, null],
    ['핫팩', 'E', 800, '🔥', 2, null, 0, null],
    ['볼펜·수첩 세트', 'E', 3000, '📝', 14, null, 0, null],
    ['립밤', 'E', 2500, '💄', 11, null, 0, null],
  ];

  function buildProducts(today) {
    return PRODUCTS.map(([name, code, price, emoji, stock, exp, pickupOnly, shelf], i) => {
      const cat = CAT_CODE[code], rule = CAT_RULE[cat];
      return {
        id: 'P' + String(i + 1).padStart(3, '0'), name, cat, price, emoji, stock,
        safety: rule.safety, optimal: rule.optimal,
        expiry: exp === null ? null : U.addDays(today, exp),
        shelf, pickupOnly: !!pickupOnly,
      };
    });
  }

  const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍'.split('');
  const GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '주원', '지호', '지후', '준우', '준서', '도현', '건우', '현우', '우진', '선우', '연우', '유준', '정우', '승우', '승현', '시윤', '준혁', '은우', '지환', '승민', '지우', '유찬', '윤우', '민성', '준영', '시후', '진우', '지원', '수호', '재윤', '시현', '동현', '태윤', '민재', '한결', '재원', '은호', '이준', '성민', '태현', '민규', '하진', '지성'];

  // 장병 100명. 첫 번째는 PRD 5.1 시나리오의 시연 계정
  function buildSoldiers() {
    const r = rng(300);
    const list = [{ id: '26-70001234', name: '김민준', rank: '일병', barracks: '3생활관', pin: '1234', pay: '나라사랑카드' }];
    const used = new Set([list[0].id]);
    while (list.length < 100) {
      const senior = r() < 0.5;
      const id = `${senior ? '25' : '26'}-7${String(Math.floor(r() * 10000000)).padStart(7, '0')}`;
      if (used.has(id)) continue;
      used.add(id);
      list.push({
        id,
        name: SURNAMES[Math.floor(r() * SURNAMES.length)] + GIVEN[Math.floor(r() * GIVEN.length)],
        rank: senior ? (r() < 0.5 ? '상병' : '병장') : (r() < 0.4 ? '이병' : '일병'),
        barracks: `${1 + Math.floor(r() * 4)}생활관`,
        pin: String(Math.floor(r() * 10000)).padStart(4, '0'),
        pay: r() < 0.6 ? '나라사랑카드' : '간편결제',
      });
    }
    return list;
  }

  // PRD 16장 이동 PX: 노선(마지막은 본점 복귀), 회차 출발 기준 도착 시각(분), 노선도 좌표
  const STOPS = [
    { name: 'PX 본점', short: 'PX 본점', off: 0, x: 90, y: 212, tx: 90, ty: 240, anchor: 'middle' },
    { name: '1생활관 앞', short: '1생활관', off: 12, x: 48, y: 136, tx: 62, ty: 140, anchor: 'start' },
    { name: '2생활관 앞', short: '2생활관', off: 26, x: 95, y: 60, tx: 95, ty: 40, anchor: 'middle' },
    { name: '연병장', short: '연병장', off: 40, x: 195, y: 42, tx: 195, ty: 24, anchor: 'middle' },
    { name: '3생활관 앞', short: '3생활관', off: 54, x: 295, y: 62, tx: 295, ty: 42, anchor: 'middle' },
    { name: '정비고', short: '정비고', off: 68, x: 334, y: 140, tx: 320, ty: 144, anchor: 'end' },
    { name: '4생활관 앞', short: '4생활관', off: 82, x: 272, y: 212, tx: 272, ty: 240, anchor: 'middle' },
    { name: 'PX 본점 (복귀)', short: 'PX 본점', off: 100, x: 90, y: 212, tx: 90, ty: 240, anchor: 'middle' },
  ];
  const VEH_ROUNDS = [{ label: '18:00', min: 1080 }, { label: '20:00', min: 1200 }];
  const BARRACKS_STOP = { '1생활관': 1, '2생활관': 2, '3생활관': 4, '4생활관': 6 };
  // 적재 품목 11종과 적재 기준 수량 (픽업전용 제외)
  const MOBILE_LOAD = [['P001', 12], ['P005', 10], ['P008', 10], ['P009', 8], ['P021', 12], ['P023', 8], ['P024', 12], ['P026', 10], ['P030', 8], ['P033', 6], ['P044', 6]];

  return { rng, CATEGORIES, CAT_RULE, buildProducts, buildSoldiers, STOPS, VEH_ROUNDS, BARRACKS_STOP, MOBILE_LOAD };
})();
