# Evaluation plan: accelerators and monitoring

Written 2026-11-04, before any test below was run and before reading the independent plan from Codex.
Criteria changed after this point must be listed under "Changes to this plan", with the reason.

## Questions

1. Do the accelerator and monitoring features work, and do they report true values?
2. In which use cases does the skill succeed or fail?
3. For each use case, is it better than the official `kaggle` CLI, or than no skill at all?
4. Should this stay one skill, gain reference files, or split?
5. What should change? Only measured problems count.

## Rules against bias

- Accuracy is scored by script against sources the skill doesn't control: `nvidia-smi`, `psutil` and `/proc` inside the session, and the official CLI.
- Failures stay in the record, including ones later fixed. A fix gets a re-test next to the original result.
- Agent tests use fresh agents with no hints, on tasks where the skill may lose.
- Codex writes its own test plan independently, and later re-checks the raw data.
- Anything not measured is reported as not measured.

## Budget and stopping rule

At most 2 GPU hours and 1 TPU hour. Tests that can run on CPU must run on CPU. Stop when every test has a recorded result (including "could not test, because..."), the split question has been decided by its rule, and Codex has reviewed the final version.

## Tests and pass criteria

### Monitoring accuracy

Ground truth is a detached logger in the session, sampled every 2 s and matched to each panel read by timestamp.

| ID | Case | Pass criterion |
|---|---|---|
| M1 | T4, sustained load on `cuda:0`, panel GPU memory vs `nvidia-smi` | median absolute error at most 10% of the true value, or 300 MiB if larger |
| M2 | Same run, panel GPU utilisation vs `nvidia-smi` | median absolute error at most 15 points after load has settled |
| M3 | Load only `cuda:1` | panel shows load on one GPU and not the other, so the two are distinguishable |
| M4 | CPU session, 4-process burn, panel CPU vs `psutil` | median absolute error at most 15 points, and the scale is documented correctly |
| M5 | Allocate 8 GB of RAM, panel RAM vs `psutil` | rise within 15% of the true rise |
| M6 | Write 5 GB to `/kaggle/working`, and 5 GB to `/tmp`, panel disk vs `du` | states which paths the panel counts; rise within 15% for those paths |
| M7 | Panel freshness | value changes within 30 s of a load step |
| M8 | Reads during a foreground run | at least 95% of `resources` calls succeed, and the run's output isn't disturbed |

### Quota

| ID | Case | Pass criterion |
|---|---|---|
| Q1 | T4 session left idle for a fixed time, with `kaggle quota` polled | rise matches wall clock within 0.02 h, which tests the claim that idle sessions spend quota |
| Q2 | Time from a session starting to quota rising | measured; `quota` must not report a stale value for more than 5 min |
| Q3 | CPU session | GPU and TPU used do not rise at all |

### Session lifetime

| ID | Case | Pass criterion |
|---|---|---|
| S1 | Idle CPU session, tab open | measured time to shutdown; the docs say 20 min |
| S2 | Idle CPU session, tab closed | alive or dead at a set time |
| S3 | Detached job with no cell activity, tab open | job finishes 40 min of work; if it is killed, the skill's long-job advice is wrong |
| S4 | Detached job, tab closed | same |
| S5 | Foreground cell for 25 min, polled with `wait --timeout` | finishes, with no false done or false failure |
| S6 | Detached job on T4 past 20 min of no cell activity | job finishes, confirming S3 on GPU |

### Accelerators

| ID | Case | Pass criterion |
|---|---|---|
| A1 | T4 cold start, 3 runs | all 3 reach a usable kernel; record the times |
| A2 | Real single-GPU and DataParallel training | both GPUs show load in `nvidia-smi` for DataParallel; job completes |
| A3 | TPU v5e-8 session, JAX | boots or reports a clear wait; `jax.devices()` shows 8; `resources` returns real values and doesn't error |
| A4 | GPU out of memory | exit 1, the error names the out-of-memory cause, the kernel stays usable |
| A5 | System RAM out of memory that kills the kernel, on CPU | non-zero exit within 2 min, with no false success and no hang |
| A6 | Disk full in `/kaggle/working`, on CPU | job sees the error, the skill reports it, and the session stays usable |
| A7 | Two T4 sessions at once | measured limit; if refused, the skill shows the reason rather than a generic timeout |
| A8 | Official CLI: every documented accelerator ID, one short run each | record which ran, on what real hardware (`nvidia-smi`), and any silent downgrade |
| A9 | Committed GPU version | `kaggle kernels status` and `logs -f` track it; compare with what the skill can see |

### Other ways to monitor

