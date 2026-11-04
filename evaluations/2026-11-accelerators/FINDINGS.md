# Findings: accelerators and monitoring

Evaluation of `kaggle-notebooks`, 2026-11-04. The plan and its pass criteria are in `PLAN.md`, written before testing. Raw data is in `raw/`, and the scripts are in `harness/`. The comparison with Colab's CLI is in `COLAB-COMPARISON.md`.

For publishing, `raw/sessions-panel.png` had the account's profile photos blacked out. Nothing else in `raw/` was changed for publishing, and credentials were scrubbed when each record was written. Paths in the logs and scripts are from the machine used. The test notebooks have since been deleted from Kaggle.

**Read these numbers with care.** Most tests ran once or a few times, on one account, on one day. They record what happened, not a rate. Kaggle can change any of this without notice.

## Verdict

1. **The monitoring numbers are accurate, with two traps.** GPU, RAM and CPU readings match independent measurements. The disk reading leaves out `/kaggle/working`, and CPU is summed across cores.
2. **The skill's measurable help is narrow, and rests on few runs.** On four of the five tasks scored in all arms, every arm met the written criterion, including agents with no skill. On batch-friendly tasks the official CLI is enough. The one task that separated them was U6, a job in an unattended session: the agent with the final skill gave advice that works, and the agent with none gave advice that loses the job. That is one run each, and it tests knowledge this evaluation wrote into the skill. Beyond that, the skill adds capability on a live session: commands during a busy cell, history and warnings, safer failures. These results can't show that it costs less in general.
3. **Keep one skill.** The written split rule fails. The routing test scored at its ceiling, so it shows no benefit from splitting, not that one skill is proven better.
4. **The evaluation found real errors in the skill,** including long-job advice that would have lost work. These are fixed or documented below, with what was and wasn't re-tested.
5. **The biggest new fact is about session life.** **An open tab doesn't protect a background job.** With no commands, a session running a job was cancelled about 40 minutes in, with its tab open or closed, and the job and its files were lost. The skill's earlier advice, "keep the tab open", could therefore lose long jobs. Commands through the kernel kept sessions alive in every run that used them.

## Status of every planned test

Outcomes are pass, fail, or not exercised, as `PLAN.md` requires.

