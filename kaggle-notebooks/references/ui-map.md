# Kaggle notebook editor: UI map

Verified live on **2026-11-04** with Chrome 156. Read this for anything the CLI does not cover, or when `selfcheck` reports that an anchor moved. Refresh it with `map-ui`.

## Contents
1. Page structure
2. Toolbar
3. Session pill and resources panel
4. Menus
5. Panels and dialogs
6. JupyterLab inside the iframe
7. How saving works
8. Run state
9. Shell access
10. Timings
11. Not verified

## 1. Page structure

| Layer | Holds | Reach it with |
|---|---|---|
| Kaggle page (main frame) | menus, toolbar, pill, panels | role and label locators on `page` |
| JupyterLab (iframe) | cells, kernel, outputs | `frame.evaluate()` on `window.jupyterapp` |

- Identify the iframe by probing frames for `window.jupyterapp`. Its name is `notebook-editor-cells`, but name and url can read empty over CDP.
- The iframe url, and `serviceManager.serverSettings.baseUrl`, hold a session token. Never print them.
- There are no `data-testid` attributes. Durable anchors are `aria-label` and exact text.
- Editor url: `https://www.kaggle.com/code/<user>/<slug>/edit`. Naming a new notebook sets its slug.
- Page title is the generic `Kaggle Notebook Editor`. The real title is in `input[aria-label^="Title:"]`.

## 2. Toolbar

Use `getByRole('button', { name })`.

| Target | Accessible name | Notes |
|---|---|---|
| Run All | `Run All` | also boots a cold session |
| Run current cell | `Run current cell` | |
| Add, cut, copy, paste cell | `Add cell`, `Cut cell`, `Copy cell`, `Paste cell` | |
| Cell type | `Show options` | shows `Code` or `Markdown` |
| Save Version | `Save Version` | opens a side panel |
| Versions badge | `Show Versions` | text is the count; lags several seconds |
| Share | text contains `Share` | opens a side panel |
| Console, palette | `Open console`, `Open command palette` | bottom bar |
| More | `More settings` | |

Menu buttons have no aria-label, so match the exact text with an anchored regex: `File`, `Edit`, `View`, `Run`, `Settings`, `Add-ons`, `Help`.

**Blockers:**
- An open menu or dialog marks the page `aria-hidden`, so role lookups for toolbar buttons return nothing.
- One Escape closes only a submenu. Press until no `[role="menuitem"]` is visible.
- A click on a menu button sometimes does not open it. Confirm a menuitem is visible, and retry.
- The cookie banner `OK, Got it.` is a plain `div`, not a button. Match it by text.

## 3. Session pill and resources panel

The pill is the `button` containing `Draft Session`. Its text starts with the icon word `circle`.

| Pill text | Meaning |
|---|---|
| `Draft Session off (run a cell to start)` | off |
| `Draft Session Waiting for Jupyter …`, `Booting the kernel …`, `Starting …`, `Running` | coming up |
| `Draft Session (4m) HDD CPU RAM`, plus `GPU GPU` on T4 | live; metrics flowing |

`Starting …` also appears after a tab reconnects to a session that is running a job, and the popover is then empty. A queued TPU session reads the same, so ask the server (`serverKernel`) or use Active Events to tell them apart.

`Draft Session Fatal` means the editor crashed; see section 7.

Clicking the pill opens a popover, which comes from Kaggle's metrics and works during a busy kernel. It is empty for a few seconds after boot, and it ignores Escape. Close it with `button[aria-label="Close"]`. The first click after that Close button does nothing, so check and click again. Use a DOM click, because a tooltip can cover the pill. Its `innerText` has one value per line; it reads like this:

```
Draft Session
GPU T4 x2 On                 (or: No Accelerator)
Session  0m   12 hours
Disk     2GiB   Max 57.6GiB
CPU      78.00%
RAM      563.6MiB   Max 30GiB
GPU      0.00%               (repeated per GPU)
GPU Memory  0Bytes   Max 15GiB
```

**Accuracy, measured against `nvidia-smi` and `psutil` (2026-11-04):**

| Value | Result |
|---|---|
| GPU utilisation | 0 points median error; entries stay in device order, 0 then 1 |
| GPU memory | 12 MiB error at most, under load |
| RAM | 36-76 MiB error on an 8 GiB rise. `Max 30GiB` is the real limit (`memory.max`); `psutil` reports the host's 31.3 GiB |
| CPU | Adds up across cores: 398% with all 4 cores at 100%. Divide by the core count |
| Disk | **Excludes `/kaggle/working`.** Writing 5 GiB there moved it by 0; 5 GiB in `/tmp` moved it by exactly 5 GiB. It read 2 GiB while `/kaggle/working` was 100% full |
| Freshness | GPU memory 6-12 s and utilisation 11-16 s, read every 7-10 s. CPU, RAM and disk 3-7 s, read every 2.6 s |

