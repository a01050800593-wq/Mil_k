/* 경량 QR 코드 생성기 — Byte 모드, 오류정정 M, 버전 1~10 (외부 라이브러리 없이 오프라인 동작) */
const QR = (() => {
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  // 버전별 표 (오류정정 M)
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];

  function generator(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
      poly = next;
    }
    return poly;
  }

  function remainder(data, gen, deg) {
    let res = new Array(deg).fill(0);
    for (const b of data) {
      const factor = b ^ res[0];
      res = res.slice(1).concat(0);
      for (let i = 0; i < deg; i++) res[i] ^= mul(gen[i + 1], factor);
    }
    return res;
  }

  function penalty(m) {
    const n = m.length;
    let score = 0, dark = 0;
    for (let a = 0; a < n; a++) {
      let rc = null, rl = 0, cc = null, cl = 0;
      for (let b = 0; b < n; b++) {
        const r = m[a][b], c = m[b][a];
        if (r === rc) { rl++; if (rl === 5) score += 3; else if (rl > 5) score++; } else { rc = r; rl = 1; }
        if (c === cc) { cl++; if (cl === 5) score += 3; else if (cl > 5) score++; } else { cc = c; cl = 1; }
        if (r) dark++;
        if (a < n - 1 && b < n - 1 && r === m[a][b + 1] && r === m[a + 1][b] && r === m[a + 1][b + 1]) score += 3;
      }
    }
    return score + Math.max(0, Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 10; ver++) {
      const cap = TOTAL_CW[ver] - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
    }
    if (ver > 10) throw new Error('QR 데이터가 너무 깁니다');
    const cap = TOTAL_CW[ver] - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

    // 데이터 비트열
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, cap * 8 - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (let pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);

    // 블록 분할 + 오류정정 + 인터리브
    const nb = NUM_BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver], total = TOTAL_CW[ver];
    const numShort = nb - total % nb, shortLen = Math.floor(total / nb);
    const gen = generator(ecLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - ecLen + (i < numShort ? 0 : 1);
      const dat = data.slice(k, k + len); k += len;
      blocks.push({ dat, ecc: remainder(dat, gen, ecLen) });
    }
    const cw = [];
    for (let i = 0; i <= shortLen - ecLen; i++) blocks.forEach(b => { if (i < b.dat.length) cw.push(b.dat[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach(b => cw.push(b.ecc[i]));

    // 행렬 구성
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[ver], n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = mask => {
      const d = mask; // 오류정정 M = 00
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const f = ((d << 10) | r) ^ 0x5412;
      const bit = i => ((f >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let r = ver;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const v = (ver << 12) | r;
      for (let i = 0; i < 18; i++) {
        const b = ((v >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3);
        set(a, c, b); set(c, a, b);
      }
    }

    // 데이터 배치 (지그재그)
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && idx < cw.length * 8) { mod[y][x] = ((cw[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1; idx++; }
      }
    }

    // 마스크 선택
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const s = penalty(mod);
      if (s < bestScore) { best = m; bestScore = s; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function svg(text) {
    const m = encode(text), n = m.length, q = 4, full = n + q * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
    return `<svg class="qr" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${full}" height="${full}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }

  return { encode, svg, _remainder: remainder, _generator: generator };
})();
