# Codex reviews

Final message of each review, read-only runs of `codex exec` with gpt-6.1-sol, 2026-11-04. Credentials scrubbed. Links to local files are as Codex wrote them.

## Round 1, draft

d not sign this off yet. The GPU accuracy results largely reproduce, but several passes exceed the recorded evidence, U5 was scored against an added requirement, and the current code has concrete session-selection and cleanup defects.

I changed no files and made no network requests. All 28 existing offline tests passed. Additional checks used in-memory mocks and a local process-group experiment; these do not establish live Kaggle behavior.

Part 1 — evaluation findings, ranked by severity.

1. **High — U5’s baseline was penalized for an unwritten requirement.**  
   [FINDINGS.md:100](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:100): **“Partly: no quota answer.”** [PLAN.md:141](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:141) requires accurate GPU readings, the right device, progress reporting and no interruption. It does not require quota. Consequently, the missing quota answer cannot justify “Partly” or the claimed **“clear advantage”** at findings lines 10 and 105.  
   **Smallest fix:** rescore all U5 arms using the written criterion and retain their timestamped answers and tool traces. The supplied data cannot establish the corrected winner.

2. **High — “job lost” is not demonstrated by the closed-tab experiment.**  
   [FINDINGS.md:72](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:72): **“Cancelled at 41.0 min after closing, job lost.”** The workload in [job_heartbeat.py:5](/Users/alpha/skills/evaluations/2026-11-accelerators/harness/job_heartbeat.py:5) runs for **40 minutes**. Thus it could have finished before the first observed cancellation at 41.0 minutes. The same issue affects the WebSocket case, first observed cancelled at **40.9 minutes**. Neither case records the final job log or completion artifact. The sidecar-polled control does record `JOB FINISHED`.  
   **Correct claim:** the sessions were first observed cancelled by 41.0 and 40.9 minutes; job completion in those two cases is unknown. These are polling observations, not exact shutdown timestamps.  
   **Smallest fix:** correct the wording; repeat with a workload longer than the cancellation window and independently preserve completion/progress evidence.

3. **Medium — CPU, RAM and disk were scored without the required sample count.**  
   [PLAN.md:126](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:126) says **“Discard the first 20 s after each load change, and need at least 10 paired samples.”** Nevertheless, [FINDINGS.md:27](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:27) and nearby rows report passes.

   | Measurement | Recomputed evidence |
   |---|---|
   | CPU burn | **5** settled pairs; raw median error **298 percentage points**; after dividing panel CPU by four, median paired error **0.5 points** |
   | RAM hold | **5** settled pairs; approximately **76 MiB** rise error |
   | `/kaggle/working` disk hold | **2** settled panel samples |
   | `/tmp` disk hold | **2** settled panel samples; **zero** panel baseline samples after applying the full 20-second settling rule |

   [score-cpu.py:75](/Users/alpha/skills/evaluations/2026-11-accelerators/harness/score-cpu.py:75) quietly uses **15 seconds** for disk holds and **10 seconds** for baselines. RAM baselines also use 15 seconds. Its advertised disk result uses three hold samples, still below ten.  
   **Smallest fix:** retain the measured deltas, mark the formal accuracy criteria unfulfilled, and collect longer phases and baselines. Document normalization explicitly rather than presenting raw CPU numbers as matching.

4. **Medium — the unequal-memory experiment’s failure is omitted.**  
   [FINDINGS.md:23](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:23): **“Unequal memory on two GPUs … Pass.”** Line 41 reports successful training without mentioning that the complete notebook exited **1**. [dp-wait.txt:12](/Users/alpha/skills/evaluations/2026-11-accelerators/raw/dp-wait.txt:12) records a **12 GiB allocation OOM** in the unequal-memory cell: `hold1.float()` expanded the 3 GiB byte tensor. The intended 45-second hold and release did not complete.  
   The training-cell figures do reproduce: relative L2 **1.45038e-7**, times **0.041 versus 1.104 seconds**, and replica counts **1,024 per GPU**.  
   **Smallest fix:** report training success and unequal-memory-cell failure separately; avoid the expanding conversion and record a successful hold/release retest.

5. **Medium — the quota conclusion omits a material counter reversal and overstates isolation.**  
   [FINDINGS.md:48](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:48): **“whether busy or idle: +0.24 h over 0.246 h.”** The selected interval reproduces approximately **+0.24 h over 0.24667 h**, consistent with session-hour rather than GPU-hour billing. It mixes workloads and idle periods, however; it is not the fixed idle-only Q1 experiment.

   The quota log also drops from **1.26 h at 05:10:46 to 1.13 h at 05:11:18**, a **0.13 h reversal**. That matters when treating readings as a billing ledger. The per-test ledger contains only the initial two checkpoints, despite [PLAN.md:120](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:120) requiring before/after records for every accelerator test.  
   **Smallest fix:** disclose the reversal, distinguish reported usage from settled billing, and limit the rate conclusion to the selected interval. Record isolated idle, CPU-only and post-stop controls.

6. **Medium — GPU freshness was measured using memory, then described as load freshness.**  
   [FINDINGS.md:24](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:24): **“GPU load change visible … 5.6–11.6 s.”** The scorer’s detection predicates test memory thresholds. GPU 0’s first panel utilisation above 5% arrives **15.644 seconds** after its load-start mark.  
   **Correct figures:** memory detection **5.6–11.6 seconds**; utilisation transition detection approximately **11.3–15.6 seconds**. Both satisfy 20 seconds. [ui-map.md:91](/Users/alpha/skills/kaggle-notebooks/references/ui-map.md:91), **“A change shows within 12 s,”** is therefore too strong.  
   **Smallest fix:** label the metrics separately and correct the freshness statement.

7. **Medium — the supplied record cannot reproduce the fresh-agent comparison.**  
   [FINDINGS.md:84](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:84) says **“Tokens and tool calls come from the harness”** and **“Answers were scored against truth measured separately.”** The supplied `raw/` and `harness/` contain neither the per-arm transcripts and usage records nor the scoring records behind lines 88–101.

   This leaves all those per-arm correctness labels, tool counts, token totals and durations unauditable. The U1 calibration summary supports **8,783 MiB on GPU 0 and 3 MiB on GPU 1** for that calibration; it does not validate every arm. Likewise, `u5-truth.jsonl` lacks the agents’ timestamped readings needed for pairing.

   Claims including **“at the same cost”** (line 10), **“Every arm was correct”** and the earlier **“22 scripts … against 0”** (line 104), and **“inside normal run-to-run noise”** (line 106) exceed this record. One repetition cannot estimate run-to-run noise.  
   **Smallest fix:** include the missing inputs, outputs, usage records and scoring; otherwise mark these results unverified and remove the noise claim.

