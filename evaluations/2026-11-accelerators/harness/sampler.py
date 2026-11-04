# Independent ground truth: one JSON line per second. Knows nothing about the skill.
import json
import os
import shutil
import subprocess
import time

import psutil

path = "/kaggle/working/truth.jsonl"
psutil.cpu_percent(None)
with open(path, "a", buffering=1) as f:
    while True:
        t = time.time()
        gpus = []
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=index,utilization.gpu,memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5).stdout
            for line in out.strip().splitlines():
                i, u, m, total = [x.strip() for x in line.split(",")]
                gpus.append({"i": int(i), "util": float(u), "mem": float(m), "total": float(total)})
        except Exception:
            pass
        v = psutil.virtual_memory()
        rec = {
            "t": t,
            "gpu": gpus,
            "cpu": psutil.cpu_percent(None),
            "ncpu": psutil.cpu_count(),
            "ram_used_mib": (v.total - v.available) / 2**20,
            "ram_total_mib": v.total / 2**20,
            "disk_root_used_mib": shutil.disk_usage("/").used / 2**20,
            "disk_root_total_mib": shutil.disk_usage("/").total / 2**20,
            "disk_work_used_mib": shutil.disk_usage("/kaggle/working").used / 2**20,
            "disk_work_total_mib": shutil.disk_usage("/kaggle/working").total / 2**20,
        }
        f.write(json.dumps(rec) + "\n")
        time.sleep(max(0.0, 1.0 - (time.time() - t)))
