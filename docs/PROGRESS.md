# 진행 상황 (2026-11-19)

## 완료
- 게임 개발, GitHub Pages 배포: https://lthel1047.github.io/palette-master-kr/
- 광고 자리: 결과 화면 하단에만 있음 (`ads-config.js`에서 설정)
- 애드핏 신청 자료: `docs/adfit/` (PDF와 캡처)

## 광고 신청 현황
- 구글 애드센스: github.io 주소는 소유 도메인이 아니라서 신청 불가.
  내 도메인을 연결해야 함 (Cloudflare 계정에 있는 것을 확인할 예정)
- 카카오 애드핏: with.kakao.com 제휴 제안서 작성 중.
  사전 승인을 받은 뒤 광고 단위 ID(DAN-...)를 받으면 된다.

## 다음 할 일
1. 애드핏 승인 후 DAN ID를 `ads-config.js`에 넣고 provider를 'adfit'으로 바꿔 푸시
2. (선택) Cloudflare 도메인 연결 → 애드센스 신청 → ads.txt 추가