8. **Medium — several remaining numerical claims lack their recorded measurements.**

   | Location and quote | What the supplied record supports | Smallest fix |
   |---|---|---|
   | [FINDINGS.md:26](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:26), also line 145: **“1.05 s after a fix”** | Original GPU median **6.986 s**, 35/35 within 10 s; CPU median **7.097 s**, **43/45** within 10 s. No saved post-fix timing series establishes 1.05 s or its p95. | Save the post-fix series; distinguish median from the percentile criterion. |
   | [FINDINGS.md:40](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:40): **“19, 19, 25 s”** T4 starts | `start-times.csv` records **one T4 start, 19 s**. Another recorded 19-second start is CPU. | Supply three T4 trials or mark A1 incomplete. |
   | [FINDINGS.md:70](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:70): **“Off at 77.8 min”** | S1 is recorded live at **03:47:22**, showing an 8-minute pill, and off at **04:56:47**. Its exact start timestamp is absent. | Report the observation interval or provide the start record. |
   | [FINDINGS.md:71](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:71): **“alive at 28 min … gone by 41”** | S2 cancellation is recorded, but its close timestamp and timed alive observation are absent. | Include those observations or remove the precise bounds. |
   | [FINDINGS.md:75](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:75), also line 76: **“80 of 80 heartbeats, longest gap 30 s”** | The workload would emit 80 heartbeats; the complete two output logs are absent. Sparse polled tails do not establish every heartbeat or maximum gap. | Preserve and score both complete logs. |
   | [FINDINGS.md:78](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:78): **“See ‘Long runs’ below”** | There is no such results section. L2/L3/L4 logs stop well before their intended long-run outcomes. | State that these tests are incomplete. |
   | [FINDINGS.md:137](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:137): **“558 ms idle, 557 ms busy”** | These are repeated **`1+1` requests through an already-created sidecar**, not complete `sh` calls. Initial readiness was **2,138 ms**; recorded CLI shell checks took about **4.8–5 s**. | Label warm-request latency and report complete command latency separately. |

9. **Medium — routing arithmetic is wrong, and design B was not evaluated.**  
   [FINDINGS.md:127](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:127): **“Only 1 of 723 decisions missed.”** There are **33 × 24 = 792 decisions**, with **791 exact matches**. The frozen specification’s SHA-256 prefix does reproduce.

   A and C achieve F1 **1.000** throughout. Haiku A2 achieves **0.990476**, with **119/120** exact matches; all other model/design combinations achieve 1.000. Thus the best-one-skill-versus-split ceiling conclusion holds.

   But [PLAN.md:101](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:101)’s reference-file design **B** is absent: A2 rewrites the description. No recorded body-loading experiment establishes line 131’s reference-file decision or line 124’s **“All four U tasks … needed both.”** The roughly 9% calculation is an assumption-based estimate, not measured loading cost.  
   **Smallest fix:** correct the denominator and identify B and content-loading comparisons as untested. Keeping one skill remains consistent with the failed first split condition.

10. **Medium — “counts everything except `/kaggle/working`” generalizes beyond the probes.**  
    [FINDINGS.md:30](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:30): **“Counts everything except `/kaggle/working`.”** The probes establish that a 5,120 MiB working-directory write changes the panel by **0**, while a `/tmp` write changes it by **5,120 MiB**. They do not establish every other path or the complete accounting scope. The independent root-filesystem totals also differ substantially from the panel’s totals.  
    **Smallest fix:** describe those two measured paths; leave the broader accounting scope unknown.

11. **Medium — “fixed” and “refused incomplete readings” exceed the checks.**  
    [FINDINGS.md:45](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:45), line 143: **“immediate, clear error”** has no recorded post-fix cap-refusal retest. Lines 115 and 146 claim missing readings are refused; the parser counterexamples below disprove that. Line 151 records an idle-prompt fix, but no completed live test shows `Continue editing` preserving a long-running job.  
    **Smallest fix:** distinguish implemented changes from verified fixes; retain explicit retest results.

The following planned checks also lack a complete recorded result. Each is **medium severity** because the plan’s stopping rule requires an outcome, including an explicit “not exercised” with a reason. The smallest correction is to add that status rather than silently treating coverage as complete.

| Plan location | Missing or differently scored check |
|---|---|
| [PLAN.md:47](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:47) | **Q1:** isolated fixed-duration idle billing test. |
| [PLAN.md:48](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:48) | **Q2:** start-to-quota-rise lag scored against five minutes. |
| [PLAN.md:49](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:49) | **Q3:** isolated CPU-only non-billing control; the CPU accuracy run overlaps GPU work. |
| [PLAN.md:60](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:60) | **S6:** detached T4 job beyond 20 minutes without cell activity. |
| [PLAN.md:74](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:74) | **A9/C11:** CLI batch status has results; the UI committed-run comparison and `logs -f` tracking do not. |
| [PLAN.md:81](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:81) | **I2:** probe code exists, but no saved result identifies the panel’s metrics response. |
| [PLAN.md:132](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:132) | **C06:** zero silently incomplete parser reports is false under the fixtures below; broken-anchor coverage is not systematically recorded. |
| [PLAN.md:133](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:133) | **C09:** isolated post-stop burn control and a recorded model fit. |
| [PLAN.md:137](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:137) | **C15:** busy `sh` was changed from refusal to allowed execution without an explicit criterion amendment. Interrupt-within-15-seconds and kernel `SIGKILL` controls have no recorded result. |
| [PLAN.md:138](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:138) | **C16:** agent warning replay covering GPU collapse, RAM/disk pressure and low quota. |

TPU execution and U3 are explicitly marked unexercised; A8’s narrowing is explicitly documented. Those are not hidden omissions.

