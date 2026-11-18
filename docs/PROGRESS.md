# 진행 상황 (2026-11-19)

## 완료
- 게임 개발, GitHub Pages 배포: https://saekgam.cc (도메인은 Cloudflare에서 구매, 2027-11-19 만료, 자동 갱신)
- 광고 자리: 결과 화면 하단에만 있음 (`ads-config.js`에서 설정)
- 애드핏 신청 자료: `docs/adfit/` (PDF와 캡처)

## 광고 신청 현황
- 구글 애드센스: github.io로는 신청 불가 → saekgam.cc로 신청.
  승인 후 ads.txt.example을 ads.txt로 바꾸고 pub ID 입력
- 카카오 애드핏: with.kakao.com 제휴 제안서 작성 중.
  사전 승인을 받은 뒤 광고 단위 ID(DAN-...)를 받으면 된다.

## 다음 할 일
1. 애드핏 승인 후 DAN ID를 `ads-config.js`에 넣고 provider를 'adfit'으로 바꿔 푸시
2. https://saekgam.cc 로 애드센스 신청 → 승인 후 ads.txt 추가, provider를 'adsense'로

## 도메인 설정 (saekgam.cc)
- Cloudflare DNS: A @ → 185.199.108.153 / 109.153 / 110.153 / 111.153, CNAME www → lthel1047.github.io (모두 DNS only)
- GitHub Settings → Pages → Custom domain: saekgam.cc, Enforce HTTPS

## 게스트 랭킹 (2026-11-19)
- 결과 화면에서 닉네임 입력 → 랭킹 등록, 상단 「랭킹」 버튼으로 오늘/전체 보기
- API: https://api.saekgam.cc (Cloudflare Worker `saekgam-api`, 코드는 `worker/`)
  - main에 푸시하면 Cloudflare가 `worker/` 폴더를 자동 배포 (Workers Builds, GitHub 연동)
- DB: Cloudflare D1 `saekgam-ranking` (Asia Pacific)
  - 이상한 기록 지우기: 대시보드 → D1 → saekgam-ranking → Console
    `DELETE FROM runs WHERE name = '닉네임';` (모드만 지우려면 `AND mode = 'sec30'` 또는 `'speed'`)

## 모드별 랭킹으로 변경 (2026-11-19)
- 일반 모드와 일반 랭킹을 없애고 ⏱ 30초 챌린지 / ⚡ 스피드 런 두 모드로 나눔
- DB 표: `runs` (mode, name, score, time_ms, ...). 예전 `scores` 표는 쓰지 않음
