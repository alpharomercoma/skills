#!/bin/zsh
# Exit codes through the real CLI, not the driver. Kernel killed in the gap between run and wait,
# then false-positive controls: run-cell in a two-cell notebook, and a clean Run All.
cd ~/skills/evaluations/2026-11-accelerators
K() { perl -e 'alarm shift; exec @ARGV' 200 node ~/.claude/skills/kaggle-notebooks/scripts/cli.mjs "$@"; }
U=https://www.kaggle.com/code/alpharomercoma/kn-eval-cpu2/edit
D=$(mktemp -d)
OUT=raw/kill-cli.txt; : > $OUT
say() { echo "$@" | tee -a $OUT; }
K start --url $U | tr -s ' \n' ' ' | cut -c1-100 | tee -a $OUT; echo | tee -a $OUT
printf '# %%%%\nimport os, time\nopen("/kaggle/working/pid.txt", "w").write(str(os.getpid()))\ntime.sleep(300)\n# %%%%\nprint("second cell")\n' > $D/a.py
K push $D/a.py --url $U > /dev/null
K run --url $U | tr -s ' \n' ' ' | cut -c1-80 | tee -a $OUT; echo | tee -a $OUT
python3 -c "import time;time.sleep(6)"
say "kill the notebook kernel in the gap: $(K sh 'kill -9 $(cat /kaggle/working/pid.txt); echo sent $(cat /kaggle/working/pid.txt)' --url $U | tr -s ' \n' ' ' | cut -c1-90)"
python3 -c "import time;time.sleep(20)"
K wait --timeout 90 --url $U > $D/w.txt 2> $D/w.err; say "wait after kill: exit $?"
tr -s ' \n' ' ' < $D/w.txt | cut -c1-260 | tee -a $OUT; echo | tee -a $OUT; cut -c1-240 $D/w.err | tee -a $OUT
printf '# %%%%\nprint("first")\n# %%%%\nprint("second")\n' > $D/b.py
K push $D/b.py --url $U | tr -s ' \n' ' ' | cut -c1-90 | tee -a $OUT; echo | tee -a $OUT
K run-cell 0 --wait --timeout 90 --url $U > $D/w.txt 2> $D/w.err; say "run-cell 0 of 2, second never run: exit $?"
tr -s ' \n' ' ' < $D/w.txt | cut -c1-220 | tee -a $OUT; echo | tee -a $OUT; cut -c1-200 $D/w.err | tee -a $OUT
K run --wait --timeout 90 --url $U > $D/w.txt 2> $D/w.err; say "clean Run All: exit $?"
tr -s ' \n' ' ' < $D/w.txt | cut -c1-200 | tee -a $OUT; echo | tee -a $OUT
K stop --url $U | tr -s ' \n' ' ' | tee -a $OUT; echo | tee -a $OUT
