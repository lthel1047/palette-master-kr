/*
 * 절대 색감 — 색 엔진
 * - 분광 Kubelka-Munk(2상수) 물감 혼합: 400~700nm, 20nm 간격 16밴드
 * - 스펙트럼 → XYZ(D65, CIE1931 2°) → 선형 sRGB / CIELAB
 * - CIEDE2000 색차
 * 브라우저에서는 window.ColorEngine, Node에서는 module.exports 로 사용.
 */
(function (root) {
  'use strict';

  const NB = 16; // 400..700nm, 20nm step

  // CIE 1931 2° 등색함수 (20nm 샘플)
  const CMF_X = [0.01431, 0.13438, 0.34828, 0.29080, 0.09564, 0.00490, 0.06327, 0.29040,
                 0.59450, 0.91630, 1.06220, 0.85445, 0.44790, 0.16490, 0.04677, 0.01136];
  const CMF_Y = [0.000396, 0.004, 0.023, 0.060, 0.13902, 0.323, 0.710, 0.954,
                 0.995, 0.870, 0.631, 0.381, 0.175, 0.061, 0.017, 0.004102];
  const CMF_Z = [0.06785, 0.6456, 1.74706, 1.6692, 0.81295, 0.272, 0.07825, 0.0203,
                 0.0039, 0.00165, 0.0008, 0.00019, 0.00002, 0, 0, 0];
  // D65 상대 분광분포
  const D65 = [82.75, 93.43, 104.86, 117.81, 115.92, 109.35, 104.79, 104.41,
               100.0, 95.79, 90.01, 87.70, 83.70, 80.21, 78.28, 71.61];

  // 밴드별 가중치 (조명 × 등색함수), 완전 반사체 Y=1 로 정규화
  const WX = new Float64Array(NB), WY = new Float64Array(NB), WZ = new Float64Array(NB);
  (function () {
    let yn = 0;
    for (let i = 0; i < NB; i++) yn += D65[i] * CMF_Y[i];
    for (let i = 0; i < NB; i++) {
      WX[i] = D65[i] * CMF_X[i] / yn;
      WY[i] = D65[i] * CMF_Y[i] / yn;
      WZ[i] = D65[i] * CMF_Z[i] / yn;
    }
  })();
  let XW = 0, YW = 0, ZW = 0;
  for (let i = 0; i < NB; i++) { XW += WX[i]; YW += WY[i]; ZW += WZ[i]; }

  const M = [[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]];
  const MI = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
  // 완전 반사체가 정확히 (1,1,1) 이 되도록 채널별 화이트 밸런스
  const WB = [
    M[0][0] * XW + M[0][1] * YW + M[0][2] * ZW,
    M[1][0] * XW + M[1][1] * YW + M[1][2] * ZW,
    M[2][0] * XW + M[2][1] * YW + M[2][2] * ZW,
  ];

  // 반사율 곡선 제어점(nm → R)을 16밴드로 보간
  function curve(points) {
    const out = new Float64Array(NB);
    for (let i = 0; i < NB; i++) {
      const wl = 400 + i * 20;
      let j = 0;
      while (j < points.length - 2 && wl > points[j + 1][0]) j++;
      const [w0, r0] = points[j], [w1, r1] = points[j + 1];
      const t = Math.min(1, Math.max(0, (wl - w0) / (w1 - w0)));
      const s = t * t * (3 - 2 * t); // 부드러운 보간
      out[i] = r0 + (r1 - r0) * s;
    }
    return out;
  }

  // 8가지 물감. R = 단독(마스톤) 반사율, S = 산란 계수(은폐력·착색력), 표시 이름
  // 군청·검정·청록·자홍은 S를 낮춰 착색력을 줄임 → 흰색에 조금씩 넣으면 단계적으로 변함
  // 빨강은 보라 쪽 반사를 조금 남겨 군청과 섞으면 보라 계열이 되게 함
  const PIGMENT_DEFS = [
    { id: 'white',   name: '흰색',   S: 1.00, R: curve([[400, 0.86], [440, 0.92], [700, 0.93]]) },
    { id: 'yellow',  name: '노랑',   S: 0.60, R: curve([[400, 0.06], [470, 0.07], [530, 0.80], [560, 0.88], [700, 0.90]]) },
    { id: 'red',     name: '빨강',   S: 0.32, R: curve([[400, 0.15], [430, 0.12], [465, 0.04], [545, 0.035], [572, 0.14], [595, 0.55], [620, 0.80], [700, 0.87]]) },
    { id: 'magenta', name: '자홍',   S: 0.22, R: curve([[400, 0.32], [440, 0.30], [500, 0.08], [560, 0.04], [600, 0.25], [640, 0.62], [700, 0.75]]) },
    { id: 'blue',    name: '군청',   S: 0.13, R: curve([[400, 0.30], [440, 0.38], [470, 0.30], [520, 0.04], [640, 0.03], [700, 0.12]]) },
    { id: 'cyan',    name: '청록',   S: 0.17, R: curve([[400, 0.12], [460, 0.34], [490, 0.36], [530, 0.20], [580, 0.05], [700, 0.03]]) },
    { id: 'brown',   name: '갈색',   S: 0.32, R: curve([[400, 0.05], [520, 0.07], [580, 0.12], [640, 0.22], [700, 0.30]]) },
    { id: 'black',   name: '검정',   S: 0.11, R: curve([[400, 0.018], [700, 0.016]]) },
  ];
  const NP = PIGMENT_DEFS.length;

  // 각 물감의 K, S 스펙트럼: K/S = (1-R)^2 / 2R
  const K = PIGMENT_DEFS.map(p => {
    const k = new Float64Array(NB);
    for (let i = 0; i < NB; i++) { const r = p.R[i]; k[i] = p.S * (1 - r) * (1 - r) / (2 * r); }
    return k;
  });
  const S = PIGMENT_DEFS.map(p => p.S);

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  /** amounts(길이 NP) → 선형 sRGB [r,g,b]. 양이 0이면 null */
  function mixLinear(amounts, out) {
    out = out || [0, 0, 0];
    let tot = 0;
    for (let p = 0; p < NP; p++) tot += amounts[p];
    if (tot <= 0) return null;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < NB; i++) {
      let k = 0, s = 0;
      for (let p = 0; p < NP; p++) {
        const a = amounts[p];
        if (a > 0) { k += a * K[p][i]; s += a * S[p]; }
      }
      const ks = k / s;
      const r = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
      x += r * WX[i]; y += r * WY[i]; z += r * WZ[i];
    }
    out[0] = clamp01((M[0][0] * x + M[0][1] * y + M[0][2] * z) / WB[0]);
    out[1] = clamp01((M[1][0] * x + M[1][1] * y + M[1][2] * z) / WB[1]);
    out[2] = clamp01((M[2][0] * x + M[2][1] * y + M[2][2] * z) / WB[2]);
    return out;
  }

  const toSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const to8 = c => Math.round(clamp01(toSrgb(c)) * 255);

  function linToCss(lin) { return `rgb(${to8(lin[0])},${to8(lin[1])},${to8(lin[2])})`; }
  function linToHex(lin) { return '#' + lin.map(c => to8(c).toString(16).padStart(2, '0')).join('').toUpperCase(); }

  const fLab = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  /** 선형 sRGB → CIELAB (화이트 밸런스 적용된 공간 기준) */
  function linToLab(lin, out) {
    out = out || [0, 0, 0];
    const r = lin[0] * WB[0], g = lin[1] * WB[1], b = lin[2] * WB[2];
    const x = MI[0][0] * r + MI[0][1] * g + MI[0][2] * b;
    const y = MI[1][0] * r + MI[1][1] * g + MI[1][2] * b;
    const z = MI[2][0] * r + MI[2][1] * g + MI[2][2] * b;
    const fx = fLab(x / XW), fy = fLab(y / YW), fz = fLab(z / ZW);
    out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
    return out;
  }

  /** CIEDE2000 색차 */
  function deltaE2000(L1, a1, b1, L2, a2, b2) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
    const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hue = (b, a) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
    const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
    const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
      if (Math.abs(h1p - h2p) > 180) hbp += (hbp < 360 ? 360 : -360);
      hbp /= 2;
    }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
            + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    const Lb50 = (Lbp - 50) * (Lbp - 50);
    const Sl = 1 + 0.015 * Lb50 / Math.sqrt(20 + Lb50);
    const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    const l = dLp / Sl, c = dCp / Sc, h = dHp / Sh;
    return Math.sqrt(l * l + c * c + h * h + Rt * c * h);
  }

  const api = {
    NB, NP, PIGMENTS: PIGMENT_DEFS.map((p, i) => ({ id: p.id, name: p.name, index: i })),
    mixLinear, linToLab, linToCss, linToHex, deltaE2000, toLin, toSrgb,
  };
  // 각 물감 단독 색(튜브 라벨 색)
  api.PIGMENTS.forEach(p => {
    const a = new Array(NP).fill(0); a[p.index] = 1;
    p.lin = mixLinear(a); p.css = linToCss(p.lin); p.hex = linToHex(p.lin);
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColorEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
