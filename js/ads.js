/*
 * 결과 화면 광고 로더
 * - 게임 중에는 광고 스크립트를 전혀 불러오지 않고, 결과 화면이 처음 열릴 때 한 번만 불러온다.
 * - 같은 광고 단위를 너무 자주 새로 고치지 않도록 한 번 만든 광고는 그대로 다시 보여 준다.
 */
(function () {
  'use strict';
  const cfg = window.ADS_CONFIG || { provider: 'none' };
  let mounted = false;

  function loadScript(src, attrs) {
    const s = document.createElement('script');
    s.async = true; s.src = src;
    Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
    return s;
  }

  function mountAdsense(slot) {
    const { client, slot: adSlot } = cfg.adsense || {};
    if (!client || /X{4,}/.test(client)) return false;
    loadScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`,
      { crossorigin: 'anonymous' });
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', client);
    ins.setAttribute('data-ad-slot', adSlot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    slot.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
    return true;
  }

  function mountAdfit(slot) {
    const { unit, width = 320, height = 100 } = cfg.adfit || {};
    if (!unit || /X{4,}/.test(unit)) return false;
    const ins = document.createElement('ins');
    ins.className = 'kakao_ad_area';
    ins.style.display = 'none';
    ins.setAttribute('data-ad-unit', unit);
    ins.setAttribute('data-ad-width', String(width));
    ins.setAttribute('data-ad-height', String(height));
    slot.appendChild(ins);
    loadScript('https://t1.daumcdn.net/kas/static/ba.min.js');
    return true;
  }

  function placeholder(slot) {
    if (!cfg.showPlaceholder) return;
    const d = document.createElement('div');
    d.className = 'ad-placeholder';
    d.textContent = '광고 영역 (ads-config.js 에서 설정)';
    slot.appendChild(d);
  }

  window.Ads = {
    showResultAd(slot) {
      if (mounted || !slot) return;
      mounted = true;
      let ok = false;
      try {
        if (cfg.provider === 'adsense') ok = mountAdsense(slot);
        else if (cfg.provider === 'adfit') ok = mountAdfit(slot);
      } catch (e) { ok = false; }
      if (!ok) placeholder(slot);
    },
  };
})();
