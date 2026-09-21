#!/bin/bash
# 모의 화면 회귀 테스트 모음
cd /tmp/shots
out=/tmp/shots/suite_now.txt
: > $out
for r in run_recall2 run_spell2 run_memorize run_msent run_rsent run_wtest \
         run_tsent run_tsent2 run_matching run_scramble run_talk run_talk_trusted \
         run_talk_type run_full4 run_gtalk2 run_gclass_modal run_gmulti run_gtypes run_gmatch run_gstreak; do
  [ -f "$r.mjs" ] || continue
  rm -rf "profile_$r"
  res=$(timeout 180 xvfb-run -a node "$r.mjs" 2>&1 | grep -E "결과:" | tail -1)
  printf "== %-18s %s\n" "$r" "${res:-(결과 줄 없음)}" >> $out
done
cat $out
