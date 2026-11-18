# 절대 색감 — 물감 조색 게임

🎨 플레이: **https://saekgam.cc**

8가지 물감을 직접 짜고 헤라로 섞어서, 화면 위의 **목표 색**을 100%에 가깝게 맞추는 웹 게임입니다.
일본의 웹 게임 「調色マスター」의 게임 방식을 분석해서 한국어판으로 새로 만들었습니다. 코드와 그래픽은 모두 새로 작성했습니다.

## 플레이 방법

- 튜브를 누른 채 팔레트로 끌어오면 물감이 나옵니다. 천천히 움직이거나 멈추면 많이 나와요.
- 팔레트의 빈 곳을 드래그하면 헤라로 섞고 펴 바릅니다.
- 돋보기는 테두리나 손잡이를 잡고 옮깁니다. PC에서는 방향키도 쓸 수 있어요.
- **완성**을 누르면 렌즈 안에 보이는 색과 목표 색의 일치율이 나옵니다.

## 원본 분석 결과와 이 구현

| 항목 | 원본 (분석) | 이 버전 |
|---|---|---|
| 렌더링 | three.js r128 3D | 2D Canvas (라이브러리 없음, 가벼움) |
| 물감 혼합 | 분광 Kubelka-Munk, 400~700nm 16밴드 | 같은 방식 (`js/color.js`, 물감 데이터는 새로 설계) |
| 물감 | 8색 | 흰색·노랑·빨강·자홍·군청·청록·갈색·검정 |
| 판정 | 돋보기 렌즈 안, CIEDE2000, ΔE 40 이상이면 0% | 같은 기준. 렌즈에 보이는 범위 = 판정 범위 |
| 얼룩 | 덜 섞이면 점수 하락 | 칸마다 따로 채점한 뒤 평균을 내서 얼룩이 그대로 감점 |
| 목표 색 | 물감 1~2개를 정수비로 섞음 | 물감 1~3개 + 흰색을 정수비로 섞음. 결과 화면에 정답 배합 공개 |
| 광고 | 결과 화면 | **결과 화면에만** (게임 중에는 광고 스크립트도 불러오지 않음) |

## 파일 구조

```
index.html          화면
css/style.css       스타일
js/color.js         색 엔진 (분광 혼합, Lab, CIEDE2000)
js/game.js          게임 (팔레트 시뮬레이션, 입력, 판정, 결과)
js/ads.js           결과 화면 광고 로더
ads-config.js       광고 설정  ← 여기만 고치면 됨
test/               색 엔진 단위 테스트 + 브라우저 플레이 테스트
```

## 광고 붙이기 (결과 화면 전용)

`ads-config.js`에서 고르세요.

**구글 애드센스**
```js
provider: 'adsense',
adsense: { client: 'ca-pub-1234567890123456', slot: '1234567890' },
```
그다음 `ads.txt.example` 파일을 `ads.txt`로 이름을 바꾸고 pub ID를 본인 것으로 바꾸세요.

**카카오 애드핏**
```js
provider: 'adfit',
adfit: { unit: 'DAN-xxxxxxxxxxxxxxx', width: 320, height: 100 },
```

광고 ID가 없으면 `showPlaceholder: true`일 때 점선으로 광고 자리만 표시하고, `false`면 아무것도 나오지 않습니다.
애드센스와 애드핏 모두 사이트 심사를 먼저 통과해야 광고가 나옵니다.

## 배포

### GitHub Pages (무료, 기본)
`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 테스트를 돌린 뒤 자동으로 배포합니다.
저장소 **Settings → Pages → Source**가 **GitHub Actions**로 되어 있어야 합니다.

### Firebase Hosting (무료)
```bash
npm i -g firebase-tools
firebase login
firebase init hosting   # 기존 firebase.json 사용, public 디렉터리는 "."
firebase deploy
```

### 기타
빌드 과정이 없는 정적 파일이라 Cloudflare Pages, Netlify, Vercel 등에 폴더째 올려도 됩니다.

## 랭킹 (게스트)

게임은 세 모드가 있습니다. 🎨 **일반**은 시간 제한 없는 연습 모드(랭킹 없음)이고, 아래 두 모드는 랭킹을 모드별로 따로 매깁니다. 결과 화면에서 닉네임만 적으면 올라가고, 닉네임별 최고 기록으로 **오늘 / 전체** 순위를 보여 줍니다.

- ⏱ **30초 챌린지**: 30초 안에 「완성」을 누르거나 시간이 끝난 순간의 일치율. 높을수록 위 (같으면 빠른 사람)
- ⚡ **스피드 런**: 일치율 90%를 넘기기까지 걸린 시간. 짧을수록 위 (5분이 넘으면 실패)

- 서버: `worker/` — Cloudflare Workers + D1, 주소 `https://api.saekgam.cc`
  - `GET /ranking?mode=sec30|speed&period=today|all&limit=20`, `POST /runs {mode, name, score, time_ms, target, mine}`
  - 닉네임 1~12자, 30초 모드는 31초 이내, 스피드 런은 90% 이상·1.5초~5분, 같은 IP는 4초에 1번·하루 300번까지
- 배포: Cloudflare 대시보드의 Workers에서 이 저장소를 연결 (루트 디렉터리 `worker`)
- 테스트: `node --test worker/test/*.test.mjs`
- 게스트 랭킹이라 점수 조작을 완전히 막을 수는 없습니다. 이상한 기록은 D1 콘솔에서 지우면 됩니다.

## 개발

```bash
node --test test/*.test.js       # 색 엔진 테스트
npx serve .                      # 로컬 실행 (아무 정적 서버나 가능)
```

## 라이선스

MIT