12. **Low — the Colab comparison contains unsupported or stale assertions.**  
    [COLAB-COMPARISON.md:16](/Users/alpha/skills/evaluations/2026-11-accelerators/COLAB-COMPARISON.md:16): **“About 1,700 lines of JavaScript”** is now **2,247 lines** across the three scripts. Line 58’s **“Argument and file checks now run before connecting”** is false: file reads occur after `connect()` in CLI dispatch. Lines 37–38’s **“Can’t fix”** claims go beyond finding no suitable public API or getting 404s from the tested terminal URL forms.  
    **Smallest fix:** update the count and validation description, and bound impossibility claims to what was investigated.

Part 2 — current-code findings, ranked by severity.

1. **High — duplicate titles can stop the wrong session.**  
   [driver.mjs:1093](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1093) chooses the first exact-title match without checking its run identity, type or state. With a committed version and interactive session both titled `Training`, `sessions-stop Training` can choose the wrong row. Duplicate version titles already occur in `events-raw.txt`.  
   **Smallest fix:** expose a stable run/session identifier and require it for stopping; meanwhile refuse multiple title matches and validate that the selected row is live.

2. **High — `job stop` can leave the actual workload running.**  
   [jupyter.mjs:249](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:249) signals the process group, then waits only for its leader. If the bash runner exits on SIGTERM while a child ignores SIGTERM, the loop breaks and skips SIGKILL. I reproduced that process state locally. The command reports `stopped: true` while the child remains alive.  
   **Smallest fix:** test whether the process group still exists, escalate against that group after the grace period, and verify its disappearance.

3. **High — job logs bypass token scrubbing.**  
   [cli.mjs:355](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:355) prints `job logs` verbatim; `job status` prints its `logTail` verbatim too. A job such as `job start inspect 'ps aux'` can capture the Jupyter token that the evaluation says was found in process output. Retrieving that log exposes it despite `sh` being scrubbed.  
   **Smallest fix:** apply the same credential redaction to every log-bearing response, including JSON fields, and test with synthetic credentials.

4. **High — incomplete GPU readings can be declared complete.**  
   [driver.mjs:953](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:953) checks for at least one GPU, not the expected count, and does not require limits. Offline counterexamples produced `missing: []` after:
   
   - deleting the entire second GPU block from the T4-x2 fixture;
   - deleting every maximum and the session limit;
   - deleting GPU 0’s utilisation headings, causing GPU 1 to be labelled index 0.

   `resources()` therefore returns these as full readings.  
   **Smallest fix:** validate required limits, expected device count and block structure; reject unmatched memory blocks and ambiguous device ordering.

5. **High — `put` can exhaust session RAM while verifying a large file.**  
   [jupyter.mjs:374](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:374) computes the remote checksum using `open(...).read()`, loading the entire file into the sidecar. Uploading a 5 GiB checkpoint while training uses roughly 26 GiB can exceed the measured 30 GiB shared limit. Chunked transfer does not prevent this final allocation.  
   **Smallest fix:** hash the remote file incrementally with bounded reads.

6. **Medium — sidecar cleanup failures are silently accepted.**  
   [jupyter.mjs:124](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:124) ignores DELETE exceptions and never checks the returned HTTP status. A mocked DELETE **500** still produced successful command completion, leaving the sidecar behind. Process termination also has no cleanup handler.  
   **Smallest fix:** require successful deletion, retry bounded transient failures, and report the undeleted kernel ID without its token-bearing URL. Handle normal cancellation cleanup.

7. **Medium — restarting the monitor destroys its active history.**  
   [jupyter.mjs:293](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:293) unlinks the sample log before checking whether `kn-monitor` already runs. Calling `monitor start` twice leaves the existing sampler writing to an unlinked inode; the duplicate job is refused and `monitor report` finds no pathname. [cli.mjs:335](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:335) nevertheless exits 0 for that error object.  
   **Smallest fix:** check/lock monitor state before removing the log; propagate failure to the CLI exit code.

8. **Medium — restart detection confuses connection state with kernel death and misses unobserved deaths.**  
   [driver.mjs:794](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:794) requires this invocation to have observed pending cells, then treats `connecting` as evidence of a restart. Offline state sequences demonstrated:
   
   - running → successful completion → connection reconnect → idle produces `kernelRestarted: true`;
   - starting `wait` during the recorded connecting phase of an OOM produces no restart flag because this invocation never saw pending cells.

   A restart completed between polls is likewise unobservable to this logic. [cli.mjs:189](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:189) then attributes cause using the lifetime OOM count, which may belong to an earlier failure.  
   **Smallest fix:** retain a run’s kernel-process/generation identity and OOM-counter baseline; distinguish transport reconnects, confirmed restarts and unknown outcomes.

9. **Medium — shell/job polling does not answer the idle prompt.**  
   [driver.mjs:311](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:311) and [cli.mjs:343](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:343) obtain the server and run sidecar commands without `answerIdlePrompt()`. Thus an agent following [SKILL.md:77](/Users/alpha/skills/kaggle-notebooks/SKILL.md:77), **“poll this,”** can repeatedly obtain job status while leaving the idle dialog unanswered. Only `wait` and overlay-using operations address it.  
   **Smallest fix:** answer the narrowly identified idle prompt on the explicitly selected notebook before job/shell operations. Complete the interrupted L2/L3 live experiment before claiming this preserves long jobs.

10. **Medium — session-list operations can renew an unrelated GPU session.**  
    [driver.mjs:1042](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1042) reuses the first Kaggle page. Opening Active Events invokes `closeOverlays()`, which automatically clicks `Continue editing`. With an idle GPU notebook first and an unrelated CPU session targeted for stopping, `sessions-stop` can renew the GPU session before acting on the CPU session. The dialog fixture reproduced the automatic click.  
    **Smallest fix:** use a dedicated management page and restrict idle-prompt renewal to explicitly targeted notebook activity.

11. **Medium — a shrinking download can loop until the watchdog kills the CLI.**  
    [jupyter.mjs:392](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:392) loops until the original file size is reached but never rejects a zero-byte read. If training truncates or replaces a checkpoint during download, EOF can leave `got` unchanged forever. The watchdog eventually exits without sidecar cleanup.  
    **Smallest fix:** fail immediately on unexpected EOF and validate source size/identity before claiming a verified snapshot.

