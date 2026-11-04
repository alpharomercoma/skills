---
name: kaggle-notebooks
description: Use when an AI agent needs the Kaggle web UI or notebook editor, such as creating or editing Kaggle notebooks, pasting code into cells and running them, switching GPU or TPU accelerators, running shell commands in a live Kaggle session, checking session resources or GPU quota, attaching datasets, or training on Kaggle GPUs from a terminal.
---

# Kaggle Notebooks

Drive the signed-in Kaggle editor through one CLI. The CLI and `references/ui-map.md` already hold what the page would tell you, so run commands instead of reading the DOM or taking screenshots.

**How it works:** a session is a rented VM running your notebook's kernel. Kaggle ends sessions it sees as unattended. In tests on CPU sessions, one was cancelled about 40 minutes after the last command, tab open or closed, and everything in it was lost, including `/kaggle/working`. A background job and REST calls didn't prevent that. `sh` and `job status` appear to reset the clock, and a printing cell appears to hold it off. GPU sessions weren't tested past 24 minutes, so assume the same there. Commands reach it two ways: through the page, and directly through the session's own Jupyter server, which keeps working during a busy cell.

## Setup

`$SKILL` is this file's directory. `k` below means `node $SKILL/scripts/cli.mjs`. Spell it out in each tool call, or define `k() { node "$SKILL/scripts/cli.mjs" "$@"; }` there. `K="node …"; $K` fails in zsh, and shell state may not persist between calls.

```bash
bash $SKILL/scripts/start-chrome.sh       # safe to repeat; the login survives restarts
k doctor
```

- `"signedIn": false`: ask the user to sign in, in the Chrome window that opened. Never type credentials yourself.
- `Cannot find package 'playwright-core'`: run `npm install --prefix $SKILL`.

## Commands

Commands that change anything require `--url "<notebook url>"`. If that notebook's tab is closed, `--url` opens it. Run `k` alone for full usage.

| Goal | Command |
|---|---|
| Create, inspect | `new --title T`, `status`, `tabs`, `rename T`, `visibility` |
| Replace all cells from `.py` or `.ipynb` | `push file`. A line starting `# %%` splits cells, even inside a string. Code before the first marker becomes its own cell, and a file with no markers is one cell. `# %% [markdown]` makes a markdown cell. The old notebook is saved to `~/.kaggle-agent/backups/` |
| Edit one cell (`-` reads stdin) | `cells`, `append file\|- [--markdown]`, `set-cell i file\|-`, `delete-cell i` |
| Accelerator, internet | `accel none\|t4x2\|tpu`, `internet on\|off` |
| Attach data | `add-input <full kaggle url>`, once per input, mounted under `/kaggle/input/datasets/<owner>/<name>`. Check with `sh 'ls /kaggle/input/datasets/*'` instead of repeating it, because a repeat can detach it |
| Session | `start`, `stop`, `restart`, `sessions` (every live session, even with no tab), `sessions-stop "<title>"` |
| Run | `run --wait --timeout S`, `run-cell i --wait`, `wait --timeout S`, `interrupt`, `outputs --cell i --max N --save-images DIR` |
| Shell, works during a busy cell | `sh '<bash>'`, cwd `/kaggle/working`, real exit codes |
| Python in the notebook's kernel | `exec '<python>'`, refused during a busy cell |
| Long job | `job start <name> '<command>'`, `job status <name>`, `job logs <name>`, `job stop <name>`, `job list` (only jobs begun with `job start`) |
| Copy files, checksum verified | `put <local> <session path>`, `get <session path> <local>` |
| Monitor | `resources` (one reading), `monitor start`, `monitor report`, `monitor stop` (history and warnings), `quota` (weekly hours) |
| Save | `save-version --name N`, `--quick` to skip the run |
| When broken | `selfcheck`, `map-ui`, `screenshot out.png`, `close-tab` |

`quota`, `doctor`, `tabs`, `new`, `sessions` and `sessions-stop` take no `--url`.

**Exit codes:** 0 ok; 1 failed, a cell errored, or the kernel died; 2 session lost; 3 outcome unknown, such as a tab closed during the run; 124 timed out and possibly still running.

Run one command per tool call, and keep `--timeout` below your tool's own limit.

## Workflows

**Short run.** A failed `new` must stop you, so check that `$URL` is set:
```bash
URL=$(k new --title my-run | sed -n 's/.*"url": "\(.*\)",/\1/p'); [ -n "$URL" ] || exit 1
k accel t4x2 --url "$URL"
k push train.py --url "$URL"
k run --wait --timeout 540 --url "$URL"
```
Then act on the exit code:
- **0 or 1:** read the result, `get` any files you need, then `k stop --url "$URL"`.
- **124:** the job may still be running, so don't `run` again. Run `k wait --timeout 540 --url "$URL"`. If `status` shows the session off, it has ended, so check `outputs` before deciding.

**Is the GPU really being used?** An accelerator being on doesn't mean the code uses it, and printing `cuda` proves nothing. Start `monitor` before the work, and read its warnings after:
```bash
k start --url "$URL"
k monitor start --url "$URL"
k run --wait --timeout 540 --url "$URL"
k monitor report --url "$URL"     # peak memory and use per GPU, plus warnings
k monitor stop --url "$URL"
```

