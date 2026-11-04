#!/bin/zsh
# A8 + A9 / C11: official CLI batch runs. What hardware does each documented ID really give?
# Each run prints the real device list, so a silent downgrade is visible. Private notebooks only.
cd ~/skills/evaluations/2026-11-accelerators
OUT=raw/a8-cli.csv
echo 'accel,slug,push_exit,push_msg,seconds_to_end,final_status,hardware,run_id_found' > $OUT
W=$(mktemp -d)
USER_=alpharomercoma
for ACC in NvidiaTeslaT4 NvidiaL4 NvidiaL4X1 NvidiaH100; do
  SLUG="kn-eval-cli-$(echo $ACC | tr 'A-Z' 'a-z')"
  RUNID="run-$RANDOM$RANDOM"
  D=$W/$SLUG; mkdir -p $D
  cat > $D/probe.py <<EOF
import subprocess, time
print("RUN_ID $RUNID", flush=True)
r = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1 | sort | uniq -c", shell=True, capture_output=True, text=True)
print("HARDWARE", r.stdout.strip().replace("\n", " ; ") or "none", flush=True)
try:
    import torch
    print("TORCH_CUDA", torch.cuda.device_count(), flush=True)
except Exception as e:
    print("TORCH_ERR", e, flush=True)
for i in range(12):
    print("tick", i, time.time(), flush=True)
    time.sleep(5)
print("BATCH_DONE", flush=True)
EOF
  cat > $D/kernel-metadata.json <<EOF
{"id": "$USER_/$SLUG", "title": "$SLUG", "code_file": "probe.py", "language": "python", "kernel_type": "script", "is_private": true, "enable_gpu": true, "enable_internet": false, "machine_shape": "$ACC"}
EOF
  t0=$(date +%s)
  msg=$(kaggle -W kernels push -p $D --accelerator $ACC 2>&1 | tr '\n' ' ' | tr ',' ';' | cut -c1-200)
  pe=${pipestatus[1]}
  echo "$(date -u +%T) $ACC push: $msg" >> raw/a8-cli.log
  st=unknown
  for i in $(seq 1 40); do
    st=$(kaggle -W kernels status $USER_/$SLUG 2>&1 | tail -1 | cut -c1-120)
    echo "$(date -u +%T) $ACC status: $st" >> raw/a8-cli.log
    if [ "$i" = 3 ]; then kaggle -W kernels logs $USER_/$SLUG 2>&1 | tail -3 | cut -c1-200 >> raw/a8-cli.log; fi
    echo "$st" | grep -qEi 'COMPLETE|ERROR|CANCEL|not found|403|404|forbidden|Unauthorized' && break
    sleep 15
  done
  secs=$(( $(date +%s) - t0 ))
  O=$W/out-$SLUG; mkdir -p $O
  kaggle -W kernels output $USER_/$SLUG -p $O -q >> raw/a8-cli.log 2>&1
  hw=$(cat $O/*.log 2>/dev/null | grep -aoE 'HARDWARE[^"\\]*' | head -1 | cut -c10-120 | tr ',' ';')
  found=$(cat $O/*.log 2>/dev/null | grep -ac "RUN_ID $RUNID")
  echo "$ACC,$SLUG,$pe,$msg,$secs,$(echo $st | tr ',' ';'),$hw,$found" >> $OUT
done
echo DONE >> raw/a8-cli.log