12. **Medium — a missing notebook-session match silently selects another kernel.**  
    [jupyter.mjs:49](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:49) falls back to the first session. With API rows `other.ipynb: idle` followed by `train.ipynb: busy`, neither matching the hard-coded path, the function reports idle. I reproduced this with an offline response fixture. This can falsely settle an unknown notebook state. Whether Kaggle can produce that arrangement needs a multi-document/external-editor test.  
    **Smallest fix:** match the notebook’s actual kernel ID; fail explicitly when no unique match exists.

13. **Medium — `start` can report readiness for a restarting or dead kernel.**  
    [driver.mjs:322](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:322) accepts any connected status except `unknown`, `connecting` and `starting`. That includes `dead`, `restarting` and `autorestarting`. The preflight’s connected check also returns `alreadyRunning` for those states. A following `exec` can therefore encounter a kernel that `start` supposedly settled.  
    **Smallest fix:** define usable states explicitly and continue waiting or fail for death/restart states.

14. **Medium — the monitoring workflow fails from a cold session.**  
    [SKILL.md:66](/Users/alpha/skills/kaggle-notebooks/SKILL.md:66) starts `monitor` before `run`, but `monitor start` requires an already-live session. Following it after creating/configuring a notebook produces `No live session`; continuing with `run` then runs without monitoring.  
    **Smallest fix:** add `k start --url "$URL"` before `monitor start`.

15. **Low — scrubbing corrupts ordinary output.**  
    [cli.mjs:205](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:205) matches `eyJ` anywhere inside a word. The legitimate output `{"keyJSON":"value"}` becomes `{"k<token>":"value"}`. Long ordinary values after `token:` are also silently replaced.  
    **Smallest fix:** redact known credentials and well-defined credential fields rather than arbitrary substrings, and expose that redaction occurred.

What I tried to break and couldn’t: the settled GPU comparisons reproduced **11 and 10 load samples**, zero median utilisation error, p95 error at most one point, approximately **12.2 MiB** maximum memory error, and **21/21** correct device assignments. All four A8 records consistently show successful T4 hardware despite the requested IDs. The foreground test records **15 timeouts followed by successful completion**. Job-name validation rejected traversal and shell metacharacters; a hostile file path remained a Python string literal. I found no injection through those encodings, and the recorded idle dialog’s `Continue editing` selector matched the current handler.

## Round 2, near-final

I would not sign this off yet. There are defects beyond the pending results. I changed no files and used no network.

1. **P1 — `sessions-stop` can target another notebook after the list changes.**

   [driver.mjs:1131](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1131) finds the matching row’s numerical index; [line 1146](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1146) later resolves `.nth(index)` against the current list. If another session appears before that row, the command opens that session’s menu and clicks its Stop Session action.

   I reproduced this with the actual function and an in-memory page mock: requesting `wanted`, then inserting `new-busy` before the click, selected `More options for new-busy`.

   `anyKagglePage` also picks the first Kaggle tab, including a busy editor or a page without navigation, such as `robots.txt` ([line 1075](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1075)). Avoiding `closeOverlays` correctly avoids answering another notebook’s dialog, but consequently a modal can block stopping a session. There is no isolated surface for these account-wide operations.

   **Correction:** use a dedicated temporary navigation tab; select and revalidate a stable session/notebook identity immediately before stopping. Never use a changing list position as destructive identity.

2. **P1 — The “41 minutes after last kernel activity” conclusion is not established.**

   It is presented as fact in [FINDINGS.md:13](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:13), [SKILL.md:10](/Users/alpha/skills/kaggle-notebooks/SKILL.md:10), its limits table, and `ui-map.md`. The supplied observations support a narrower conclusion:

   | Case | What the raw record establishes |
   |---|---|
   | S4b | Cancellation first observed **40.974 min after closing**, not an exact cancellation time. |
   | S4d | Cancellation first observed **40.852 min after closing**; socket was still open at 35.1 min. |
   | L2 | Progress successfully read at **35.095 min after job start**. First failed fetch at **45.347 min**, not the stated 43.3. Its result is `status undefined`, not cancellation. |
   | L3 | Progress successfully read at **40.125 min**. `job status` failed at **41.084 min** with `No live session`. That is not independently confirmed cancellation, especially given the documented reconnect defect. |
   | L4 | Last recorded state is an empty pill at **10.1 min**. The supplied files do not show the claimed “gone by 40.4”. |

   Evidence: `closed-tab.csv:126`, `closed-tab.csv:131`, `long-runs.csv:22`, `long-runs.csv:24`, `long-runs.csv:25`, and `long-runs2.csv:2`.

   L2–L4 are confounded by four tabs disappearing together for an unknown reason. Their last kernel activity timestamps were not recorded. Session start, notebook activity, browser keepalive state, and the tab-loss event are not separated. Also, [FINDINGS.md:171](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:171) says a job was running in every case, although L4 was idle.

   The S4 failure label is premature too: the original jobs lasted **40 minutes**, while cancellation was detected near 41. Those observations alone do not prove the jobs were killed before completion. The new 60-minute tests appropriately address that gap.

   **Correction:** describe the last-activity clock as a hypothesis, report detection bounds rather than exact cancellation times, remove unsupported L2/L4 terminal bounds, and leave S4 job-loss unestablished until there is direct evidence.

   **What would falsify the proposed clock:** for example, record `last_activity=T`, deliberately close the tab at `T+15 min`, then independently verify uninterrupted job progress at `T+50 min`, with no intervening kernel commands or tab reopening. Cancellation around `T+56 min` would support a closure-based clock instead. Controlled activity well after session start is also needed to distinguish session age from last activity. The pending immediate-close tests alone cannot make that distinction.

3. **P1 — `job stop` does not reliably return the job’s exit code.**

   [jupyter.mjs:279](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:279) chooses 143 or 137 from the signals attempted. [Line 294](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:294) returns that choice even when an actual `.exit` file exists with another code.

   In an in-memory execution of the generated Python, a job recording **7** during stopping retained **7** on disk but `job stop` returned **143**. A command that handles termination and exits cleanly can likewise be assigned an inferred signal result because its recording wrapper was killed.

   The existence check normally preserves an already published exit file; it is not an unconditional overwrite. However, lifecycle operations are unlocked. A concurrent `job start` reusing the name after the old wrapper dies can have its metadata or exit file corrupted by the old `job stop`; the check-then-write at [line 292](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:292) is not atomic.

   **Correction:** separate `stopSignal`/`forced` from an observed `exitCode`. Preserve and return an actual recorded result. Use one supervisor to observe completion, plus locking and a generation identity for start/stop/publication. Do not manufacture an observed exit status when it is unknown.

