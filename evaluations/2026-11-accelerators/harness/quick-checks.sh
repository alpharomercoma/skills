#!/bin/zsh
# C13 wrong-notebook safety, C14 no stale values, C15 busy refusals. Uses the installed CLI.
cd ~/skills/evaluations/2026-11-accelerators
K() { perl -e 'alarm shift; exec @ARGV' 120 node ~/.claude/skills/kaggle-notebooks/scripts/cli.mjs "$@"; }
B=https://www.kaggle.com/code/alpharomercoma
X=$B/kn-eval-s4b-closed/edit
Y=$B/kn-eval-s4d-closed-ws/edit
FG=$B/kn-eval-s5-foreground/edit
OUT=raw/quick-checks.txt
: > $OUT
say() { echo "$@" | tee -a $OUT; }

say "=== C13: alternate between two notebooks, marking each with its own sentinel"
printf 'print("sentinel-X")\n' > /tmp/kn-x.py; printf 'print("sentinel-Y")\n' > /tmp/kn-y.py
K push /tmp/kn-x.py --url $X > /dev/null; K push /tmp/kn-y.py --url $Y > /dev/null
wrong=0; n=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  a=$(K cells --url $X | grep -c 'sentinel-X'); b=$(K cells --url $Y | grep -c 'sentinel-Y')
  c=$(K cells --url $X | grep -c 'sentinel-Y'); d=$(K cells --url $Y | grep -c 'sentinel-X')
  n=$((n+2)); [ "$a" = 1 ] || wrong=$((wrong+1)); [ "$b" = 1 ] || wrong=$((wrong+1)); [ "$c" = 0 ] || wrong=$((wrong+1)); [ "$d" = 0 ] || wrong=$((wrong+1))
done
say "alternating reads: $n, wrong-notebook results: $wrong (need 0)"
printf 'print("sentinel-X2")\n' > /tmp/kn-x2.py
K set-cell 0 /tmp/kn-x2.py --url $X | tr -d '\n ' | tee -a $OUT; echo | tee -a $OUT
say "after a write to X: X has X2 = $(K cells --url $X | grep -c sentinel-X2), Y has X2 = $(K cells --url $Y | grep -c sentinel-X2) (need 1 and 0)"
K tabs > /tmp/kn-tabs; say "open editor tabs: $(python3 -c "import json;print(len(json.load(open('/tmp/kn-tabs'))))")"
K cells 2>&1 | head -1 | cut -c1-90 | tee -a $OUT; say "read with no --url and several tabs: exit ${pipestatus[1]} (must refuse)"
K set-cell 0 /tmp/kn-x.py 2>&1 | cut -c1-90 | tee -a $OUT; say "write with no --url: exit ${pipestatus[1]} (must refuse)"

say "=== C14: an off session returns no live values"
for i in 1 2 3; do K resources --url $X | tr -d '\n ' | tee -a $OUT; echo | tee -a $OUT; done
K close-tab --url $X > /dev/null; K resources --url $X | tr -d '\n ' | tee -a $OUT; echo " (after reopening)" | tee -a $OUT

say "=== C15: during a busy foreground cell"
t0=$(python3 -c 'import time;print(time.time())'); K exec 'open("/kaggle/working/SIDE_EFFECT","w").write("x")' --url $FG 2>&1 | cut -c1-130 | tee -a $OUT; rc=${pipestatus[1]}
say "busy exec: exit $rc in $(python3 -c "import time;print(round(time.time()-$t0,1))") s (need refusal within 10)"
t0=$(python3 -c 'import time;print(time.time())'); K wait --timeout 5 --url $FG > /tmp/kn-w.out 2>&1; rc=$?
say "wait --timeout 5: exit $rc in $(python3 -c "import time;print(round(time.time()-$t0,1))") s (need 124 within 12)"
t0=$(python3 -c 'import time;print(time.time())'); K sh 'ls /kaggle/working/SIDE_EFFECT 2>&1 | tail -1; echo side-channel-ok' --url $FG 2>&1 | tee -a $OUT
say "busy sh took $(python3 -c "import time;print(round(time.time()-$t0,1))") s; SIDE_EFFECT must not exist"
K status --url $FG | grep -E '"busy"|"kernel"' | tr -d '\n ' | tee -a $OUT; echo | tee -a $OUT
say "=== sessions shows what the panel shows"
K sessions | python3 -c "import json,sys;[print(r['title'],r['status'],r['accelerator']) for r in json.load(sys.stdin)]" | tee -a $OUT
say "=== done $(date -u +%T)"