**Long job:** run it as a job, so the kernel stays free, output goes to a log, and you get a real exit code. **Poll it with `job status` every 5 minutes until it ends: a background job alone doesn't keep a session alive, and neither does an open tab.** Polling that way carried a 100-minute job to completion (1 run). If you can't keep polling for the whole run, use a committed run instead, below.
```bash
k start --url "$URL"
k put train.py /kaggle/working/train.py --url "$URL"
k job start train 'python train.py' --url "$URL"
k job status train --url "$URL"      # poll this; logs are at /kaggle/working/train.log
k get /kaggle/working/model.pt ./model.pt --url "$URL"
k stop --url "$URL"
```

**Must survive with no browser:** use `kaggle kernels push` from the official CLI, or `save-version`. Those start a new run on Kaggle's side, from the top. They can't adopt a job that's already running. A `job` lasts only as long as its session. `save-version` returns once the run is queued. Follow either one with `kaggle kernels status <user>/<slug>` or `kaggle kernels logs -f <user>/<slug>` (a live log, typically under 1 s behind once running), and fetch results with `kaggle kernels output <user>/<slug> -p <dir>`. A committed run has no resource view.

## Measured limits

On CPU sessions, on one account, on 2026-11-04, unless noted. Kaggle can change any of this.

| Limit | Measured |
|---|---|
| Sessions at once | 5 CPU and 1 GPU, on this account. `start` reports the cap within seconds; find the others with `sessions` |
| Quota | About 1 hour per session hour for T4 x2, even with both GPUs idle (0.37 h over 0.377 h). An estimate: it once fell by 0.13 h. Check with `quota` |
| Background job, tab open, no commands | `Are you still there?` prompt at 38 minutes. Unanswered, the session was cancelled by 40 minutes, and the job with it (1 run). Two earlier open-tab sessions lasted longer, for reasons not established, so don't rely on the tab |
| Background job, tab closed, no commands | Cancelled about 40 minutes in (4 runs). REST calls and an open WebSocket didn't help. A restart found the job, log and `/kaggle/working` gone (checked once) |
| One command | Moved the cut-off: a command at 20 minutes, then nothing, was cancelled about 61 minutes in (1 run). One `job status` also cleared the prompt within 5 s, and that session ran on (1 run) |
| Foreground cell, tab open, no commands | No prompt, and still printing at 60 minutes (1 run) |
| RAM | 30 GiB. Going over kills the kernel with no error in the cell |
| TPU | Requests sit in a queue, not billed, with the pill showing only `Starting …`; `sessions` shows `queued`. One waited nearly 4 hours and never started, so TPU sessions themselves are untested. `start` returns 124 while queued, and `sessions-stop` cancels the request |

**Reading `resources`:**
- `cpuPercent` adds up across cores: 400 means all 4 cores at full use.
- `disk` does **not** include `/kaggle/working`. That folder has its own limit, about 19.5 GiB usable, and the panel can look fine while it is full. Use `monitor report` or `sh 'df -h /kaggle/working'`.
- On a tab reopened during a busy cell, Kaggle shows no panel, so `resources` fails and says so. The session is fine: use `sh 'nvidia-smi'` or `monitor`.

## Rules

**Do:**
- Run `stop` when the work is finished, after `get`ting what you need, and check `sessions` for anything left running. Idle sessions spend quota. Poll only while a job is running, because commands answer Kaggle's idle prompt, and so keep a session spending. Don't hold a session open for possible later work.
- Run `quota` before long GPU work.
- Write checkpoints to `/kaggle/working`, and `get` the important ones regularly, because a cancelled session loses that folder. Treat exit 3 as unknown: check those files before re-running anything.

**Don't:**
- Don't switch accelerator on a live session. It ends the session and anything in it, and does not restart. `accel` refuses unless you `stop` first or pass `--force`.
- Don't close the tab or Chrome during a run. A foreground run's later output is lost, and the session may be cancelled.
- Don't request hardware through the official CLI and assume you got it. `NvidiaL4`, `NvidiaL4X1` and `NvidiaH100` were accepted and silently ran on T4. Check with `nvidia-smi`.
- Don't run two commands at once that use the same notebook's menus. `sh`, `job` and `resources` are safe alongside a run.
- Don't write Playwright to edit cells, or call `context.save()`. Edits made before Kaggle finishes loading are discarded, and `context.save()` clears the dirty flag and sends nothing. `push` and the cell commands handle both, and `draftSaved: true` means Kaggle stored the edit.
- Don't print frame URLs or the Kaggle Jupyter Server URLs. They carry session tokens.
- Don't sign in to anything else in this Chrome. Any local process can drive it.
- Don't run `delete`, make a notebook public, share it, or touch notebooks you did not create, unless the user asked for that specific action. `delete --confirm <exact title>` cannot be undone.

## When it breaks

- **`Kaggle's editor has crashed` (pill `Fatal`, dialog `Oops something went wrong`):** run `close-tab`, then check `status` and `cells` with `--url`. Unsaved edits are gone, but the session may have survived, so check its files before re-running anything.
- **`No live session`, or a tab has gone:** tabs can vanish. Run `sessions`. If yours is `running`, any `--url` command reopens its tab, and `job status` still works. If it is `cancelled`, the session and its files are gone, so restart from your last download or version.
- **A command fails on a selector:** run `selfcheck`, which names each anchor that moved and lists what it did not check. Use `map-ui` to see the new labels, fix `scripts/driver.mjs`, and update `references/ui-map.md`.

Read `references/ui-map.md` for anything the CLI doesn't cover. Run `node --test $SKILL/tests/` after changing the scripts.

## Use the official CLI instead for

`kaggle kernels push` for unattended batch runs, plus `kaggle kernels output`, `kaggle kernels logs`, `kaggle datasets` and `kaggle competitions`. They need no browser, but have no live session or resource view.
