// 의견·댓글 흐름 확인: node test/feedback-e2e.mjs <outdir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || '/tmp/fb-shots'; fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'x' }); res.end(d); }); }).listen(0);
const sqlite = new DatabaseSync(':memory:');
const D1 = { prepare(sql, args = []) { const idx = [...sql.matchAll(/\?(\d+)/g)].map(m => +m[1] - 1), q = sql.replace(/\?(\d+)/g, '?'); const vals = () => (idx.length ? idx.map(i => args[i]) : args);
  return { bind: (...a) => D1.prepare(sql, a), all: async () => ({ results: sqlite.prepare(q).all(...vals()) }), first: async () => sqlite.prepare(q).get(...vals()) ?? null,
    run: async () => { const r = sqlite.prepare(q).run(...vals()); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; }, _exec: () => sqlite.prepare(q).run(...vals()) }; },
  batch: async l => l.map(s => s._exec()) };
const env = { DB: D1 }; let ip = 0;
await worker.fetch(new Request('https://api.saekgam.cc/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({ name: '먼저온사람', body: '물감 섞이는 게 진짜 같아요!' }) }), env);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
for (const [name, vp, m] of [['mobile', { width: 390, height: 844 }, true], ['pc', { width: 1280, height: 800 }, false]]) {
  const pg = await b.newPage({ viewport: vp, deviceScaleFactor: 2, isMobile: m, hasTouch: m });
  pg.on('pageerror', e => errors.push(e.message));
  await pg.route('https://api.saekgam.cc/**', async route => { const r = route.request(); const res = await worker.fetch(new Request(r.url(), { method: r.method(), headers: { ...r.headers(), 'CF-Connecting-IP': `2.2.2.${++ip}` }, body: r.postData() || undefined }), env); await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }); });
  await pg.addInitScript(() => localStorage.setItem('jeoldae-saekgam.howto', '1'));
  await pg.goto(`http://127.0.0.1:${server.address().port}/`);
  await pg.click('.mode-card[data-mode="normal"]');
  await pg.evaluate(() => { __game.lens.x = __game.GX / 2; __game.lens.y = __game.GY * 0.55; __game.fillLensWith(__game.target.parts); });
  await pg.click('#done'); await pg.waitForTimeout(2000);
  await pg.screenshot({ path: `${out}/${name}-result.png` });
  await pg.click('#fb-open'); await pg.waitForTimeout(400);
  console.log(name, 'list:', await pg.$$eval('#fb-list li', l => l.map(x => x.innerText.replace(/\s+/g, ' '))), '| count:', await pg.textContent('#fb-count'));
  await pg.fill('#fb-body', 'www.spam.com 오세요');
  await pg.click('#fb-submit'); await pg.waitForTimeout(300);
  console.log(name, 'link blocked:', await pg.textContent('#fb-msg'));
  await pg.fill('#fb-body', name === 'mobile' ? '스피드 런 재밌어요!\n랭킹 1등 할 거예요' : '30초가 너무 짧아요 ㅎㅎ');
  await pg.fill('#fb-name', name === 'mobile' ? '색감천재' : '');
  console.log(name, 'len:', await pg.textContent('#fb-len'));
  await pg.click('#fb-submit'); await pg.waitForTimeout(500);
  console.log(name, 'after submit:', await pg.textContent('#fb-msg'), '| list:', await pg.$$eval('#fb-list li', l => l.map(x => (x.className ? `[${x.className}] ` : '') + x.innerText.replace(/\s+/g, ' '))));
  await pg.screenshot({ path: `${out}/${name}-feedback.png` });
  await pg.focus('#fb-body'); await pg.keyboard.press('ArrowLeft');
  await pg.keyboard.press('Escape');
  console.log(name, 'esc closes only feedback:', await pg.isHidden('#feedback'), await pg.isVisible('#result'));
  await pg.close();
}
await b.close(); server.close();
console.log('ERRORS', errors.length ? errors : 'none');
