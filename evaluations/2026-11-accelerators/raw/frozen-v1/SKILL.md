---
name: kaggle-notebooks
description: Use when an AI agent needs the Kaggle web UI or notebook editor, such as creating or editing Kaggle notebooks, pasting code into cells and running them, switching GPU or TPU accelerators, running shell commands in a live Kaggle session, checking session resources or GPU quota, attaching datasets, or training on Kaggle GPUs from a terminal.
---

# Kaggle Notebooks

Drive the signed-in Kaggle editor through one CLI. The CLI and `references/ui-map.md` already hold what the page would tell you, so run commands instead of reading the DOM or taking screenshots.

## Setup

`$SKILL` is this file's directory. `k` below means `node $SKILL/scripts/cli.mjs`. Spell it out in each tool call, or define `k() { node "$SKILL/scripts/cli.mjs" "$@"; }` there. `K="node …"; $K` fails in zsh, and shell state may not persist between calls.

```bash
bash $SKILL/scripts/start-chrome.sh       # safe to repeat; the login survives reboots
k doctor
```

- `"signedIn": false`: ask the user to sign in, in the Chrome window that opened. Never type credentials yourself.
- `Cannot find package 'playwright-core'`: run `npm install --prefix $SKILL`.

## Commands

Commands that change anything require `--url "<notebook url>"`. If that notebook's tab is closed, `--url` opens it. `quota`, `doctor`, `tabs` and `new` take no `--url`. Run `k` alone for full usage.

| Goal | Command |
|---|---|
| Create, inspect | `new --title T`, `status`, `tabs`, `rename T`, `visibility` |
| Replace all cells from `.py` or `.ipynb` | `push file`. A line starting `# %%` splits cells, even inside a string. Code before the first marker becomes its own cell, and a file with no markers is one cell. `# %% [markdown]` makes a markdown cell. The old notebook is saved to `~/.kaggle-agent/backups/` |
| Edit one cell (`-` reads stdin) | `cells`, `append file\|- [--markdown]`, `set-cell i file\|-`, `delete-cell i` |
| Accelerator, internet | `accel none\|t4x2\|tpu`, `internet on\|off` |
| Attach data | `add-input <full kaggle url>`, once per input, mounted under `/kaggle/input/datasets/<owner>/<name>`. Check with `sh 'ls /kaggle/input/datasets/*'` instead of repeating it, because Kaggle's search can't show that an input is already attached, and a repeat can detach it |
| Session | `start`, `stop`, `restart` |
| Run | `run --wait --timeout S`, `run-cell i --wait`, `wait --timeout S`, `interrupt`, `outputs --cell i --max N` |
| Shell and Python in the session | `sh '<bash>'`, `exec '<python>'`, either with `--file F` |
| Copy a local file to the session | `put <local> <path in session>` |
| Monitor | `resources` (live CPU, RAM, disk, GPU), `quota` (weekly hours) |
| Save | `save-version --name N`, `--quick` to skip the run |
| When broken | `selfcheck`, `map-ui`, `screenshot out.png`, `close-tab` |

**Exit codes:** 0 ok; 1 failed or a cell errored; 2 session lost; 3 outcome unknown, such as a tab closed during the run; 124 timed out and possibly still running.

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
- **0 or 1:** read the result, then `k stop --url "$URL"`.
- **124:** the job may still be running, so don't `run` again. Check `k status --url "$URL"`. If `busy` is true, run `k wait --timeout 540 --url "$URL"`. If the session is off, it never started or has ended, so check `outputs` before deciding.

**Long job.** Detach it, so the kernel stays free and output survives on disk. Write `cd x; nohup …` exactly like this, because `cd x && nohup … &` blocks until the job ends.
```bash
k start --url "$URL"
k put train.py /kaggle/working/train.py --url "$URL"
k sh 'cd /kaggle/working; nohup python train.py > train.log 2>&1 < /dev/null & echo $!' --url "$URL"
k sh 'tail -n 20 /kaggle/working/train.log; pgrep -af train.py' --url "$URL"    # poll this
```
When the log shows it finished, run `k stop --url "$URL"`.

## Rules

**Do:**
- Run `stop` when finished. A live session spends quota even when idle, up to the 12-hour limit.
- Run `quota` before long GPU work, and `resources` to watch it. `resources` works during a busy cell; `sh` and `exec` do not.
- Write logs and checkpoints to `/kaggle/working`. Treat exit 3 as unknown, and check those files before re-running anything.

**Don't:**
- Don't switch accelerator on a live session. It ends the session and anything in it, including detached jobs, and does not restart. `accel` refuses unless you `stop` first or pass `--force`.
- Don't close the tab or Chrome during a foreground run. The job continues, but all later output is lost from the notebook.
- Don't run two commands at once against one notebook. They fight over the same menus.
- Don't write Playwright to edit cells, or call `context.save()`. Edits made before Kaggle finishes loading are discarded, and `context.save()` clears the dirty flag and sends nothing. `push` and the cell commands handle both, and `draftSaved: true` means Kaggle stored the edit.
- Don't print frame URLs or the Kaggle Jupyter Server URLs. They carry session tokens.
- Don't sign in to anything else in this Chrome. Any local process can drive it.
- Don't run `delete`, make a notebook public, share it, or touch notebooks you did not create, unless the user asked for that specific action. `delete --confirm <exact title>` cannot be undone.

## When it breaks

- **`Kaggle's editor has crashed` (pill `Fatal`, dialog `Oops something went wrong`):** run `close-tab`, then check `status` and `cells` with `--url`. Unsaved edits are gone, but the session may have survived, so check its files before re-running anything.
- **A command fails on a selector:** run `selfcheck`, which names each anchor that moved. Use `map-ui` to see the new labels, fix `scripts/driver.mjs`, and update `references/ui-map.md`.

Read `references/ui-map.md` for anything the CLI doesn't cover.

## Use the official CLI instead for

`kaggle kernels push` for unattended batch runs, plus `kaggle kernels output`, `kaggle datasets` and `kaggle competitions`. They need no browser, but have no live session, shell or resource view.
