/*
 * 절대 색감 — 게임 로직 (2D Canvas, 외부 라이브러리 없음)
 * 팔레트를 격자로 나눠 칸마다 물감 8종의 양을 저장하고,
 * 칸의 색은 color.js 의 분광 Kubelka-Munk 혼합으로 계산한다.
 */
(() => {
  'use strict';
  const CE = window.ColorEngine;
  const NP = CE.NP;
  const $ = id => document.getElementById(id);

  // ---------- 설정값 ----------
  const GX = 108, GY = 144, N = GX * GY;  // 팔레트 격자 (가로 3 : 세로 4)
  const FULL = 0.22;            // 이 두께 이상이면 바탕이 완전히 가려짐
  const SQUEEZE_RATE = 11;      // 튜브에서 초당 나오는 물감 양 (두께×칸)
  const BLOB_R = 2.9;           // 짜낸 물감 방울 반지름 (칸)
  const KNIFE_R = 5.0;          // 헤라 반지름 (칸)
  const PICK = 0.32, DROP = 0.34;  // 헤라가 한 걸음마다 묻혀 가는/내려놓는 비율
  const LENS_R = 15;            // 돋보기 렌즈 반지름 (칸)
  const ZOOM = 1.6;             // 돋보기 배율 (판정 범위 = 보이는 범위)
  const JUDGE_R = LENS_R / ZOOM;
  const SCORE_ZERO = 40;        // CIEDE2000 이 값 이상이면 0%
  const PAINT_MIN = 0.18;       // 판정에 필요한 렌즈 안 평균 두께 비율
  const TUBE_AREA = 118;        // 튜브 받침 영역 높이 (CSS px)
  const BEST_KEY = 'jeoldae-saekgam.best';
  const SEEN_KEY = 'jeoldae-saekgam.howto';

  // ---------- 상태 ----------
  const amt = new Float32Array(N * NP);   // 칸별 물감 양
  const thick = new Float32Array(N);      // 칸별 총 두께
  const col = new Float32Array(N * 3);    // 칸별 물감 색(선형 sRGB, 바탕 미포함)
  const dirty = new Uint8Array(N).fill(1);
  const tmpA = new Float32Array(NP), tmpRGB = [0, 0, 0];
  const PAPER = [0.955, 0.950, 0.932].map(CE.toLin);

  let target = null;            // { parts, lin, lab, css, hex }
  let state = 'playing';
  let best = 0;
  try { best = parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch (e) {}

  const lens = { x: GX * 0.5, y: GY * 0.62 };
  const knife = { load: new Float32Array(NP), active: false, x: 0, y: 0, px: 0, py: 0 };
  let drag = null;              // { mode: 'tube'|'knife'|'lens', ... }
  let needsRender = true;

  // ---------- 캔버스 / 레이아웃 ----------
  const cv = $('cv'), ctx = cv.getContext('2d');
  const off = document.createElement('canvas'); off.width = GX; off.height = GY;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(GX, GY);
  let W = 0, H = 0, DPR = 1, P = { x: 0, y: 0, w: 0, h: 0, cell: 1 }, tubes = [];

  function layout() {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const availH = Math.max(160, H - TUBE_AREA - 6);
    let pw = Math.min(W - 16, 540), ph = pw * GY / GX;
    if (ph > availH) { ph = availH; pw = ph * GX / GY; }
    P = { x: (W - pw) / 2, y: 2, w: pw, h: ph, cell: pw / GX };
    document.documentElement.style.setProperty('--palette-w', `${Math.max(pw, 260)}px`);
    // 튜브 배치
    const n = NP, span = Math.min(W - 12, Math.max(pw + 40, 320));
    const step = span / n, tw = Math.min(34, step * 0.62), th = tw * 2.75;
    const top = P.y + P.h + (H - (P.y + P.h) - th) / 2 + 4;
    tubes = CE.PIGMENTS.map((p, i) => ({
      p, w: tw, h: th, x: (W - span) / 2 + step * (i + 0.5), y: top + th / 2,
    }));
    needsRender = true;
  }

  // ---------- 격자 유틸 ----------
  const toGrid = (x, y) => [(x - P.x) / P.cell, (y - P.y) / P.cell];
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
  function shownColor(c, out) {
    cellColor(c);
    const t = Math.min(1, thick[c] / FULL), cov = t * (2 - t);
    for (let k = 0; k < 3; k++) out[k] = PAPER[k] * (1 - cov) + col[c * 3 + k] * cov;
    return out;
  }
  function recompute() {
    for (let c = 0; c < N; c++) thick[c] = 0;
    for (let c = 0; c < N; c++) { let s = 0; for (let p = 0; p < NP; p++) s += amt[c * NP + p]; thick[c] = s; }
    dirty.fill(1);
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
    needsRender = true;
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
    // 1) 헤라 아래 물감을 일부 묻혀 간다
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], f = PICK * ws[i];
      if (thick[c] <= 0) continue;
      for (let p = 0; p < NP; p++) {
        const v = amt[c * NP + p] * f; amt[c * NP + p] -= v; load[p] += v;
      }
    }
    // 2) 묻은 물감(이미 섞인 상태)을 고르게 내려놓는다
    let loadSum = 0; for (let p = 0; p < NP; p++) loadSum += load[p];
    if (loadSum > 1e-7) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], share = DROP * ws[i] / wsum;
        for (let p = 0; p < NP; p++) amt[c * NP + p] += load[p] * share;
      }
      for (let p = 0; p < NP; p++) load[p] *= (1 - DROP);
    }
    for (const c of cells) {
      let s = 0; for (let p = 0; p < NP; p++) { if (amt[c * NP + p] < 1e-7) amt[c * NP + p] = 0; s += amt[c * NP + p]; }
      thick[c] = s; dirty[c] = 1;
    }
    needsRender = true;
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
  const HANDLE_ANG = Math.PI / 4;
  function lensGeom() {
    const cx = P.x + lens.x * P.cell, cy = P.y + lens.y * P.cell, R = LENS_R * P.cell;
    const hx0 = cx + Math.cos(HANDLE_ANG) * (R + 4), hy0 = cy + Math.sin(HANDLE_ANG) * (R + 4);
    const len = Math.max(46, R * 1.35);
    const hx1 = hx0 + Math.cos(HANDLE_ANG) * len, hy1 = hy0 + Math.sin(HANDLE_ANG) * len;
    return { cx, cy, R, hx0, hy0, hx1, hy1 };
  }
  function hitLens(x, y) {
    const g = lensGeom(), d = Math.hypot(x - g.cx, y - g.cy);
    if (d > g.R - Math.max(10, g.R * 0.22) && d < g.R + 14) return true;
    // 손잡이 선분과의 거리
    const vx = g.hx1 - g.hx0, vy = g.hy1 - g.hy0;
    const t = Math.max(0, Math.min(1, ((x - g.hx0) * vx + (y - g.hy0) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - (g.hx0 + vx * t), y - (g.hy0 + vy * t)) < 16;
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
  function hitTube(x, y) {
    for (const t of tubes) {
      if (Math.abs(x - t.x) < Math.max(t.w * 0.75, 20) && Math.abs(y - t.y) < t.h * 0.6) return t;
    }
    return null;
  }
  // 손가락에 가리지 않도록 터치일 때는 노즐을 더 위로
  function nozzlePos(d) {
    const t = d.tube, lift = d.touch ? 34 : 6;
    return [d.x, d.y - t.h * 0.5 - lift];
  }

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
    state = 'playing';
  }
  function clearPalette() {
    amt.fill(0); thick.fill(0); dirty.fill(1); knife.load.fill(0); needsRender = true;
  }

  // ---------- 판정 ----------
  function judge() {
    const cells = judgeCells();
    let paint = 0;
    for (const c of cells) paint += Math.min(1, thick[c] / FULL);
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

  let revealRaf = 0, lastResult = null;
  function showResult(res) {
    state = 'result';
    lastResult = res;
    const isNew = res.score > best;
    if (isNew) { best = res.score; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }
    updateBest();
    $('cmp-target').style.background = target.css;
    $('cmp-mine').style.background = res.css;
    $('hex-target').textContent = target.hex;
    $('hex-mine').textContent = res.hex;
    $('grade').textContent = '';
    $('recipe').textContent = recipeText(target.parts);
    const ov = $('result'), card = ov.querySelector('.result-card');
    card.classList.remove('show', 'done');
    ov.hidden = false;
    window.Ads && window.Ads.showResultAd($('result-ad'));
    requestAnimationFrame(() => card.classList.add('show'));
    const t0 = performance.now() + 450, dur = 1300;
    cancelAnimationFrame(revealRaf);
    const tick = now => {
      const t = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - t, 3);
      $('score').textContent = `일치율 ${(res.score * e).toFixed(1)}%`;
      if (t < 1) { revealRaf = requestAnimationFrame(tick); return; }
      $('grade').innerHTML = gradeText(res.score) + (isNew ? '<span class="new">최고 기록</span>' : '');
      card.classList.add('done');
    };
    revealRaf = requestAnimationFrame(tick);
    setTimeout(() => $('next').focus(), 50);
  }
  function hideResult() { $('result').hidden = true; state = 'playing'; }
  function updateBest() { $('best').textContent = best > 0 ? `최고 기록 ${best.toFixed(1)}%` : '최고 기록 —'; }

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------- 그리기 ----------
  const LUT = new Uint8ClampedArray(4097);
  for (let i = 0; i <= 4096; i++) LUT[i] = Math.round(CE.toSrgb(i / 4096) * 255);
  const lut = v => LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0];

  function paintImage() {
    const d = img.data, rgb = [0, 0, 0];
    for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
      const c = y * GX + x, i = c * 4;
      shownColor(c, rgb);
      let shade = 1, spec = 0;
      if (thick[c] > 0.002) {
        // 두께 기울기로 빛(왼쪽 위) 음영과 광택
        const h = k => Math.min(1.4, thick[k]);
        const hl = x > 0 ? h(c - 1) : h(c), hr = x < GX - 1 ? h(c + 1) : h(c);
        const hu = y > 0 ? h(c - GX) : h(c), hd = y < GY - 1 ? h(c + GX) : h(c);
        const gx = hr - hl, gy = hd - hu;
        const lit = -(gx + gy) * 1.6;
        shade = 1 + Math.max(-0.35, Math.min(0.25, lit));
        spec = Math.max(0, lit - 0.18) * 0.55;
      }
      d[i] = lut(rgb[0] * shade + spec);
      d[i + 1] = lut(rgb[1] * shade + spec);
      d[i + 2] = lut(rgb[2] * shade + spec);
      d[i + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function drawTube(t, x, y, open, ghost) {
    const w = t.w, h = t.h;
    ctx.save();
    ctx.translate(x, y);
    if (ghost) ctx.globalAlpha = 0.28;
    // 그림자
    if (!ghost) { ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4; }
    // 몸통 (금속)
    const bodyTop = -h * 0.30, bodyBot = h * 0.42;
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#9fa2a7'); g.addColorStop(0.35, '#eceef0'); g.addColorStop(0.7, '#c9ccd0'); g.addColorStop(1, '#8c8f94');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, bodyBot); ctx.lineTo(-w * 0.5, bodyTop + w * 0.12);
    ctx.quadraticCurveTo(-w * 0.5, bodyTop - w * 0.1, -w * 0.2, bodyTop - w * 0.28);
    ctx.lineTo(w * 0.2, bodyTop - w * 0.28);
    ctx.quadraticCurveTo(w * 0.5, bodyTop - w * 0.1, w * 0.5, bodyTop + w * 0.12);
    ctx.lineTo(w * 0.5, bodyBot); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    // 라벨 (물감 색)
    const lg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    lg.addColorStop(0, 'rgba(0,0,0,.22)'); lg.addColorStop(0.35, 'rgba(255,255,255,.18)'); lg.addColorStop(0.75, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = t.p.css; ctx.fillRect(-w / 2, -h * 0.12, w, h * 0.42);
    ctx.fillStyle = lg; ctx.fillRect(-w / 2, -h * 0.12, w, h * 0.42);
    // 아래 접힌 끝
    ctx.fillStyle = '#b5b8bd'; ctx.fillRect(-w * 0.54, bodyBot - 2, w * 1.08, h * 0.08);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    for (let k = -2; k <= 2; k++) ctx.fillRect(k * w * 0.2 - 0.5, bodyBot, 1, h * 0.06);
    // 목 + 뚜껑
    const neckY = bodyTop - w * 0.28;
    ctx.fillStyle = '#c4c7cb'; ctx.fillRect(-w * 0.16, neckY - h * 0.06, w * 0.32, h * 0.06);
    if (!open) {
      const cg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      cg.addColorStop(0, '#7d8085'); cg.addColorStop(0.4, '#d7d9dc'); cg.addColorStop(1, '#6f7277');
      ctx.fillStyle = cg;
      roundRect(ctx, -w * 0.32, neckY - h * 0.2, w * 0.64, h * 0.15, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let k = -2; k <= 2; k++) ctx.fillRect(k * w * 0.1 - 0.5, neckY - h * 0.19, 1, h * 0.13);
    } else {
      // 열린 노즐 끝에 물감 한 방울
      ctx.fillStyle = t.p.css;
      ctx.beginPath(); ctx.ellipse(0, neckY - h * 0.06, w * 0.13, w * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawKnife(x, y) {
    // 날 끝이 (x,y). 손잡이는 오른쪽 아래로.
    ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 4 + Math.PI);
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    const bg = ctx.createLinearGradient(0, -10, 0, 10);
    bg.addColorStop(0, '#d9dce0'); bg.addColorStop(0.5, '#a7abb1'); bg.addColorStop(1, '#7f838a');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-14, -12, -34, -7); ctx.lineTo(-38, 0); ctx.lineTo(-34, 7); ctx.quadraticCurveTo(-14, 12, 0, 0); ctx.fill();
    ctx.strokeStyle = '#7d8187'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(-52, 0); ctx.stroke();
    ctx.fillStyle = '#5b3a24'; roundRect(ctx, -96, -5, 46, 10, 5); ctx.fill();
    ctx.restore();
  }

  function drawLens() {
    const g = lensGeom();
    // 손잡이
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
    ctx.strokeStyle = '#b9bcc1'; ctx.lineWidth = 7;
    const nx = g.hx0 + Math.cos(HANDLE_ANG) * 10, ny = g.hy0 + Math.sin(HANDLE_ANG) * 10;
    ctx.beginPath(); ctx.moveTo(g.hx0, g.hy0); ctx.lineTo(nx, ny); ctx.stroke();
    ctx.strokeStyle = '#1f1f22'; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(g.hx1, g.hy1); ctx.stroke();
    ctx.restore();
    // 확대된 물감
    ctx.save();
    ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const sr = LENS_R / ZOOM;
    ctx.drawImage(off, lens.x - sr, lens.y - sr, sr * 2, sr * 2, g.cx - g.R, g.cy - g.R, g.R * 2, g.R * 2);
    const gl = ctx.createRadialGradient(g.cx - g.R * 0.4, g.cy - g.R * 0.45, 0, g.cx, g.cy, g.R);
    gl.addColorStop(0, 'rgba(255,255,255,.35)'); gl.addColorStop(0.35, 'rgba(255,255,255,.06)'); gl.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = gl; ctx.fillRect(g.cx - g.R, g.cy - g.R, g.R * 2, g.R * 2);
    ctx.restore();
    // 테두리
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    const rg = ctx.createLinearGradient(g.cx - g.R, g.cy - g.R, g.cx + g.R, g.cy + g.R);
    rg.addColorStop(0, '#f1f2f4'); rg.addColorStop(0.5, '#9a9ea4'); rg.addColorStop(1, '#5d6066');
    ctx.strokeStyle = rg; ctx.lineWidth = Math.max(5, g.R * 0.09);
    ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 팔레트 판
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.30)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#efeee9'; roundRect(ctx, P.x, P.y, P.w, P.h, 4); ctx.fill();
    ctx.restore();
    paintImage();
    ctx.save();
    roundRect(ctx, P.x, P.y, P.w, P.h, 4); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, P.x, P.y, P.w, P.h);
    // 판에 은은한 빛
    const sh = ctx.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
    sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.05)');
    ctx.fillStyle = sh; ctx.fillRect(P.x, P.y, P.w, P.h);
    ctx.restore();

    drawLens();
    // 튜브 받침
    for (const t of tubes) {
      const held = drag && drag.mode === 'tube' && drag.tube === t;
      drawTube(t, t.x, t.y, false, held);
    }
    if (drag && drag.mode === 'tube') {
      const [nx, ny] = nozzlePos(drag);
      drawTube(drag.tube, nx, ny + drag.tube.h * 0.5 + drag.tube.h * 0.36, true, false);
    }
    if (drag && drag.mode === 'knife') drawKnife(drag.x, drag.y);
    needsRender = false;
  }

  // ---------- 입력 ----------
  function onDown(e) {
    if (state !== 'playing' || drag) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const touch = e.pointerType !== 'mouse';
    cv.setPointerCapture(e.pointerId);
    if (hitLens(x, y)) {
      const [gx, gy] = toGrid(x, y);
      drag = { id: e.pointerId, mode: 'lens', ox: lens.x - gx, oy: lens.y - gy, x, y };
    } else {
      const t = hitTube(x, y);
      if (t) {
        drag = { id: e.pointerId, mode: 'tube', tube: t, x, y, sx: x, sy: y, touch, last: null };
      } else {
        const [gx, gy] = toGrid(x, y);
        if (!inPalette(gx, gy)) { cv.releasePointerCapture(e.pointerId); return; }
        drag = { id: e.pointerId, mode: 'knife', x, y };
        knife.x = gx; knife.y = gy; knife.active = true;
        knifeStep(gx, gy);
      }
    }
    needsRender = true;
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag.x = x; drag.y = y;
    const [gx, gy] = toGrid(x, y);
    if (drag.mode === 'lens') { lens.x = gx + drag.ox; lens.y = gy + drag.oy; clampLens(); }
    else if (drag.mode === 'knife') knifeTo(clampG(gx, GX), clampG(gy, GY));
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
    if (!$('howto').hidden) { if (e.key === 'Escape') closeHowto(); return; }
    if (state === 'result') { if (e.key === 'Escape') hideResult(); return; }
    const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (m) { lens.x += m[0]; lens.y += m[1]; clampLens(); needsRender = true; e.preventDefault(); }
  });

  // ---------- 매 프레임 ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (drag && drag.mode === 'tube') {
      // 손 움직임 속도(px/s)를 0.09초 시간상수로 부드럽게
      const inst = drag.px == null ? 0 : Math.hypot(drag.x - drag.px, drag.y - drag.py) / Math.max(dt, 1e-3);
      drag.px = drag.x; drag.py = drag.y;
      drag.speed = (drag.speed || 0) + (inst - (drag.speed || 0)) * (1 - Math.exp(-dt / 0.09));
      const [nx, ny] = nozzlePos(drag);
      const [gx, gy] = toGrid(nx, ny);
      // 튜브를 집자마자 팔레트 끝에 물감이 묻지 않도록, 조금 끌어온 뒤부터 짠다
      if (!drag.armed && Math.hypot(drag.x - drag.sx, drag.y - drag.sy) > 18) drag.armed = true;
      if (drag.armed && inPalette(gx, gy)) {
        // 지난 프레임 노즐 위치부터 지금 위치까지 선을 따라 짜낸다
        const from = drag.last && inPalette(...drag.last) ? drag.last : [gx, gy];
        const dist = Math.hypot(gx - from[0], gy - from[1]);
        // 빠르게 지나가면 거의 안 나오고, 멈추거나 천천히 움직일 때 많이 나온다
        const flow = 1 / (1 + Math.pow(drag.speed / 240, 2));
        const steps = Math.max(1, Math.ceil(dist / 0.8));
        const amount = SQUEEZE_RATE * dt * flow / steps;
        for (let i = 1; i <= steps; i++) {
          deposit(from[0] + (gx - from[0]) * i / steps, from[1] + (gy - from[1]) * i / steps, drag.tube.p.index, amount);
        }
        drag.squeezed = true;
      }
      drag.last = [gx, gy];
      needsRender = true;
    }
    if (needsRender) render();
    requestAnimationFrame(frame);
  }

  // ---------- 버튼 ----------
  $('done').addEventListener('click', () => {
    if (state !== 'playing') return;
    const res = judge();
    if (!res) { toast('렌즈 안에 물감이 부족해요. 돋보기를 물감 위로 옮겨 주세요.'); return; }
    showResult(res);
  });
  $('clear').addEventListener('click', () => { if (state === 'playing') { clearPalette(); toast('팔레트를 비웠어요', 1200); } });
  $('again').addEventListener('click', hideResult);
  $('next').addEventListener('click', () => { hideResult(); newRound(); });
  $('share').addEventListener('click', async () => {
    if (!lastResult) return;
    const url = location.href.split('#')[0];
    const text = `🎨 절대 색감 일치율 ${lastResult.score.toFixed(1)}%! 목표 ${target.hex} → 내 색 ${lastResult.hex}\n#절대색감`;
    try {
      if (navigator.share) { await navigator.share({ title: '절대 색감', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('결과를 복사했어요. 붙여넣어 공유하세요!'); }
    catch (e) { toast('공유를 지원하지 않는 브라우저예요'); }
  });
  function openHowto() { $('howto').hidden = false; $('howto-close').focus(); }
  function closeHowto() { $('howto').hidden = true; try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} }
  $('howto-btn').addEventListener('click', openHowto);
  $('howto-close').addEventListener('click', closeHowto);
  $('howto').addEventListener('click', e => { if (e.target.id === 'howto') closeHowto(); });

  window.addEventListener('resize', layout);

  // ---------- 시작 ----------
  layout();
  updateBest();
  newRound();
  try { if (!localStorage.getItem(SEEN_KEY)) openHowto(); } catch (e) {}
  requestAnimationFrame(frame);

  // 테스트/디버그용 훅
  window.__game = {
    get target() { return target; }, get tubes() { return tubes.map(t => ({ x: t.x, y: t.y })); }, get palette() { return P; }, lens, judge, recompute, GX, GY, NP, amt, thick,
    fillLensWith(parts) {
      const tot = parts.reduce((a, b) => a + b, 0);
      for (const c of judgeCells()) for (let p = 0; p < NP; p++) amt[c * NP + p] = parts[p] / tot * FULL * 2;
      recompute(); needsRender = true;
    },
  };
})();
