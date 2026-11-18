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
const run = (mode, name, score, time_ms) => ({ mode, name, score, time_ms, target: '#AABBCC', mine: '#ABBBCC' });

test('닉네임 정리', () => {
  assert.strictEqual(cleanName('  색감  왕 '), '색감 왕');
  assert.strictEqual(cleanName('<b>x</b>'), 'bx/b');
  assert.strictEqual(cleanName(''), null);
  assert.strictEqual(cleanName('가'.repeat(13)), null);
  assert.strictEqual(cleanName('가'.repeat(12)), '가'.repeat(12));
});

test('입력 검증: 모드별 범위', () => {
  assert.ok(validate(run('normal', 'a', 50, 1000)).error, '없는 모드');
  assert.ok(validate(run('sec30', 'a', 101, 1000)).error);
  assert.ok(validate(run('sec30', 'a', 50, 40000)).error, '30초 모드는 31초 넘으면 안 됨');
  assert.ok(!validate(run('sec30', 'a', 0, 30000)).error, '시간 종료 0%도 기록 가능');
  assert.ok(validate(run('speed', 'a', 89.9, 10000)).error, '스피드는 90% 이상만');
  assert.ok(validate(run('speed', 'a', 95, 500)).error, '1.5초 미만은 거부');
  assert.ok(validate({ ...run('sec30', 'a', 50, 1000), target: 'red' }).error);
  assert.strictEqual(validate(run('sec30', 'a', 87.66, 12345.6)).value.score, 87.7);
  assert.strictEqual(validate(run('sec30', 'a', 87.66, 12345.6)).value.time_ms, 12346);
});

test('KST 날짜', () => {
  assert.strictEqual(kstDay(Date.UTC(2026, 10, 18, 15, 30)), '2026-11-19');
  assert.strictEqual(kstDay(Date.UTC(2026, 10, 18, 14, 59)), '2026-11-18');
});

test('30초 챌린지: 일치율 높은 순, 같으면 빠른 순, 닉네임별 최고 기록', async () => {
  let r = await call('POST', '/runs', run('sec30', '철수', 80, 20000));
  assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/runs', run('sec30', '영희', 92.3, 28000));
  assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/runs', run('sec30', '철수', 92.3, 15000));     // 같은 점수, 더 빠름
  assert.strictEqual(r.body.rankToday, 1);
  r = await call('POST', '/runs', run('sec30', '철수', 50, 10000));       // 더 낮은 기록은 순위에 영향 없음
  r = await call('POST', '/runs', run('sec30', '민수', 70, 30000));
  assert.strictEqual(r.body.rankToday, 3);
  const g = await call('GET', '/ranking?mode=sec30&period=today');
  assert.deepStrictEqual(g.body.items.map(i => [i.rank, i.name, i.score, i.time_ms]),
    [[1, '철수', 92.3, 15000], [2, '영희', 92.3, 28000], [3, '민수', 70, 30000]]);
});

test('스피드 런: 시간 짧은 순, 모드끼리 섞이지 않음', async () => {
  await call('POST', '/runs', run('speed', '철수', 91, 42000));
  await call('POST', '/runs', run('speed', '영희', 96, 18000));
  const r = await call('POST', '/runs', run('speed', '철수', 90.5, 25000));
  assert.strictEqual(r.body.rankToday, 2);
  const g = await call('GET', '/ranking?mode=speed&period=all');
  assert.deepStrictEqual(g.body.items.map(i => [i.name, i.time_ms]), [['영희', 18000], ['철수', 25000]]);
  const s = await call('GET', '/ranking?mode=sec30&period=all&limit=2');
  assert.strictEqual(s.body.items.length, 2);
  assert.ok(s.body.items.every(i => i.time_ms <= 31000));
});

test('같은 IP 연속 등록은 막힘', async () => {
  const a = await call('POST', '/runs', run('sec30', '도배', 10, 1000), '9.9.9.9');
  const b = await call('POST', '/runs', run('sec30', '도배', 11, 1000), '9.9.9.9');
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 429);
});

test('잘못된 입력은 400, 옛 주소는 404, CORS 헤더 포함', async () => {
  const r = await call('POST', '/runs', run('sec30', '', 50, 1000));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), 'https://saekgam.cc');
  assert.strictEqual((await call('POST', '/scores', run('sec30', 'a', 50, 1000))).status, 404);
  const o = await worker.fetch(new Request('https://api.saekgam.cc/runs', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), env);
  assert.strictEqual(o.status, 204);
  assert.strictEqual(o.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
});
