#!/usr/bin/env python3
"""Score the panel's CPU, RAM and disk readings against psutil and shutil, with PLAN.md tolerances."""
import json
import re
import statistics as st
from pathlib import Path

raw = Path(__file__).resolve().parent.parent / "raw"
truth = [json.loads(l) for l in (raw / "cpu-truth.jsonl").read_text().splitlines() if l.strip()]
panel = [json.loads(l) for l in (raw / "cpu-panel.jsonl").read_text().splitlines() if l.strip()]
marks = {}
for line in (raw / "cpu-marks.txt").read_text().splitlines():
    if line.startswith("MARK"):
        _, name, t = line.split()
        marks[name] = float(t)

UNITS = {"bytes": 1 / 2**20, "b": 1 / 2**20, "kib": 1 / 1024, "mib": 1, "gib": 1024, "tib": 1024**2}


def mib(text):
    m = re.fullmatch(r"([\d.]+)\s*([A-Za-z]+)", (text or "").strip())
    return float(m.group(1)) * UNITS[m.group(2).lower()] if m else None


def val(p, label):
    for s in p["r"]["sections"]:
        if s["label"] == label:
            return s["value"]
    return None


def nearest(t):
    return min(truth, key=lambda r: abs(r["t"] - t))


ok = [p for p in panel if p["ok"]]
lat = [p["t1"] - p["t0"] for p in panel]
print(f"calls {len(panel)}, ok {len(ok)} ({100 * len(ok) / len(panel):.0f}%); latency median {st.median(lat):.1f} s, within 10 s {100 * sum(x <= 10 for x in lat) / len(lat):.0f}%")
print("ncpu", truth[0]["ncpu"], "ram total MiB", round(truth[0]["ram_total_mib"]), "disk / total MiB", round(truth[0]["disk_root_total_mib"]), "working total MiB", round(truth[0]["disk_work_total_mib"]))
print("panel limits", sorted({f"{s['label']}={s.get('limit')}" for p in ok for s in p["r"]["sections"] if s.get("limit")}))

print("\nM4 CPU, panel vs psutil, during the burn after 20 s settle:")
a, b = marks["cpu_start"] + 20, marks["cpu_end"]
rows = []
for p in ok:
    mid = (p["t0"] + p["t1"]) / 2
    if a <= mid <= b:
        v = float(val(p, "CPU").rstrip("%"))
        rows.append((v, nearest(mid)["cpu"]))
if rows:
    e = sorted(abs(x - y) for x, y in rows)
    print(f"  n={len(rows)} panel median {st.median(x for x, _ in rows):.1f} truth median {st.median(y for _, y in rows):.1f} median err {st.median(e):.1f} (need <=10)")
    print("  raw pairs", [(round(x), round(y)) for x, y in rows][:12])
idle = [(float(val(p, "CPU").rstrip("%")), nearest((p["t0"] + p["t1"]) / 2)["cpu"]) for p in ok if marks["idle_0"] + 5 <= (p["t0"] + p["t1"]) / 2 <= marks["cpu_start"]]
print("  idle pairs", [(round(x), round(y)) for x, y in idle][:6])


def rise(label, key, start, end, base_start, base_end):
    base = [mib(val(p, label)) for p in ok if base_start <= (p["t0"] + p["t1"]) / 2 <= base_end]
    held = [mib(val(p, label)) for p in ok if start <= (p["t0"] + p["t1"]) / 2 <= end]
    tb = [r[key] for r in truth if base_start <= r["t"] <= base_end]
    th = [r[key] for r in truth if start <= r["t"] <= end]
    if not base or not held:
        return None
    return {"panel_base": round(st.median(base)), "panel_held": round(st.median(held)), "panel_rise": round(st.median(held) - st.median(base)), "truth_rise": round(st.median(th) - st.median(tb)), "n": len(held)}


print("\nM5 RAM, allocate 8 GiB (8192 MiB):")
r = rise("RAM", "ram_used_mib", marks["ram_held"] + 20, marks["ram_end"], marks["cpu_end"] + 15, marks["ram_start"])
print(" ", r)
if r:
    print(f"  panel rise error {abs(r['panel_rise'] - r['truth_rise'])} MiB; need <= max(128, 10% of 8192) = 819")

print("\nM6 disk, 5 GiB in /kaggle/working, then 5 GiB in /tmp:")
r = rise("Disk", "disk_work_used_mib", marks["disk_work_written"] + 15, marks["disk_work_end"], marks["ram_end"] + 10, marks["disk_work_start"])
print("  /kaggle/working vs working fs:", r)
r2 = rise("Disk", "disk_root_used_mib", marks["disk_tmp_written"] + 15, marks["disk_tmp_end"], marks["disk_work_end"] + 10, marks["disk_tmp_start"])
print("  /tmp vs root fs:", r2)
r3 = rise("Disk", "disk_root_used_mib", marks["disk_work_written"] + 15, marks["disk_work_end"], marks["ram_end"] + 10, marks["disk_work_start"])
print("  /kaggle/working write vs root fs:", r3)
print("  need rise error <= max(32, 5% of 5120) = 256 MiB")

print("\nM7 freshness:")
for name, when, label, cond in [
    ("cpu burn seen", marks["cpu_start"], "CPU", lambda v: float(v.rstrip("%")) > 50),
    ("cpu release seen", marks["cpu_end"], "CPU", lambda v: float(v.rstrip("%")) < 30),
    ("ram held seen", marks["ram_held"], "RAM", lambda v: mib(v) > 7000),
    ("ram release seen", marks["ram_end"], "RAM", lambda v: mib(v) < 4000),
]:
    seen = next((p["t1"] - when for p in ok if p["t1"] >= when and cond(val(p, label))), None)
    print(f"  {name}: {'never' if seen is None else f'{seen:.1f} s'} (need <=20)")
