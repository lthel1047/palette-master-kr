/*
 * 효과음 — 파일 없이 Web Audio로 직접 만든다 (노이즈 + 필터).
 *  - 헤라 소리: 물감 위에서는 촉촉하게 '슥슥', 빈 팔레트에서는 마른 긁는 소리. 움직이는 속도만큼 커짐
 *  (튜브 짜는 소리·톡·결과 차임은 만들어 두었지만 게임에서는 쓰지 않음 — 2026-11-19 사용자 결정)
 * 브라우저 정책상 첫 터치/클릭 뒤에 소리가 켜진다. 음소거는 localStorage에 기억.
 */
(function (root) {
  const KEY = 'jeoldae-saekgam.mute';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  let ctx = null, master = null, noiseBuf = null;
  let sq = null, kn = null;   // 계속 나는 소리 체인

  function makeNoise(c) {
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    // 갈색 잡음 쪽으로 살짝 기운 흰 잡음 (덜 쨍하게)
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.06 * w) / 1.06; d[i] = w * 0.55 + last * 3.2; }
    return b;
  }
  function loopNoise() {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 1.5);
    return s;
  }
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    noiseBuf = makeNoise(ctx);

    // 튜브: 저역 통과 + 느리게 흔들리는 공명 → 질척한 소리
    {
      const src = loopNoise(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 6;
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 7; lfoG.gain.value = 220; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      g.gain.value = 0; src.connect(lp); lp.connect(g); g.connect(master);
      sq = { lp, g, lfo, level: 0 };
    }
    // 헤라: 마른 긁기(대역 통과, 높음) + 촉촉한 소리(저역, 흔들림) 두 갈래
    {
      const src = loopNoise();
      const bp = ctx.createBiquadFilter(), dry = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.9;
      const lp = ctx.createBiquadFilter(), wet = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3;
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.type = 'triangle'; lfo.frequency.value = 11; lfoG.gain.value = 350; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      dry.gain.value = 0; wet.gain.value = 0;
      src.connect(bp); bp.connect(dry); dry.connect(master);
      src.connect(lp); lp.connect(wet); wet.connect(master);
      kn = { bp, lp, dry, wet, lfo };
    }
    return true;
  }
  const now = () => ctx.currentTime;
  const ramp = (p, v, tc = 0.04) => p.setTargetAtTime(v, now(), tc);

  const Sound = {
    /** 첫 사용자 입력 때 불러 오디오를 깨운다 */
    unlock() { ensure(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
      if (master) ramp(master.gain, muted ? 0 : 0.9, 0.02);
    },
    /** 튜브 짜는 세기 0~1 (매 프레임) */
    squeeze(level) {
      if (!ctx || !sq) return;
      level = Math.max(0, Math.min(1, level));
      ramp(sq.g.gain, level * 0.32, level > sq.level ? 0.03 : 0.08);
      ramp(sq.lp.frequency, 380 + level * 420, 0.05);
      sq.lfo.frequency.setTargetAtTime(5 + level * 6 + Math.random() * 2, now(), 0.1);
      sq.level = level;
    },
    /** 헤라: speed 0~1(움직임 빠르기), wet 0~1(날 아래 물감 양) */
    knife(speed, wet) {
      if (!ctx || !kn) return;
      speed = Math.max(0, Math.min(1, speed)); wet = Math.max(0, Math.min(1, wet));
      const v = Math.pow(speed, 0.8);
      ramp(kn.wet.gain, v * wet * 0.55, 0.03);
      ramp(kn.dry.gain, v * (1 - wet) * 0.16, 0.03);
      ramp(kn.bp.frequency, 1500 + speed * 2200, 0.05);
      ramp(kn.lp.frequency, 500 + speed * 900, 0.05);
      kn.lfo.frequency.setTargetAtTime(6 + speed * 14, now(), 0.08);
    },
    /** 튜브를 집을 때 '톡' */
    tick() {
      if (!ensure() || muted) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = now();
      o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
    },
    /** 결과: 점수가 높을수록 밝은 화음. ok=false면 낮은 두 음 */
    result(score, ok = true) {
      if (!ensure() || muted) return;
      const notes = !ok ? [392, 330] : score >= 90 ? [523.3, 659.3, 784, 1046.5] : score >= 70 ? [523.3, 659.3, 784] : [440, 523.3];
      const t0 = now() + 0.05;
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.11;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.95);
      });
    },
  };
  root.Sound = Sound;
  // iOS 등은 touchend/click 같은 '확정된' 입력에서만 오디오가 풀린다
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev => root.addEventListener(ev, () => ensure(), { passive: true, capture: true }));
})(window);
