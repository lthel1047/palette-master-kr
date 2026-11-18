// node --test worker/test/  (node:sqlite 로 D1 흉내)
import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import worker, { cleanName, validate, kstDay } from '../src/index.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const conv = sql => sql.replace(/\?(\d+)/g, '?');               // ?1 → ? (번호 순서대로 bind)
  const order = sql => [...sql.matchAll(/\?(\d+)/g)].map(m => +m[1] - 1);
  const prep = (sql, args = []) => {
    const idx = order(sql), vals = idx.length ? idx.map(i => args[i]) : args;
    const st = { all: (...v) => db.prepare(conv(sql)).all(...v), get: (...v) => db.prepare(conv(sql)).get(...v), run: (...v) => db.prepare(conv(sql)).run(...v) };
    return {
      bind: (...a) => prep(sql, a),
      all: async () => ({ results: st.all(...vals) }),
      first: async () => st.get(...vals) ?? null,
      run: async () => st.run(...vals),
      _exec: () => st.run(...vals),
    };
  };
  return { prepare: sql => prep(sql), batch: async list => list.map(s => s._exec()), raw: db };
}

const env = { DB: fakeD1(), IP_SALT: 't', DEBUG: 1 };
let ipN = 0;
const req = (method, path, body, ip) => new Request(`https://api.saekgam.cc${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Origin: 'https://saekgam.cc', 'CF-Connecting-IP': ip || `10.0.0.${++ipN}` },
  body: body ? JSON.stringify(body) : undefined,
});
const call = async (...a) => { const r = await worker.fetch(req(...a), env); return { status: r.status, body: await r.json(), headers: r.headers }; };
const entry = (name, score) => ({ name, score, target: '#AABBCC', mine: '#ABBBCC' });

test('닉네임 정리', () => {
  assert.strictEqual(cleanName('  색감  왕 '), '색감 왕');
  assert.strictEqual(cleanName('<b>x</b>'), 'bx/b');
  assert.strictEqual(cleanName(''), null);
  assert.strictEqual(cleanName('가'.repeat(13)), null);
  assert.strictEqual(cleanName('가'.repeat(12)), '가'.repeat(12));
});

test('입력 검증', () => {
  assert.ok(validate(entry('a', 101)).error);
  assert.ok(validate(entry('a', -1)).error);
  assert.ok(validate({ ...entry('a', 50), target: 'red' }).error);
  assert.deepStrictEqual(validate(entry('a', 87.66)).value.score, 87.7);
});

test('KST 날짜', () => {
  assert.strictEqual(kstDay(Date.UTC(2026, 10, 18, 15, 30)), '2026-11-19');
  assert.strictEqual(kstDay(Date.UTC(2026, 10, 18, 14, 59)), '2026-11-18');
});

test('등록 → 랭킹 (닉네임별 최고 점수, 순위)', async () => {
  let r = await call('POST', '/scores', entry('철수', 80));
  assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/scores', entry('영희', 92.3));
  assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/scores', entry('철수', 95));      // 철수 최고점 갱신
  assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/scores', entry('민수', 50));
  assert.strictEqual(r.body.rankToday, 3);
  const g = await call('GET', '/ranking?period=today');
  assert.strictEqual(g.status, 200);
  assert.deepStrictEqual(g.body.items.map(i => [i.rank, i.name, i.score]), [[1, '철수', 95], [2, '영희', 92.3], [3, '민수', 50]]);
  const all = await call('GET', '/ranking?period=all&limit=2');
  assert.strictEqual(all.body.items.length, 2);
});

test('같은 IP 연속 등록은 막힘', async () => {
  const a = await call('POST', '/scores', entry('도배', 10), '9.9.9.9');
  const b = await call('POST', '/scores', entry('도배', 11), '9.9.9.9');
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 429);
});

test('잘못된 입력은 400, CORS 헤더 포함', async () => {
  const r = await call('POST', '/scores', entry('', 50));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), 'https://saekgam.cc');
  const o = await worker.fetch(new Request('https://api.saekgam.cc/scores', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), env);
  assert.strictEqual(o.status, 204);
  assert.strictEqual(o.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
});
