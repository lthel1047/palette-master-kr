/*
 * 광고 설정 — 결과 화면에만 광고가 나옵니다.
 *
 * provider:
 *   'none'    광고 없음 (기본값). showPlaceholder 가 true 면 광고 자리만 점선으로 표시
 *   'adsense' 구글 애드센스  → adsense.client / adsense.slot 입력
 *   'adfit'   카카오 애드핏  → adfit.unit 입력 (DAN-로 시작하는 광고단위 ID)
 *
 * 애드센스를 쓰면 사이트 루트의 ads.txt 에 아래 한 줄을 넣어야 합니다.
 *   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
 */
window.ADS_CONFIG = {
  provider: 'adsense',
  showPlaceholder: false,
  adsense: {
    client: 'ca-pub-7945324970921581',
    slot: '0000000000',   // ← 애드센스에서 디스플레이 광고 단위를 만들고 받은 숫자로 교체
  },
  adfit: {
    unit: 'DAN-XXXXXXXXXXXXXXX',
    width: 320,
    height: 100,
  },
};
