// 섞임 정도 측정: node test/mix-bench.mjs  (헤라 왕복·동그라미 횟수별 평균 색차, 낮을수록 잘 섞임)
// 노랑·청록을 나란히 짜고, 같은 범위를 헤라로 왕복하면서 섞임 정도(평균 색차)를 잰다
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), tag = process.argv[2] || 'x';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'x' }); res.end(d); }); }).listen(0);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 500, height: 700 } });
await pg.route(/googlesyndication|api\.saekgam|api-staging/, r => r.abort());
await pg.addInitScript(() => localStorage.setItem('jeoldae-saekgam.howto', '1'));
await pg.goto(`http://127.0.0.1:${server.address().port}/`); await pg.waitForTimeout(600);
await pg.click('.mode-card[data-mode="normal"]'); await pg.waitForTimeout(200);
const out = await pg.evaluate(() => {
  const G = __game, res = [];
  // 사람이 짜는 정도: 노랑 한 덩이, 청록 한 덩이 (각 약 1.5초 분량)
  for (let i = 0; i < 18; i++) { G.squeezeAt(40 + i * 0.3, 50, 1, 1.0); G.squeezeAt(62 + i * 0.3, 50, 5, 1.0); }
  res.push(['짠 직후', G.mixStats(30, 38, 80, 62)]);
  // 사람이 섞듯이: 두 덩이를 가로질러 왕복 (한 번 = 왼→오→왼)
  const stroke = () => G.knifeStroke([[38, 50], [72, 50], [38, 51], [72, 49], [55, 50]]);
  for (let n = 1; n <= 12; n++) { stroke(); if ([1, 2, 4, 8, 12].includes(n)) res.push([`왕복 ${n}번`, G.mixStats(25, 35, 85, 65)]); }
  // 시나리오 B: 새 판에서 경계 근처를 동그랗게 문지르기
  G.fillAll([1,0,0,0,0,0,0,0], 0);
  for (let i = 0; i < 18; i++) { G.squeezeAt(40 + i * 0.3, 50, 1, 1.0); G.squeezeAt(62 + i * 0.3, 50, 5, 1.0); }
  const circle = (cx, cy, r) => { const pts = []; for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.25) pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6]); return pts; };
  for (let n = 1; n <= 6; n++) { G.knifeStroke(circle(56, 50, 9)); if ([1, 3, 6].includes(n)) res.push([`동그라미 ${n}번`, G.mixStats(25, 35, 85, 65)]); }
  return res;
});
for (const [k, v] of out) console.log(k.padEnd(8), v ? `칸 ${String(v.cells).padStart(4)}  평균색차 ${v.meanDE.toFixed(1).padStart(5)}  상위10% ${v.p90.toFixed(1).padStart(5)}  총량 ${v.total.toFixed(1)}` : '-');
await pg.screenshot({ path: `/tmp/mix-${tag}.png` });
await b.close(); server.close();
