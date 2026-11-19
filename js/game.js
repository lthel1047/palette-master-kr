/*
 * 절대 색감 — 게임 로직
 * 팔레트를 격자로 나눠 칸마다 물감 8종의 양을 저장하고,
 * 칸의 색은 color.js 의 분광 Kubelka-Munk 혼합으로 계산한다.
 * 화면은 scene3d.js(three.js) 가 3D 로 그린다.
 */
import { DataUtils } from 'three';
import { createScene } from './scene3d.js';

(() => {
  'use strict';
  const CE = window.ColorEngine;
  const NP = CE.NP;
  const $ = id => document.getElementById(id);

  // ---------- 설정값 ----------
  const GX = 108, GY = 144, N = GX * GY;  // 팔레트 격자 (가로 3 : 세로 4)
  // 물감은 불투명: 아주 얇은 막(COV0 이하)은 안 보이고, COV1 이상이면 바탕이 완전히 가려진다
  const COV0 = 0.02, COV1 = 0.045;
  const FILM = 0.14;            // 헤라로 펴 바른 물감 막의 두께 (항상 불투명하게 보이는 두께)
  const SQUEEZE_RATE = 12;      // 튜브에서 초당 나오는 물감 양 (두께×칸)
  const BLOB_R = 2.9;           // 짜낸 물감 방울 반지름 (칸)
  const KNIFE_R = 6.5;          // 헤라 반지름 (칸)
  const MIX = 0.5;              // 헤라 아래 물감끼리 한 걸음마다 섞이는 정도 (0~1)
  const PICK = 0.42, DROP = 0.45;  // 헤라가 한 걸음마다 묻혀 가는/내려놓는 비율
  const LENS_R = 11;            // 돋보기 테 반지름 (칸)
  const JUDGE_R = LENS_R - 1.2; // 판정 범위 = 테 안쪽
  const SCORE_ZERO = 40;        // CIEDE2000 이 값 이상이면 0%
  const PAINT_MIN = 0.18;       // 판정에 필요한 렌즈 안 평균 두께 비율
  const TOUCH_LIFT = 10;        // 터치로 튜브를 들면 노즐을 손가락보다 이만큼(칸) 위로
  const BEST_KEY = 'jeoldae-saekgam.best2';  // { sec30: 최고 일치율, speed: 최단 시간(ms) }
  const MODE_KEY = 'jeoldae-saekgam.mode';
  const MODES = {
    normal: { name: '일반', icon: '🎨' },
    sec30: { name: '30초 챌린지', icon: '⏱', limit: 30000 },
    speed: { name: '스피드 런', icon: '⚡', goal: 90, cap: 300000 },
  };
  const SEEN_KEY = 'jeoldae-saekgam.howto';

  // ---------- 상태 ----------
  const amt = new Float32Array(N * NP);   // 칸별 물감 양
  const thick = new Float32Array(N);      // 칸별 총 두께
  const col = new Float32Array(N * 3);    // 칸별 물감 색(선형 sRGB, 바탕 미포함)
  const dirty = new Uint8Array(N).fill(1);
  const tmpA = new Float32Array(NP), tmpRGB = [0, 0, 0];
  const PAPER = [0.955, 0.950, 0.932].map(CE.toLin);

  let target = null;            // { parts, lin, lab, css, hex }
  let state = 'menu';            // menu → playing → result
  let mode = 'normal';
  let runStart = 0;
  let bests = {};
  try { bests = JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) {}
  try { if (MODES[localStorage.getItem(MODE_KEY)]) mode = localStorage.getItem(MODE_KEY); } catch (e) {}
  const elapsed = () => performance.now() - runStart;
  const secText = ms => `${(ms / 1000).toFixed(1)}초`;

  const lens = { x: GX * 0.5, y: GY * 0.62 };
  const knife = { load: new Float32Array(NP), active: false, x: 0, y: 0, px: 0, py: 0 };
  let drag = null;              // { mode: 'tube'|'knife'|'lens', ... }
  let needsRender = true;

  // ---------- 캔버스 / 3D 장면 ----------
  const cv = $('cv');
  const RS = 2;                                       // 물감 텍스처 해상도: 칸당 RS×RS
  const RW = GX * RS, RH = GY * RS, M = RW * RH;
  const HT = new Float32Array(M), HA = new Float32Array(M), HR = new Float32Array(M), HG = new Float32Array(M), HB = new Float32Array(M);
  const HEIGHT = new Uint16Array(M), COLOR = new Uint8Array(M * 4), NOISE = new Float32Array(M);
  let needsPaint = true, lastPaintMs = 0;
  let W = 0, H = 0, DPR = 1;
  let S3 = null;
  try {
    S3 = createScene(cv, {
      GX, GY, lensR: LENS_R, bg: '#8d8f94',
      paper: `rgb(${[0.955, 0.950, 0.932].map(v => Math.round(v * 255)).join(',')})`,
      pigments: CE.PIGMENTS.map(p => ({ css: p.css })),
    });
  } catch (e) {
    console.error(e);
    document.getElementById('toast').textContent = '이 브라우저는 3D 그래픽(WebGL)을 지원하지 않아요. 최신 크롬·사파리에서 열어 주세요.';
    document.getElementById('toast').classList.add('show');
  }

  function layout() {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    if (!S3) return;
    // 목표 카드를 팔레트 위쪽 모서리 바로 위에 띄운다 (원작처럼)
    const bar = document.querySelector('.targetbar');
    const barH = Math.max(54, Math.min(76, H * 0.09)) + 12;
    S3.resize(W, H, DPR, barH);
    const e = S3.paletteTopEdge();
    const root = document.documentElement.style;
    root.setProperty('--palette-w', `${Math.max(e.right - e.left, 240)}px`);
    root.setProperty('--bar-left', `${cv.offsetLeft + e.left}px`);
    root.setProperty('--bar-top', `${Math.max(0, e.top - barH)}px`);
    bar.style.height = `${barH - 12}px`;
    needsRender = true;
  }

  // ---------- 격자 유틸 ----------
  const inPalette = (gx, gy) => gx >= 0 && gy >= 0 && gx < GX && gy < GY;

  function cellColor(c) {
    if (dirty[c]) {
      for (let p = 0; p < NP; p++) tmpA[p] = amt[c * NP + p];
      const r = thick[c] > 1e-6 ? CE.mixLinear(tmpA, tmpRGB) : null;
      if (r) { col[c * 3] = r[0]; col[c * 3 + 1] = r[1]; col[c * 3 + 2] = r[2]; }
      dirty[c] = 0;
    }
  }
  // 바탕 + 물감 덮임 정도를 반영한 실제 보이는 색(음영 없음)
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const coverage = t => smooth(COV0, COV1, t);
  function shownColor(c, out) {
    cellColor(c);
    const cov = coverage(thick[c]);
    for (let k = 0; k < 3; k++) out[k] = PAPER[k] * (1 - cov) + col[c * 3 + k] * cov;
    return out;
  }
  function recompute() {
    for (let c = 0; c < N; c++) thick[c] = 0;
    for (let c = 0; c < N; c++) { let s = 0; for (let p = 0; p < NP; p++) s += amt[c * NP + p]; thick[c] = s; }
    dirty.fill(1);
    needsPaint = true;
  }

  // ---------- 물감 짜기 ----------
  function deposit(gx, gy, pigment, amount) {
    // 이미 수북한 곳에 계속 짜면 옆으로 퍼진다
    const ci = Math.min(GY - 1, Math.max(0, gy | 0)) * GX + Math.min(GX - 1, Math.max(0, gx | 0));
    const r = BLOB_R + Math.min(3.5, thick[ci] * 1.6), r2 = r * r;
    const x0 = Math.max(0, Math.floor(gx - r)), x1 = Math.min(GX - 1, Math.ceil(gx + r));
    const y0 = Math.max(0, Math.floor(gy - r)), y1 = Math.min(GY - 1, Math.ceil(gy + r));
    let wsum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2;
      if (d2 < r2) wsum += 1 - d2 / r2;
    }
    if (wsum <= 0) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2;
      if (d2 >= r2) continue;
      const a = amount * (1 - d2 / r2) / wsum, c = y * GX + x;
      amt[c * NP + pigment] += a; thick[c] += a; dirty[c] = 1;
    }
    needsRender = needsPaint = true;
  }

  // ---------- 헤라 ----------
  function knifeStep(gx, gy) {
    const r = KNIFE_R, r2 = r * r, load = knife.load;
    const x0 = Math.max(0, Math.floor(gx - r)), x1 = Math.min(GX - 1, Math.ceil(gx + r));
    const y0 = Math.max(0, Math.floor(gy - r)), y1 = Math.min(GY - 1, Math.ceil(gy + r));
    const cells = [], ws = [];
    let wsum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2;
      if (d2 >= r2) continue;
      const w = 1 - d2 / r2; cells.push(y * GX + x); ws.push(w); wsum += w;
    }
    if (!cells.length) return;
    // 1) 헤라 아래 물감을 묻혀 간다. 안 보일 만큼 얇은 막은 통째로 걷어 가서 자국을 남기지 않는다
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (thick[c] <= 0) continue;
      const f = thick[c] < COV1 ? 1 : PICK * ws[i];
      for (let p = 0; p < NP; p++) {
        const v = amt[c * NP + p] * f; amt[c * NP + p] -= v; load[p] += v;
      }
      thick[c] *= 1 - f;
    }
    // 2) 묻은 물감(헤라 위에서 이미 섞인 상태)을 내려놓는다.
    //    먼저 헤라 가운데부터 빈 곳을 FILM 두께로 채우고(→ 펴 발라도 색이 흐려지지 않음),
    //    남는 몫은 물감 있는 곳에 고루 돌려줘서 계속 섞이게 한다.
    let loadSum = 0; for (let p = 0; p < NP; p++) loadSum += load[p];
    if (loadSum > 1e-6) {
      let budget = loadSum * DROP;
      const give = new Float32Array(cells.length);
      const order = cells.map((_, i) => i).sort((i, j) => ws[j] - ws[i]);
      // 가운데(무게 큰 칸)부터 둥글게 채운다. 예산이 모자라면 경계 고리의 칸들에 고르게 나눠서
      // 한쪽으로 쏠린 들쭉날쭉한 자국이 생기지 않게 한다
      const need = order.map(i => Math.max(0, FILM * (0.65 + 0.35 * ws[i]) - thick[cells[i]]));
      let k = 0;
      while (k < order.length && budget > 0) {
        // 무게가 비슷한(0.06 이내) 칸들을 한 고리로 묶는다
        let e = k, ringNeed = 0;
        while (e < order.length && ws[order[k]] - ws[order[e]] < 0.06) { ringNeed += need[e]; e++; }
        const f = ringNeed > 0 ? Math.min(1, budget / ringNeed) : 0;
        for (let q = k; q < e; q++) { const g = need[q] * f; give[order[q]] += g; budget -= g; }
        k = e;
      }
      if (budget > 0) {
        let hs = 0; const hw = cells.map((c, i) => { const v = ws[i] * (thick[c] > COV1 ? 1 : 0.05); hs += v; return v; });
        for (let i = 0; i < cells.length; i++) give[i] += budget * hw[i] / (hs || 1);
      }
      let used = 0;
      for (let i = 0; i < cells.length; i++) {
        if (give[i] <= 0) continue;
        const c = cells[i], k = give[i] / loadSum;
        for (let p = 0; p < NP; p++) amt[c * NP + p] += load[p] * k;
        used += give[i];
      }
      const keep = Math.max(0, 1 - used / loadSum);
      for (let p = 0; p < NP; p++) load[p] *= keep;
    }
    for (const c of cells) {
      let s = 0; for (let p = 0; p < NP; p++) { if (amt[c * NP + p] < 1e-7) amt[c * NP + p] = 0; s += amt[c * NP + p]; }
      thick[c] = s; dirty[c] = 1;
    }
    // 3) 헤라 날 아래 물감끼리 직접 섞는다: 각 칸의 성분을 헤라 아래 평균 성분 쪽으로 당긴다.
    //    가중 평균을 쓰므로 물감 총량은 그대로 보존된다.
    {
      const mavg = new Float64Array(NP); let mt = 0;
      const mc = new Float32Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; if (thick[c] < COV1) continue;
        mc[i] = MIX * Math.min(1, ws[i] * 1.6);
        mt += mc[i] * thick[c];
        for (let p = 0; p < NP; p++) mavg[p] += mc[i] * amt[c * NP + p];
      }
      if (mt > 1e-6) {
        for (let p = 0; p < NP; p++) mavg[p] /= mt;
        for (let i = 0; i < cells.length; i++) {
          if (!mc[i]) continue;
          const c = cells[i], t = thick[c], m = mc[i];
          for (let p = 0; p < NP; p++) amt[c * NP + p] += m * (t * mavg[p] - amt[c * NP + p]);
        }
      }
    }
    needsRender = needsPaint = true;
  }
  function knifeTo(gx, gy) {
    const dx = gx - knife.x, dy = gy - knife.y, dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.7));
    for (let i = 1; i <= steps; i++) knifeStep(knife.x + dx * i / steps, knife.y + dy * i / steps);
    knife.px = knife.x; knife.py = knife.y; knife.x = gx; knife.y = gy;
  }
  function knifeRelease() {
    // 헤라에 남은 물감은 마지막 위치에 모두 내려놓는다 (물감이 사라지지 않게)
    let s = 0; for (let p = 0; p < NP; p++) s += knife.load[p];
    if (s > 1e-7) {
      for (let p = 0; p < NP; p++) if (knife.load[p] > 0) deposit(clampG(knife.x, GX), clampG(knife.y, GY), p, knife.load[p]);
    }
    knife.load.fill(0); knife.active = false;
  }
  const clampG = (v, n) => Math.min(n - 0.5, Math.max(0.5, v));

  // ---------- 돋보기 ----------
  function clampLens() {
    lens.x = Math.min(GX - JUDGE_R - 0.2, Math.max(JUDGE_R + 0.2, lens.x));
    lens.y = Math.min(GY - JUDGE_R - 0.2, Math.max(JUDGE_R + 0.2, lens.y));
  }
  // 돋보기 테·손잡이를 잡았는지 (격자 좌표로 판단, 손잡이는 오른쪽 아래 45°)
  function hitLens(gx, gy) {
    const d = Math.hypot(gx - lens.x, gy - lens.y);
    if (d > LENS_R - 2.6 && d < LENS_R + 2.8) return true;
    const ux = Math.SQRT1_2, uy = Math.SQRT1_2;
    const t = (gx - lens.x) * ux + (gy - lens.y) * uy, perp = Math.abs(-(gx - lens.x) * uy + (gy - lens.y) * ux);
    return t > LENS_R && t < LENS_R + 21 && perp < 2.8;
  }
  function judgeCells() {
    const out = [], r2 = JUDGE_R * JUDGE_R;
    for (let y = Math.floor(lens.y - JUDGE_R); y <= Math.ceil(lens.y + JUDGE_R); y++)
      for (let x = Math.floor(lens.x - JUDGE_R); x <= Math.ceil(lens.x + JUDGE_R); x++) {
        if (!inPalette(x, y)) continue;
        if ((x + 0.5 - lens.x) ** 2 + (y + 0.5 - lens.y) ** 2 <= r2) out.push(y * GX + x);
      }
    return out;
  }

  // ---------- 튜브 ----------
  // 노즐 위치(격자): 손가락에 가리지 않도록 터치일 때는 조금 위(-y)로
  function nozzlePos(d) { return [d.gx, d.gy - (d.touch ? TOUCH_LIFT : 0)]; }

  // ---------- 목표 색 ----------
  function makeTarget() {
    const lab = [0, 0, 0];
    const pure = CE.PIGMENTS.map(p => CE.linToLab(p.lin));
    const paperLab = CE.linToLab(PAPER);
    for (let tries = 0; tries < 400; tries++) {
      const parts = new Array(NP).fill(0);
      const pool = [1, 2, 3, 4, 5, 6, 7];
      const r = Math.random(), n = r < 0.35 ? 1 : r < 0.85 ? 2 : 3;
      for (let q = 0; q < n; q++) {
        const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        parts[k] = 1 + Math.floor(Math.random() * (k === 7 ? 2 : 4));
      }
      if (Math.random() < 0.75) parts[0] = 1 + Math.floor(Math.random() * 6);
      const lin = CE.mixLinear(parts);
      CE.linToLab(lin, lab);
      if (lab[0] < 22 || lab[0] > 93) continue;
      if (CE.deltaE2000(...lab, ...paperLab) < 10) continue;
      if (pure.some(pl => CE.deltaE2000(...lab, ...pl) < 7)) continue;
      return { parts, lin, lab: lab.slice(), css: CE.linToCss(lin), hex: CE.linToHex(lin) };
    }
    const parts = [2, 1, 0, 0, 0, 1, 0, 0];
    const lin = CE.mixLinear(parts);
    return { parts, lin, lab: CE.linToLab(lin), css: CE.linToCss(lin), hex: CE.linToHex(lin) };
  }
  function newRound() {
    target = makeTarget();
    const card = $('target');
    card.style.backgroundColor = target.css;
    card.classList.toggle('light', target.lab[0] > 72);
    card.setAttribute('aria-label', `목표 색 ${target.hex}`);
    clearPalette();
    updateModeChip();
    state = 'playing';
    runStart = performance.now();
    lastTimerText = '';
  }
  function startMode(m) {
    mode = MODES[m] ? m : 'normal';
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    $('modes').hidden = true;
    hideResult();
    newRound();
  }
  function openModes() {
    if (drag) { if (drag.mode === 'knife') knifeRelease(); drag = null; }
    state = 'menu';
    $('result').hidden = true;
    $('modes').hidden = false;
    const btn = document.querySelector(`.mode-card[data-mode="${mode}"]`);
    btn && btn.focus();
  }
  function updateModeChip() {
    const M = MODES[mode];
    $('mode-chip').textContent = `${M.icon} ${M.name}`;
    $('timer').classList.toggle('up', mode === 'speed');
    if (mode === 'normal') $('timer').textContent = '';
    updateBest();
  }
  function clearPalette() {
    amt.fill(0); thick.fill(0); dirty.fill(1); knife.load.fill(0); needsRender = needsPaint = true;
  }

  // ---------- 판정 ----------
  function judge() {
    const cells = judgeCells();
    let paint = 0;
    for (const c of cells) paint += coverage(thick[c]);
    if (paint / cells.length < PAINT_MIN) return null;
    const rgb = [0, 0, 0], lab = [0, 0, 0], avg = [0, 0, 0];
    let sum = 0;
    for (const c of cells) {
      shownColor(c, rgb);
      CE.linToLab(rgb, lab);
      const de = CE.deltaE2000(...lab, ...target.lab);
      sum += Math.max(0, 1 - de / SCORE_ZERO);
      avg[0] += rgb[0]; avg[1] += rgb[1]; avg[2] += rgb[2];
    }
    avg.forEach((v, i) => avg[i] = v / cells.length);
    const avgLab = CE.linToLab(avg);
    return {
      score: Math.round(sum / cells.length * 1000) / 10,
      avg, hex: CE.linToHex(avg), css: CE.linToCss(avg),
      dE: CE.deltaE2000(...avgLab, ...target.lab),
    };
  }

  function gradeText(s) {
    if (s >= 98) return '절대 색감 보유자!';
    if (s >= 95) return '거의 똑같아요';
    if (s >= 90) return '훌륭해요';
    if (s >= 80) return '꽤 비슷해요';
    if (s >= 60) return '조금만 더 섞어 보세요';
    return '다시 도전해 보세요';
  }
  function recipeText(parts) {
    const items = parts.map((v, i) => [v, CE.PIGMENTS[i].name]).filter(([v]) => v > 0);
    return '정답 배합 · ' + items.map(([v, n]) => `${n} ${v}`).join(' : ');
  }

  function speedGrade(ms) {
    if (ms < 10000) return '번개 손!';
    if (ms < 20000) return '엄청 빨라요';
    if (ms < 40000) return '빨라요';
    if (ms < 90000) return '좋아요';
    return '성공!';
  }

  let revealRaf = 0, lastResult = null;
  /** res: { score, hex, css, time, timeout?, fail? } */
  function showResult(res) {
    if (drag) { if (drag.mode === 'knife') knifeRelease(); drag = null; }
    state = 'result';
    lastResult = { ...res, mode };
    const M = MODES[mode];
    let isNew = false;
    if (!res.fail) {
      if (mode === 'normal' && res.score > 0 && !(bests.normal >= res.score)) { bests.normal = res.score; isNew = true; }
      if (mode === 'sec30' && res.score > 0 && !(bests.sec30 >= res.score)) { bests.sec30 = res.score; isNew = true; }
      if (mode === 'speed' && !(bests.speed <= res.time)) { bests.speed = Math.round(res.time); isNew = true; }
      if (isNew) { try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch (e) {} }
    }
    updateBest();
    $('result-mode').textContent = `${M.icon} ${M.name}`;
    $('cmp-target').style.background = target.css;
    $('cmp-mine').style.background = res.css;
    $('hex-target').textContent = target.hex;
    $('hex-mine').textContent = res.hex;
    $('grade').textContent = '';
    $('recipe').textContent = recipeText(target.parts);
    let sub;
    if (mode === 'normal') sub = '';
    else if (mode === 'sec30') sub = res.timeout ? '⏰ 시간 종료! 그 순간의 색으로 채점했어요' : `⏱ ${secText(res.time)} 만에 완성`;
    else sub = res.fail ? '5분 안에 90%를 넘기지 못했어요' : `일치율 ${res.score.toFixed(1)}%로 성공`;
    $('sub').textContent = sub;
    const ov = $('result'), card = ov.querySelector('.result-card');
    card.classList.remove('show', 'done');
    ov.hidden = false;
    window.Ads && window.Ads.showResultAd($('result-ad'));
    window.Ranking && window.Ranking.onResult({
      mode, score: res.score, time_ms: Math.round(res.time), target: target.hex, mine: res.hex,
      ok: mode !== 'normal' && !res.fail && (mode === 'speed' || res.score > 0),
    });
    requestAnimationFrame(() => card.classList.add('show'));
    const t0 = performance.now() + 450, dur = 1300;
    cancelAnimationFrame(revealRaf);
    const tick = now => {
      const t = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - t, 3);
      if (mode === 'speed' && res.fail) $('score').textContent = '실패';
      else if (mode === 'speed') $('score').textContent = `⚡ ${secText(res.time * e)}`;
      else $('score').textContent = `일치율 ${(res.score * e).toFixed(1)}%`;
      if (t < 1) { revealRaf = requestAnimationFrame(tick); return; }
      const g = res.fail ? '다시 도전해 보세요' : mode === 'speed' ? speedGrade(res.time) : gradeText(res.score);
      $('grade').innerHTML = g + (isNew ? '<span class="new">내 최고 기록</span>' : '');
      card.classList.add('done');
    };
    revealRaf = requestAnimationFrame(tick);
    // 일반 모드: 계속 섞기 / 새 문제, 시간 모드: 모드 변경 / 다시 하기
    $('again').textContent = mode === 'normal' ? '계속 섞기' : '모드 변경';
    $('next').textContent = mode === 'normal' ? '새 문제' : '다시 하기';
    setTimeout(() => $('next').focus(), 50);
  }
  function hideResult() { $('result').hidden = true; }
  function continueMixing() { hideResult(); state = 'playing'; }
  function updateBest() {
    const v = bests[mode];
    const text = v == null ? '—' : mode === 'speed' ? secText(v) : `${v.toFixed(1)}%`;
    $('best').textContent = `${MODES[mode].icon} 내 최고 ${text}`;
  }

  // ---------- 타이머 ----------
  let lastTimerText = '';
  function tickTimer() {
    if (state !== 'playing' || mode === 'normal') return;
    const t = elapsed();
    let text;
    if (mode === 'sec30') {
      const left = Math.max(0, MODES.sec30.limit - t);
      text = (left / 1000).toFixed(1);
      $('timer').classList.toggle('warn', left < 10000);
      if (left <= 0) { timeUp(); return; }
    } else {
      text = (t / 1000).toFixed(1);
      $('timer').classList.remove('warn');
      if (t >= MODES.speed.cap) { giveUp(); return; }
    }
    if (text !== lastTimerText) { $('timer').textContent = text; lastTimerText = text; }
  }
  function blankResult() {
    return { score: 0, hex: CE.linToHex(PAPER), css: CE.linToCss(PAPER) };
  }
  function timeUp() {
    $('timer').textContent = '0.0';
    const res = judge() || blankResult();
    showResult({ ...res, time: MODES.sec30.limit, timeout: true });
  }
  function giveUp() {
    const res = judge() || blankResult();
    showResult({ ...res, time: MODES.speed.cap, fail: true });
  }

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------- 그리기 ----------
  const LUT = new Uint8ClampedArray(4097);
  for (let i = 0; i <= 4096; i++) LUT[i] = Math.round(CE.toSrgb(i / 4096) * 255);
  const lut = v => LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0];

  // 물감 결(임파스토)용 노이즈: 두 옥타브 값 노이즈
  (function makeNoise() {
    const grid = (sx, sy, seed) => {
      const gw = Math.ceil(RW / sx) + 2, gh = Math.ceil(RH / sy) + 2, g = new Float32Array(gw * gh);
      let st = seed; for (let i = 0; i < g.length; i++) { st = (st * 16807) % 2147483647; g[i] = st / 2147483647 - 0.5; }
      return (x, y) => {
        const u = x / sx, v = y / sy, x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
        const sx2 = fx * fx * (3 - 2 * fx), sy2 = fy * fy * (3 - 2 * fy);
        return a + (b - a) * sx2 + (c - a) * sy2 + (a - b - c + d) * sx2 * sy2;
      };
    };
    const n1 = grid(RS * 3.0, RS * 1.6, 11), n2 = grid(RS * 1.4, RS * 0.9, 29);
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) NOISE[y * RW + x] = n1(x, y) * 0.7 + n2(x, y) * 0.4;
  })();

  const WT = new Float32Array(N), WC = new Float32Array(N * 3), TS = new Float32Array(N);
  // 격자 → 물감 텍스처(높이 half-float, 색 sRGB + 덮임)
  function paintTextures() {
    for (let c = 0; c < N; c++) {
      const t = thick[c];
      if (t > 1e-5) {
        cellColor(c);
        const w = Math.min(t, 0.25) + 1e-4;
        WT[c] = w; WC[c * 3] = col[c * 3] * w; WC[c * 3 + 1] = col[c * 3 + 1] * w; WC[c * 3 + 2] = col[c * 3 + 2] * w;
      } else { WT[c] = 0; WC[c * 3] = WC[c * 3 + 1] = WC[c * 3 + 2] = 0; }
    }
    for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
      const c = y * GX + x, t = thick[c];
      const l = x > 0 ? thick[c - 1] : t, r = x < GX - 1 ? thick[c + 1] : t, u = y > 0 ? thick[c - GX] : t, d = y < GY - 1 ? thick[c + GX] : t;
      TS[c] = t * 0.5 + (l + r + u + d) * 0.125;
    }
    const inv = 1 / RS;
    for (let Y = 0; Y < RH; Y++) {
      let v = (Y + 0.5) * inv - 0.5; if (v < 0) v = 0; if (v > GY - 1) v = GY - 1;
      const y0 = Math.min(GY - 2, v | 0); let fy = v - y0; fy = fy * fy * (3 - 2 * fy);
      for (let X = 0; X < RW; X++) {
        let u = (X + 0.5) * inv - 0.5; if (u < 0) u = 0; if (u > GX - 1) u = GX - 1;
        const x0 = Math.min(GX - 2, u | 0); let fx = u - x0; fx = fx * fx * (3 - 2 * fx);
        const c00 = y0 * GX + x0, c10 = c00 + 1, c01 = c00 + GX, c11 = c01 + 1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const i = Y * RW + X, o = i * 4;
        const t = TS[c00] * w00 + TS[c10] * w10 + TS[c01] * w01 + TS[c11] * w11;
        const a = coverage(t);
        // 높이: 두께 + 물감 결. 덮이지 않은 곳은 0
        const h = a > 0 ? (t > 1.4 ? 1.4 : t) * 0.9 + NOISE[i] * (t > 0.45 ? 0.45 : t) * 0.12 : 0;
        HEIGHT[i] = DataUtils.toHalfFloat(h * a);
        if (a > 0) {
          const ws = WT[c00] * w00 + WT[c10] * w10 + WT[c01] * w01 + WT[c11] * w11 + 1e-9;
          COLOR[o] = lut((WC[c00 * 3] * w00 + WC[c10 * 3] * w10 + WC[c01 * 3] * w01 + WC[c11 * 3] * w11) / ws);
          COLOR[o + 1] = lut((WC[c00 * 3 + 1] * w00 + WC[c10 * 3 + 1] * w10 + WC[c01 * 3 + 1] * w01 + WC[c11 * 3 + 1] * w11) / ws);
          COLOR[o + 2] = lut((WC[c00 * 3 + 2] * w00 + WC[c10 * 3 + 2] * w10 + WC[c01 * 3 + 2] * w01 + WC[c11 * 3 + 2] * w11) / ws);
          COLOR[o + 3] = Math.round(a * 255);
        } else COLOR[o + 3] = 0;
      }
    }
    S3.updatePaint(RW, RH, HEIGHT, COLOR);
  }

  function render() {
    if (!S3) return;
    if (needsPaint) { const t0 = performance.now(); paintTextures(); needsPaint = false; lastPaintMs = performance.now() - t0; }
    S3.setLens(lens.x, lens.y);
    if (drag && drag.mode === 'tube') { const [nx, ny] = nozzlePos(drag); S3.setHeldTube(drag.tube, nx, ny); }
    else S3.setHeldTube(-1);
    if (drag && drag.mode === 'knife') S3.setKnife(true, knife.x, knife.y, knife.x - knife.px, knife.y - knife.py);
    else S3.setKnife(false);
    S3.render();
    needsRender = false;
  }

  // ---------- 입력 ----------
  const LENS_PICK_H = 0.42;           // 돋보기는 팔레트 위에 떠 있으니 그 높이에서 잡는다
  function onDown(e) {
    if (state !== 'playing' || drag || !S3) return;
    const touch = e.pointerType !== 'mouse';
    const at = S3.pick(e.clientX, e.clientY), atLens = S3.pick(e.clientX, e.clientY, LENS_PICK_H);
    if (!at) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}   // 일부 기기에서 실패해도 조작은 계속되게
    const tube = S3.pickTube(e.clientX, e.clientY);
    if (tube >= 0) {
      // 집자마자 바닥에 찍히지 않게 처음엔 빠르게 움직이는 것으로 본다
      drag = { id: e.pointerId, mode: 'tube', tube, gx: at.gx, gy: at.gy, cx: e.clientX, cy: e.clientY, sx: e.clientX, sy: e.clientY, touch, last: null, speed: 600 };
    } else if (atLens && hitLens(atLens.gx, atLens.gy)) {
      drag = { id: e.pointerId, mode: 'lens', ox: lens.x - atLens.gx, oy: lens.y - atLens.gy };
    } else {
      if (!inPalette(at.gx, at.gy)) { try { cv.releasePointerCapture(e.pointerId); } catch (err) {} drag = null; return; }
      drag = { id: e.pointerId, mode: 'knife' };
      knife.x = knife.px = at.gx; knife.y = knife.py = at.gy; knife.active = true;
      knifeStep(at.gx, at.gy);
    }
    needsRender = true;
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id || !S3) return;
    if (drag.mode === 'lens') {
      const p = S3.pick(e.clientX, e.clientY, LENS_PICK_H);
      if (p) { lens.x = p.gx + drag.ox; lens.y = p.gy + drag.oy; clampLens(); }
    } else {
      const p = S3.pick(e.clientX, e.clientY);
      if (!p) return;
      if (drag.mode === 'knife') knifeTo(clampG(p.gx, GX), clampG(p.gy, GY));
      else { drag.gx = p.gx; drag.gy = p.gy; drag.cx = e.clientX; drag.cy = e.clientY; }
    }
    needsRender = true;
    e.preventDefault();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.mode === 'knife') knifeRelease();
    if (drag.mode === 'tube' && !drag.squeezed) toast('튜브를 누른 채로 팔레트 위까지 끌어오세요');
    drag = null; needsRender = true;
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (!$('ranking').hidden) return;
    if (!$('howto').hidden) { if (e.key === 'Escape') closeHowto(); return; }
    if (state === 'result' && mode === 'normal' && e.key === 'Escape') { continueMixing(); return; }
    if (state !== 'playing') return;
    const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (m) { lens.x += m[0]; lens.y += m[1]; clampLens(); needsRender = true; e.preventDefault(); }
  });

  // ---------- 매 프레임 ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (drag && drag.mode === 'tube') {
      // 손 움직임 속도(px/s)를 0.09초 시간상수로 부드럽게
      const inst = drag.px == null ? 0 : Math.hypot(drag.cx - drag.px, drag.cy - drag.py) / Math.max(dt, 1e-3);
      drag.px = drag.cx; drag.py = drag.cy;
      drag.speed = (drag.speed || 0) + (inst - (drag.speed || 0)) * (1 - Math.exp(-dt / 0.09));
      const [gx, gy] = nozzlePos(drag);
      // 튜브를 집자마자 팔레트 끝에 물감이 묻지 않도록, 조금 끌어온 뒤부터 짠다
      if (!drag.armed && Math.hypot(drag.cx - drag.sx, drag.cy - drag.sy) > 18) drag.armed = true;
      if (drag.armed && inPalette(gx, gy)) {
        // 지난 프레임 노즐 위치부터 지금 위치까지 선을 따라 짜낸다
        const from = drag.last && inPalette(...drag.last) ? drag.last : [gx, gy];
        const dist = Math.hypot(gx - from[0], gy - from[1]);
        // 빠르게 지나가면 거의 안 나오고, 멈추거나 천천히 움직일 때 많이 나온다
        const flow = 1 / (1 + Math.pow(drag.speed / 200, 3));
        const steps = Math.max(1, Math.ceil(dist / 0.8));
        const amount = SQUEEZE_RATE * dt * flow / steps;
        for (let i = 1; i <= steps; i++) {
          deposit(from[0] + (gx - from[0]) * i / steps, from[1] + (gy - from[1]) * i / steps, drag.tube, amount);
        }
        drag.squeezed = true;
      }
      drag.last = [gx, gy];
      needsRender = true;
    }
    tickTimer();
    if (needsRender) render();
    requestAnimationFrame(frame);
  }

  // ---------- 버튼 ----------
  $('done').addEventListener('click', () => {
    if (state !== 'playing') return;
    const res = judge();
    if (!res) { toast('렌즈 안에 물감이 부족해요. 돋보기를 물감 위로 옮겨 주세요.'); return; }
    const t = elapsed();
    if (mode === 'speed' && res.score < MODES.speed.goal) {
      toast(`일치율 ${res.score.toFixed(1)}% — 90% 이상이어야 성공! 더 섞어 보세요`, 2400);
      return;
    }
    showResult({ ...res, time: mode === 'sec30' ? Math.min(t, MODES.sec30.limit) : t });
  });
  $('clear').addEventListener('click', () => { if (state === 'playing') { clearPalette(); toast('팔레트를 비웠어요', 1200); } });
  $('again').addEventListener('click', () => (mode === 'normal' ? continueMixing() : openModes()));
  $('next').addEventListener('click', () => { hideResult(); newRound(); });
  $('mode-chip').addEventListener('click', () => { if (state === 'playing') openModes(); });
  document.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => startMode(b.dataset.mode)));
  $('share').addEventListener('click', async () => {
    if (!lastResult) return;
    const url = location.href.split('#')[0];
    const r = lastResult;
    const head = r.mode === 'normal' ? `🎨 절대 색감 일치율 ${r.score.toFixed(1)}%!` : r.mode === 'speed'
      ? (r.fail ? '⚡ 절대 색감 스피드 런 도전 실패!' : `⚡ 절대 색감 스피드 런 ${secText(r.time)} (일치율 ${r.score.toFixed(1)}%)`)
      : `⏱ 절대 색감 30초 챌린지 일치율 ${r.score.toFixed(1)}%!`;
    const text = `${head} 목표 ${target.hex} → 내 색 ${r.hex}\n#절대색감`;
    try {
      if (navigator.share) { await navigator.share({ title: '절대 색감', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('결과를 복사했어요. 붙여넣어 공유하세요!'); }
    catch (e) { toast('공유를 지원하지 않는 브라우저예요'); }
  });
  function openHowto() { $('howto').hidden = false; $('howto-close').focus(); }
  function closeHowto() {
    $('howto').hidden = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    if (state === 'menu' && $('modes').hidden) openModes();
  }
  $('howto-btn').addEventListener('click', openHowto);
  $('howto-close').addEventListener('click', closeHowto);
  $('howto').addEventListener('click', e => { if (e.target.id === 'howto') closeHowto(); });

  window.addEventListener('resize', layout);

  // ---------- 시작 ----------
  layout();
  updateBest();
  updateModeChip();
  $('timer').textContent = '';
  let seen = true;
  try { seen = !!localStorage.getItem(SEEN_KEY); } catch (e) {}
  if (seen) openModes(); else openHowto();
  requestAnimationFrame(frame);

  // 테스트/디버그용 훅
  window.__game = {
    get target() { return target; }, get state() { return state; }, get paintMs() { return lastPaintMs; }, get renderScale() { return RS; }, S3, get mode() { return mode; },
    startMode, setElapsed(ms) { runStart = performance.now() - ms; }, 
    /** 테스트용: 튜브 i 의 화면 좌표(클라이언트), 격자 좌표 → 화면 좌표 */
    tubeClient(i) { const r = cv.getBoundingClientRect(), [x, y] = S3.tubeScreen(i); return [r.left + x, r.top + y]; },
    gridClient(gx, gy) { const r = cv.getBoundingClientRect(), [x, y] = S3.project(gx, gy); return [r.left + x, r.top + y]; }, lens, judge, recompute, GX, GY, NP, amt, thick,
    // 테스트용: 격자 좌표로 물감 짜기 / 헤라 긋기 / 섞임 정도 재기
    squeezeAt(gx, gy, pigment, amount) { deposit(gx, gy, pigment, amount); },
    knifeStroke(pts) {
      knife.x = knife.px = pts[0][0]; knife.y = knife.py = pts[0][1]; knifeStep(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) knifeTo(x, y);
      knifeRelease(); needsRender = true;
    },
    mixStats(x0, y0, x1, y1) {
      const labs = [], lab = [0, 0, 0], rgb = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = y * GX + x; if (thick[c] < COV1) continue;
        cellColor(c); CE.linToLab([col[c * 3], col[c * 3 + 1], col[c * 3 + 2]], lab); labs.push(lab.slice());
      }
      if (!labs.length) return null;
      const m = [0, 1, 2].map(k => labs.reduce((a, l) => a + l[k], 0) / labs.length);
      const de = labs.map(l => CE.deltaE2000(...l, ...m)).sort((a, b) => a - b);
      return { cells: labs.length, meanDE: de.reduce((a, b) => a + b, 0) / de.length, p90: de[Math.floor(de.length * 0.9)], total: thick.reduce((a, b) => a + b, 0) };
    },
    fillAll(parts, t = 0.3) {
      const tot = parts.reduce((a, b) => a + b, 0);
      for (let c = 0; c < N; c++) for (let p = 0; p < NP; p++) amt[c * NP + p] = parts[p] / tot * t;
      recompute(); needsRender = true;
    },
    mixHex(parts) { return CE.linToHex(CE.mixLinear(parts)); },
    fillLensWith(parts) {
      const tot = parts.reduce((a, b) => a + b, 0);
      for (const c of judgeCells()) for (let p = 0; p < NP; p++) amt[c * NP + p] = parts[p] / tot * 0.3;
      recompute(); needsRender = true;
    },
  };
})();