## 4. Menus

Rows are `[role="menuitem"]`. `innerText` begins with an icon word such as `memory` or `delete` that the accessible name lacks, so match accessible names with a regex that omits it.

**Settings**
- `Turn off internet` or `Turn on internet`. The row offers the opposite of the current state. No dialog, and it takes effect on a live session.
- `Accelerator ▸`: hover, don't click. Rows are `None`, `GPU T4 x2`, `TPU v5e-8`. The active row starts with `check `. GPU P100 no longer exists.
- `Environment Preferences ▸`: `Pin to original environment`, `Always use latest environment`.

**Selecting an accelerator**
- T4 and TPU open a dialog with buttons `Cancel` and `Turn on <label>`. Its text gives remaining hours (`You have 29 hours remaining`, rounded).
- `None` has no dialog.
- Any switch **ends a live session and leaves it off**, including detached jobs in it. Run `start` afterwards. Selecting the one already active changes nothing.
- Selection matches real hardware: `GPU T4 x2` gave 2 Tesla T4 with 15360 MiB each, and `None` gave no GPU.

**Run**
`Run current cell`, `Run all`, `Run before`, `Run selected`, `Run current and after`, `Run selected cells and insert below`, `Run selected text or current line in console`, `Factory reset`, `Restart & clear cell outputs`, `Start session` or `Stop session` (no dialog), `Kaggle Jupyter Server`, `Schedule a notebook run`.

**File**
`New Notebook`, `Import Notebook`, `Download Notebook`, `Link to Colab`, `Open in Colab`, `Link to GitHub`, `Set as Utility Script`, `Set as Benchmark Task`, `Add input`, `Upload input ▸` (`Upload dataset`, `Upload model`), `Editor Type ▸` (`Notebook`, `Script`), `Share`, `Save Version`, `Version history`, `Rename Notebook`, `Delete Notebook`.

**Edit**
`Move cell up`, `Move cell down`, `Delete cell`, `Undo`, `Redo`, `Cut cells`, `Copy cell`, `Paste cells below`, `Paste cells above`, `Paste cell and replace`, `Select all cells`, `Deselect all cells`, `Split cell`, `Merge cells`, `Clear output`, `Clear all outputs`, `Find...`, `Find next...`, `Find previous...`.

**View**
`Toggle line numbers`, `Toggle output scrolling`, `Toggle word wrap`, `Toggle XL font size`, `Theme settings`, `Hide toolbar`, `Show sidebar` or `Hide sidebar`, `Show console` or `Hide console`, `Hide cell from viewers ▸` (`Hide input`, `Hide output`), collapse and expand items, `Activate command palette`.

**Add-ons**
`Secrets`, `Google Cloud Services`, `Google Cloud SDK`, `Install Dependencies`.

**Help**
`Docs`, `API`, `Feedback`, `About`.

## 5. Panels and dialogs

| Item | Type | Details |
|---|---|---|
| Rename | `role="dialog"` | one `input`; buttons `Cancel`, `Confirm` |
| Delete | `role="dialog"` | text names `'<title>'`; buttons `Cancel`, `Yes, delete`; cannot be undone |
| Save version | side panel, not a dialog | `Version Name` field, `Version Type` select (`Save & Run All (Commit)` is the default, or Quick Save), `Advanced Settings`, `Cancel`, `Save` |
| Share | side panel, not a dialog | cards `Private` (default) and `Public`, people search, `Allow Comments`, `Cancel`, `Save`. Never click `Public` or `Save` without an explicit request |
| Add Input | panel | placeholder `Search keyword or URL`; tabs `All`, `Your Work`, `Datasets`, `Models`, `Competition Datasets`, `Notebook`, `Utility Scripts`; result buttons `aria-label="Add Dataset <title>"` |
| Secrets | drawer | lists secrets; never read their values |
| Idle prompt | `role="dialog"` | `Are you still there?`, "You haven't made changes within your interactive session in over 40 minutes", with `Cancel` and `Continue editing`. Editor commands answer it with `Continue editing` |
| Session cap | `role="dialog"` | `CPU Session cap reached` or `GPU Session cap reached`, with `Cancel` and `Manage active sessions`. Limits: 5 CPU, 1 GPU |
| Active Events | panel, `#active-events-panel`, toggled by `button[aria-controls="active-events-panel"]` | One row per session or version with a state: `Running: <time>`, `Queued`, `Cancelled` or `Successful`. Row menu `button[aria-label="More options for <title>"]` offers `Edit` and `Stop Session`. It also lists finished runs. The first `More options` button on the page, "this notebook", is not in this panel |
| Kaggle Jupyter Server | drawer | `Open in Colab`, `Colab Compatible URL`, `VSCode Compatible URL`. Both urls carry a token |
| Sidebar (`Show sidebar`) | right column | `Input` (`Add Input`, `Upload`), `Output (72KiB / 19.5GiB)` with `/kaggle/working`, `Table of contents`, `Session options`, `Schedule a notebook to run` |
| Console | bottom panel | `textarea[placeholder="Enter console command here"]`. It runs in the kernel and also shows silent-exec output. `sh` and `exec` are more reliable, because DOM reads can drop lines |

