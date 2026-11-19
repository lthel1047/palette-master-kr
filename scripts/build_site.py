#!/usr/bin/env python3
"""
배포용 사이트 폴더 만들기.

  python3 scripts/build_site.py <소스 폴더> <출력 폴더> <버전> [--staging]

- JS/CSS 주소와 모듈 import 경로에 ?v=버전 을 붙인다 (새 화면 + 옛 코드가 섞이지 않게)
- --staging: 테스트 서버용
    * 검색에 안 잡히게 noindex
    * 랭킹·댓글은 테스트 API(api-staging.saekgam.cc) 사용 → 실제 랭킹에 테스트 기록이 안 섞임
    * 광고 끄기 (애드센스 확인 코드 제거, provider 'none') → 무효 클릭 방지
    * 화면 위에 「테스트 서버」 표시
"""
import re, shutil, sys
from pathlib import Path

src, out, ver = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
staging = '--staging' in sys.argv

out.mkdir(parents=True, exist_ok=True)
for name in ['index.html', 'ads-config.js', 'favicon.svg', 'og.png']:
    if (src / name).exists():
        shutil.copy2(src / name, out / name)
for d in ['css', 'js', 'vendor', 'guide']:
    if (src / d).exists():
        shutil.copytree(src / d, out / d, dirs_exist_ok=True)
# 실제 사이트 루트에만 두는 파일: ads.txt, 검색엔진용 robots.txt·sitemap.xml, 구글/네이버 소유 확인 파일
if not staging:
    for f in ['ads.txt', 'robots.txt', 'sitemap.xml', *[p.name for p in src.glob('google*.html')], *[p.name for p in src.glob('naver*.html')]]:
        if (src / f).exists():
            shutil.copy2(src / f, out / f)

html = (out / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'(src|href)="((?:js/[^"]+\.js)|ads-config\.js|(?:css/[^"]+\.css))"', rf'\1="\2?v={ver}"', html)

for js in (out / 'js').glob('*.js'):
    t = js.read_text(encoding='utf-8')
    t2 = re.sub(r"from '\./([a-z0-9]+\.js)'", rf"from './\1?v={ver}'", t)
    if t2 != t:
        js.write_text(t2, encoding='utf-8')

if staging:
    html = re.sub(r'\s*<!-- Google AdSense.*?</script>', '', html, flags=re.S)
    html = html.replace('<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">\n'
                        "  <script>window.RANKING_API = 'https://api-staging.saekgam.cc'; window.SAEKGAM_STAGING = true;</script>", 1)
    html = html.replace('</body>', '  <div style="position:fixed;left:8px;bottom:6px;z-index:50;'
                        'background:#ffd43b;color:#1d1d1f;font:700 12px/1 system-ui,sans-serif;padding:5px 10px;'
                        'border-radius:8px;pointer-events:none">🧪 테스트 서버 — 실제 사이트와 랭킹이 달라요</div>\n</body>', 1)
    cfg = (out / 'ads-config.js').read_text(encoding='utf-8')
    (out / 'ads-config.js').write_text(re.sub(r"provider:\s*'[a-z]+'", "provider: 'none'", cfg), encoding='utf-8')

(out / 'index.html').write_text(html, encoding='utf-8')
if staging and (out / 'guide' / 'index.html').exists():
    g = out / 'guide' / 'index.html'
    g.write_text(g.read_text(encoding='utf-8').replace('<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">', 1), encoding='utf-8')
print(f"built {'staging' if staging else 'production'} → {out} (v={ver})")
