/*
 * 의견·댓글 (결과 화면의 「💬 의견·댓글 남기기」)
 * 남긴 글은 모두에게 보이는 방명록 형태. API 는 랭킹과 같은 서버(/feedback).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = (window.Ranking && window.Ranking.API) || 'https://api.saekgam.cc';
  const NAME_KEY = 'jeoldae-saekgam.nickname';
  const myIds = new Set();

  function when(ms) {
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return '방금';
    if (d < 3600) return `${Math.floor(d / 60)}분 전`;
    if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
    const t = new Date(ms);
    return `${t.getMonth() + 1}월 ${t.getDate()}일`;
  }

  async function api(path, opts) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(API + path, { ...opts, signal: ctl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || '서버에 연결하지 못했어요');
      return body;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('서버에 연결하지 못했어요');
      throw e;
    } finally { clearTimeout(timer); }
  }

  function item(it) {
    const li = document.createElement('li');
    if (myIds.has(it.id)) li.className = 'mine';
    const meta = document.createElement('div'); meta.className = 'fb-meta';
    const name = document.createElement('b'); name.textContent = it.name;
    const time = document.createElement('span'); time.textContent = when(it.created_at);
    meta.append(name, time);
    const p = document.createElement('p'); p.className = 'fb-text'; p.textContent = it.body;
    li.append(meta, p);
    return li;
  }
  const emptyLi = text => Object.assign(document.createElement('li'), { className: 'empty', textContent: text });

  async function load() {
    const list = $('fb-list');
    list.replaceChildren(emptyLi('불러오는 중…'));
    try {
      const r = await api('/feedback?limit=30');
      $('fb-count').textContent = r.total ? `${r.total}개` : '';
      list.replaceChildren(...(r.items.length ? r.items.map(item) : [emptyLi('아직 댓글이 없어요. 첫 의견을 남겨 주세요!')]));
    } catch (e) { list.replaceChildren(emptyLi(e.message)); }
  }

  function setMsg(text, kind) { const el = $('fb-msg'); el.textContent = text || ''; el.className = 'rank-msg' + (kind ? ' ' + kind : ''); }

  async function submit(e) {
    e.preventDefault();
    const body = $('fb-body').value.trim(), name = $('fb-name').value.trim();
    if ([...body].length < 2) { setMsg('2자 이상 적어 주세요', 'err'); $('fb-body').focus(); return; }
    const btn = $('fb-submit');
    btn.disabled = true; btn.textContent = '남기는 중…';
    try {
      const r = await api('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || undefined, body }) });
      if (r.item.id != null) myIds.add(r.item.id);
      if (name) { try { localStorage.setItem(NAME_KEY, name); } catch (err) {} }
      $('fb-body').value = ''; updateLen();
      setMsg('고마워요! 의견이 등록됐어요', 'ok');
      await load();
    } catch (err) { setMsg(err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = '남기기'; }
  }

  function updateLen() { $('fb-len').textContent = `${[...$('fb-body').value].length}/300`; }

  function open() {
    let saved = ''; try { saved = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
    if (!$('fb-name').value) $('fb-name').value = saved;
    setMsg('');
    $('feedback').hidden = false;
    $('fb-body').focus();
    load();
  }
  function close() { $('feedback').hidden = true; }

  $('fb-open').addEventListener('click', open);
  $('fb-close').addEventListener('click', close);
  $('feedback').addEventListener('click', e => { if (e.target.id === 'feedback') close(); });
  $('fb-form').addEventListener('submit', submit);
  $('fb-body').addEventListener('input', updateLen);
  // 댓글 창이 열려 있으면 Esc 는 댓글 창만 닫고, 게임 단축키는 막는다
  window.addEventListener('keydown', e => {
    if ($('feedback').hidden) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') close();
  }, true);

  window.Feedback = { open };
})();
