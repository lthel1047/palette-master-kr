/*
 * 절대 색감 랭킹 API — Cloudflare Worker + D1
 *
 *   GET  /ranking?period=today|all&limit=20   랭킹 조회 (닉네임별 최고 점수)
 *   POST /scores  { name, score, target, mine }  점수 등록
 *   GET  /health
 *
 * 게스트 랭킹이라 로그인은 없다. 대신 입력값 검증과 IP 기준 도배 방지를 한다.
 */

const ALLOWED_ORIGINS = [
  'https://saekgam.cc',
  'https://www.saekgam.cc',
  'https://lthel1047.github.io',
];
const NAME_MIN = 1, NAME_MAX = 12;
const SUBMIT_GAP_MS = 4000;      // 같은 IP는 4초에 한 번만 등록
const DAILY_CAP = 300;           // 같은 IP는 하루 300번까지

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scores (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     score REAL NOT NULL,
     target TEXT NOT NULL,
     mine TEXT NOT NULL,
     day TEXT NOT NULL,
     ip TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_scores_day ON scores(day, name, score)',
  'CREATE INDEX IF NOT EXISTS idx_scores_name ON scores(name, score)',
  'CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores(ip, created_at)',
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  schemaReady = true;
}

/** 한국 시간 기준 날짜 YYYY-MM-DD */
export function kstDay(ms = Date.now()) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 닉네임 정리: 제어문자·꺾쇠 제거, 공백 정리, 길이 제한 */
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const len = [...s].length;
  if (len < NAME_MIN || len > NAME_MAX) return null;
  return s;
}

export function validate(body) {
  if (!body || typeof body !== 'object') return { error: '잘못된 요청이에요' };
  const name = cleanName(body.name);
  if (!name) return { error: `닉네임은 ${NAME_MIN}~${NAME_MAX}자로 적어 주세요` };
  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return { error: '점수가 올바르지 않아요' };
  const hex = /^#[0-9A-F]{6}$/i;
  if (!hex.test(body.target || '') || !hex.test(body.mine || '')) return { error: '색 정보가 올바르지 않아요' };
  return {
    value: {
      name,
      score: Math.round(score * 10) / 10,
      target: body.target.toUpperCase(),
      mine: body.mine.toUpperCase(),
    },
  };
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, request, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(request), ...extra },
  });
}

async function getRanking(db, period, limit) {
  const day = kstDay();
  // 닉네임별 최고 점수 (같은 점수면 먼저 낸 사람이 위)
  const where = period === 'today' ? 'WHERE day = ?1' : '';
  const sql = `
    SELECT name, MAX(score) AS score, target, mine, MIN(created_at) AS at
    FROM scores ${where}
    GROUP BY name
    ORDER BY score DESC, at ASC
    LIMIT ${limit}`;
  const stmt = period === 'today' ? db.prepare(sql).bind(day) : db.prepare(sql);
  const { results } = await stmt.all();
  return { period, day, items: results.map((r, i) => ({ rank: i + 1, ...r })) };
}

async function rankOf(db, score, day) {
  const where = day ? 'WHERE day = ?2' : '';
  const sql = `SELECT COUNT(*) AS n FROM (SELECT name, MAX(score) AS s FROM scores ${where} GROUP BY name) WHERE s > ?1`;
  const stmt = day ? db.prepare(sql).bind(score, day) : db.prepare(sql).bind(score);
  const row = await stmt.first();
  return (row?.n || 0) + 1;
}

async function postScore(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청이에요' }, 400, request); }
  const v = validate(body);
  if (v.error) return json({ error: v.error }, 400, request);

  const db = env.DB;
  const now = Date.now(), day = kstDay(now);
  const ip = await hashIp(request.headers.get('CF-Connecting-IP') || 'unknown', env.IP_SALT || 'saekgam');

  const recent = await db.prepare(
    'SELECT MAX(created_at) AS last, SUM(CASE WHEN day = ?2 THEN 1 ELSE 0 END) AS today FROM scores WHERE ip = ?1'
  ).bind(ip, day).first();
  if (recent?.last && now - recent.last < SUBMIT_GAP_MS) return json({ error: '잠시 후 다시 등록해 주세요' }, 429, request);
  if ((recent?.today || 0) >= DAILY_CAP) return json({ error: '오늘은 더 등록할 수 없어요' }, 429, request);

  const { name, score, target, mine } = v.value;
  await db.prepare(
    'INSERT INTO scores (name, score, target, mine, day, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  ).bind(name, score, target, mine, day, ip, now).run();

  const [rankToday, rankAll] = await Promise.all([rankOf(db, score, day), rankOf(db, score, null)]);
  return json({ ok: true, name, score, day, rankToday, rankAll }, 201, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    try {
      if (url.pathname === '/health') return json({ ok: true, day: kstDay() }, 200, request);
      await ensureSchema(env.DB);
      if (url.pathname === '/ranking' && request.method === 'GET') {
        const period = url.searchParams.get('period') === 'all' ? 'all' : 'today';
        const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        return json(await getRanking(env.DB, period, limit), 200, request, { 'Cache-Control': 'public, max-age=10' });
      }
      if (url.pathname === '/scores' && request.method === 'POST') return postScore(request, env);
      return json({ error: 'not found' }, 404, request);
    } catch (e) {
      return json({ error: '서버 오류가 났어요', ...(env.DEBUG ? { detail: String(e && e.stack || e) } : {}) }, 500, request);
    }
  },
};
