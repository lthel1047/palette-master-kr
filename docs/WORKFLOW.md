# 작업 → 테스트 → 반영 순서

실제로 플레이하는 사람들이 버그를 겪지 않도록, 바로 실제 사이트에 올리지 않는다.

| 브랜치 | 사이트 | 랭킹·댓글 서버 | 광고 |
|---|---|---|---|
| `dev` | https://saekgam.cc/staging/ (테스트 서버, 검색 제외) | https://api-staging.saekgam.cc (테스트 DB) | 없음 |
| `main` | https://saekgam.cc (실제 사이트) | https://api.saekgam.cc (실제 DB) | 결과 화면 |

1. 새 작업은 `dev` 브랜치에서 한다. `dev`에 푸시하면 1분 안에 테스트 사이트에 반영된다.
2. 테스트 사이트에서 모바일·PC로 직접 플레이해 확인한다. 화면 왼쪽 아래에 「🧪 테스트 서버」가 보이면 테스트 사이트다.
3. 문제가 없으면 `dev`를 `main`에 합친다 (`git checkout main && git merge dev && git push`). 그때 실제 사이트에 반영된다.

- 사이트 묶기는 `scripts/build_site.py`가 한다 (`--staging`이면 noindex, 테스트 API, 광고 끄기, 표시 띠).
- 랭킹 서버: Cloudflare Workers 에 `saekgam-api`(main) 와 `saekgam-api-staging`(dev) 두 개.
  테스트 서버는 `npx wrangler deploy --env staging` 으로 배포되고 DB도 따로 쓴다.