4. **P1 — Notebook output bypasses token scrubbing.**

   [cli.mjs:153](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:153) prints cell source and output directly; [line 164](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:164) prints live tails directly. Thus ordinary `outputs`, `wait`, and `run --wait` can disclose the Jupyter token even though JSON output and `sh` output are scrubbed.

   I passed a synthetic `--ServerApp.token=…` through the actual `printOutputs`: it was printed intact, while `scrub()` removed the same token. Argument-parser errors at line 119 also bypass scrubbing.

   **Correction:** scrub every output path, including cell headings, text, live tails, and early errors. Add tests exercising those printing paths. The successful real-`ps` test proves the `sh` path only.

5. **P1 — The workflows still allow result loss, and the keepalive advice needs tighter scope.**

   [SKILL.md:61](/Users/alpha/skills/kaggle-notebooks/SKILL.md:61) directs an agent to read the result and stop after exit 0 or 1, without first preserving required files. A training script can successfully create a model or checkpoint in the session without printing its contents.

   [Line 83](/Users/alpha/skills/kaggle-notebooks/SKILL.md:83) offers `save-version` for browser-independent work without explicitly saying that it launches a separate execution, rather than migrating the currently running job and its state.

   The “`sh` or `job status` every 5.8 minutes, no tab” row also misidentifies the measured route. S4c used **direct `j.shell(base, …)`**, retaining the server URL (`harness/run-closed-tab.mjs:76`). The public CLI commands reopen the tab through `page()`.

   Rule 105 correctly says to stop when finished. Nevertheless, the opening “an open tab keeps it alive” and the polling row can be read as general advice to preserve idle sessions.

   **Correction:** require downloading necessary artifacts before stopping; state that committed execution restarts the workload; distinguish the direct-sidecar experiment from the CLI; and limit polling/prompt continuation to an authorized job still needing execution. Stop an idle allocation instead of maintaining it for possible future work.

6. **P2 — Reopened-tab state handling still has false classifications.**

   `status` captures the pill state **before** `settledRunState` ([cli.mjs:254](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:254)). A transient initial `off` can therefore survive into the final response even after the kernel settles as live.

   `resources` returns `{session:"off"}` immediately from that same transient pill, without the loaded/settled safeguards described elsewhere ([driver.mjs:997](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:997)).

   Conversely, the Starting fallback treats **any non-null kernel object** as running. In mocked executions, server states `starting`, `restarting`, and `dead` all produced `session:"running"` and the same busy-cell recovery note. The resources error uses the same insufficient predicate.

   **Correction:** settle before taking the final session snapshot; verify apparent off states; distinguish server reachability from usable kernel state; issue the busy-cell explanation only when supported. The recorded busy-session and queued-TPU retests cover those two cases, not these transitions.

7. **P2 — `monitor` can present stale GPU data as current and confuse missing measurements with inactivity.**

   The sampler silently turns `nvidia-smi` failures into `g=[]` ([jupyter.mjs:317](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:317)). The report computes GPU “last” values and utilization statistics from whichever successful samples remain, while its freshness field describes the latest overall sample ([line 357](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:357)).

   I replayed one successful GPU sample followed by 200 seconds of missing GPU samples. The result reported:

   - `lastSampleAgeSeconds: 0`
   - `lastMemMiB: 8000`
   - `meanUtil: 95`
   - `activePercent: 100`
   - “GPU use has stopped…”

   Those are missing measurements, not evidence that GPU work stopped.

   **Correction:** record sampling errors and per-device timestamps/coverage; make current GPU values unknown when stale; calculate collapse warnings only over sufficiently complete recent observations.

8. **P2 — Local validation is incomplete, including the explicitly requested `--file` and `-` cases.**

   [cli.mjs:223](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:223) checks `exec --file` but omits `sh --file`. It checks existence rather than readability and exempts `-` even where the eventual reader treats it as a filename.

   With a mocked connector:

   | Invocation | Observed order |
   |---|---|
   | `sh --file /no/such/file --url u` | Connect, then ENOENT |
   | `exec --file /no/such/file --url u` | Correctly refused before connecting |
   | `exec --file - --url u` | Connect, then read literal filename `-` |
   | `append kaggle-notebooks --url u` | Connect, prepare tab, then EISDIR |
   | `push - --url u` | Connect, prepare tab, then read literal `-` |

   **Correction:** read and validate local input before connecting. Define stdin support consistently, or reject unsupported `-` forms before connecting. Validate local action/name arguments there too. This contradicts the comparison’s blanket “arguments and local files … checked before connecting”.

9. **P2 — Some “Live” and “Offline” labels overstate the saved evidence.**

   [FINDINGS.md:256](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:256) gives these labels explicit meanings. Here is the evidence for **every Live-labelled row**; filenames below are under `evaluations/2026-11-accelerators/raw/`.

   | Changed feature | Saved raw evidence |
   |---|---|
   | Busy-cell shell | `probe-sidecar.txt:7`; `quick-checks.txt:15` |
   | Monitor and warnings | `new-features2.txt:2`; `gpu2.txt:24`; constructed replay in `cpu2.txt:13` |
   | Job commands | `new-features.txt:43`; `retests.txt:16` |
   | Process-group stop and exit recording | `retests.txt:5` shows cleanup; `retests.txt:16` shows **137** and no leftovers. **143 and preservation of a job’s own code are not shown.** |
   | Unknown-job refusal | `retests.txt:25` |
   | Duplicate monitor refusal | `retests.txt:2` |
   | Sessions and sessions-stop | Listing: `sessions-live.txt:1`, `quick-checks.txt:23`. **The claimed 8-second stop and missing/finished-title refusals are not shown.** |
   | Download/checksum | `new-features.txt:48` |
   | Start readiness | `retests.txt:1` |
   | Cap refusal | `gpu2.txt:19`; `retests.txt:14` |
   | Kernel-death handling | `new-features2.txt:29`; `kill-cli.txt:5` |
   | Faster resources | `cpu2-panel.jsonl`; `gpu2.txt:14` |
   | Structured resources | `new-features.txt:9`; `cpu2-panel.jsonl`. Fault removals are offline tests. |
   | Reopened-tab recovery | `reopened-tab-live.txt:14` |
   | Expanded selfcheck | **No saved raw retest shown.** |
   | Scrubbing real ps output | `cpu2.txt:20`; proves that path only |
   
   The idle-dialog row is labelled **Offline**, but `tests/offline.test.mjs` contains no test of `answerIdlePrompt` or `closeOverlays`. Its pending live result is not a defect; the already claimed offline coverage is.

   **Correction:** attach the missing records or label those portions “implemented, not evidenced/retested”. Scope partial Live results to what was exercised.

