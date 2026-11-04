#!/bin/zsh
# Stop every test session and delete only this evaluation's notebooks. A name must match the test
# pattern exactly, so the account's other notebooks can't be touched. Results stay in raw/.
cd ~/skills/evaluations/2026-11-accelerators
K() { perl -e 'alarm shift; exec @ARGV' 120 node ~/.claude/skills/kaggle-notebooks/scripts/cli.mjs "$@"; }
OUT=raw/cleanup.txt; : > $OUT
K sessions | python3 -c "
import json,re,sys
for r in json.load(sys.stdin):
    if re.fullmatch(r'kn-(eval|u[1-6])-[a-z0-9-]+', r['title']) and r['type']=='interactive': print(r['title'])
" > /tmp/kn-live.txt
while read -r t; do
  K sessions-stop "$t" 2>&1 | tr -s ' \n' ' ' | cut -c1-110 | tee -a $OUT; echo | tee -a $OUT
done < /tmp/kn-live.txt
echo "--- live after stopping" | tee -a $OUT
K sessions | python3 -c "import json,sys;print([(r['title'],r['status']) for r in json.load(sys.stdin)])" | tee -a $OUT
kaggle kernels list --mine --page-size 100 --csv 2>/dev/null | cut -d, -f1 | grep -E '^alpharomercoma/kn-(eval|u[1-6])-[a-z0-9-]+$' > /tmp/kn-delete.txt
echo "--- deleting $(wc -l < /tmp/kn-delete.txt | tr -d ' ') test notebooks" | tee -a $OUT
while read -r ref; do
  kaggle -W kernels delete "$ref" -y 2>&1 | tail -1 | cut -c1-90 | tee -a $OUT
done < /tmp/kn-delete.txt
echo "--- what remains that matches the test pattern" | tee -a $OUT
kaggle kernels list --mine --page-size 100 --csv 2>/dev/null | cut -d, -f1 | grep -cE '^alpharomercoma/kn-(eval|u[1-6])-' | tee -a $OUT
echo "--- other notebooks, untouched" | tee -a $OUT
kaggle kernels list --mine --page-size 100 --csv 2>/dev/null | cut -d, -f1 | grep -E '^alpharomercoma/' | grep -vcE '^alpharomercoma/kn-(eval|u[1-6])-' | tee -a $OUT
find ~/.kaggle-agent/backups -type f \( -name 'alpharomercoma__kn-eval-*' -o -name 'alpharomercoma__kn-u[1-6]-*' \) -print -delete | wc -l | tee -a $OUT
rm -f /tmp/kn-live.txt /tmp/kn-delete.txt /tmp/kn-x.py /tmp/kn-y.py /tmp/kn-x2.py /tmp/kn-tabs
