#!/usr/bin/env python3
"""Score routing runs against the frozen labels.

"needs" uses notebook/accelerator content labels. How those map to skills depends on the design:
in A and A2 both are in kaggle-notebooks; in C they are in two skills. A prompt is correct when
every needed skill was loaded and nothing irrelevant was. F1 is computed over skills.
"""
import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

E = Path(__file__).resolve().parent.parent
spec = json.loads((E / "raw/routing-spec.json").read_text())
paths = sys.argv[1:] or [str(E / "raw/routing-runs.jsonl")]
runs = [json.loads(l) for p in paths for l in Path(p).read_text().splitlines() if l.strip()]


def expected(needs, design):
    m = {"notebook": "kaggle-notebooks", "accelerator": "kaggle-accelerators" if design == "C" else "kaggle-notebooks"}
    return {m.get(n, n) for n in needs}


# Words an agent must load: the skill bodies. Filled in from the measured files when given.
stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "exact": 0, "n": 0})
by_group = defaultdict(lambda: {"exact": 0, "n": 0})
misses = defaultdict(int)
errors = 0
for run in runs:
    if "__error__" in run["answer"]:
        errors += 1
        continue
    for p in spec["prompts"]:
        got = set(run["answer"].get(p["id"], []))
        want = expected(p["needs"], run["design"])
        key = (run["model"], run["design"])
        s = stats[key]
        s["tp"] += len(got & want)
        s["fp"] += len(got - want)
        s["fn"] += len(want - got)
        s["n"] += 1
        ok = got == want
        s["exact"] += ok
        by_group[(run["model"], run["design"], p["group"])]["exact"] += ok
        by_group[(run["model"], run["design"], p["group"])]["n"] += 1
        if not ok:
            misses[(run["design"], p["id"], p["group"], ",".join(sorted(want)) or "(none)", ",".join(sorted(got)) or "(none)")] += 1

print(f"runs {len(runs)}, failed calls {errors}\n")
print(f"{'model':<26}{'design':<8}{'precision':>10}{'recall':>8}{'F1':>7}{'exact':>8}{'n':>6}")
for (model, design), s in sorted(stats.items()):
    p = s["tp"] / max(1, s["tp"] + s["fp"])
    r = s["tp"] / max(1, s["tp"] + s["fn"])
    f = 2 * p * r / max(1e-9, p + r)
    print(f"{model:<26}{design:<8}{p:>10.3f}{r:>8.3f}{f:>7.3f}{s['exact'] / s['n']:>8.3f}{s['n']:>6}")

print("\nExact-match rate by group:")
groups = ["accel_monitor", "notebook", "mixed", "elsewhere"]
print(f"{'model':<26}{'design':<8}" + "".join(f"{g:>15}" for g in groups))
for (model, design) in sorted(stats):
    row = [by_group[(model, design, g)] for g in groups]
    print(f"{model:<26}{design:<8}" + "".join(f"{r['exact'] / max(1, r['n']):>15.2f}" for r in row))

print("\nMost common misses (count, design, prompt, wanted, got):")
for k, v in sorted(misses.items(), key=lambda kv: -kv[1])[:24]:
    print(f"  {v:>3}  {k[0]:<4}{k[1]:<16}{k[2]:<15} want {k[3]:<38} got {k[4]}")
