#!/usr/bin/env python3
"""Routing test: which skills does a fresh model load for each prompt, per design?

Each repetition is a fresh headless call with only the skill list and the prompts, in a new random
order. Scoring is done by score_routing.py against the labels in raw/routing-spec.json, which were
written by Codex and frozen before any run.

  routing.py <model> <reps> <out.jsonl>
"""
import json
import random
import subprocess
import sys
from pathlib import Path

E = Path(__file__).resolve().parent.parent
spec = json.loads((E / "raw/routing-spec.json").read_text())
model, reps, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])

OTHERS = {
    "kaggle-cli": "Use the local Kaggle CLI skill for command guidance, workflows, and troubleshooting across competitions, datasets, kernels/notebooks, models, model variations and versions, inbox file uploads, forums/discussions, benchmarks, configuration, OAuth/API-token authentication, and accelerator quota. Activate this skill when the user asks about kaggle CLI commands, examples, flags, metadata files, download/upload flows, submissions, benchmark tasks, or Kaggle CLI behavior.",
    "colab-operator": "Operate Google Colab environments via the `colab` CLI. Use when asked to create or manage GPU/TPU sessions, run Python/shell on a remote Colab VM, sync files, automate environment setup (packages, auth, Drive), or export session history.",
    "pdf": "Use when working with PDF files, such as reading, creating, merging or filling PDFs.",
}


def build(design, order, rng):
    skills = {**spec["designs"][design], **OTHERS}
    names = list(skills)
    rng.shuffle(names)
    listing = "\n".join(f"- {n}: {skills[n]}" for n in names)
    prompts = "\n".join(f"{p['id']}: {p['text']}" for p in order)
    return f"""You are a coding agent. These skills are installed. Each is a set of instructions you can load before starting work. You see only these names and descriptions.

{listing}

For each user request below, considered on its own, decide which skills you would load before starting. Load a skill only if it is relevant to that request. You may load several, or none.

Requests:
{prompts}

Reply with only a JSON object mapping each request id to the list of skill names you would load. No other text."""


with out.open("a") as f:
    for rep in range(reps):
        for design in spec["designs"]:
            rng = random.Random(f"{model}-{design}-{rep}")
            order = list(spec["prompts"])
            rng.shuffle(order)
            r = subprocess.run(
                ["claude", "-p", "--model", model, "--output-format", "json", "--strict-mcp-config", "--disallowedTools", "*"],
                input=build(design, order, rng), capture_output=True, text=True, timeout=240)
            answer = None
            try:
                body = json.loads(r.stdout)["result"]
                answer = json.loads(body[body.index("{"): body.rindex("}") + 1])
            except Exception as e:
                answer = {"__error__": f"{e}: {r.stdout[:200]} {r.stderr[:200]}"}
            f.write(json.dumps({"model": model, "rep": rep, "design": design, "answer": answer}) + "\n")
            f.flush()
            print(model, rep, design, "ok" if "__error__" not in answer else answer["__error__"][:120], flush=True)