10. **P3 — The comparison and a few limits overgeneralize narrower results.**

   In [COLAB-COMPARISON.md:23](/Users/alpha/skills/evaluations/2026-11-accelerators/COLAB-COMPARISON.md:23), “within 0 points and 12 MiB” turns dedicated-phase results into a blanket accuracy claim. The zero is a **median**; utilization p95 reaches 1 point. `gpu2.txt:15` and `:16` show memory differences of approximately **21 MiB**.

   Its “`--url` is required for any change” statement at line 28 omits `sessions-stop` and its weaker title-based targeting. “Each was tested … before use” at line 54 also needs qualification for the incomplete validation coverage.

   `ui-map.md:221` generalizes two tested disk paths into “everything outside `/kaggle/working`”; the findings correctly say only those two paths were checked. The skill’s “20 GiB limit” should distinguish nominal capacity from the measured **19,987 MiB usable filesystem**. TPU queue behavior and session caps should carry the same one-account/date qualification as the findings.

   **Correction:** give the actual statistic, tested conditions, exceptions, and measured scope. Likewise describe committed-log latency as an observed median: the official-CLI run included a **9.2-second** first-beat delay.

What I verified and found correct:

| Check | Recomputed result |
|---|---|
| CPU monitoring | **243/243** successful; median latency **1.07 s**, p95 **1.29 s**, maximum **2.90 s** |
| CPU accuracy | **18** settled burn samples, normalized median error **0.40 points**; **15** idle samples, error **0.50** |
| RAM rise | Baseline **15**, hold **19** samples; panel **8,209 MiB**, truth **8,173 MiB**, error **36 MiB** |
| `/kaggle/working` disk rise | Baseline **16**, hold **19**; panel **0**, truth **5,120 MiB** — correctly documented failure |
| `/tmp` disk rise | Baseline **16**, hold **17**; both **5,120 MiB**, error **0** |
| CPU freshness | Load/release **3.3/6.6 s**; RAM **3.3/2.6 s**; `/tmp` **4.2 s** |
| GPU monitoring | **35/35** successful; median **7.0 s**, p95 **7.1 s**, maximum **7.2 s** |
| GPU accuracy | Load phases **11 and 10** settled pairs; median utilization error **0**, p95 at most **1**; memory error about **12 MiB** |
| Device identity | Correct in **11/11** GPU-0 and **10/10** GPU-1 load readings |
| GPU freshness | Memory **5.6–11.6 s**; independently recomputed utilization **11.3–15.6 s** |
| Sample sufficiency | Scored CPU/GPU conditions meet the ten-sample minimum. GPU idle phases have only **one** settled sample each and are correctly excluded. |

The accuracy and freshness tables match those recomputations.

Quota also checks out: Q1 is **+0.370 h over 0.376719 h**, a rate of **0.9822**, within the 0.02-hour tolerance. The earlier interval is **+0.240 h over 0.246667 h**. The reversal is exactly **−0.13 h**. Around 05:13, **+0.09 h over 157 seconds** gives **2.064 h/h**, supporting “about twice”. The first rise is at **04:03:47**, and the longest sampling gap is **39 seconds**. From 06:15:11 through 06:23:35, recorded usage stays **1.76 h**; that supports the observed window without finishing the pending Q3 conclusion.

The three formal T4 starts are **22, 19, 24 seconds**, each identifying two Tesla T4s. S6 records completion and exit **0**. The retests preserve earlier failures and show the later unknown-job refusal and forced-stop result. Kernel-kill-between-commands correctly returns **3**, while both clean controls return **0**.

A9 records both CPU committed runs completing with matching output IDs and **18/18** streamed beats; its CPU substitution is clearly disclosed. I2 appropriately concludes **source not identified** from the 90-second observation, rather than claiming no network source exists. The recorded busy reopened tab and queued TPU behave as described.

All **41 offline tests pass**. `lowQuotaWarning` correctly warns at **0.40 h**, remains quiet at **0.50 h**, and tolerates missing quota; its unit-only coverage is accurately disclosed.

**Sign-off once pending results are filled: No—fix destructive session targeting, exit recording, output scrubbing, reconnect/monitor/validation defects, and revise the lifetime, preservation, and evidence claims.**

## Round 3, final

I would not sign this off yet. The lifetime advice is substantially safer, and U6’s scoring is fair, but work-loss and reporting defects remain. I changed no files and made no network or browser calls.

1. **High: a failed upload can destroy the previous remote file.**  
   [jupyter.mjs:428](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:428) opens the destination with `"wb"` before transferring chunks or checking the checksum. A timeout, disconnected channel or full disk leaves the old file truncated or replaced by an incomplete copy. The checksum detects failure after the damage.

   **Exact correction:** upload to a uniquely named temporary file beside the destination, close and verify it, then atomically replace the destination. Preserve the original on every failure.

2. **High: truncation can bypass output scrubbing.**  
   [cli.mjs:160](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:160) truncates before the console wrapper scrubs. [driver.mjs:680](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:680) also truncates live tails first. I exercised the actual `printOutputs` function in memory: printing `token=<54-character synthetic value>` with `--max 54` exposed the complete value because truncation removed `token=`.

   Early-error scrubbing is fixed; the cell-output/tail finding is only **partly fixed**.

   **Exact correction:** scrub complete output before truncation, line selection or tail extraction. Add regression cases where those boundaries remove the credential’s identifying prefix.

