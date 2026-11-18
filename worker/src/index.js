/*
 * 절대 색감 랭킹 API — Cloudflare Worker + D1
 *
 *   GET  /ranking?mode=sec30|speed&period=today|all&limit=20   랭킹 조회 (닉네임별 최고 기록)
 *   POST /runs  { mode, name, score, time_ms, target, mine }    기록 등록
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
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     mode TEXT NOT NULL,
     name TEXT NOT NULL,
     score REAL NOT NULL,
     time_ms INTEGER NOT NULL,
     target TEXT NOT NULL,
     mine TEXT NOT NULL,
     day TEXT NOT NULL,
     ip TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_runs_mode_day ON runs(mode, day, name)',
  'CREATE INDEX IF NOT EXISTS idx_runs_mode_name ON runs(mode, name)',
  'CREATE INDEX IF NOT EXISTS idx_runs_ip ON runs(ip, created_at)',
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  schemaReady = true;
}

/*
 * 모드
 *  sec30 : 30초 챌린지 — 30초 안에 완성한 일치율. 높을수록 위 (같으면 빠른 시간)
 *  speed : 스피드 런   — 90% 이상 맞추기까지 걸린 시간. 짧을수록 위 (같으면 높은 일치율)
 */
export const MODES = {
  sec30: { minScore: 0, maxTime: 31000, minTime: 0, order: 'score DESC, time_ms ASC, created_at ASC',
           better: '(b.score > ?1 OR (b.score = ?1 AND b.time_ms < ?2))' },
  speed: { minScore: 90, maxTime: 300000, minTime: 1500, order: 'time_ms ASC, score DESC, created_at ASC',
           better: '(b.time_ms < ?2 OR (b.time_ms = ?2 AND b.score > ?1))' },
};

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
  const m = MODES[body.mode];
  if (!m) return { error: '모드가 올바르지 않아요' };
  const name = cleanName(body.name);
  if (!name) return { error: `닉네임은 ${NAME_MIN}~${NAME_MAX}자로 적어 주세요` };
  const score = Number(body.score), time = Math.round(Number(body.time_ms));
  if (!Number.isFinite(score) || score < m.minScore || score > 100) return { error: '점수가 올바르지 않아요' };
  if (!Number.isFinite(time) || time < m.minTime || time > m.maxTime) return { error: '기록 시간이 올바르지 않아요' };
  const hex = /^#[0-9A-F]{6}$/i;
  if (!hex.test(body.target || '') || !hex.test(body.mine || '')) return { error: '색 정보가 올바르지 않아요' };
  return {
    value: {
      mode: body.mode, name,
      score: Math.round(score * 10) / 10,
      time_ms: time,
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

/** 닉네임별 최고 기록만 남긴 목록 (SQL 조각) */
function bestPerName(mode, period) {
  const m = MODES[mode];
  const where = period === 'today' ? 'mode = ?1 AND day = ?2' : 'mode = ?1';
  return `SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY ${m.order}) AS rn FROM runs WHERE ${where}
    ) WHERE rn = 1`;
}

async function getRanking(db, mode, period, limit) {
  const day = kstDay();
  const sql = `SELECT name, score, time_ms, target, mine FROM (${bestPerName(mode, period)})
               ORDER BY ${MODES[mode].order} LIMIT ${limit}`;
  const stmt = period === 'today' ? db.prepare(sql).bind(mode, day) : db.prepare(sql).bind(mode);
  const { results } = await stmt.all();
  return { mode, period, day, items: results.map((r, i) => ({ rank: i + 1, ...r })) };
}

/** 이번 기록보다 좋은 '다른 사람' 최고 기록 수 + 1 */
async function rankOf(db, run, period, day) {
  const m = MODES[run.mode];
  const where = period === 'today' ? 'mode = ?3 AND day = ?5' : 'mode = ?3';
  const sql = `SELECT COUNT(*) AS n FROM (
      SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY ${m.order}) AS rn FROM runs WHERE ${where}) WHERE rn = 1
    ) AS b WHERE b.name != ?4 AND ${m.better}`;
  const args = [run.score, run.time_ms, run.mode, run.name];
  if (period === 'today') args.push(day);
  const row = await db.prepare(sql).bind(...args).first();
  return (row?.n || 0) + 1;
}

async function postRun(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청이에요' }, 400, request); }
  const v = validate(body);
  if (v.error) return json({ error: v.error }, 400, request);

  const db = env.DB;
  const now = Date.now(), day = kstDay(now);
  const ip = await hashIp(request.headers.get('CF-Connecting-IP') || 'unknown', env.IP_SALT || 'saekgam');

  const recent = await db.prepare(
    'SELECT MAX(created_at) AS last, SUM(CASE WHEN day = ?2 THEN 1 ELSE 0 END) AS today FROM runs WHERE ip = ?1'
  ).bind(ip, day).first();
  if (recent?.last && now - recent.last < SUBMIT_GAP_MS) return json({ error: '잠시 후 다시 등록해 주세요' }, 429, request);
  if ((recent?.today || 0) >= DAILY_CAP) return json({ error: '오늘은 더 등록할 수 없어요' }, 429, request);

  const r = v.value;
  await db.prepare(
    'INSERT INTO runs (mode, name, score, time_ms, target, mine, day, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
  ).bind(r.mode, r.name, r.score, r.time_ms, r.target, r.mine, day, ip, now).run();

  const [rankToday, rankAll] = await Promise.all([rankOf(db, r, 'today', day), rankOf(db, r, 'all', day)]);
  return json({ ok: true, ...r, day, rankToday, rankAll }, 201, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    try {
      if (url.pathname === '/health') return json({ ok: true, day: kstDay() }, 200, request);
      await ensureSchema(env.DB);
      if (url.pathname === '/ranking' && request.method === 'GET') {
        const mode = url.searchParams.get('mode') === 'speed' ? 'speed' : 'sec30';
        const period = url.searchParams.get('period') === 'all' ? 'all' : 'today';
        const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        // 등록 직후 바로 최신 순위가 보이도록 캐시하지 않는다
        return json(await getRanking(env.DB, mode, period, limit), 200, request, { 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/runs' && request.method === 'POST') return postRun(request, env);
      return json({ error: 'not found' }, 404, request);
    } catch (e) {
      return json({ error: '서버 오류가 났어요', ...(env.DEBUG ? { detail: String(e && e.stack || e) } : {}) }, 500, request);
    }
  },
};