| ID | Test | Outcome | Evidence |
|---|---|---|---|
| M1-M3, C01 | GPU memory, utilisation, right device | Pass | 21 of 21 reads on the right GPU; `raw/gpu-*` |
| M4 | CPU reading | **Fail as a raw number**; pass once divided by core count, which is now documented | 398 vs 100; normalised error 0.4 points, `raw/cpu2-*` |
| M5 | RAM | Pass | 36 MiB error on an 8 GiB rise |
| M6 | Disk | **Fail for `/kaggle/working`**, pass for `/tmp`, now documented | 0 of 5,120 MiB, and 5,120 of 5,120 |
| M7 | Freshness | Pass | Table below |
| M8 | Reads during a busy cell | Pass | 243 of 243 CPU, 35 of 35 GPU |
| Q1, C09 | Idle GPU session spends quota | Pass | 0.37 h over 0.377 h, GPUs idle |
| Q2 | Quota lag | Pass | First rise seen within 61 s of the start, then steps of 0.01 h. Longest gap between log entries 39 s |
| Q3, C09 | CPU-only time, and after stopping | Pass | GPU stayed at 1.76 h and TPU at 0.00 h for 35.5 min after the stop (69 log entries), with up to 5 CPU sessions live, `raw/quota-30s.csv` |
| S1 | Idle, tab open | Measured, but not clean: see "Session life" | Off at 77.8 min |
| S2 | Idle, tab closed | Measured | Alive at 28.6 min, gone by 41.7 |
| S3 | Job, tab open, 40 min | Pass as written, **but too short to catch the real limit**: L6 shows that | 80 of 80 beats in both arms, longest gap 30 s. Printed in the session transcript at the time; what could be recovered is in `raw/transcript-excerpts.txt` |
| S4 | Job, tab closed | **Fail: the job doesn't survive.** A 60 min job's session was cancelled about 40 min in, and a restart found no process, no log and an empty `/kaggle/working` | `raw/closed-tab2.csv` |
| S5 | Foreground 25 min, polled | Pass | 15 timeouts, then a correct done at 1,512 s, `raw/s5-polls.csv` |
| S6 | Detached job on T4 past 20 min | Pass | 1,320 s job, exit 0, no prompt, no cell activity, `raw/gpu2.txt` |
| A1 | T4 cold start | Pass | 22, 19, 24 s, each with 2 Tesla T4, `raw/start-times.csv` |
| A2, C05 | Single GPU and DataParallel | Pass | Weights matched to relative L2 of 1.5e-7, both GPUs loaded |
| A3, U3 | TPU, JAX | **Not exercised** | Still queued at about 08:16 UTC, after about 3 h 56 min, when testing ended. Nothing billed. A later request is described under "TPU" |
| A4 | GPU out of memory | Pass | Exit 1 in 13 s, named error, same process |
| A5 | RAM kill | Pass on detection | Kernel died near 29 GiB, restart about 32 s. Reported as exit 1 with `kernelRestarted`. See also "Kernel death" |
| A6 | Disk full | Pass | `OSError` at 20 GiB, exit 1, recovered |
| A7 | Second T4 | Pass after a fix | Was a 64-240 s silent wait; now refused in 4 s, `raw/gpu2.txt` |
| A8 | Official CLI hardware IDs | Recorded | Table below |
| A9, C11 | Committed runs | Pass, **on CPU, not GPU** | See "Committed runs". Changed so as not to disturb the quota test |
| I1 | Second kernel | Pass | Warm reply 558 ms idle, 557 ms busy |
| I2 | Source of panel data | **Not identified** | See "Panel data source" |
| I3-I5 | Contents API, kernel death, closed-tab listing | Pass | `raw/probe-*`, `raw/kill-cli.txt` |
| C03 | Accelerator selection | Pass | Same selection is a no-op; a different one is refused with the job alive |
| C06 | Parser faults | Pass | 40 single-line removals across 2 panels, 0 silently incomplete. `selfcheck` lists what it doesn't check, but not every anchor was broken on purpose |
| C13 | Wrong-notebook safety | Pass | 20 alternating reads, 0 wrong |
| C14 | Off session | Pass | `{"session":"off"}` |
| C15 | Busy refusal, wait, interrupt, kill | Pass, with one amendment | `exec` refused in 6.9 s; `wait --timeout 5` gave 124 in 6.7 s; interrupt to idle 1.6 s; kill below. Busy `sh` now works by design, so it no longer refuses |
| C16 | Warnings on a replay | Pass | Below. Low quota checked only by a unit test |
| U1, U2, U4, U5 | Fresh agents | Below | `raw/agent-runs.md` |
| Routing | Split or not | Below | `raw/routing-*` |

## Monitoring accuracy

Compared with `nvidia-smi` and `psutil` sampled by a separate logger at 1 Hz. Tolerances are from `PLAN.md`, using the stricter of the author's and Codex's. The first 20 s after each change is discarded.

| Test | Needed | Measured | Result |
|---|---|---|---|
| GPU utilisation, load phases (n=11 and 10) | median error at most 10 points, p95 at most 20 | 0 median, p95 at most 1 | Pass |
| GPU memory, load phases (n=11 and 10) | at most max(128 MiB, 5%) | at most 12 MiB | Pass |
| GPU idle phases | Not scored: only 1 settled sample each | | Not exercised |
| Unequal memory | matches, per GPU | Panel 9,318 / 3,174 MiB, `nvidia-smi` 9,339 / 3,195 MiB. Also 5.3 / 3.3 GiB against 5,403 / 3,353 MiB | Pass |
| RAM rise on 8 GiB (baseline n=15, hold n=19) | at most 819 MiB | 36 MiB | Pass |
| RAM limit | matches truth | `Max 30GiB` equals `memory.max`; `psutil` overstates at 31.3 GiB | Pass |
| CPU, all cores busy (n=18) | median error at most 10 points | Raw 398 vs 100. Divided by 4 cores, error 0.4 | **Pass only once the scale is known** |
| CPU, idle (n=15) | same | Error 0.5 after dividing | Pass |
| Disk, `/tmp` 5 GiB (baseline n=16, hold n=17) | at most 256 MiB | 0 | Pass |
| Disk, `/kaggle/working` 5 GiB (n=16, n=19) | at most 256 MiB | **Rise of 0 against a true 5,120 MiB** | **Fail, and a trap: it isn't counted** |

The panel's disk figure was only checked on those two paths. It has 0.1 GiB resolution, so memory can read up to about 51 MiB off.

**Freshness**, from each change to the first read showing it:

