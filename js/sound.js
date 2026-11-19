/*
 * 효과음 — 파일 없이 Web Audio로 직접 만든다.
 *  - 헤라 소리: 팔레트를 긁는 마른 소리. 움직이는 속도만큼 커진다.
 *  (튜브 짜는 소리·톡·결과 차임은 쓰지 않음 — 2026-11-19 사용자 결정)
 * 브라우저 정책상 첫 터치/클릭 뒤에 소리가 켜진다. 음소거는 localStorage에 기억.
 */
(function (root) {
  const KEY = 'jeoldae-saekgam.mute';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  function makeNoise(c) {
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /**
   * 헤라 소리 엔진: 팔레트를 긁는 마른 소리 하나. 움직이는 속도만큼 커진다.
   * (질퍽한 알갱이 소리는 '눈 밟는 소리 같다'는 피드백으로 뺐다 — 2026-11-19)
   */
  function createKnifeVoice(ctx, out, noise, P = {}) {
    const p = Object.assign({ gain: 0.11 }, P);
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; src.start(0);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; hp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    return {
      update(t, dt, speed) {
        speed = Math.max(0, Math.min(1, speed));
        g.gain.setTargetAtTime(p.gain * Math.pow(speed, 0.8), t, 0.03);
      },
    };
  }

  let ctx = null, master = null, voice = null, lastT = 0;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    voice = createKnifeVoice(ctx, master, makeNoise(ctx));
    lastT = ctx.currentTime;
    return true;
  }

  const Sound = {
    unlock() { ensure(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
    },
    /** 헤라: speed 0~1(움직임 빠르기). 프레임마다 부른다 */
    knife(speed, wet) {
      if (!ctx || !voice || muted) return;
      const t = ctx.currentTime, dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
      voice.update(t, dt, speed, wet);
    },
    // 미리듣기·테스트용
    _createKnifeVoice: createKnifeVoice, _makeNoise: makeNoise,
  };
  root.Sound = Sound;
  // iOS 등은 touchend/click 같은 '확정된' 입력에서만 오디오가 풀린다
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev => root.addEventListener(ev, () => ensure(), { passive: true, capture: true }));
})(window);