3. **High: the skill still presents a CPU observation as a general lifetime mechanism.**  
   [SKILL.md:10](/Users/alpha/skills/kaggle-notebooks/SKILL.md:10) states “40 minutes after the kernel’s last activity” without the CPU restriction that [FINDINGS.md:183](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:183) correctly supplies.

   The experiments support a narrower conclusion:

   - Running background jobs did not prevent expiry in the clean CPU cases.
   - Clock g supports a reset following a **sidecar-command operation**. That operation also creates, initializes and deletes a kernel; execution alone was not isolated.
   - L8 combines clicking **Continue editing** with kernel commands. It cannot distinguish their effects.
   - L9 supports “appears to” for a **printing foreground cell**. It does not distinguish a busy kernel from periodic output.
   - S1 and S3a remain counterexamples to an unconditional cutoff.
   - GPU expiry around 40 minutes was never tested.

   **Exact correction:** qualify the opening and measured-limit rows as observations on this account’s CPU sessions. Describe the reset mechanism as inferred. Retain five-minute polling as practical advice, while stating its measured duration. Also replace the unsupported general claim about closed-tab `run` survival at [SKILL.md:83](/Users/alpha/skills/kaggle-notebooks/SKILL.md:83).

   Checkpoints solely in `/kaggle/working` remain vulnerable; [SKILL.md:108](/Users/alpha/skills/kaggle-notebooks/SKILL.md:108) should recommend periodically exporting important checkpoints outside the session.

4. **Medium: `job stop` misses surviving children after the wrapper dies.**  
   [jupyter.mjs:211](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:211) defines “running” using the recorded wrapper PID. [jupyter.mjs:261](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:261) skips process-group inspection when that PID has ended.

   I ran the generated Python against an in-memory process/filesystem fixture: a zombie wrapper with a live child in its group returned `running:false`, `stopped:false`, and sent **no signals**. [cli.mjs:393](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:393) then treats that existing job as a successful stop operation.

   The live SIGTERM/SIGKILL fixes work for the tested cases; this finding is **partly fixed**.

   **Exact correction:** inspect remaining group members even when the wrapper has ended. Record process identity sufficiently to guard against PID/group reuse, and return failure if live members remain after stopping.

5. **Medium: missing-GPU handling is global rather than per device.**  
   [jupyter.mjs:374](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:374) considers readings current if **any** GPU still appears. In my in-memory replay, GPU 1 disappeared for 200 seconds while GPU 0 continued reporting. GPU 1 retained `lastMemMiB:8000` with **no warning**.

   **Exact correction:** track reading age per GPU, null stale current values individually, and identify which device is unknown. Preserve historical peaks separately. The original all-GPUs-missing case is fixed.

6. **Lower: several evidence descriptions still overstate precision or replication.**

   - [SKILL.md:92](/Users/alpha/skills/kaggle-notebooks/SKILL.md:92) associates “4 runs” with cancellation **and** post-restart file loss. There are four cancellation observations; the explicit restart/file-loss inspection is S4f alone.  
     **Correction:** say “four cancellation runs; file loss checked after restart in S4f.”
   - [FINDINGS.md:177](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:177) says a job was running in all those cancellation cases. S4b/S4d used the [40-minute heartbeat](/Users/alpha/skills/evaluations/2026-11-accelerators/harness/job_heartbeat.py:5), while cancellation was detected later.  
     **Correction:** base demonstrated interruption of unfinished jobs on L6/S4e/S4f.
   - Exact S1 **77.8** and S3a **41.9** cannot be independently reconstructed from the specified artifacts: launch timestamps are absent, and the session snapshot contains coarse ages without its own timestamp.  
     **Correction:** preserve the original launch evidence or use approximate ages, distinguishing session uptime from job elapsed time.
   - [COLAB-COMPARISON.md:17](/Users/alpha/skills/evaluations/2026-11-accelerators/COLAB-COMPARISON.md:17) and [line 41](/Users/alpha/skills/evaluations/2026-11-accelerators/COLAB-COMPARISON.md:41) still say **41 offline tests**; there are **53**.

The disposition of each previous finding is:

| Previous finding | Status and current evidence |
|---|---|
| `sessions-stop` targeting | **Fixed:** exact-title selection and click occur together; duplicates refuse. [driver:1138](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1138) |
| Its own tab | **Fixed:** account operations create and close a separate tab. [driver:1082](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:1082) |
| Lifetime conclusion | **Partly fixed:** mixed results and GPU limitation are honest in the evaluation; the skill remains broader. [FINDINGS:175](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:175) |
| `job stop` and exit codes | **Partly fixed:** real codes are preserved and unknown jobs fail; surviving-child case remains. [jupyter:292](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:292) |
| Output, tails, early errors | **Partly fixed:** centralized printing and early errors scrub; truncation bypass remains. [cli:115](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:115) |
| Result-loss/keep-alive advice | **Partly fixed:** polling, exporting before stopping, and committed-run restart semantics are improved; scope and checkpoint durability need correction. [SKILL:73](/Users/alpha/skills/kaggle-notebooks/SKILL.md:73) |
| Reopened-tab state | **Fixed for the demonstrated case:** server truth distinguishes busy sessions from queued TPU. [driver:711](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:711), [cli:275](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:275) |
| Missing GPU readings | **Partly fixed:** complete disappearance works; individual-device disappearance does not. [jupyter:373](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:373) |
| Local-file validation | **Fixed for the requested cases:** missing, unreadable/non-file paths and unsupported stdin fail before connecting. [cli:228](/Users/alpha/skills/kaggle-notebooks/scripts/cli.mjs:228) |
| Live/Offline labels | **Fixed:** remaining live-test gaps are explicitly identified. [FINDINGS:268](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:268) |
| Comparison over-generalization | **Fixed in substance:** source-only Colab evidence, route limitations and narrow cost evidence are disclosed. Stale test counts remain. [comparison:5](/Users/alpha/skills/evaluations/2026-11-accelerators/COLAB-COMPARISON.md:5) |

I recomputed these session-life figures directly from timestamps:

| Case | Recomputed result |
|---|---|
| L6 | Prompt **38.239 min**; pill off **40.239 min**; approximately **2 min** between detections |
| L7 | Closed **0.751 min**; reopened **10.440 min**; **17 successful CLI polls**; final progress at **94.641 min**, `beat 5670` |
| L8 | Prompt **38.040 min**; command completed **38.127 min**; dialog absent **5.22 s** after prompt detection |
| L9 | Printing at **50.060 min**, `beat 3000`, with no prompt logged |
| Clock h | Cancelled **40.550 min** after launch, **25.549 min** after closing |
| Clock g | Cancelled **61.269 min** after launch, **41.173 min** after the command |
| S4b / S4d | Cancelled **40.974 / 40.852 min** after closing |
| S4e / S4f | Cancelled **40.338 / 40.611 min** after closing |
| S4c | Alive at **68.448 min**; its completed job does not demonstrate that much job survival |
| S1 / S3a | First-observation-to-off intervals **69.423 / 46.359 min**; initial pills said **8m / 6m** |