| Change | Seen after | Read interval |
|---|---|---|
| GPU memory | 5.6-11.6 s | 7-10 s |
| GPU utilisation | 11.3-15.6 s | 7-10 s |
| CPU load, release | 3.3 s, 6.6 s | 2.6 s |
| RAM held, released | 3.3 s, 2.6 s | 2.6 s |
| Disk in `/tmp` | 4.2 s | 2.6 s |

**Time per `resources` call:** 7.0 s median before a fix (`raw/gpu-panel.jsonl`). After it, 1.07 s median, 1.29 s p95, 2.90 s max over 243 CPU reads (`raw/cpu2-panel.jsonl`), and about 1.15 s over 14 T4 reads (`raw/gpu2.txt`).

**C16, warnings on a replay** (`raw/cpu2.txt`):

| Replayed case | Warning |
|---|---|
| Normal, both GPUs busy | None |
| One of two GPUs unused | `Only GPU 0 of 2 was used.` |
| No GPU, CPU busy | `No GPU was used, while the CPU was busy...` |
| GPU use collapses | `GPU use has stopped...` |
| RAM at 95% | `RAM reached 90% of its limit...` |
| `/kaggle/working` at 95% | `/kaggle/working is above 90% full.` |
| GPU memory at 96% | `GPU 0 memory reached 95% of its limit.` |

Replays are constructed data. They show the warnings fire on those inputs, not how often they would fire on real runs.

## Accelerators

### Official CLI hardware IDs

Each ran a real job that printed its own hardware.

| Requested | Push | Final status | Actually ran on |
|---|---|---|---|
| `NvidiaTeslaT4` | OK | COMPLETE | 2 Tesla T4 |
| `NvidiaL4` | OK | COMPLETE | **2 Tesla T4** |
| `NvidiaL4X1` | OK | COMPLETE | **2 Tesla T4** |
| `NvidiaH100` | OK | COMPLETE | **2 Tesla T4** |

There was no error and no warning at push. Kaggle's docs say some IDs are restricted, so this is expected to vary by account. Always check real hardware.

### Quota

| Measure | Result |
|---|---|
| T4 x2, GPUs idle, job on CPU | +0.37 h over 0.377 h (`raw/quota-ledger.csv`). A per-GPU rate would have given about 0.75 h |
| Earlier interval, mixed load | +0.24 h over 0.246 h |
| Queued TPU | 0.00 h for the whole queue |
| After stopping, with CPU sessions running | Flat at 1.76 h for 35.5 min |

**Caveats.** Kaggle's figure is not strictly increasing: it fell from 1.26 h at 05:10:46 to 1.13 h at 05:11:18, with no action of ours that explains it. It also rose at about twice the rate around 05:13, while more than one GPU run was active. Treat it as a good estimate, not a meter.

### TPU

Requested at 04:20:39 UTC. It was still `Queued` at about 08:16 UTC, nearly 4 hours later, when testing ended. Deleting its notebook then cancelled it (`raw/tpu.txt`, `raw/cleanup.txt`). Its tab was among those that vanished at 05:28 and was reopened at 05:29, and I can't rule out that this affected its place in the queue. So this is one wait, not a typical one. Kaggle shows no queue position or estimate. Quota wasn't the cause: 20 h remained, with 0 used.

Stopping a request: a fresh one queued at 08:19 was cancelled by `sessions-stop` in about 10 s (`raw/tpu-stop-test.txt`). One earlier `sessions-stop` on the long-queued request failed with "no live session", though `sessions` listed it as queued. That wasn't reproduced, and the cause is unknown.

A further request was queued at 08:24 UTC at the owner's request, with a watcher set to run the tests below if it starts, then stop the session and delete its notebook, for up to 6 hours (`harness/run-tpu3.mjs`, `raw/tpu3.txt`). This section will be updated if it produces a result. Until then, TPU sessions remain not exercised. The pill read `Starting …` throughout, and only Active Events showed `Queued`. Nothing was billed while queued.

So JAX, PyTorch XLA, the TPU panel format and the 9-hour limit could not be tested. The parser keeps unknown lines in `unrecognised`, and a reading with missing values is refused rather than passed off as complete, but neither has been checked against a real TPU panel.

### Kernel death