A committed run (`Save & Run All`) uses its own session. Check it with `kaggle kernels status <user>/<slug>`, and follow it with `kaggle kernels logs -f <user>/<slug>`, which was about 0.2 s behind once running (one first line took 9.2 s).

## 6. JupyterLab inside the iframe

```js
const app = window.jupyterapp;
const panel = [app.shell.currentWidget, ...app.shell.widgets('main')].find((w) => w?.content?.model?.sharedModel);
const nb = panel.content;                  // Notebook
const shared = nb.model.sharedModel;       // YNotebook
const kernel = panel.sessionContext.session.kernel;
```

- **Wait for `panel.context.isReady` first.** Until then the model is a placeholder with one empty cell.
- Replace all cells: `shared.transact(() => { shared.deleteCellRange(0, shared.cells.length); cells.forEach((c, i) => shared.insertCell(i, c)); })`.
- Per cell: `shared.cells[i].getSource()`, `.setSource(s)`, `.toJSON()`.
- Commands that work once a kernel exists: `notebook:run-cell`, `notebook:run-all-cells`, `notebook:interrupt-kernel`, `notebook:clear-all-cell-outputs`. The promise from `notebook:run-cell` lasts as long as the cell, so don't await it.

## 7. How saving works

Measured with edit, then reload, then compare.

- After an edit, `Draft saved` vanishes. A save is `GetKernel`, a blob upload to `/upload/storage/`, then `UpdateKernelDraft`, 2-31 s after the edit.
- **`Draft saved` is also absent until Kaggle finishes loading the notebook. An edit made in that window is discarded, even though the later save returns 200.** With the label showing before the edit, 23 of 23 edits persisted.
- `panel.context.save()` resolves in milliseconds and clears the dirty flag without sending anything. The edit is then lost.
- A transient `UpdateKernelDraft` 400 can occur, and Kaggle retries it.
- Only an upload begun after the edit can contain it, so `editAndSave` in `driver.mjs` counts only that.

**Kaggle's data-loss guard.** Replacing 3 or more cells with exactly 1 in one step throws the page error `An error was prevented that could have led to data loss`. The pill turns `Fatal`, the dialog `Oops something went wrong` appears with `Refresh` and `Download`, and that edit never saves.

| Change in one step | Result |
|---|---|
| 3 to 1, 4 to 1, 3 large to 1 large | crash |
| 2 to 1, 3 to 2, 4 to 2, 5 to 2, 6 to 3, 6 to 5, 7 to 2 | saved |
| 3 large to 3 tiny (size only) | saved |
| 3 to 2, then 2 to 1, saving between | saved |

`push` takes the two-step route. Recover from a crash by closing the tab and reopening; the session and earlier saved edits survive.

## 8. Run state

- `nb.widgets[i].promptNode.textContent` reads `[*]:` for running or queued cells, `[n]:` when done, `[ ]:` when not run. `[*]` stays set between cells, while kernel status can dip to idle.
- Execution counts alone read a previous run as finished. `notebook:clear-all-cell-outputs` resets them.
- An error stops the run: later cells stay `[ ]:`, and the kernel goes idle.
- Interrupt is recorded as an `error` output with `ename: 'KeyboardInterrupt'`.
- **Reopening a tab during a job:** the page reads the kernel as `unknown` and the pill `Starting …` until the job ends, because a busy kernel cannot answer it. Prompts come back empty, and output from then on is not recorded. The job itself continues. The server still knows: `GET /api/kernels` gives the true `execution_state`.
- **RAM exhaustion:** the kernel dies with no error in the cell, reads `connecting` for about 30 s, and returns `idle` with a new process and no variables. `memory.events` in `/sys/fs/cgroup` counts it as `oom_kill`. `memory.max` is 30 GiB.

## 9. Shell access and the Jupyter server

Every session runs a Jupyter server, the one Kaggle offers to external editors under Run > Kaggle Jupyter Server. Its base url is `window.jupyterapp.serviceManager.serverSettings.baseUrl` and the drawer's path variant, which is the same. **It carries a token, so never print it.** From Node it works with no browser cookies:

