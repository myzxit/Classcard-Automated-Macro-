#!/bin/bash
# 사파리 웹 확장(아이폰 앱)으로 바꾸는 스크립트. **맥에서만 돌아간다.**
#
# 애플이 주는 공식 변환기를 쓴다. 우리가 Xcode 프로젝트 파일을 손으로 만들어 두면
# Xcode 버전이 바뀔 때마다 깨지므로, 변환은 그때그때 맥에서 하는 편이 안전하다.
#
#   bash ios/safari/convert.sh
#
# 끝나면 Xcode 가 열린다. 서명(Signing & Capabilities)에서 본인 Apple ID 팀을 고르고
# 아이폰을 연결해 실행하면 설치된다. 무료 계정은 7일마다 다시 설치해야 한다.
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "이 스크립트는 맥에서만 동작합니다. (아이폰 앱 빌드에는 Xcode 가 필요합니다)"
  echo "맥이 없으면 ios/README.md 의 '북마클릿' 방법을 쓰세요 — 맥 없이 바로 됩니다."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/ios/safari/build"
rm -rf "$OUT"
mkdir -p "$OUT"

# 사파리는 chrome.debugger 를 지원하지 않는다. 그 권한이 들어 있으면 변환기가 경고를
# 내고, 남겨 둬도 쓸 수 없다. 그래서 복사본에서 빼고 변환한다.
cp -R "$ROOT/extension" "$OUT/extension"
python3 - "$OUT/extension/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p, encoding='utf-8'))
m['permissions'] = [x for x in m.get('permissions', []) if x != 'debugger']
m['name'] = '클래스카드 자동화 (iOS)'
json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('manifest 에서 debugger 권한을 뺐습니다:', m['permissions'])
PY

xcrun safari-web-extension-converter "$OUT/extension" \
  --project-location "$OUT" \
  --app-name "ClassCard Macro" \
  --bundle-identifier "net.classcard.macro.ios" \
  --swift \
  --copy-resources

echo
echo "변환 끝. Xcode 에서 서명 팀을 고르고 아이폰에 설치하세요."
echo "설치 뒤: 설정 > Safari > 확장 프로그램 에서 켜고, 클래스카드 페이지에서 'ㅏA' 메뉴로 실행합니다."