| Case | Result through the real CLI |
|---|---|
| Kernel dies while `wait` is watching | Exit 1, `kernelRestarted: true`, kill count from `memory.events` |
| Kernel killed between `run` and `wait` (`raw/kill-cli.txt`) | **Exit 3**, `indeterminate: true`, "either the tab closed or reloaded... or the kernel restarted". Not a false success |
| False-alarm control: `run-cell 0` of 2 cells | Exit 0 |
| False-alarm control: clean Run All | Exit 0 |
| Cell error, GPU out of memory | Exit 1, `kernelRestarted: false` |
| Interrupt | `interrupted: true`, `kernelRestarted: false` |

A first version of this test called the driver function directly, and it returned `done` with no error. I reported that to the owner as a false success, and it was wrong: the exit-code logic is in the CLI layer. The re-test through the CLI is the result above.

## Session life

All on CPU except S6, and with no edits to the notebook.

| Case | Outcome |
|---|---|
| Idle, tab open, prompt unanswered (S1) | Off at 77.8 min. A dialog says "You haven't made changes ... in over 40 minutes", with `Cancel` and `Continue editing` |
| Idle, tab closed (S2) | Alive at 28.6 min, gone by 41.7 |
| Job, tab closed right after start, nothing else (S4b) | Cancelled at **41.0 min** after closing |
| Same, kernel WebSocket held open (S4d) | Cancelled at **40.9 min**, so a socket doesn't help |
| Same, REST and a sidecar command every 5.8 min (S4c) | **Alive at 68.4 min** when stopped by hand. Its job ended at 41.5 min, so this says nothing about the job |
| Job, tab lost 13 min in, REST read every 10 min (L2) | Read OK at 35.1 min after job start. Not in the live list at 43.8 min (`raw/transcript-excerpts.txt`), and listed `cancelled` by about 46 |
| Idle, tab lost 10 min in (L4) | Not in the live list at 40.9 min after start, and listed `cancelled` by about 43 |
| Job, tab lost 8 min in, REST read every 10 min (L3) | Read OK at 40.1 min after job start. `No live session` at 41.1, and listed `cancelled` at 41.5 |
| 60 min job, tab closed, REST read every 5 min (S4e) | REST answered through 35.3 min. First seen cancelled at **40.3 min** |
| 60 min job, tab closed, nothing at all (S4f) | First seen cancelled at **40.6 min**. After a restart: no process, no log, and `/kaggle/working` empty, so **the job and its files were lost** |
| Job 40 min, tab open (S3a, S3b) | 80 of 80 beats, with and without polling |
| Foreground 25 min, polled (S5) | Correct done, no false result |
| Foreground cell in a session up about 2 h, tab reopened at an unknown time (L1) | Still printing at 2h:5m of session uptime, when I interrupted it. No prompt logged from 06:01 on. Not clean: its tab was replaced and I ran commands in it at 06:03, 06:13, 06:16 and 06:38 |
| 100 min job, tab open, no commands, prompt unanswered (L6) | Prompt seen at 38.2 min. **Session off and listed `cancelled` by 40.2 min** after job start, with the job lost |
| 90 min job, tab open, no commands until the prompt, then one `job status` (L8) | Prompt at 38.0 min. One `job status` at 38.1 min cleared it within 5 s. **Still running at 56.2 min**, well past L6's cut-off. Listed `running` at about 71 min, and `cancelled` by 80 min, within about 42 min of that one command |
| Foreground cell, tab open, no commands, prompt unanswered (L9) | **No prompt, still printing at 77.5 min** (`raw/foreground-final.txt`), when I stopped it |
| Job, tab open until T+15, then closed, no commands or REST at all (clock h) | First seen cancelled at **T+40.55**, so 25.5 min after closing. A clock running from closing predicted T+56 |
| Job, tab closed at T+1, one command at T+20, nothing else (clock g) | Alive at T+46. First seen cancelled at **T+61.27**, about 40 min after the command |
| 100 min job, tab closed at 0.8 min, reopened at 10.4 min by `job status`, then polled every 5 min (L7) | **The 100 min job finished with exit 0** and `JOB FINISHED`, past every cut-off seen. All 17 polls exited 0, the last at 87 min, and no prompt was logged |

