// 실제 브라우저에서 플레이: node test/e2e.mjs <outdir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || '/tmp/shots';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function run(name, viewport, isMobile) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-0-howto.png` });
  await page.click('#howto-close');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}-1-start.png` });

  // 튜브 위치 계산 후 끌어서 짜기
  const geo = await page.evaluate(() => {
    const r = document.getElementById('cv').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  });
  const tubes = await page.evaluate(() => __game.tubes);
  const Pp = await page.evaluate(() => __game.palette);
  async function squeeze(i, path) {
    await page.mouse.move(geo.left + tubes[i].x, geo.top + tubes[i].y);
    await page.mouse.down();
    for (const [x, y] of path) { await page.mouse.move(geo.left + Pp.x + x * Pp.w, geo.top + Pp.y + y * Pp.h + 60, { steps: 12 }); await page.waitForTimeout(140); }
    await page.mouse.up();
  }
  async function smear(path) {
    await page.mouse.move(geo.left + Pp.x + path[0][0] * Pp.w, geo.top + Pp.y + path[0][1] * Pp.h);
    await page.mouse.down();
    for (const [x, y] of path.slice(1)) await page.mouse.move(geo.left + Pp.x + x * Pp.w, geo.top + Pp.y + y * Pp.h, { steps: 8 });
    await page.mouse.up();
  }
  await squeeze(1, [[0.40, 0.36], [0.46, 0.37], [0.50, 0.39], [0.54, 0.38]]);   // 노랑
  await squeeze(5, [[0.55, 0.40], [0.58, 0.42]]);                 // 청록
  await squeeze(0, [[0.50, 0.30], [0.53, 0.30]]);                 // 흰색
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}-2-squeezed.png` });
  for (let k = 0; k < 8; k++) {
    await smear([[0.42, 0.34], [0.56, 0.44], [0.44, 0.44], [0.56, 0.34], [0.48, 0.46], [0.50, 0.38]]);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}-3-mixed.png` });
  // 돋보기를 섞은 곳으로 (테두리 잡고 끌기)
  const lensInfo = await page.evaluate(() => ({ x: __game.lens.x, y: __game.lens.y }));
  console.log(name, 'lens start', lensInfo);
  // 물감 무게중심 계산 후, 돋보기 손잡이를 실제로 끌어서 옮긴다
  const c = await page.evaluate(() => {
    const g = __game; let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < g.GY; y++) for (let x = 0; x < g.GX; x++) { const t = g.thick[y * g.GX + x]; if (t > 0.15) { sx += x * t; sy += y * t; sw += t; } }
    return { x: sx / sw, y: sy / sw, lx: g.lens.x, ly: g.lens.y };
  });
  const cell = Pp.w / await page.evaluate(() => __game.GX);
  const R = 15 * cell, hx = Pp.x + c.lx * cell + Math.cos(Math.PI / 4) * (R + 30), hy = Pp.y + c.ly * cell + Math.sin(Math.PI / 4) * (R + 30);
  await page.mouse.move(geo.left + hx, geo.top + hy); await page.mouse.down();
  await page.mouse.move(geo.left + hx + (c.x - c.lx) * cell, geo.top + hy + (c.y - c.ly) * cell, { steps: 10 }); await page.mouse.up();
  console.log(name, 'lens moved to', await page.evaluate(() => [__game.lens.x.toFixed(1), __game.lens.y.toFixed(1)]), 'paint center', c.x.toFixed(1), c.y.toFixed(1));
  await page.mouse.move(geo.left + 2, geo.top + 2);
  await page.click('#done');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/${name}-4-result.png` });
  const score = await page.textContent('#score');
  console.log(name, score, await page.textContent('#grade'), await page.textContent('#recipe'));

  // 정답 배합으로 채우면 100% 근처가 나와야 함
  if (await page.isVisible('#again')) await page.click('#again');
  const perfect = await page.evaluate(() => { __game.fillLensWith(__game.target.parts); return __game.judge(); });
  console.log(name, 'perfect-fill score', perfect && perfect.score, 'dE', perfect && perfect.dE.toFixed(3));
  await page.close();
}
await run('desktop', { width: 1280, height: 800 }, false);
await run('mobile', { width: 390, height: 844 }, true);
await browser.close();
server.close();
console.log('ERRORS', errors.length ? errors : 'none');
