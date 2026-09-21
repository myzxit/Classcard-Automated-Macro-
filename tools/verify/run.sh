#!/bin/bash
# 모의 화면 회귀 테스트(확장 + Playwright 크로미움)를 한 번에 돌린다.
#
#   bash tools/verify/run.sh            # 전체 (약 8~10분)
#   bash tools/verify/run.sh run_recall2 run_gstreak   # 일부만
#
# 실제 사이트 규칙(isTrusted 검사, 자동 재생 차단, 축하 화면, 채점 결과 화면 …)을 흉내 낸 mock_*.html 을
# 확장에 보여 주고 각 모드가 끝까지 도는지 본다. 결과는 tools/verify/last_result.txt 에도 남는다.
#
# 러너는 /tmp/shots 를 작업 폴더로 쓴다(원래 그렇게 만들어졌다). 여기서 그 폴더에 복사해 넣는다.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK=/tmp/shots
mkdir -p "$WORK"
cp -f "$HERE"/shots/* "$WORK"/

# Playwright: 시스템에 있으면 그것을, 없으면 이 폴더에 설치해서 쓴다 (러너는 'playwright' 를 import 한다)
mkdir -p "$WORK/node_modules"
if [ ! -e "$WORK/node_modules/playwright" ]; then
  if [ -d /opt/node22/lib/node_modules/playwright ]; then
    ln -s /opt/node22/lib/node_modules/playwright "$WORK/node_modules/playwright"
  else
    (cd "$HERE" && [ -d node_modules/playwright ] || npm install --no-audit --no-fund playwright@1.56 >/dev/null 2>&1)
    ln -s "$HERE/node_modules/playwright" "$WORK/node_modules/playwright"
    (cd "$HERE" && npx playwright install chromium >/dev/null 2>&1 || true)
  fi
fi

# 러너가 확장 폴더를 절대 경로로 잡고 있으므로 이 저장소 위치로 바꿔 준다
sed -i "s#/home/user/Classcard-Automated-Macro-/extension#$ROOT/extension#g" "$WORK"/run_*.mjs

RUNNERS=("$@")
if [ ${#RUNNERS[@]} -eq 0 ]; then
  RUNNERS=(run_recall2 run_spell2 run_memorize run_msent run_rsent run_wtest run_tsent run_tsent2 run_matching run_scramble
           run_talk run_talk_trusted run_talk_type run_full4 run_gtalk2 run_gclass_modal run_gmulti run_gtypes run_gmatch run_gstreak run_useactive run_sspell run_sent3 run_ctest)
fi

XVFB=""
if ! [ -n "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then XVFB="xvfb-run -a"; fi

out="$HERE/last_result.txt"
: > "$out"
fail=0
for r in "${RUNNERS[@]}"; do
  [ -f "$WORK/$r.mjs" ] || { echo "== $r (없음)" | tee -a "$out"; continue; }
  # 확장 코드가 바뀌었을 때 옛 서비스워커를 쓰지 않도록 프로필을 지운다
  P=$(grep -o "launchPersistentContext('[^']*'" "$WORK/$r.mjs" | sed "s/launchPersistentContext('//;s/'//")
  [ -n "$P" ] && rm -rf "$P"
  res=$(cd "$WORK" && timeout 240 $XVFB node "$r.mjs" 2>&1 | grep -E "결과:" | tail -1 || true)
  # 브라우저를 띄우는 테스트라 가끔 시간 문제로 결과 줄이 안 나온다 — 한 번은 다시 돌려 본다
  if [ -z "$res" ]; then
    [ -n "$P" ] && rm -rf "$P"
    res=$(cd "$WORK" && timeout 240 $XVFB node "$r.mjs" 2>&1 | grep -E "결과:" | tail -1 || true)
  fi
  if [ -z "$res" ] || echo "$res" | grep -q "완주 못함\|오답\|튕김 있음\|안 됨"; then fail=$((fail+1)); mark="✗"; else mark="✓"; fi
  printf "%s %-18s %s\n" "$mark" "$r" "${res:-(결과 줄 없음)}" | tee -a "$out"
done
echo "실패 $fail / ${#RUNNERS[@]}" | tee -a "$out"
[ "$fail" -eq 0 ]
