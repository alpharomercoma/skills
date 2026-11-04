# `kaggle-notebooks` compared with `google-colab-cli`

Compared with the source of [`googlecolab/google-colab-cli`](https://github.com/googlecolab/google-colab-cli), commit `463fd36` (2026-11-03), and v0.7.4 installed on this machine.

**How much of this is verified:** the Colab column comes from its source code and docs. The CLI wasn't signed in on this machine, so none of its behaviour was run. The Kaggle column was measured live; see `FINDINGS.md`.

They are not direct competitors. Colab's CLI can't reach Kaggle, and this skill can't reach Colab. The comparison asks which of its ideas are worth having on Kaggle, and where this skill is already ahead.

## The basic difference

| | `google-colab-cli` | `kaggle-notebooks` |
|---|---|---|
| Way in | Google's session API (`/tun/m/assign`), with OAuth or Application Default Credentials | A signed-in browser, then the session's own Jupyter server. The official Kaggle CLI (2.2.4) has no interactive session commands |
| Needs a browser | No | Yes, to start and control sessions |
| Works without a desktop | Yes, on Linux and macOS | No: it starts Chrome on macOS |
| Source size | 5,743 lines of Python | About 2,400 lines of JavaScript |
| Tests | 338 test functions in 9,083 lines, plus 9 live scenarios | 58 offline tests, plus this evaluation's live tests |

## Where this skill helps and Colab's doesn't

| Capability | `google-colab-cli` | `kaggle-notebooks` |
|---|---|---|
| Live GPU use and memory | None. No `nvidia-smi`, `psutil` or utilisation anywhere in `src/`. `colab status` gives hardware, and an idle or busy flag from local state | `resources` matched `nvidia-smi` in load tests: utilisation median error 0 and p95 at most 1 point, memory within 21 MiB. `monitor` adds peaks and warnings |
| Is training really on the GPU? | Up to the agent | `monitor report` warns when no GPU is used while the CPU is busy, or when one of two GPUs is unused |
| Kernel killed by running out of memory | Raises an error when the kernel reports `dead` or `restarting` (`runtime.py:27, 320`), without saying why | Reports the restart, and reads the kill count from `memory.events`. If the kernel died while nothing was watching, it reports outcome unknown (exit 3) |
| Durable notebooks | Notebooks are inputs; results go to a local `_output.ipynb` | Edits, drafts and versions in a persistent notebook |
| Edit confirmed as saved | Not applicable | `draftSaved: true` only after an upload begun after the edit, then a 200 |
| Writing to the wrong notebook | With one session, `-s` can be left out; a wrong name errors | `--url` is required for any change to a notebook, and an empty value is refused. The exception is `sessions-stop`, which targets one live session by exact title |
| Busy kernel | `exec` does not check, and queues behind a running cell. `running` is local state only | `exec` refuses, and `sh` runs alongside through a sidecar |
| File copy verification | No checksum on upload or download (`contents.py`) | SHA-256 both ways |
| Weekly quota | `colab usage` gives compute units and rate | `quota`, through Kaggle's official CLI, plus the measured rate |

## Where Colab's is ahead

| Capability | `google-colab-cli` | `kaggle-notebooks` | Decision |
|---|---|---|---|
| **No browser needed** | API plus OAuth | Chrome on macOS, with a sign-in by hand | **No supported route found.** Kaggle's public API and CLI have no session commands. The browser uses private endpoints (`kernels.KernelsService/...`); calling those directly was not tested, and they could change without notice |
| **Interactive shell** | `console` (tmux over `/colab/tty`) and `ssh` | None | **Not available on the routes tried.** A terminal can be created over REST, but its WebSocket gave 404 at Kaggle's proxy on every url form tested. `sh` and `job` cover non-interactive use |
| **One command that always cleans up** | `colab run`: new, exec, stop in a `finally` (`run.py:448-458`) | Separate commands, so the agent must remember to `stop` | **Not built.** All 4 fresh agents that started an interactive session also stopped it, and `sessions` finds leftovers. The remaining risk is an agent losing context, and a Kaggle tab can also vanish mid-run, which a `finally` wouldn't survive. Reconsider if a real run leaves sessions spending quota |
| **Session history** | `colab log`, with export to `.ipynb`, `.md`, `.txt`, `.jsonl` | None | Not built: no measured need. A cost if an agent loses context |
| **Test coverage** | Large suite and live scenarios | 58 offline tests | Partly closed. Still far behind |
| **Editing a remote file** | `colab edit` | `get`, edit, `put` | Not built: agents don't need `$EDITOR` |
| **High-RAM shapes** | `--high-mem` | Not offered by Kaggle's UI | Not applicable |
| **Plots** | `--output-image` | Added: `outputs --save-images` | **Closed** |
| **File download** | `colab download` | Added: `get` | **Closed**, with a checksum as well |
| **Session list, including orphans** | `colab sessions`, from the server | Added: `sessions` and `sessions-stop` | **Closed** |
| **Kernel death during a run** | Detected | Added | **Closed**, with a measured cause as well |
| **Allocation refused** | Clear message at once (`session.py:144`) | Was a silent wait until timeout. Now a clear error in 4-6 s | **Closed** |
| **Accelerator not available** | Clear message on a 400 (`session.py:163`) | Selection and hardware agree in the UI; see `FINDINGS.md` on the official CLI's silent downgrade | Documented |
| **Bundled guide** | `colab skill` prints it | `SKILL.md` | Equal |

## Ideas taken from its source

These came from reading the code. The first two were tested live on Kaggle. The third is a local check:

1. **The Jupyter API works directly with a token.** Colab uses it for kernels and files. That led to testing the same on Kaggle, which is where the sidecar kernel came from.
2. **Fail on `dead` and `restarting`.** Its `_KERNEL_GONE` check prompted the test that found this skill's weakest failure message.
3. **Validate before spending.** Its `AGENTS.md` says to check locally before allocating anything billable. Arguments and local input files are now checked before connecting, with offline tests (`push`, `append`, `set-cell`, `put`, `exec --file`, `sh --file`). Checks that need the notebook, such as a cell index, still run after connecting.

## Ideas tested and rejected

| Idea | Result on Kaggle |
|---|---|
| Real terminal over `/terminals/websocket` | Created over REST, then 404 at Kaggle's proxy on every url form tested |
| Contents API for file transfer | Works, but only inside `/kaggle/working`. The sidecar route reaches any path, so it is the one used |

## Its agent guide

Its `colab-operator` skill is worth learning from. It opens with a mental model ("a session is a live Jupyter kernel on a rented VM"), names the top blocker (authentication), and has an explicit recovery section. Where this skill's `SKILL.md` was a command list, those were the parts it lacked.
