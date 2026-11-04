#!/usr/bin/env python3
"""Score the skill's resources output against nvidia-smi. Tolerances are from PLAN.md."""
import json
import re
import statistics as st
import sys
from pathlib import Path

raw = Path(__file__).resolve().parent.parent / "raw"
truth = [json.loads(l) for l in (raw / "gpu-truth.jsonl").read_text().splitlines() if l.strip()]
panel = [json.loads(l) for l in (raw / "gpu-panel.jsonl").read_text().splitlines() if l.strip()]
marks = {}
for line in (raw / "gpu-marks.txt").read_text().splitlines():
    if line.startswith("MARK"):
        _, name, t = line.split()
        marks[name] = float(t)

UNITS = {"bytes": 1 / 2**20, "b": 1 / 2**20, "kib": 1 / 1024, "mib": 1, "gib": 1024, "tib": 1024**2}


def mib(text):
    m = re.fullmatch(r"([\d.]+)\s*([A-Za-z]+)", text.strip())
    return float(m.group(1)) * UNITS[m.group(2).lower()] if m else None


def pct(text):
    m = re.fullmatch(r"([\d.]+)%", text.strip())
    return float(m.group(1)) if m else None


def gpus(entry):
    secs = entry["r"]["sections"]
    utils = [pct(s["value"]) for s in secs if s["label"].lower() == "gpu"]
    mems = [mib(s["value"]) for s in secs if s["label"].lower() == "gpu memory"]
    return utils, mems


def nearest(t):
    return min(truth, key=lambda r: abs(r["t"] - t))


PHASES = [
    ("idle before", marks["idle_0"], marks["load_start_cuda:0"], None),
    ("load gpu0", marks["load_start_cuda:0"], marks["load_end_cuda:0"], 0),
    ("idle mid", marks["released_cuda:0"], marks["load_start_cuda:1"], None),
    ("load gpu1", marks["load_start_cuda:1"], marks["load_end_cuda:1"], 1),
    ("idle after", marks["released_cuda:1"], marks["done"], None),
]
SETTLE = 20.0

ok = [p for p in panel if p["ok"]]
latency = [p["t1"] - p["t0"] for p in panel]
print(f"resources calls: {len(panel)}, succeeded {len(ok)} ({100 * len(ok) / len(panel):.1f}%)  need >=95%")
print(f"call latency s: median {st.median(latency):.1f}, p95 {sorted(latency)[int(0.95 * len(latency))]:.1f}, max {max(latency):.1f}  "
      f"within 10 s: {100 * sum(l <= 10 for l in latency) / len(latency):.0f}%  need >=95%")
print(f"gap between reads s: max {max(b['t0'] - a['t0'] for a, b in zip(panel, panel[1:])):.1f}  need <=20")
print(f"truth samples {len(truth)}")

all_u, all_m = {0: [], 1: []}, {0: [], 1: []}
print("\nPer phase, after discarding the first 20 s (panel read paired with nearest truth sample):")
print(f"{'phase':<13}{'gpu':>4}{'n':>4}{'panel util':>12}{'true util':>11}{'util err':>10}{'panel mem':>11}{'true mem':>10}{'mem err':>9}")
for name, a, b, _ in PHASES:
    sel = [p for p in ok if a + SETTLE <= (p["t0"] + p["t1"]) / 2 <= b]
    for g in (0, 1):
        rows = []
        for p in sel:
            u, m = gpus(p)
            if len(u) <= g or len(m) <= g or u[g] is None or m[g] is None:
                continue
            tr = nearest((p["t0"] + p["t1"]) / 2)
            tg = next(x for x in tr["gpu"] if x["i"] == g)
            rows.append((u[g], tg["util"], m[g], tg["mem"]))
        if not rows:
            print(f"{name:<13}{g:>4}{0:>4}  no paired samples")
            continue
        ue = [abs(r[0] - r[1]) for r in rows]
        me = [abs(r[2] - r[3]) for r in rows]
        all_u[g] += ue
        all_m[g] += [(abs(r[2] - r[3]), r[3]) for r in rows]
        print(f"{name:<13}{g:>4}{len(rows):>4}{st.median(r[0] for r in rows):>12.1f}{st.median(r[1] for r in rows):>11.1f}"
              f"{st.median(ue):>10.1f}{st.median(r[2] for r in rows):>11.0f}{st.median(r[3] for r in rows):>10.0f}{st.median(me):>9.0f}")

print("\nCriteria (need >=10 paired samples per load phase):")
for g in (0, 1):
    if all_u[g]:
        s = sorted(all_u[g])
        mem_ok = sum(e <= max(128, 0.05 * tv) for e, tv in all_m[g]) / len(all_m[g])
        print(f"  gpu{g}: util median err {st.median(s):.1f} (need <=10), p95 {s[int(.95 * len(s))]:.1f} (need <=20); "
              f"memory within tolerance in {100 * mem_ok:.0f}% of samples, median err {st.median(e for e, _ in all_m[g]):.0f} MiB")

print("\nFreshness, from each load change to the first panel read showing it (need <=20 s):")
for name, g, when, cond in [
    ("load gpu0 seen", 0, marks["load_start_cuda:0"], lambda u, m: m > 1000),
    ("release gpu0 seen", 0, marks["released_cuda:0"], lambda u, m: m < 1000),
    ("load gpu1 seen", 1, marks["load_start_cuda:1"], lambda u, m: m > 1000),
    ("release gpu1 seen", 1, marks["released_cuda:1"], lambda u, m: m < 1000),
]:
    seen = None
    for p in ok:
        if p["t1"] < when:
            continue
        u, m = gpus(p)
        if len(m) > g and m[g] is not None and u[g] is not None and cond(u[g], m[g]):
            seen = p["t1"] - when
            break
    print(f"  {name}: {'never' if seen is None else f'{seen:.1f} s'}")

print("\nDevice identity: during each load, does the loaded panel entry match the loaded GPU?")
for name, a, b, g in PHASES:
    if g is None:
        continue
    sel = [p for p in ok if a + SETTLE <= (p["t0"] + p["t1"]) / 2 <= b]
    match = 0
    for p in sel:
        u, m = gpus(p)
        if len(m) >= 2 and m[g] is not None and m[1 - g] is not None and m[g] > m[1 - g]:
            match += 1
    print(f"  {name}: panel entry {g} holds more memory in {match}/{len(sel)} reads")

other = {}
if ok:
    last = ok[-1]["r"]
    print("\nLast panel accelerator label:", last.get("accelerator"))
    print("Labels seen:", sorted({s["label"] for p in ok for s in p["r"]["sections"]}))
    print("Limits seen:", sorted({f"{s['label']}={s.get('limit')}" for p in ok for s in p["r"]["sections"] if s.get("limit")}))
