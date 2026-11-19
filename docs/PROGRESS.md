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
- 일반 모드 다시 추가: 🎨 일반(시간 제한 없음, 계속 섞기 가능, 랭킹 없음) + ⏱ 30초 챌린지 + ⚡ 스피드 런

## 의견·댓글 (2026-11-19)
- 결과 화면 「💬 의견·댓글 남기기」 → 모두에게 보이는 방명록. 2~300자, 링크 금지, 같은 IP 20초에 1개·하루 30개
- API: `GET /feedback`, `POST /feedback {name?, body}` / DB 표: `feedback`
- 댓글 숨기기(지우지 않고 안 보이게): D1 Console에서 `UPDATE feedback SET hidden = 1 WHERE id = 번호;`
- 전체 보기: `SELECT id, name, body, datetime(created_at/1000, 'unixepoch', '+9 hours') FROM feedback ORDER BY id DESC;`

## 그래픽·헤라 개선 (2026-11-19, 플레이어 피드백 반영)
- 펴 바르면 색이 흐려짐 → 물감을 불투명하게 계산 (두께 0.02~0.045 사이에서 바로 덮임), 헤라는 일정 두께(FILM 0.14)로 펴 바름
- 뿌옇다 → 칸당 3×3 픽셀 고해상도 렌더러, 가장자리를 또렷하게 자름
- 물감 같지 않다 → 두께 지도 + 물감 결 노이즈로 빛·광택·바닥 그림자 표현
- 섞은 뒤 자국 → 안 보일 만큼 얇은 막은 헤라가 통째로 걷어 감, 빈 바닥엔 막을 덜 깜
- 물감 그림은 물감이 바뀔 때만 다시 그림 (돋보기·튜브 이동 때는 재사용)

## 원작 느낌 3D로 전환 (2026-11-19)
- 2D 그래픽이 별로라는 피드백 → three.js(r160, vendor/three 포함)로 원작처럼 3D 장면
- 비스듬히 내려다보는 카메라, 팔레트 위에 목표 카드, 서 있는 튜브 8개, 헤라·돋보기 3D 모델, 부드러운 그림자
- 물감: 두께 텍스처로 면을 실제로 솟게 하고(높이 변형), 광택 코팅 재질
- 색 정확도: 평평한 물감이 원래 색으로 보이도록 밝기 보정 (EXPOSURE 0.82, 물감 GAIN 1.5)
- 판정: 돋보기 테 안쪽(반지름 9.8칸) — 확대 없음
