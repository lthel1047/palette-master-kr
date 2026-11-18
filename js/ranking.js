/*
 * 게스트 랭킹 (결과 화면에서 닉네임으로 등록, 상단 「랭킹」 버튼으로 보기)
 * API: worker/src/index.js  (기본 주소 https://api.saekgam.cc, ?api=주소 로 바꿔 테스트 가능)
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const NAME_KEY = 'jeoldae-saekgam.nickname';
  const API = (() => {
    try { const q = new URLSearchParams(location.search).get('api'); if (q) return q.replace(/\/$/, ''); } catch (e) {}
    return (window.RANKING_API || 'https://api.saekgam.cc').replace(/\/$/, '');
  })();

  let current = null;       // 이번 결과 { mode, score, time_ms, target, mine, ok, submitted }
  let period = 'today';
  let mode = 'sec30';
  const RULES = {
    sec30: '30초 안에 낸 일치율이 높은 순 (같으면 더 빨리 낸 사람이 위)',
    speed: '일치율 90%를 넘기기까지 걸린 시간이 짧은 순',
  };
  const sec = ms => `${(ms / 1000).toFixed(1)}초`;
  let myName = '';
  try { myName = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

  async function api(path, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(API + path, { ...opts, signal: ctl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || '랭킹 서버에 연결하지 못했어요');
      return body;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('랭킹 서버에 연결하지 못했어요');
      throw e;
    } finally { clearTimeout(timer); }
  }

  function setMsg(text, kind) {
    const el = $('rank-msg');
    el.textContent = text || '';
    el.className = 'rank-msg' + (kind ? ' ' + kind : '');
  }

  // ---------- 결과 화면 ----------
  function onResult(r) {
    current = { ...r, submitted: false };
    if (r.mode !== 'normal') mode = r.mode;
    $('rank-form').hidden = !r.ok;
    if (!r.ok) { setMsg(r.mode === 'normal' ? '랭킹은 ⏱ 30초 챌린지와 ⚡ 스피드 런에서 겨룰 수 있어요' : ''); return; }
    const input = $('rank-name'), btn = $('rank-submit');
    input.value = myName;
    input.disabled = false; btn.disabled = false;
    btn.textContent = '랭킹 등록';
    $('rank-form').hidden = false;
    setMsg('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!current || current.submitted) return;
    const input = $('rank-name'), btn = $('rank-submit');
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { setMsg('닉네임을 적어 주세요', 'err'); input.focus(); return; }
    btn.disabled = true; btn.textContent = '등록 중…';
    try {
      const r = await api('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: current.mode, name, score: current.score, time_ms: current.time_ms, target: current.target, mine: current.mine }),
      });
      current.submitted = true;
      myName = r.name;
      try { localStorage.setItem(NAME_KEY, myName); } catch (err) {}
      input.disabled = true; btn.textContent = '등록 완료';
      const msg = document.createElement('span');
      msg.textContent = `오늘 ${r.rankToday}위 · 전체 ${r.rankAll}위`;
      const link = document.createElement('button');
      link.type = 'button'; link.className = 'link-btn'; link.textContent = '랭킹 보기';
      link.addEventListener('click', () => open('today', current.mode));
      $('rank-msg').replaceChildren(msg, ' ', link);
      $('rank-msg').className = 'rank-msg ok';
    } catch (err) {
      btn.disabled = false; btn.textContent = '다시 등록';
      setMsg(err.message, 'err');
    }
  }

  // ---------- 랭킹 보기 ----------
  function row(item) {
    const li = document.createElement('li');
    if (myName && item.name === myName) li.className = 'me';
    const rank = document.createElement('span'); rank.className = 'r'; rank.textContent = item.rank;
    const sw = document.createElement('span'); sw.className = 'pair';
    const a = document.createElement('i'); a.style.background = item.target; a.title = `목표 ${item.target}`;
    const b = document.createElement('i'); b.style.background = item.mine; b.title = `내 색 ${item.mine}`;
    sw.append(a, b);
    const name = document.createElement('span'); name.className = 'n'; name.textContent = item.name;
    const score = document.createElement('span'); score.className = 's';
    const main = mode === 'speed' ? sec(item.time_ms) : `${Number(item.score).toFixed(1)}%`;
    const extra = mode === 'speed' ? `${Number(item.score).toFixed(1)}%` : sec(item.time_ms);
    score.append(main, Object.assign(document.createElement('small'), { textContent: extra }));
    li.append(rank, sw, name, score);
    return li;
  }

  async function load() {
    const list = $('ranking-list');
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: '불러오는 중…' }));
    document.querySelectorAll('#ranking .period-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.period === period)));
    document.querySelectorAll('#ranking .mode-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    $('ranking-rule').textContent = RULES[mode];
    const want = `${mode}/${period}`;
    try {
      const r = await api(`/ranking?mode=${mode}&period=${period}&limit=30`);
      if (`${mode}/${period}` !== want) return;   // 탭을 빨리 바꾼 경우 늦게 온 응답은 버림
      if (!r.items.length) {
        list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: '아직 아무도 없어요. 첫 번째로 올라가 보세요!' }));
        return;
      }
      list.replaceChildren(...r.items.map(row));
    } catch (err) {
      list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: err.message }));
    }
  }

  function open(p, m) {
    if (p) period = p;
    if (m) mode = m;
    $('ranking').hidden = false;
    $('ranking-close').focus();
    load();
  }
  function close() { $('ranking').hidden = true; }

  $('rank-form').addEventListener('submit', submit);
  $('rank-btn').addEventListener('click', () => open());
  $('ranking-close').addEventListener('click', close);
  $('ranking').addEventListener('click', e => { if (e.target.id === 'ranking') close(); });
  document.querySelectorAll('#ranking .period-tabs .tab').forEach(t => t.addEventListener('click', () => { period = t.dataset.period; load(); }));
  document.querySelectorAll('#ranking .mode-tabs .tab').forEach(t => t.addEventListener('click', () => { mode = t.dataset.mode; load(); }));
  // 랭킹 창이 열려 있으면 Esc 는 랭킹 창만 닫는다 (뒤의 결과 창은 그대로)
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ranking').hidden) { e.stopImmediatePropagation(); close(); } });

  window.Ranking = { onResult, open, API };
})();