| ID | Case | Pass criterion |
|---|---|---|
| I1 | A second kernel in the same session, for commands during a busy cell | either works and returns `nvidia-smi` during a busy cell, or the refusal is recorded |
| I2 | Where the panel's data comes from | identify whether a network response carries it, so it could be read without clicks |

### Fresh agents, skill against no skill

Same model and tasks in both arms, one run each, plus the skill arm again after changes. Scored against ground truth from the workload's own log.

| ID | Task | Correct when |
|---|---|---|
| U1 | Train a small model on T4 and report peak GPU memory, and whether both GPUs were used | within 20% of the logged peak, and the right answer about both GPUs |
| U2 | A provided script looks like GPU training but stays on CPU; "is this actually using the GPU?" | says it isn't, with evidence |
| U3 | Run JAX on TPU and report the devices and how much quota was used | device count right, quota within 0.05 h |
| U4 | An unattended job that must finish without a browser | picks a committed run or the official CLI, and the job completes |

### Skill structure

**Routing test.** About 20 prompts: accelerator and monitoring requests, general notebook requests, and prompts that belong elsewhere (Colab, a local GPU, batch runs through the official CLI, what a TPU is). Each design is shown only as a list of skill names and descriptions, always including Kaggle's own `kaggle-cli`. At least 5 repetitions per design with Claude, and one set with Codex. Scored by script against labels written in advance.

| Design | Layout |
|---|---|
| A | One skill, as now |
| B | One skill, with accelerator and monitoring detail moved to a reference file |
| C | Two skills: notebooks, and accelerators and monitoring |

**Decision rule.** Split only if all three hold:
1. C's routing score (F1) beats the best one-skill design by at least 0.10.
2. In the fresh-agent tasks, fewer than 30% need both halves.
3. C loads at least 20% fewer words per task than B.

Otherwise it stays one skill. Between A and B, choose B only if it loads at least 20% fewer words per task with no fall in fresh-agent task success.

## Changes to this plan

Made after an independent review, before any test was run:

- **S3 runs as three cases.** Kaggle's docs say a session ends after 20 minutes with no code "modified or executed". S3a: detached job, no commands for the whole run. S3b: detached job, `sh tail` every 5 min. S5 is the foreground control. If S3a dies and S3b lives, polling is required. If both die, the long-job advice is wrong.
- **A8 is narrowed.** Run T4 (control), L4 and L4X1 (plausibly available, and not in the UI), and H100 (one restricted sample, to see refusal or silent downgrade). The other IDs are documented as restricted, and each attempt could spend quota.
- **U1 and U4 get a third arm:** Kaggle's own `kaggle-cli` skill. U4 is designed so that it can win.
- **Routing descriptions come from Codex,** not the skill's author, and are frozen before any routing run. A routed design counts as correct when the needed content gets loaded, and words loaded are charged as its cost.
- **A3 reads the session limit on TPU.** The docs say 9 hours for TPU; `ui-map.md` says 12 hours with no exception.
- **Quota is logged** to `raw/quota-ledger.csv` before and after every GPU or TPU test, with a hard stop at 2.0 GPU hours.
- **Known weakness:** condition 2 of the split rule rests on only four agent tasks. Treat it as weak evidence.
- **Commit:** nothing is committed, because the owner has not asked for that. The plan's SHA-256 is recorded at the time of this change instead.

Added 2026-11-04 03:52 UTC, after reading Codex's independent plan. Only the session-cap and start-time probe had run by then, and it doesn't bear on these criteria:

- **Stricter tolerances win.** Where Codex's limit is tighter, it replaces mine: GPU utilisation median error at most 10 points and 95th percentile at most 20; GPU memory error at most max(128 MiB, 5%); RAM rise at most max(128 MiB, 10%); disk rise at most max(32 MiB, 5%); CPU median error at most 10 points; metric change detected within 20 s; 95% of monitoring calls within 10 s. Discard the first 20 s after each load change, and need at least 10 paired samples.
- **Results use three outcomes:** pass, fail, or not exercised. Refusals and unmeasurable cases are not passes.
- **Added from Codex** (C-numbers are its test IDs):
  - C01: load GPU 0 and then GPU 1, checking that readings stay matched to the right device (extends M1-M3).
  - C03: selected accelerator against actual hardware, for each state; a same-selection call must not restart anything.
  - C05: DataParallel weights match single-GPU within relative L2 of 0.001, with unequal memory on the two GPUs.
  - C06: parser fixtures, with zero silently incomplete reports; every broken monitoring anchor is caught by `selfcheck` or stated as outside its coverage.
  - C09: fit quota to one hour per session-hour against one per GPU-hour; check for burn after stopping.
  - C11: committed run in the UI, official `kernels push`, and a raw agent, each with a unique run ID.
  - C13: 20 alternating operations across two notebooks, with zero wrong-notebook actions.
  - C14: no live values from an off session; no stale readings passed off as current.
  - C15: busy `sh` and `exec` refuse within 10 s with zero side effects; `wait --timeout 5` returns 124 within 12 s; interrupt stops progress within 15 s; `SIGKILL` of the kernel as a crash control.
  - C16: monitoring usefulness on a replay: can an agent warn on GPU use collapsing, RAM or disk above 90%, and low quota?