| Call | Result | Use |
|---|---|---|
| `GET /api/kernels`, `/api/sessions` | 200 | True `execution_state`, `last_activity` and `connections`, with no UI |
| `POST /api/kernels` | 201 | A sidecar kernel, ready in about 2 s, 103 MiB |
| `WS /api/kernels/<id>/channels` | 101 | Run code in it, JSON protocol, no origin needed |
| `GET`, `PUT /api/contents/<path>` | 200, 201 | Files, but rooted at `/kaggle/working` only. Base64 round trip verified |
| `POST /api/terminals` | 200 | Created, but unusable: its WebSocket is 404 at Kaggle's proxy on every url form tried. **So there is no interactive shell** |

From inside the page, the same `POST /api/kernels` and `terminals.startNew()` return 500. Use Node.

- **Sidecar latency:** 558 ms median with the notebook kernel idle, and 557 ms during a busy cell, so it is unaffected. This is what `sh`, `job`, `monitor`, `put` and `get` use.
- **Run commands in their own process group** (`start_new_session=True`). Then removing the sidecar can't kill what it started, and a timeout can kill the whole group.
- `kernel.requestExecute({ code, silent: false, store_history: false, allow_stdin: false })` from the page runs in the notebook's kernel without touching cells or counts, and is what `exec` uses. Output is mirrored in the Console panel. Requests queue behind a busy cell.
- `cd x && nohup y &` backgrounds the whole list, which holds the output pipe open, so the command blocks until the job ends. Write `cd x; nohup y > log 2>&1 < /dev/null &`.
- Move files with `put`, not a heredoc. A file containing the heredoc delimiter would run its remaining lines as shell.

## 10. Timings

| Step | Observed |
|---|---|
| Open editor to `context.isReady` | 4-5 s |
| Open editor to `Draft saved` | 4-7 s |
| Cold session, CPU or T4 | 19-25 s |
| Accelerator switch | 2-5 s |
| Stop session | under 2 s |
| Edit to stored draft | 2-31 s; about 44 s during a busy cell |

Environment on 2026-11-04: T4 x2 has two GPUs with 15 GiB each. Sessions have a 12-hour limit in the panel, 30 GiB RAM, a 57.6 GiB disk figure in the panel, and 4 CPUs. The panel's disk figure counted `/tmp` and not `/kaggle/working`; other paths weren't checked. `/kaggle/working` is its own volume, 19,987 MiB usable. Weekly quota is 30 h GPU and 20 h TPU, resetting at `refreshAt` from `kaggle quota`. Kaggle's docs give 9 hours for TPU sessions.

Quota was measured at about 1 hour per session hour for T4 x2, not 1 per GPU: 0.37 h over 0.377 h with both GPUs idle, and 0.24 h over 0.25 h earlier. It is an estimate: it once fell from 1.26 h to 1.13 h with no action that explains it.

**Session life, measured on CPU, 2026-11-04.** Times are when a poll first saw the change. Details are in `evaluations/2026-11-accelerators/FINDINGS.md` in this repo.

| Case | Outcome |
|---|---|
| Job, tab open, no commands, prompt unanswered | Prompt at 38 min. Cancelled by 40 min, and the job lost (1 run) |
| Job, tab closed within a minute, no commands | First seen cancelled at 40-41 min (4 runs), including with REST reads every 5 min, or a kernel WebSocket held open. A restart found no process and an empty `/kaggle/working` |
| Job, tab closed at 15 min, no commands | Cancelled at 40.6 min, so the clock doesn't run from closing |
| Job, tab closed, one sidecar command at 20 min | Cancelled at 61.27 min, about 40 min after the command |
| Job, polled through the CLI every 5 min | A 100 min job finished with exit 0 |
| Job, sidecar command every 5.8 min, no tab | Alive at 68.4 min, then stopped by hand |
| Job, prompt answered by one `job status` | Dialog gone within 5 s, session alive at 56 min |
| Foreground cell, tab open, no commands | No prompt, printing at 60 min |
| Idle or job, tab open, no commands, earlier in the day | Two sessions outlasted this cut-off, one until 77.8 min and one to 52 min when stopped. Not explained |

While a session is open, the page calls `kernels.KernelsService/UpdateKernelSessionKeepalive`, twice in a 90 s watch. It is private, and calling it directly wasn't tested. The source of the panel's numbers wasn't identified: no readable response carried them.

## 11. Not verified

- Repeating `add-input`. A new search always labels the row `Add`, even when the input is attached, and the label reads `Remove` only right after a click. In the one repeat tried, the second click was not confirmed and the input was missing from the next session, so it probably detached. Attaching while the session is off does persist to the next session.
- What the UI shows when quota is exhausted.
- `Factory reset`, `Schedule a notebook run`, `Install Dependencies`, `Upload` and removing an input are mapped but not driven.
- The 12-hour limit itself, which is too long to test.
