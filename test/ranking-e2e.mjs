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
// 미리 다른 사람 점수 몇 개
for (const [n, s, t, m] of [['색맹아님', 97.2, '#5A8FD0', '#5C8ECD'], ['팔레트장인', 91.4, '#C46258', '#C9665A'], ['초보', 62.0, '#8A9B3C', '#99A35A']]) {
  await worker.fetch(new Request('https://api.saekgam.cc/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `1.1.1.${++ipSeq}` }, body: JSON.stringify({ name: n, score: s, target: t, mine: m }) }), env);
}

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
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
  await pg.click('#howto-close');
  await pg.evaluate(() => { __game.lens.x = __game.GX / 2; __game.lens.y = __game.GY * 0.55; const q = __game.target.parts.slice(); q[0] += 1; __game.fillLensWith(q); });
  await pg.click('#done');
  await pg.waitForTimeout(2200);
  await pg.fill('#rank-name', name === 'mobile' ? '색감천재' : '데스크톱러');
  await pg.click('#rank-submit');
  await pg.waitForTimeout(500);
  const msg = await pg.textContent('#rank-msg');
  console.log(name, 'score', await pg.textContent('#score'), '| msg:', msg);
  await pg.screenshot({ path: `${out}/${name}-result.png` });
  // 같은 결과 두 번 등록 안 됨
  console.log(name, 'submit disabled after:', await pg.isDisabled('#rank-name'));
  await pg.click('.link-btn');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${out}/${name}-ranking.png` });
  const rows = await pg.$$eval('#ranking-list li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
  console.log(name, 'today:', rows);
  await pg.click('.tab[data-period="all"]');
  await pg.waitForTimeout(300);
  console.log(name, 'all count:', await pg.$$eval('#ranking-list li', ls => ls.length));
  await pg.keyboard.press('Escape');
  console.log(name, 'ranking closed:', await pg.isHidden('#ranking'), '| result still open:', await pg.isVisible('#result'));
  // 다음 판: 닉네임이 미리 채워지는지
  await pg.click('#next');
  await pg.evaluate(() => { __game.fillLensWith(__game.target.parts); });
  await pg.click('#done'); await pg.waitForTimeout(300);
  console.log(name, 'prefilled name:', await pg.inputValue('#rank-name'));
  await pg.close();
}
// 서버가 꺼져 있을 때 메시지
{
  const pg = await b.newPage();
  await pg.route('https://api.saekgam.cc/**', r => r.abort());
  await pg.goto(url); await pg.click('#howto-close');
  await pg.evaluate(() => { __game.fillLensWith(__game.target.parts); });
  await pg.click('#done'); await pg.fill('#rank-name', '오프라인'); await pg.click('#rank-submit'); await pg.waitForTimeout(400);
  console.log('offline msg:', await pg.textContent('#rank-msg'), '| button:', await pg.textContent('#rank-submit'));
  await pg.close();
}
await b.close(); server.close();
console.log('ERRORS', errors.length ? errors : 'none');
