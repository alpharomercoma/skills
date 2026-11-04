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

`Starting …` also appears after a tab reconnects to a session that is running a job.

`Draft Session Fatal` means the editor crashed; see section 7.

Clicking the pill toggles a popover, which comes from Kaggle's metrics and works during a busy kernel. It is empty for a few seconds after boot, and it ignores Escape. Close it with `button[aria-label="Close"]`. Its `innerText` has one value per line; it reads like this:

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

## 4. Menus

Rows are `[role="menuitem"]`. `innerText` begins with an icon word such as `memory` or `delete` that the accessible name lacks, so match accessible names with a regex that omits it.

**Settings**
- `Turn off internet` or `Turn on internet`. The row offers the opposite of the current state. No dialog, and it takes effect on a live session.
- `Accelerator ▸`: hover, don't click. Rows are `None`, `GPU T4 x2`, `TPU v5e-8`. The active row starts with `check `. GPU P100 no longer exists.
- `Environment Preferences ▸`: `Pin to original environment`, `Always use latest environment`.

**Selecting an accelerator**
- T4 and TPU open a dialog with buttons `Cancel` and `Turn on <label>`. Its text gives remaining hours (`You have 29 hours remaining`, rounded).
- `None` has no dialog.
- Any switch **ends a live session and leaves it off**, including detached jobs in it. Run `start` afterwards.

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
| Kaggle Jupyter Server | drawer | `Open in Colab`, `Colab Compatible URL`, `VSCode Compatible URL`. Both urls carry a token |
| Sidebar (`Show sidebar`) | right column | `Input` (`Add Input`, `Upload`), `Output (72KiB / 19.5GiB)` with `/kaggle/working`, `Table of contents`, `Session options`, `Schedule a notebook to run` |
| Console | bottom panel | `textarea[placeholder="Enter console command here"]`. It runs in the kernel and also shows silent-exec output. `sh` and `exec` are more reliable, because DOM reads can drop lines |

A committed run (`Save & Run All`) uses its own session. Check it with `kaggle kernels status <user>/<slug>`.

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
- **Reopening a tab during a job:** the kernel reads `unknown` and the pill `Starting …` until the job ends, because a busy kernel cannot answer. Prompts come back empty, and output from then on is not recorded. The job itself continues.

## 9. Shell access

- Jupyter terminals are disabled: `terminals.startNew()` returns 500, although `isAvailable()` says true. There is no interactive shell.
- `kernel.requestExecute({ code, silent: false, store_history: false, allow_stdin: false })` runs code without touching cells or counts, and is what `exec` and `sh` use. Output is mirrored in the Console panel.
- `%%bash` turns a non-zero exit into a `CalledProcessError`, so exit codes come through.
- Requests queue behind a busy cell, so a shell command waits for the job to end. A detached job leaves the kernel free.
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

Environment on 2026-11-04: T4 x2 has two GPUs with 15 GiB each. Sessions have a 12-hour limit, 30 GiB RAM, 57.6 GiB disk and 4 CPUs. `/kaggle/working` is 20 GB. Weekly quota is 30 h GPU and 20 h TPU, resetting at `refreshAt` from `kaggle quota`.

## 11. Not verified

- How long an idle session survives. Check with `status` rather than assuming.
- A TPU session actually booting. The selection and dialog are verified, but not a run.
- A detached job during a long idle period, since Kaggle's idle timeout may stop the session.
- Repeating `add-input`. A new search always labels the row `Add`, even when the input is attached, and the label reads `Remove` only right after a click. In the one repeat tried, the second click was not confirmed and the input was missing from the next session, so it probably detached. Attaching while the session is off does persist to the next session.
- What the UI shows when quota is exhausted.
- `Factory reset`, `Schedule a notebook run`, `Install Dependencies`, `Upload` and removing an input are mapped but not driven.
