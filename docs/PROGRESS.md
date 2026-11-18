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
