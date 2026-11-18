// 브라우저에서 랭킹 등록/조회 흐름 확인: node test/ranking-e2e.mjs <outdir>
// api.saekgam.cc 요청은 실제 Worker 코드(+ node:sqlite 로 만든 가짜 D1)로 처리한다.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || '/tmp/rank-shots'; fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const sqlite = new DatabaseSync(':memory:');
const D1 = {
  prepare(sql, args = []) {
    const idx = [...sql.matchAll(/\?(\d+)/g)].map(m => +m[1] - 1), q = sql.replace(/\?(\d+)/g, '?');
    const vals = () => (idx.length ? idx.map(i => args[i]) : args);
    return {
      bind: (...a) => D1.prepare(sql, a),
      all: async () => ({ results: sqlite.prepare(q).all(...vals()) }),
      first: async () => sqlite.prepare(q).get(...vals()) ?? null,
      run: async () => sqlite.prepare(q).run(...vals()),
      _exec: () => sqlite.prepare(q).run(...vals()),
    };
  },
  batch: async l => l.map(s => s._exec()),
};
let ipSeq = 0;
const env = { DB: D1, IP_SALT: 'e2e' };
// 미리 다른 사람 기록 몇 개
for (const [m, n, sc, t] of [['sec30', '색맹아님', 97.2, 21000], ['sec30', '팔레트장인', 91.4, 29000], ['speed', '번개손', 92.1, 14200], ['speed', '느긋', 90.3, 61000]]) {
  await worker.fetch(new Request('https://api.saekgam.cc/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.1.1.${++ipSeq}` }, body: JSON.stringify({ mode: m, name: n, score: sc, time_ms: t, target: '#5A8FD0', mine: '#5C8ECD' }) }), env);
}

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
const log = (...a) => console.log(...a);
for (const [name, viewport, mobile] of [['mobile', { width: 390, height: 844 }, true], ['pc', { width: 1280, height: 800 }, false]]) {
  const pg = await b.newPage({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  pg.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await pg.route('https://api.saekgam.cc/**', async route => {
    const r = route.request();
    const req = new Request(r.url(), { method: r.method(), headers: { ...r.headers(), 'CF-Connecting-IP': `2.2.2.${++ipSeq}` }, body: r.postData() || undefined });
    const res = await worker.fetch(req, env);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  await pg.goto(url);
  log(name, 'first visit: howto', await pg.isVisible('#howto'), 'state', await pg.evaluate(() => __game.state));
  await pg.click('#howto-close');
  log(name, 'then modes:', await pg.isVisible('#modes'));
  await pg.screenshot({ path: `${out}/${name}-modes.png` });

  // ---- 일반 모드 ----
  await pg.click('.mode-card[data-mode="normal"]');
  await pg.waitForTimeout(800);
  log(name, 'normal timer empty:', JSON.stringify(await pg.textContent('#timer')), '| best:', await pg.textContent('#best'));
  await pg.evaluate(() => { __game.lens.x = __game.GX / 2; __game.lens.y = __game.GY * 0.55; __game.fillLensWith(__game.target.parts); });
  await pg.click('#done'); await pg.waitForTimeout(2200);
  log(name, 'normal result:', await pg.textContent('#result-mode'), '|', await pg.textContent('#score'), '| form hidden:', await pg.isHidden('#rank-form'), '|', await pg.textContent('#rank-msg'), '| buttons:', await pg.textContent('#again'), '/', await pg.textContent('#next'));
  await pg.screenshot({ path: `${out}/${name}-normal-result.png` });
  await pg.click('#again');
  log(name, 'continue mixing → state:', await pg.evaluate(() => __game.state), '| result hidden:', await pg.isHidden('#result'));
  await pg.click('#done'); await pg.waitForTimeout(300);
  await pg.click('#next');
  log(name, 'new problem state:', await pg.evaluate(() => __game.state));
  await pg.click('#mode-chip');
  log(name, 'chip opens modes:', await pg.isVisible('#modes'));

  // ---- 30초 챌린지 ----
  await pg.click('.mode-card[data-mode="sec30"]');
  await pg.waitForTimeout(1200);
  log(name, 'sec30 timer:', await pg.textContent('#timer'), '| chip:', await pg.textContent('#mode-chip'));
  await pg.screenshot({ path: `${out}/${name}-sec30-play.png` });
  await pg.evaluate(() => { __game.lens.x = __game.GX / 2; __game.lens.y = __game.GY * 0.55; const q = __game.target.parts.slice(); q[0] += 1; __game.fillLensWith(q); __game.setElapsed(12345); });
  await pg.click('#done'); await pg.waitForTimeout(2200);
  log(name, 'sec30 result:', await pg.textContent('#result-mode'), '|', await pg.textContent('#score'), '|', await pg.textContent('#sub'), '|', await pg.textContent('#grade'), '| buttons:', await pg.textContent('#again'), '/', await pg.textContent('#next'));
  await pg.fill('#rank-name', name === 'mobile' ? '색감천재' : '데스크톱러');
  await pg.click('#rank-submit'); await pg.waitForTimeout(400);
  log(name, 'sec30 submit:', await pg.textContent('#rank-msg'));
  await pg.screenshot({ path: `${out}/${name}-sec30-result.png` });

  // ---- 30초 시간 종료 (물감 없음) ----
  await pg.click('#next');
  await pg.evaluate(() => __game.setElapsed(29900));
  await pg.waitForTimeout(2500);
  log(name, 'timeout result:', await pg.textContent('#score'), '|', await pg.textContent('#sub'), '| form hidden:', await pg.isHidden('#rank-form'));

  // ---- 스피드 런 ----
  await pg.click('#again');                         // 모드 변경
  await pg.click('.mode-card[data-mode="speed"]');
  await pg.waitForTimeout(600);
  log(name, 'speed timer counts up:', await pg.textContent('#timer'));
  await pg.evaluate(() => { const q = __game.target.parts.slice(); const i = q.findIndex((v, k) => k > 0 && v === 0); q[i] = 3; __game.fillLensWith(q); });
  await pg.click('#done'); await pg.waitForTimeout(300);
  log(name, 'speed under 90 → toast:', await pg.textContent('#toast'), '| still playing:', await pg.evaluate(() => __game.state));
  await pg.evaluate(() => { __game.fillLensWith(__game.target.parts); __game.setElapsed(15000); });
  await pg.click('#done'); await pg.waitForTimeout(2200);
  log(name, 'speed result:', await pg.textContent('#score'), '|', await pg.textContent('#sub'), '|', await pg.textContent('#grade'));
  await pg.click('#rank-submit'); await pg.waitForTimeout(400);
  log(name, 'speed submit (prefilled name):', await pg.inputValue('#rank-name'), '→', await pg.textContent('#rank-msg'));
  await pg.screenshot({ path: `${out}/${name}-speed-result.png` });
  await pg.click('.link-btn'); await pg.waitForTimeout(400);
  log(name, 'ranking speed/today:', await pg.$$eval('#ranking-list li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim())));
  await pg.screenshot({ path: `${out}/${name}-ranking-speed.png` });
  await pg.click('.mode-tabs .tab[data-mode="sec30"]'); await pg.waitForTimeout(300);
  log(name, 'ranking sec30/today:', await pg.$$eval('#ranking-list li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim())));
  await pg.keyboard.press('Escape');
  log(name, 'esc closes only ranking:', await pg.isHidden('#ranking'), await pg.isVisible('#result'));

  // ---- 스피드 5분 초과 ----
  await pg.click('#next');
  await pg.evaluate(() => __game.setElapsed(300000));
  await pg.waitForTimeout(2200);
  log(name, 'speed giveup:', await pg.textContent('#score'), '|', await pg.textContent('#sub'), '| form hidden:', await pg.isHidden('#rank-form'));
  log(name, 'header best:', await pg.textContent('#best'));
  await pg.close();
}
await b.close(); server.close();
console.log('ERRORS', errors.length ? errors : 'none');