**What this shows.** All times are when a poll first saw the change, usually at 60 s intervals, not exact moments.
- **An open tab is no guarantee.** L6 had its tab open throughout and lost its job at about 40 minutes.
- **But open-tab results are mixed, and I can't fully explain them.** At 04:29 UTC, S1 was alive about 50 minutes after its start, and S3a about 42 minutes after its job started, both with tabs open and no commands to them (`raw/sessions-at-50min.json`, start times in `raw/transcript-excerpts.txt`). S1 was first seen off about 78 minutes after its start, about two 39-minute cycles, which would fit something answering its first prompt, but no record shows what did. S3a was stopped by hand at 04:33. A person using that Chrome window could explain it, but that's a guess. So the safe advice doesn't depend on the tab.
- **The clock doesn't run from the tab closing.** Clock h closed at T+15 and was cancelled at T+40.55. S4b, S4d, S4e and S4f closed within a minute of starting, and were first seen cancelled at 41.0, 40.9, 40.3 and 40.6 minutes.
- **A background process doesn't count as activity.** L6, S4e, S4f, clock h and clock g all had work left when they were cancelled. The S4b and S4d jobs were 40 minutes long, so they don't show this.
- **REST reads don't count.** S4e read the server every 5 minutes and was cancelled on the same schedule. A held WebSocket (S4d) didn't count either.
- **A kernel command appears to count.** One command at T+20 moved the cancel from about T+41 to T+61.27 (clock g, 1 run). L7 and S4c, with commands every 5-6 minutes, outlived every cut-off seen. L8 survived its prompt after one `job status`. Each of those commands also creates and deletes a sidecar kernel, and L8's also clicked `Continue editing`, so plain code execution isn't isolated as the cause.
- **A busy cell appears to count too.** L9 had no commands and no prompt, and was still printing at 77.5 minutes, where L6's background job had been cancelled. That is one run, and it doesn't separate a busy kernel from periodic output.**
- **Loss is real.** After S4f was cancelled, a restart found no process, no log and an empty `/kaggle/working`.
- L2, L3 and L4 fit this, but their tabs vanished for an unknown reason, so they carry no weight on their own.
- Not measured: how long one command buys beyond clock g, whether answering the prompt without any kernel command is enough, and how any of this varies by account, accelerator or time. Clock h, g and S4 ran on CPU. S6 on T4 ended at 22 minutes, before the cut-off, so the 40-minute cut-off is unmeasured on GPU.
- Kaggle's docs say 20 minutes of idle, which didn't match any case measured here.

**The long-test tabs vanished.** The first run of the "past the prompt" tests was lost. At 05:27:57-05:28:08 UTC, four separate processes all reported their tabs closed. Chrome's main process kept running, and no script or agent transcript shows a close at that time, so the cause is unknown. A person closing a window would fit, but I can't confirm it. The monitors kept logging an empty pill, which I didn't notice until 06:00. L2, L3 and L4 therefore became accidental tests of a lost tab, and are reported only as that. L6 and L7 replace them, and they log tab presence.

### A tab reopened on a busy session

`raw/reopened-tab-live.txt`, one session:
- The pill stays at `Draft Session Starting`, while the kernel keeps running and printing.
- `resources` can't read a panel. It used to fail with a timeout, and now says why and what to use instead.
- `status` said `session: starting`. It now asks the session's server, and reports `running` with a note. A queued TPU still reads `starting`.
- `sh` and `job list` work normally.
- After the cell ended (by an interrupt): `wait` gave exit 3, `indeterminate`, as the page had no record of the run; the pill went back to normal, `status` read `running` with no note, and `resources` worked again (`raw/reopened-tab-end.txt`).

## Committed runs

A 180 s CPU job, each with a unique run ID (`raw/a9.jsonl`).

| | Official `kernels push` | Skill `save-version` |
|---|---|---|
| Time to submit | 2 s | 43.9 s, including `new` and `push` |
| `kernels status` tracks it | Yes: QUEUED, RUNNING, COMPLETE | Yes: RUNNING, COMPLETE |
| `kernels logs -f` | 18 of 18 beats, about 0.2 s behind | 18 of 18 beats, about 0.1 s behind |
| `kernels output`, right run ID | Yes | Yes |
| Live resource view | None | None |

So `kaggle kernels logs -f` is a real live log for batch runs from either route, and the skill now says so. These delays are medians once it was following. One first beat arrived 9.2 s late, because the follow started after the job did. Neither route gives a resource view of a committed run. A9's GPU wording was narrowed to CPU. T4 runs in A8 were tracked by `kernels status` only.

## Panel data source (I2)

Passive watch of one busy CPU tab for 90 s (`raw/i2-network.json`): 16 endpoints, none with a readable response mentioning a metric. The Firestore `Listen` stream bodies were almost empty, 2,972 bytes across 71 responses, possibly because a stream can't be read this way. So the source was **not identified**. I stopped there, because reading the panel takes about 1 s and matches truth.