- **C17 and C18 are scoped to the budget.** The head-to-head uses the U tasks with three arms. C18's routing test uses the design above, with Codex's 12-prompt split folded into the prompt set.
- **New owner request: compare with `google-colab-cli`** at the source level (repo cloned at commit 463fd36, v0.7.4 installed). A feature in that tool counts as a gap only if it is worth having on Kaggle, and each gap is tested where possible. It is not signed in on this machine, so any claim about its live behaviour must be labelled as coming from its source and docs.
- **U5 added 2026-11-04 04:58 UTC, from Codex's C17 "busy-run monitoring" family,** before any U5 result, after U1 showed that a no-skill agent can route batch-friendly tasks to the official CLI. U1 and U4 can be done without a live session, so they don't test what this skill is for. Task: a training cell is already running in a notebook the agent didn't start. Without interrupting it, report current GPU use and memory per GPU, and whether it is progressing. Correct when: memory is within max(128 MiB, 5%) and utilisation within 10 points of the independent logger at the time of the agent's reading, the right GPU is named, and the run was not interrupted. Same arms: no skill, current skill, new skill.
- **Amendments after testing began,** each recorded with its reason:
  - C15: a busy `sh` now runs through the sidecar by design, so only `exec` is still expected to refuse. The other C15 parts are unchanged.
  - A9: run on CPU rather than GPU, so as not to disturb the isolated quota test (Q1). A9's GPU wording isn't met.
  - U5: all arms are scored against the written criterion above. Quota was not part of it, so a missing quota answer doesn't fail an arm.
  - S4 was extended after the Codex audit: S4e (REST reads only) and S4f (nothing at all), each with a 60 min job, because the first round's job ended near the cancel time and couldn't prove loss.
  - The long "past the prompt" tests were restarted as L6 and L7 at 06:12 UTC, because the first set's tabs vanished at 05:28. The first set is reported only as accidental lost-tab cases.
- **U6 added 2026-11-04 06:25 UTC, before any U6 result,** to check the final skill's changed advice with a reader who didn't write it. A job runs in a session whose tab was closed a few minutes earlier, with its log at `/kaggle/working/u6.log`. The task: (a) is it still running, and what is its last progress line, (b) if the job needs 3 more hours, what must I do so that it finishes, (c) leave it running. Correct when: (a) the line is within 60 s of an independent read of the log at the agent's reading time; (b) it says the session will be cancelled well before 3 hours if left with no tab (any figure from 20 to 60 minutes counts, or no figure), and gives a workable action, meaning keep a tab open and handle the prompt or poll, or use a committed run, noting that a committed run restarts the job; (c) the job is still running afterwards. Arms: final skill and no skill, one run each, Claude Sonnet.
- **Clock tests added 2026-11-04 06:40 UTC, from Codex's second audit, before any result,** because the first lost-tab cases can't separate the possible explanations. A job starts at T. Case h: the tab stays open until T+15, then closes, with no commands or REST calls at any point. Cancelled near T+41 falsifies a clock running from closing; cancelled near T+56 supports it. Case g: the tab closes at T+1, and one command goes through the session's server at T+20. Cancelled near T+41 means a command doesn't reset the clock; alive past T+45 means it does. Status comes only from Active Events in a separate tab. Times are detection times, polled every 60 s.
- **L8 added 2026-11-04 06:55 UTC,** after L6's result, before any L8 result. Job, tab open, no commands until the prompt appears, then one `job status --url`. Survives if it is still running well after L6's cut-off, meaning past T+45 at least.
- **L9 added 2026-11-04 06:57 UTC,** after L6's result, before any L9 result. A foreground cell, tab open, no commands, no answer to any prompt. Still printing past T+45 means a busy cell is treated differently from a background job. Cancelled near T+41 means it isn't.
- **Added from the Colab source:**
  - I3: Jupyter Contents API on Kaggle for file transfer.
  - I4: is a dead or restarting kernel detected during `wait` (A5 is the live case)?
  - I5: can the skill list sessions whose tabs are closed, given that Kaggle has a session cap?

