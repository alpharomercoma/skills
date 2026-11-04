#!/bin/zsh
# One line every 30 s: the official quota, for burn-rate and lag analysis.
cd ~/skills/evaluations/2026-11-accelerators
[ -f raw/quota-30s.csv ] || echo 'utc,gpu_used,tpu_used' > raw/quota-30s.csv
for i in $(seq 1 ${1:-480}); do
  kaggle -W quota --format json 2>/dev/null | python3 -c "import json,sys,datetime;q=json.load(sys.stdin);print(datetime.datetime.now(datetime.UTC).strftime('%FT%TZ'),next(r['used'] for r in q if r['resource']=='GPU'),next(r['used'] for r in q if r['resource']=='TPU'),sep=',')" >> raw/quota-30s.csv
  sleep 30
done
