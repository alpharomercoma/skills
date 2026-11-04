#!/usr/bin/env python3
"""Score the second CPU run strictly: discard 20 s after every change, in baselines and holds, and
require at least 10 paired samples. Tolerances are exactly those in PLAN.md."""
import json
import statistics as st
from pathlib import Path

raw = Path(__file__).resolve().parent.parent / "raw"
truth = [json.loads(l) for l in (raw / "cpu2-truth.jsonl").read_text().splitlines() if l.strip()]
panel = [json.loads(l) for l in (raw / "cpu2-panel.jsonl").read_text().splitlines() if l.strip()]
marks = {}
for line in (raw / "cpu2-marks.txt").read_text().splitlines():
    if line.startswith("MARK"):
        _, name, t = line.split()
        marks[name] = float(t)
ok = [p for p in panel if p["ok"]]
lat = sorted(p["t1"] - p["t0"] for p in panel)
SETTLE = 20.0
ncpu = truth[0]["ncpu"]


def mid(p):
    return (p["t0"] + p["t1"]) / 2


def nearest(t):
    return min(truth, key=lambda r: abs(r["t"] - t))


def window(a, b):
    return [p for p in ok if a + SETTLE <= mid(p) <= b]


print(f"calls {len(panel)}, ok {len(ok)} ({100 * len(ok) / len(panel):.1f}%), need >=95%")
print(f"latency s: median {st.median(lat):.2f}, p95 {lat[int(.95 * len(lat))]:.2f}, max {lat[-1]:.2f}; within 10 s {100 * sum(x <= 10 for x in lat) / len(lat):.1f}%, need >=95%")
gaps = [b["t0"] - a["t0"] for a, b in zip(panel, panel[1:])]
print(f"gap between reads s: median {st.median(gaps):.1f}, max {max(gaps):.1f}, need <=20")

print("\nM4 CPU over all cores (panel / cores vs psutil), during the burn:")
s = window(marks["cpu_start"], marks["cpu_end"])
pairs = [(p["r"]["cpuPercent"], nearest(mid(p))["cpu"]) for p in s]
errs = sorted(abs(x / ncpu - y) for x, y in pairs)
print(f"  n={len(pairs)} (need >=10); raw panel median {st.median(x for x, _ in pairs):.1f}; normalised median error {st.median(errs):.2f}, need <=10")
s = window(marks["cpu_end"], marks["ram_start"])
pairs = [(p["r"]["cpuPercent"], nearest(mid(p))["cpu"]) for p in s]
print(f"  idle: n={len(pairs)}, normalised median error {st.median(sorted(abs(x / ncpu - y) for x, y in pairs)):.2f}")


def rise(label, get, key, base, hold, want, tol):
    b = window(*base)
    h = window(*hold)
    pb = st.median(get(p) for p in b)
    ph = st.median(get(p) for p in h)
    tb = st.median(r[key] for r in truth if base[0] + SETTLE <= r["t"] <= base[1])
    th = st.median(r[key] for r in truth if hold[0] + SETTLE <= r["t"] <= hold[1])
    pr, tr = ph - pb, th - tb
    print(f"  {label}: baseline n={len(b)}, hold n={len(h)} (need >=10 each); panel rise {pr:.0f} MiB, truth rise {tr:.0f} MiB, error {abs(pr - tr):.0f}, tolerance {tol}")


ram = lambda p: p["r"]["ram"]["usedMiB"]
disk = lambda p: p["r"]["disk"]["usedMiB"]
print("\nM5 RAM, 8 GiB:")
rise("RAM", ram, "ram_used_mib", (marks["cpu_end"], marks["ram_start"]), (marks["ram_held"], marks["ram_end"]), 8192, 819)
print("\nM6 disk, 5 GiB each:")
rise("write to /kaggle/working, panel vs working fs", disk, "disk_work_used_mib", (marks["ram_end"], marks["disk_work_start"]), (marks["disk_work_written"], marks["disk_work_end"]), 5120, 256)
rise("write to /tmp, panel vs root fs", disk, "disk_root_used_mib", (marks["disk_work_end"], marks["disk_tmp_start"]), (marks["disk_tmp_written"], marks["disk_tmp_end"]), 5120, 256)

print("\nM7 freshness, need <=20 s:")
for name, when, cond in [
    ("CPU load seen", marks["cpu_start"], lambda p: p["r"]["cpuPercent"] > 200),
    ("CPU release seen", marks["cpu_end"], lambda p: p["r"]["cpuPercent"] < 100),
    ("RAM held seen", marks["ram_held"], lambda p: ram(p) > 7000),
    ("RAM release seen", marks["ram_end"], lambda p: ram(p) < 4000),
    ("/tmp disk seen", marks["disk_tmp_written"], lambda p: disk(p) > 6000),
]:
    seen = next((p["t1"] - when for p in ok if p["t1"] >= when and cond(p)), None)
    print(f"  {name}: {'never' if seen is None else f'{seen:.1f} s'}")
print("\nLimits:", ok[-1]["r"]["ram"]["maxMiB"], ok[-1]["r"]["disk"]["maxMiB"], ok[-1]["r"]["sessionLimit"], "unrecognised:", {x for p in ok for x in p["r"]["unrecognised"]})
print("Truth limits: ram", round(truth[-1]["ram_total_mib"]), "working", round(truth[-1]["disk_work_total_mib"]))
