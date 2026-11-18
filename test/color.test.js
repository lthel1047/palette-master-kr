// node --test test/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/color.js');

const mix = parts => {
  const a = new Array(C.NP).fill(0);
  for (const [id, v] of Object.entries(parts)) a[C.PIGMENTS.find(p => p.id === id).index] = v;
  return C.mixLinear(a);
};
const hsvHue = lin => {
  const [r, g, b] = lin.map(C.toSrgb);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test('CIEDE2000: Sharma 테스트 데이터와 일치', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  for (const [a, b, want] of cases) {
    assert.ok(Math.abs(C.deltaE2000(...a, ...b) - want) < 1e-3, `${a} vs ${b}`);
  }
});

test('같은 색은 색차 0', () => {
  assert.strictEqual(C.deltaE2000(40, 10, -20, 40, 10, -20), 0);
});

test('완전 흰 물감은 거의 흰색, 검정은 거의 검정', () => {
  const w = C.linToLab(mix({ white: 1 }));
  const k = C.linToLab(mix({ black: 1 }));
  assert.ok(w[0] > 92, `white L=${w[0]}`);
  assert.ok(k[0] < 25, `black L=${k[0]}`);
});

test('파랑(청록) + 노랑 = 초록 (감법혼색)', () => {
  const g = mix({ cyan: 1, yellow: 1 });
  const h = hsvHue(g);
  assert.ok(h > 80 && h < 170, `hue=${h}`);
});

test('빨강 + 노랑 = 주황', () => {
  const h = hsvHue(mix({ red: 1, yellow: 1 }));
  assert.ok(h > 15 && h < 50, `hue=${h}`);
});

test('흰색을 더하면 밝아지고, 검정은 조금만 넣어도 크게 어두워진다', () => {
  const L = lin => C.linToLab(lin)[0];
  assert.ok(L(mix({ red: 1, white: 2 })) > L(mix({ red: 1 })));
  const drop = L(mix({ white: 10 })) - L(mix({ white: 10, black: 1 }));
  assert.ok(drop > 15, `black 1/11 drop=${drop}`);
});

test('혼합 결과는 양의 비율에만 의존', () => {
  const a = mix({ red: 1, blue: 2 }), b = mix({ red: 3, blue: 6 });
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});
