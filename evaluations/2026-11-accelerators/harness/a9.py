#!/usr/bin/env python3
"""A9 and C11, on CPU: one committed run through Kaggle's official CLI and one through the skill's
save-version. Each prints a unique run ID and timed beats. Records how status and `logs -f` track it,
how late each beat arrives, and whether the output holds the right ID. Run on CPU to protect the
isolated GPU quota test, which is a change from A9's wording."""
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

E = Path(__file__).resolve().parent.parent
RAW = E / "raw"
OWNER = "alpharomercoma"
CLI = str(Path.home() / ".claude/skills/kaggle-notebooks/scripts/cli.mjs")
WORK = Path(sys.argv[1])
LOG = RAW / "a9.jsonl"


def emit(arm, event, **kw):
    row = {"t": round(time.time(), 2), "arm": arm, "event": event, **kw}
    with LOG.open("a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row)[:230], flush=True)


def payload(run_id):
    return f"""import time
print("RUN_ID {run_id}", flush=True)
for i in range(18):
    print("BEAT", i, round(time.time(), 2), flush=True)
    time.sleep(10)
open("/kaggle/working/result.txt", "w").write("{run_id}")
print("DONE {run_id}", flush=True)
"""


def follow(arm, slug):
    """Stream logs and time each beat's arrival against the time it printed inside itself."""
    p = subprocess.Popen(["kaggle", "kernels", "logs", f"{OWNER}/{slug}", "-f"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    delays, other = [], []
    for line in p.stdout:
        m = re.search(r"BEAT (\d+) (\d+\.\d+)", line)
        if m:
            delays.append(round(time.time() - float(m.group(2)), 1))
        else:
            other.append(line.strip()[:160])
    code = p.wait()
    emit(arm, "logs -f ended", exit=code, beats=len(delays), delays=delays, other=other[:6])


def watch(arm, slug, run_id):
    t0 = time.time()
    last = None
    follower = None
    while time.time() - t0 < 1500:
        r = subprocess.run(["kaggle", "kernels", "status", f"{OWNER}/{slug}"], capture_output=True, text=True)
        text = (r.stdout + r.stderr).strip()
        m = re.search(r'status "?(?:KernelWorkerStatus\.)?(\w+)', text)
        state = (m.group(1) if m else text[:90]).upper()
        if state != last:
            emit(arm, "status", state=state, seconds=round(time.time() - t0))
            last = state
        if follower is None and state == "RUNNING":
            follower = threading.Thread(target=follow, args=(arm, slug))
            follower.start()
        if state in ("COMPLETE", "ERROR", "CANCELACKNOWLEDGED", "CANCEL_ACKNOWLEDGED"):
            break
        time.sleep(10)
    if follower:
        follower.join(timeout=120)
    out = WORK / f"out-{arm}"
    out.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["kaggle", "kernels", "output", f"{OWNER}/{slug}", "-p", str(out)], capture_output=True, text=True)
    got = (out / "result.txt").read_text().strip() if (out / "result.txt").exists() else None
    emit(arm, "output", exit=r.returncode, files=sorted(x.name for x in out.iterdir()), id_matches=got == run_id)
    r = subprocess.run(["kaggle", "kernels", "logs", f"{OWNER}/{slug}"], capture_output=True, text=True)
    emit(arm, "logs after completion", exit=r.returncode, has_run_id=run_id in r.stdout, beats=len(re.findall(r"BEAT \d+", r.stdout)))


def cli_arm():
    arm, slug, run_id = "official-cli", "kn-eval-a9-cli", f"cli-{uuid.uuid4().hex[:10]}"
    d = WORK / "cli"
    d.mkdir(parents=True, exist_ok=True)
    (d / "run.py").write_text(payload(run_id))
    (d / "kernel-metadata.json").write_text(json.dumps({"id": f"{OWNER}/{slug}", "title": slug, "code_file": "run.py", "language": "python", "kernel_type": "script", "is_private": True, "enable_gpu": False, "enable_tpu": False, "enable_internet": False}))
    a = time.time()
    r = subprocess.run(["kaggle", "kernels", "push", "-p", str(d)], capture_output=True, text=True)
    emit(arm, "pushed", run_id=run_id, exit=r.returncode, seconds=round(time.time() - a, 1), said=(r.stdout + r.stderr).strip()[:140])
    watch(arm, slug, run_id)


def ui_arm():
    arm, slug, run_id = "skill-save-version", "kn-eval-a9-ui", f"ui-{uuid.uuid4().hex[:10]}"
    d = WORK / "ui"
    d.mkdir(parents=True, exist_ok=True)
    (d / "run.py").write_text(payload(run_id))
    k = lambda *a: subprocess.run(["node", CLI, *a], capture_output=True, text=True, timeout=240)
    a = time.time()
    r = k("new", "--title", slug)
    if r.returncode:
        return emit(arm, "new failed", said=(r.stdout + r.stderr)[:200])
    url = json.loads(r.stdout)["url"]
    r = k("push", str(d / "run.py"), "--url", url)
    emit(arm, "pushed", run_id=run_id, exit=r.returncode, said=r.stdout[-110:].strip() if r.returncode == 0 else r.stderr[:200])
    r = k("save-version", "--name", "a9", "--url", url)
    emit(arm, "save-version", exit=r.returncode, seconds=round(time.time() - a, 1), said=(r.stdout + r.stderr).strip()[:200])
    if r.returncode == 0:
        watch(arm, slug, run_id)
    k("close-tab", "--url", url)


threads = [threading.Thread(target=cli_arm), threading.Thread(target=ui_arm)]
[t.start() for t in threads]
[t.join() for t in threads]
print("A9 FINISHED", flush=True)