The same watch found the page calling `kernels.KernelsService/UpdateKernelSessionKeepalive`, twice in 90 s. That may be why an open tab keeps a session alive. It's a private endpoint, and I didn't test calling it.

## Fresh agents

Same model (Claude Sonnet) for all, one run per arm, with no hints about the skill. Tokens and tool calls come from the harness. Each agent's report is in `raw/agent-runs.md`. Answers were scored against truth measured separately.

| Task | Arm | Met the criterion | Tool calls | Tokens | Minutes | Browser scripts |
|---|---|---|---|---|---|---|
| **U1** Peak GPU memory, and both GPUs? Truth: 8,783 MiB on GPU 0, 3 MiB on GPU 1 | Current skill | Yes | 10 | 57.0k | 4.9 | 0 |
| | Official CLI skill | Yes | 12 | 64.1k | 7.5 | 0 |
| | No skill | Yes | 10 | 55.9k | 4.0 | 0 |
| | New skill | Yes | 11 | 57.2k | 6.0 | 0 |
| **U2** Script claims `cuda` but runs on CPU | Current skill | Yes | 12 | 57.3k | 4.9 | 0 |
| | No skill | Yes | 12 | 56.9k | 3.9 | 0 |
| | New skill | Yes | 9 | 56.4k | 8.0 | 0 |
| **U4** Must finish with no browser | Current skill | Yes | 6 | 53.6k | 3.1 | 0 |
| | Official CLI skill | Yes | 5 | 56.6k | 3.3 | 0 |
| | No skill | Yes | 15 | 55.6k | 10.4 | 0 |
| | New skill | Yes | 10 | 56.5k | 4.8 | 0 |
| **U6** Job in a session with its tab closed: is it alive, and what must I do for it to finish in 3 h? | Final skill | Yes | 5 | 55.6k | 1.1 | 0 |
| | No skill | **No, on (b).** Read the job correctly and left it running, but advised only keeping the tab open, with no prompt handling or polling, which L6 shows loses the job | 18 | 70.0k | 2.9 | 6 script runs, and 3 screenshots |
| **U5** Report on a run already in progress. Truth at 05:04:21: GPU 1 at 100%, 3,389 MiB | Current skill | Yes | 6 | 54.0k | 1.4 | 0 |
| | No skill | Yes, but it didn't report quota, which the task didn't require in writing | 7 | 61.3k | 2.0 | 5, and 3 screenshots |
| | New skill | Yes, plus direct `nvidia-smi` | 7 | 56.9k | 1.6 | 0 |

"Current" means the frozen skill at the start of this evaluation (`raw/frozen-v1`).

**What this shows:**
- **U6 is the only task where an arm failed a written criterion, and it's one run per arm.** The criterion was written before L6's result. It tests knowledge that this evaluation put into the skill, so a good note in a README would likely do the same. The final skill's text at that moment still overstated some details, such as the 78 minutes, though its action was workable.
- **No other arm failed a written criterion.** The earlier result, 22 scripts without the skill against 0 with it, came from a baseline that banned the official CLI, and it overstated the skill's value.
- **On U5, the no-skill agent got there by writing browser scripts and taking screenshots,** which is more moving parts on someone's live run. One run can't show that it costs more.
- **No general cost claim is supported.** With one run per arm, these differences can't be separated from noise. U1 and U2 took longer on the new version than on the current one, and U6 less than no skill.
- Token totals barely move because each agent starts with a large fixed context. `SKILL.md` is about 2k of 55k tokens.
- All 4 agents that started an interactive session also stopped it, which is why a Colab-style one-shot `run` wasn't built.

## One skill, or split?

Decision rule from `PLAN.md`: split only if all three hold.

| Condition | Result |
|---|---|
| 1. The split design's routing F1 beats the best one-skill design by at least 0.10 | **Fails.** One skill and split both scored 1.000 on all models, except a Haiku score of 0.990 on rewrite A2 |
| 2. Fewer than 30% of tasks need both halves | Not established. Four agent tasks are too few, as `PLAN.md` warned |
| 3. At least 20% fewer words loaded per task | Not established |

Condition 1 alone settles it. The routing specification was written by Codex and frozen before running (SHA-256 `87244cb9…`): 792 decisions, 791 exact, across 30 Claude runs of 24 prompts each and 3 Codex runs.