Those support the report’s rounded new-run figures. S1/S3a are now handled honestly as unexplained exceptions, rather than erased. Possible explanations remain unrecorded interaction, browser/client acknowledgement, session configuration or service variation. None is established.

**U6’s failure is fair under the written criterion.** [PLAN.md:148](/Users/alpha/skills/evaluations/2026-11-accelerators/PLAN.md:148), registered at 06:25, explicitly required prompt handling or polling as part of the open-tab action. The no-skill agent instead said the open tab itself kept the session alive ([agent report:510](/Users/alpha/skills/evaluations/2026-11-accelerators/raw/agent-runs.md:510)). L6 strengthened the explanation; it did not retroactively create the criterion.

The skill agent supplied polling/prompt handling, despite repeating the erroneous 78-minute detail. Its run began before L6’s result; the no-skill run began afterward. The knowledge advantage is disclosed at [FINDINGS.md:243](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:243). This is a targeted regression check, not independent evidence of broad superiority. The recorded **55,610 versus 69,998 tokens**, **5 versus 18 calls**, and **68.6 versus 172.9 seconds** match the summary.

For verdict items 1–5: **1 is supported with its CPU/disk qualifications; 2 is fair and appropriately narrow; 3 follows the written split rule; 4 needs the remaining defects above; 5 needs CPU and mechanism qualification.**

Other verification was sound:

- GPU scorer: **35/35 reads**, device identity **11/11 + 10/10**, utilization median error **0**, p95 at most **1 point**, load-phase memory error **12 MiB**.
- CPU scorer: **243/243 reads**, latency **1.07 s median / 1.29 s p95**; normalized CPU error **0.40 points**; RAM-rise error **36 MiB**; disk rise **0 versus 5,120 MiB** in working, **5,120 versus 5,120 MiB** in `/tmp`.
- Session-stop retest: correct target stopped in **8 seconds**, other listed sessions unaffected. Duplicate-title behavior remains untested live.
- Offline suite: **47 passed; six blocked by sandbox `mkdtemp` restrictions**. I separately ran all six replay test bodies using an in-memory log; they passed. This is not a claim that the unmodified suite passed.
- I found no remaining cross-notebook targeting defect in the reviewed session-list/stop path.

**Sign-off: no—fix upload preservation, scrubbing before truncation, surviving-child stopping and per-GPU freshness, then narrow the lifetime claims and correct the evidence counts.**

## Round 4, final check

1. **P1 — `job stop` can signal an unrelated process group.** [jupyter.mjs:211](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:211) treats any live process at the saved PID as the wrapper. If that PID is reused, [line 295](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:295) calls `killpg` without checking job identity. **Correction:** verify the wrapper’s recorded process start time and job tag before signalling; validate surviving members when the wrapper is gone.

2. **P1 — Restarting a job can orphan survivors and truncate their log.** [jupyter.mjs:228](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:228) checks only `cur.running`. With a dead wrapper and surviving children, `job start` removes their tracking records and truncates the log. Subsequent `job stop` targets only the replacement. **Correction:** check for tagged survivors before replacing records; refuse restart until they are stopped.

3. **P2 — `runState` still cuts before scrubbing.** [driver.mjs:686](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:686) takes the last 4,000 characters before scrubbing at line 705. An in-memory check with a 4,096-character credential exposed its final 400 characters. **Correction:** scrub the complete stream before either slice, and correct the “before any cutting” claim in [FINDINGS.md:292](/Users/alpha/skills/evaluations/2026-11-accelerators/FINDINGS.md:292).

`node --test tests/`: 55 tests discovered; 48 passed, seven blocked by sandbox `EPERM` on temporary-directory creation. No files changed; no network used.

**Sign-off: No—fix process identity checks, survivor handling on restart, and the remaining cut before scrubbing.**

## Round 5, those three only

- [jupyter.mjs:207](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:207): Ownership uses substring matching. An entry such as `SAVED_KN_JOB=<name>:<start>` passes without the actual job tag, potentially authorizing `killpg` against an unrelated group. Match an exact entry in `environ.split(b"\0")`.

- [jupyter.mjs:233](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:233): A dead wrapper makes surviving work report `running: false`, as the retest demonstrates. Derive running state from live owned processes, including survivors. Restart refusal works for tagged survivors in the original group; `exec python` alone does not break monitor detection.

- [driver.mjs:689](/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs:689): The tail cut still leaks credentials whose marker precedes a newline. Verified with a long prefix followed by `token\n<secret>`: the cut removes the marker, and the secret survives scrubbing. Scrub the complete stream before either truncation.

I would not sign this off until ownership matching, survivor-based running status, and scrub-before-truncation are fixed.

## Round 6, those three only

One defect:

- [jupyter.mjs:234](/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs:234): `running` becomes false whenever `.exit` exists, even with live tagged children. A command such as `python train.py &` lets the wrapper record exit 0 while training continues. Reporting completion can prompt session shutdown and lose work. Correct to `running = bool(survivors(name, pid))`; retain the wrapper exit code separately.

Exact tag matching is correct. `runState` scrubs the entire selected stream in the page before slicing; string patterns retain their escaping. Six focused offline checks passed, plus an in-memory page-path check. Existing tests cover `scrub`/`clipOutput`, not `runState` directly.

The timed-out start click safely falls through to kernel verification; it neither retries the click nor assumes success. Retests support that path, but omit the live-child-with-exit-code case.

Sign-off: **No—make `running` depend on live tagged processes regardless of `.exit`.**

## Round 7, that one fix

No defect found in the scoped fix. `running` now depends on tagged, non-zombie survivors regardless of `.exit`. Start refuses surviving jobs; stop still terminates them; status reports them as running. `lostWithoutExitCode` remains true only when no survivors, exit code, or stop record exists. The end-to-end evidence confirms background work remains running after exit 0 and stops with zero processes left.

Sign-off: **Yes**, with `FINDINGS.md` disclosing its known limits.
