// 한 번 슥 긋기 장면 스크린샷: node test/swipe-shot.mjs <tag>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), tag = process.argv[2] || 'x';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'x' }); res.end(d); }); }).listen(0);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await pg.route(/googlesyndication|api\.saekgam|api-staging/, r => r.abort());
await pg.addInitScript(() => localStorage.setItem('jeoldae-saekgam.howto', '1'));
await pg.goto(`http://127.0.0.1:${server.address().port}/`); await pg.waitForTimeout(600);
await pg.click('.mode-card[data-mode="normal"]'); await pg.waitForTimeout(200);
const tot = await pg.evaluate(() => {
  const G = __game;
  // 튜브를 1초쯤 짠 덩이: 빨강, 군청, 갈색, 흰색
  const blob = (x, y, p, sec) => { for (let i = 0; i < sec * 30; i++) G.squeezeAt(x, y, p, 36 / 30); };
  blob(30, 60, 2, 1); blob(55, 55, 4, 0.8); blob(80, 62, 6, 0.8); blob(45, 95, 0, 1); blob(65, 100, 4, 0.5);
  const before = Array.from(G.thick).reduce((a, b) => a + b, 0);
  G.knifeStroke([[22, 60], [90, 58]]);       // 한 번 슥
  G.knifeStroke([[35, 92], [75, 102]]);
  G.knifeStroke([[40, 85], [70, 108], [40, 100]]);
  return [before, Array.from(G.thick).reduce((a, b) => a + b, 0)];
});
await pg.waitForTimeout(1500);
await pg.screenshot({ path: `/tmp/swipe-${tag}.png` });
console.log('총량 전/후', tot.map(v => v.toFixed(1)).join(' / '), 'paintMs', await pg.evaluate(() => __game.paintMs));
await b.close(); server.close();