**The score is at the ceiling, so the test can't rank these designs.**

**Reference file (design B)?** Its routing was **not tested**. The estimate is arithmetic only: moving the limits and long-job sections out would save about 500 of 1,450 words on the tasks that don't need them, which is about 4 of 16 Kaggle prompts, or about 9% on average. That is under the 20% bar in `PLAN.md`, so **keep one file**. `SKILL.md` is about 2k of 55k tokens per task, so it isn't where the cost is.

## What changed, and how it was checked

"Live" means re-tested on Kaggle after the change. "Offline" means covered only by `tests/`.

| Problem found | Measured | Change | Checked |
|---|---|---|---|
| Shell blocked during a busy cell | `sh` refused or hung | Sidecar kernel: warm command 558 ms, full CLI `sh` about 5 s | Live |
| No record of peaks | Agents built their own loggers | `monitor start/report/stop`, with warnings | Live, plus replay |
| Long jobs had no exit code | Only a log | `job start/status/logs/stop/list` | Live |
| Job with a child ignoring SIGTERM | Could outlive `stop` | Stops the process group, then kills it. Records `stoppedBy`, never invents an exit code, finds children left after the wrapper has died, checks a process carries the job's tag, refuses to restart while survivors remain, and reads as running while any of its processes is, even after its wrapper exits | Live, `raw/job-stop-retest.txt`, `raw/final-retests.txt`: SIGTERM, SIGKILL, survivors, each with 0 processes left, a job's own exit 7 kept, a restart refused, and `sleep 300 &` read as running after exit 0 (`raw/final-end-to-end.txt`). PID reuse itself wasn't reproduced |
| `job stop` of an unknown job | Exit 0 | Exit 1 | Live |
| Second `monitor start` | Could start twice | Refused with exit 1 | Live |
| Closed-tab sessions invisible | Could hit the cap with no way to see why | `sessions`, `sessions-stop` | Live, `raw/transcript-excerpts.txt`, `raw/sessions-stop-retest.txt`. **Ambiguous titles: not exercised** |
| `sessions-stop` chose a row by list position, so a list change could stop the wrong notebook (Codex reproduced it on a mock) | Found in review, never seen live | Chooses and clicks in one step, by exact title, from its own tab | Live, `raw/sessions-stop-retest.txt`: stopped the right one in 8 s with 5 live, the others unaffected. The race itself wasn't reproduced live |
| `sessions` used whichever Kaggle tab came first, even a busy one | Found in review | Uses its own temporary tab | Live: 6 s with 5 sessions live |
| No file download | Only `put` | `get`, SHA-256 verified | Live |
| `put` wrote over the target before checking it (Codex's review) | A failed copy could destroy the original | Writes beside the target, verifies, then swaps it in | Live, `raw/final-retests.txt`: overwrite keeps the mode; a failed copy leaves the target and no temp file |
| `start` returned before ready | Next command failed | Waits for a settled kernel | Live |
| Cap refusal hidden | 64-240 s wait | Immediate error | Live: T4 in 4 s, CPU in 6 s with 5 live |
| Kernel death misreported | Exit 3, wrong reason | Exit 1 with the cause when seen, exit 3 when not | Live, `raw/new-features2.txt`, `raw/kill-cli.txt` |
| `resources` slow | 7-8 s | About 1.1 s: the first click after Close does nothing | Live |
| Unstructured `resources` | Flat label list | Structured values, refuses incomplete readings | Live, plus 40 fault cases |
| Reopened tab reported as starting | `status` wrong, `resources` timed out | Asks the server, and says what to use | Live |
| Disk and CPU traps | See above | Documented where agents read them | Doc |
| `selfcheck` overstated coverage | Codex's review | Lists what it didn't check | Live with no session, `raw/selfcheck-off.json`: 29 checks, 0 failed, 3 areas not checked. Live with a session on the final code, `raw/selfcheck-live.json`: 32 checks, 0 failed, 2 areas not checked |
| Token in `ps` output | Found by a fresh agent | `sh` output scrubbed | Live on a real `ps` |
| Cell output and early errors weren't scrubbed | Codex's review | Every printed line goes through `scrub`, before any cutting | Offline, and live with a synthetic token in a real cell, through `run --wait` and `outputs --max 40`: 0 lines showed it (`raw/final-retests.txt`) |
| `monitor` read missing GPU data as GPU use stopping | Codex's review, on a replay | Missing readings are reported as unknown, per GPU | Offline replay |
| `status` and `resources` could trust a brief `off`, and treat any kernel state as live | Codex's review | Settle first, and require `idle` or `busy` | Busy reopened tab and queued TPU live. **Brief `off` and dead-kernel states not exercised live** |
| Typo in a file path, directory, or `-` where stdin isn't read | Connected first | Checked before connecting | Offline |
| No tests | Codex's review | 58 offline tests | Offline |
| `start` raised a timeout though the session had started (seen once) | Live | Lets the wait decide | **Not reproduced after the fix** |
| Stray dialog handling | Cancelled everything, including the idle prompt | Idle prompt answered with `Continue editing` | Live, L8: dialog gone within 5 s of `job status`, session survived. No offline test |

## Codex's reviews

Codex reviewed this repeatedly, read-only, recomputing from `raw/`. Its reports are in `raw/codex-reviews.md`.

| Round | Result |
|---|---|
| 1, draft | Findings overstated, 15 code defects. All fixed, then re-tested as labelled above |
| 2, near-final | 10 findings, including `sessions-stop` targeting by list position, an over-firm lifetime claim, and evidence labels with no raw file. It also named the test that could disprove the lifetime claim, which became clock h and g |
| 3, final | Earlier findings fixed or partly fixed. New or remaining: `put` overwriting before verifying, truncation bypassing scrubbing, survivors after a dead wrapper, per-GPU freshness, and the skill's CPU results reading as general. It found the U6 scoring fair. All were fixed and re-tested as labelled above |
| 4, final check | Three more: `job stop` trusting a PID that could be reused, `job start` orphaning survivors of the last run, and one rare cut before scrubbing. All fixed, and live re-tests are in `raw/final-retests.txt` |
| 5, those three only | Three narrower ones: tag matching by substring, a job with a dead wrapper reading as not running, and scrubbing a cut stream. All fixed. **My fix for the first put a NUL byte in the generated Python and broke every `job` command. The live re-test caught it, and an offline test now covers it** |
| 6, those three only | One real defect: a job like `python train.py &` read as finished while still running, which could prompt a shutdown. Fixed, and re-tested in `raw/final-end-to-end.txt` |
| 7, that one fix | No defect found. **Signed off**, with this document disclosing its known limits. That sign-off covers code and evidence as they stood at 08:27 UTC |

A final end-to-end run on the finished code passed on a CPU session (`raw/final-end-to-end.txt`): new, start, selfcheck, job, cell error with exit 1, monitor, resources, put and get with an identical round trip, status, sessions-stop, and `off` afterwards. **It didn't cover a GPU or TPU session.** The last GPU session ran on code from before the final fixes to `job`, `monitor` and `put`.

**The U6 agents ran on the skill as it stood at about 06:50.** Later corrections to `SKILL.md` and the code weren't re-run with a fresh agent.

## Mistakes in this evaluation

Recorded so that they can be checked:
- The RAM-kill logic was first scored with the older detection code.
- `dp.py` caused its own out-of-memory error with `.float()`. Its replacement caused another: `.sum()` on a uint8 tensor widens to int64, asking for 24 GiB on GPU 1. The panel reading in that run is still valid, because unequal memory was held and read. It wasn't the planned 1 and 3 GiB.
- The second CPU run planned a cap test, but too few sessions were live, so it was redone by hand.
- The long-run monitors kept running blind for 32 minutes after losing their tabs.
- S3 stopped at 40 minutes. That job length hid the most important limit in this report, and I then wrote "keep the tab open" into the skill on that basis.
- `setup-u6` started its job with `nohup`, so the agents' `job list` was correctly empty. One agent reported that as odd.
- I told the owner that `wait` gave a false success. See "Kernel death".
- A monitor test began failing after more tests were added, because it read the clock once at load. Fixed in the test, after Codex's last review. The skill's code didn't change.
- My fix in round 5 broke every `job` command for about 3 minutes, until a live re-test caught it.
- `kill-cli.sh` first used a `pkill` pattern that didn't reach the kernel. The result reported is from the exact-PID version.
- L1's tab was also used for command tests at 06:03, 06:13 and 06:16, so L1 isn't a clean no-commands case.

## Could not be tested

- TPU sessions, while queued.
- Quota exhaustion, and the 12-hour limit: too costly and too long.
- Colab's CLI live: not signed in on this machine.
- Other accounts, or other times of day.
- Why the tabs vanished at 05:28.
