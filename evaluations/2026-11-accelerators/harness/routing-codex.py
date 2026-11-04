#!/usr/bin/env python3
"""The same routing test as routing.py, through Codex: one repetition per design."""
import json, random, re, subprocess, sys
from pathlib import Path
sys.argv = ["x", "x", "0", "/dev/null"]
src = (Path(__file__).parent / "routing.py").read_text().split("with out.open")[0]
exec(src)
out = E / "raw/routing-runs-codex.jsonl"
out.write_text("")
for design in spec["designs"]:
    rng = random.Random(f"codex-{design}")
    order = list(spec["prompts"]); rng.shuffle(order)
    r = subprocess.run(["codex", "exec", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="low"', "--sandbox", "read-only", "--skip-git-repo-check", build(design, order, rng)], capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=280)
    try:
        t = r.stdout; answer = json.loads(t[t.index("{"): t.rindex("}") + 1])
    except Exception as e:
        answer = {"__error__": f"{e} {t[:150]}"}
    with out.open("a") as f:
        f.write(json.dumps({"model": "codex-gpt-6.1-sol", "rep": 0, "design": design, "answer": answer}) + "\n")
    print(design, "ok" if "__error__" not in answer else answer["__error__"][:150], flush=True)
