// Playwright driver for the Kaggle notebook editor, attached over CDP to the Chrome
// started by start-chrome.sh. Every selector and state string used here is recorded,
// with its reason, in ../references/ui-map.md.
//
// The editor is two documents:
//   - Kaggle's page: menus, toolbar, session pill. Reached with role/label locators.
//   - JupyterLab in an iframe: cells and kernel. Reached through window.jupyterapp.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = process.env.KAGGLE_CDP_PORT || '9333';
export const CDP_URL = `http://127.0.0.1:${PORT}`;
const START_SCRIPT = new URL('./start-chrome.sh', import.meta.url).pathname;
const STATE_DIR = join(homedir(), '.kaggle-agent');

export const ACCELERATORS = { none: 'None', t4x2: 'GPU T4 x2', tpu: 'TPU v5e-8' };

const EDITOR_RE = /^https:\/\/www\.kaggle\.com\/code\/([^/]+)\/([^/?#]+)\/edit/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An error with a process exit code. 124 means "timed out, may still be running". */
export class KaggleError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const cleanUrl = (u) => u.split('?')[0];

/* ------------------------------------------------------------------ browser */

/** Refuse any other Chrome on this port, which could be signed in to a different account. */
function assertOurChrome() {
  let command;
  try {
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0];
    command = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' });
  } catch {
    return; // nothing is listening, so connect() reports that with its own message
  }
  if (!command.includes(`--user-data-dir=${join(STATE_DIR, 'chrome-profile')}`)) {
    throw new KaggleError(`Port ${PORT} belongs to another program, not the Kaggle Chrome, so it could be a different account. Free the port, or set KAGGLE_CDP_PORT.`);
  }
}

export async function connect(cdpUrl = CDP_URL) {
  assertOurChrome();
  try {
    const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15000 });
    return { browser, ctx: browser.contexts()[0] };
  } catch (e) {
    throw new KaggleError(`Chrome is not reachable at ${cdpUrl}. Start it with: bash ${START_SCRIPT}\n(${e.message.split('\n')[0]})`);
  }
}

/** The signed-in username, or null. /me redirects to the profile, or to login. */
export async function whoAmI(ctx) {
  let page = ctx.pages().find((p) => p.url().startsWith('https://www.kaggle.com'));
  const temporary = !page;
  if (temporary) {
    page = await ctx.newPage();
    await page.goto('https://www.kaggle.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  const finalUrl = await page.evaluate(async () => (await fetch('/me', { redirect: 'follow' })).url);
  if (temporary) await page.close();
  const path = new URL(finalUrl).pathname;
  return path.startsWith('/account/login') ? null : path.replace(/^\/|\/$/g, '');
}

export function openEditors(ctx) {
  return ctx.pages().filter((p) => EDITOR_RE.test(p.url()));
}

function assertIsEditor(page, requested) {
  const url = cleanUrl(page.url());
  if (url.includes('/account/login')) throw new KaggleError('Not signed in to Kaggle. Run: doctor');
  if (!EDITOR_RE.test(url)) throw new KaggleError(`Could not open ${requested} as an editor; landed on ${url}. Check the slug and that you own the notebook.`);
}

/**
 * Pick the notebook to act on. With a url, reuse its tab or open a new one. Without a
 * url, use the only editor tab and refuse to guess between several, because commands
 * such as push overwrite the notebook they land on.
 */
export async function notebookPage(ctx, url = null) {
  if (url) {
    const m = url.match(/kaggle\.com\/code\/([^/]+)\/([^/?#]+)/);
    if (!m) throw new KaggleError(`Not a notebook url: ${url}`);
    const target = `https://www.kaggle.com/code/${m[1]}/${m[2]}/edit`;
    let page = openEditors(ctx).find((p) => cleanUrl(p.url()).startsWith(target));
    if (!page) {
      page = await ctx.newPage();
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1500);
      assertIsEditor(page, target);
    }
    return prepareEditor(page);
  }
  const editors = openEditors(ctx);
  if (editors.length === 0) throw new KaggleError('No notebook editor tab is open. Pass --url <edit url>, or run: new');
  if (editors.length > 1) {
    throw new KaggleError(`Several notebooks are open, so pass --url with one of:\n${editors.map((p) => '  ' + cleanUrl(p.url())).join('\n')}`);
  }
  return prepareEditor(editors[0]);
}

/** Wait for the session pill, which is missing for a moment after a tab opens. */
async function prepareEditor(page) {
  await page.locator('button', { hasText: 'Draft Session' }).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await dismissBanners(page);
  return page;
}

const CRASH_MESSAGE =
  "Kaggle's editor has crashed on this tab (\"Oops something went wrong\"). Run close-tab, then check status and cells with --url. Edits not reported as draftSaved are lost. The session may have survived, so check its files before re-running anything.";

/** Fail fast on a crashed editor, where every later command would otherwise stall. */
export async function assertHealthy(page) {
  const crashed = await page.evaluate(() => /Oops something went wrong/.test(document.body.innerText));
  if (crashed || (await sessionState(page)).state === 'crashed') throw new KaggleError(CRASH_MESSAGE);
}

/** The cookie banner and the Colab promo sit over the page and steal clicks. */
export async function dismissBanners(page) {
  const cookie = page.getByText(/^OK, Got it\.?$/).first();
  if (await cookie.isVisible().catch(() => false)) await cookie.click().catch(() => {});
  const promo = page.getByRole('button', { name: /^Dismiss$/i }).first();
  if (await promo.isVisible().catch(() => false)) await promo.click().catch(() => {});
}

/**
 * Clear anything that blocks the toolbar, and confirm it is gone. An open menu or dialog
 * marks the rest of the page aria-hidden, which makes role lookups find nothing, and one
 * Escape closes only a submenu. Popovers ignore Escape and can overlap one another, so
 * click their Close buttons in the DOM. A stray confirm dialog is cancelled, not accepted.
 */
async function closeOverlays(page) {
  for (let i = 0; i < 6 && (await menuRows(page)).length; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }
  await page.evaluate(() => {
    const visible = (e) => e.getBoundingClientRect().width > 0;
    document.querySelectorAll('button[aria-label="Close"]').forEach((b) => visible(b) && b.click());
    document.querySelectorAll('[role="dialog"]').forEach((d) => {
      if (!visible(d)) return;
      const cancel = [...d.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Cancel');
      if (cancel) cancel.click();
    });
  });
  await sleep(300);
}

export async function visibleDialogs(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')]
      .filter((d) => d.getBoundingClientRect().width > 0)
      .map((d) => (d.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 400))
  );
}

/* ---------------------------------------------------------- JupyterLab bridge */

/**
 * Find the JupyterLab frame by probing for window.jupyterapp. Its url and name can read
 * as empty over CDP, and the url holds a session token, so never print or log it. Wait
 * for context.isReady: until then the model is a placeholder holding one empty cell, so
 * a read returns nothing and a write could overwrite the real notebook.
 */
export async function jupyterFrame(page, { timeoutMs = 90000 } = {}) {
  assertIsEditor(page, cleanUrl(page.url()));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const ready = await f
        .evaluate(() => {
          const app = window.jupyterapp;
          const panel = app && [app.shell.currentWidget, ...app.shell.widgets('main')].find((w) => w?.content?.model?.sharedModel);
          return !!panel?.context?.isReady;
        })
        .catch(() => false);
      if (ready) return f;
    }
    await sleep(500);
  }
  throw new KaggleError('The editor did not finish loading: no ready notebook in window.jupyterapp. Run: selfcheck', 124);
}

/** Run fn(panel, arg) inside the JupyterLab frame, where panel is the NotebookPanel. */
async function inNotebook(page, fn, arg = null) {
  const frame = await jupyterFrame(page);
  return frame.evaluate(`(async () => {
    const app = window.jupyterapp;
    const panel = [app.shell.currentWidget, ...app.shell.widgets('main')].find((w) => w?.content?.model?.sharedModel);
    if (!panel) throw new Error('no notebook panel in JupyterLab');
    return (${fn.toString()})(panel, ${JSON.stringify(arg)});
  })()`);
}

/* -------------------------------------------------------------------- menus */

function menuRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.innerText || '').trim().replace(/\s+/g, ' '))
  );
}

async function openMenu(page, name) {
  const button = page.getByRole('button', { name: new RegExp(`^${name}$`) }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await closeOverlays(page);
    await button.click({ timeout: 5000 }).catch(() => {});
    const opened = await page.getByRole('menuitem').first().waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
    if (opened) return;
  }
  throw new KaggleError(`Could not open the ${name} menu. Dialogs: ${JSON.stringify(await visibleDialogs(page))}. Run: selfcheck`);
}

const menuItem = (page, re) => page.getByRole('menuitem', { name: re }).first();

async function openAcceleratorSubmenu(page) {
  await openMenu(page, 'Settings');
  await menuItem(page, /Accelerator/i).hover();
  await page.getByRole('menuitem', { name: 'None', exact: true }).first().waitFor({ state: 'visible', timeout: 5000 });
}

/* ---------------------------------------------------------- session + kernel */

/** Parse the toolbar pill: off | starting | running. */
export async function sessionState(page) {
  const raw = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Draft Session/.test(x.innerText || ''));
    return b ? b.innerText.replace(/\s+/g, ' ').replace(/^circle /, '').trim() : null;
  });
  if (!raw) return { state: 'unknown', raw };
  if (/Draft Session off/i.test(raw)) return { state: 'off', raw };
  if (/Fatal/i.test(raw)) return { state: 'crashed', raw };
  const uptime = raw.match(/\(([^)]+)\)/);
  if (uptime) return { state: 'running', uptime: uptime[1], raw };
  return { state: 'starting', raw };
}

export async function kernelStatus(page) {
  return inNotebook(page, (panel) => {
    const ctx = panel.sessionContext;
    return { name: ctx?.kernelDisplayName ?? null, status: ctx?.kernelDisplayStatus ?? null, connected: !!ctx?.session?.kernel };
  });
}

async function waitForKernel(page, deadline) {
  for (;;) {
    const k = await kernelStatus(page);
    if (k.connected && k.status !== 'unknown') return k;
    if (Date.now() > deadline) {
      const s = await sessionState(page);
      throw new KaggleError(`Session did not come up in time. Pill: "${s.raw}". Dialogs: ${JSON.stringify(await visibleDialogs(page))}`, 124);
    }
    await sleep(2000);
  }
}

/** Start a session from the Run menu. Spends quota on the selected accelerator. */
export async function startSession(page, { timeoutMs = 300000 } = {}) {
  const t0 = Date.now();
  const before = await settledRunState(page);
  if (before.connected) return { started: false, alreadyRunning: true, kernel: before.kernel, busy: before.busy };
  const s = await sessionState(page);
  if (s.state === 'off') {
    await openMenu(page, 'Run');
    await menuItem(page, /Start session/i).click({ timeout: 5000 });
  }
  const kernel = await waitForKernel(page, t0 + timeoutMs);
  return { started: true, seconds: Math.round((Date.now() - t0) / 1000), kernel };
}

export async function stopSession(page, { timeoutMs = 60000 } = {}) {
  await settledRunState(page);
  const s = await sessionState(page);
  if (s.state === 'off') return { stopped: false, alreadyOff: true };
  await openMenu(page, 'Run');
  await menuItem(page, /Stop session/i).click({ timeout: 5000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await sessionState(page)).state === 'off') return { stopped: true };
    await sleep(1000);
  }
  throw new KaggleError('Clicked Stop session, but the pill never showed off. Check with: status', 124);
}

/* ----------------------------------------------------------------- settings */

export async function getAccelerator(page) {
  await openAcceleratorSubmenu(page);
  const rows = await menuRows(page);
  await closeOverlays(page);
  const labels = Object.values(ACCELERATORS);
  const hit = rows.find((r) => r.startsWith('check ') && labels.includes(r.slice(6)));
  return hit ? hit.slice(6) : null;
}

/**
 * Switch accelerator. This ends any live session at once and does not restart it. An idle
 * kernel does not prove nothing is running, because a detached job leaves it idle, so any
 * live session is refused unless force is set. T4/TPU show a confirm dialog with quota.
 */
export async function setAccelerator(page, key, { force = false } = {}) {
  const label = ACCELERATORS[key];
  if (!label) throw new KaggleError(`Unknown accelerator "${key}". Use one of: ${Object.keys(ACCELERATORS).join(', ')}. (GPU P100 has been retired.)`);
  const current = await getAccelerator(page);
  if (current === label) return { changed: false, accelerator: label };
  const run = await settledRunState(page);
  if (!force && (run.connected || (await sessionState(page)).state !== 'off')) {
    throw new KaggleError('A session is live, and switching accelerator would end it along with anything running in it, including detached jobs. Run stop first, or pass --force.');
  }
  await openAcceleratorSubmenu(page);
  await page.getByRole('menuitem', { name: label, exact: true }).first().click();
  const result = { changed: true, accelerator: label };
  const confirm = page.getByRole('dialog').getByRole('button', { name: new RegExp(`^Turn on ${label}$`) }).first();
  await confirm.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await confirm.isVisible().catch(() => false)) {
    const text = (await visibleDialogs(page)).join(' ');
    const hours = text.match(/You have ([\d.]+) hours? remaining/);
    if (hours) result.hoursRemaining = Number(hours[1]);
    await confirm.click();
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && (await sessionState(page)).state !== 'off') await sleep(1000);
  await closeOverlays(page);
  const now = await getAccelerator(page);
  if (now !== label) throw new KaggleError(`Accelerator is still "${now}" after selecting "${label}". Dialogs: ${JSON.stringify(await visibleDialogs(page))}`);
  const session = await sessionState(page);
  if (session.state !== 'off') throw new KaggleError(`Accelerator now reads "${label}", but the old session did not end within 45 s. Pill: "${session.raw}"`, 124);
  result.session = session.state;
  return result;
}

/** true when internet is on. The menu offers the opposite of the current state. */
export async function getInternet(page) {
  await openMenu(page, 'Settings');
  const row = (await menuRows(page)).find((r) => /Turn (on|off) internet/i.test(r));
  await closeOverlays(page);
  if (!row) throw new KaggleError('No internet row in Settings. The account may need phone verification. Run: selfcheck');
  return /Turn off internet/i.test(row);
}

export async function setInternet(page, on) {
  if ((await getInternet(page)) === on) return { changed: false, internet: on };
  await openMenu(page, 'Settings');
  await menuItem(page, on ? /Turn on internet/i : /Turn off internet/i).click();
  await sleep(1500);
  await closeOverlays(page);
  const now = await getInternet(page);
  if (now !== on) throw new KaggleError(`Internet is still ${now ? 'on' : 'off'} after toggling.`);
  return { changed: true, internet: now };
}

/* -------------------------------------------------------------------- cells */

/**
 * Turn a source file into cells. .ipynb is read as JSON. A .py is split on `# %%` lines,
 * with `# %% [markdown]` for markdown cells. A file with no markers is one code cell.
 * Text before the first marker is kept unless it is only comments or blank lines.
 */
export function parseCells(text, filename = '') {
  if (filename.endsWith('.ipynb')) {
    const nb = JSON.parse(text);
    return nb.cells.map((c) => ({
      cell_type: c.cell_type,
      source: [].concat(c.source).join(''),
      metadata: c.metadata ?? {},
      ...(c.attachments ? { attachments: c.attachments } : {}),
    }));
  }
  const marker = /^# %%[ \t]*(\[markdown\])?[^\n]*$/gm;
  const found = [...text.matchAll(marker)];
  if (found.length === 0) return text.trim() ? [{ cell_type: 'code', source: text.trimEnd() }] : [];
  const cells = [];
  const head = text.slice(0, found[0].index).trim();
  if (head.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'))) cells.push({ cell_type: 'code', source: head });
  found.forEach((m, i) => {
    const end = i + 1 < found.length ? found[i + 1].index : text.length;
    let body = text.slice(m.index + m[0].length, end).replace(/^\n+/, '').trimEnd();
    if (m[1]) body = body.split('\n').map((l) => l.replace(/^# ?/, '')).join('\n');
    if (body) cells.push({ cell_type: m[1] ? 'markdown' : 'code', source: body });
  });
  return cells;
}

export async function getCells(page) {
  return inNotebook(page, (panel) =>
    panel.content.model.sharedModel.cells.map((c) => {
      const j = c.toJSON();
      return { type: j.cell_type, exec: j.execution_count ?? null, source: j.source };
    })
  );
}

/**
 * Save the whole notebook outside the browser, so a replace can be undone by hand. The file
 * is a normal .ipynb, including outputs and attachments, readable only by this user.
 */
async function backupCells(page) {
  const m = cleanUrl(page.url()).match(EDITOR_RE);
  const dir = join(STATE_DIR, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${m[1]}__${m[2]}__${stamp}.ipynb`);
  const notebook = await inNotebook(page, (panel) => panel.content.model.sharedModel.toJSON());
  writeFileSync(file, JSON.stringify(notebook, null, 1), { mode: 0o600 });
  return file;
}

async function waitDraftLabel(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const label = await page.evaluate(() => /Draft saved/i.test(document.body.innerText));
    if (label) return true;
    if (Date.now() >= deadline) return false;
    await sleep(300);
  }
}

/**
 * Apply an edit and wait for Kaggle to store it. Measured behaviour that shapes this:
 *  - "Draft saved" is absent until Kaggle finishes loading the notebook, and an edit made
 *    in that window is discarded even though the save still returns 200.
 *  - The label is also absent while an edit is unsaved, so it must be waited for first.
 *  - A save is GetKernel, then a blob upload, then UpdateKernelDraft, 2-31 s after the
 *    edit. Only an upload begun after the edit can contain it, so count only that.
 *  - context.save() clears the dirty flag without sending anything. Never call it.
 */
async function editAndSave(page, edit, { beforeEdit = null } = {}) {
  if (!(await waitDraftLabel(page, 60000))) {
    throw new KaggleError('Kaggle has not shown "Draft saved" for 60 s, so edits would not be stored. Nothing was changed. Run close-tab, then retry with --url.');
  }
  // The wait above can be long, so check preconditions only now, right before editing.
  if (beforeEdit) await beforeEdit();
  let edited = false;
  let uploaded = false;
  let status = null;
  const onRequest = (r) => {
    if (edited && r.method() !== 'GET' && r.url().includes('/upload/storage/')) uploaded = true;
  };
  // Kaggle retries after a transient 400, so keep waiting for a 200 until the deadline.
  const onResponse = (r) => {
    if (uploaded && r.url().includes('UpdateKernelDraft') && status !== 200) status = r.status();
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    const result = await edit();
    if (result?.error) throw new KaggleError(result.error);
    edited = true;
    const deadline = Date.now() + 60000;
    while (status !== 200 && Date.now() < deadline) await sleep(250);
    if (status !== 200) {
      throw new KaggleError(`The edit is in the open tab, but Kaggle did not confirm storing it (save status: ${status ?? 'none within 60 s'}). Keep the tab open, and treat the edit as unsaved.`);
    }
    return { ...result, draftSaved: true };
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}

/**
 * Replace the whole notebook. The old cells go to a backup file first. Kaggle treats going
 * from 3+ cells straight to 1 as data loss and crashes the editor ("An error was prevented
 * that could have led to data loss"), while 7 to 2 and 2 to 1 are fine. So that one case
 * goes through a saved 2-cell step.
 */
export async function setCells(page, cells) {
  if (!cells.length) throw new KaggleError('Refusing to replace the notebook with zero cells.');
  let backup = null;
  const replace = (arr, beforeEdit = null) =>
    editAndSave(
      page,
      () =>
        inNotebook(
          page,
          (panel, list) => {
            const s = panel.content.model.sharedModel;
            s.transact(() => {
              s.deleteCellRange(0, s.cells.length);
              list.forEach((c, i) => s.insertCell(i, c));
            });
            return { cells: s.cells.length };
          },
          arr
        ),
      { beforeEdit }
    );
  const prepare = async () => {
    if ((await settledRunState(page)).busy) throw new KaggleError('The kernel is busy, so replacing every cell would break the running job. Run: interrupt, then wait, and retry.');
    backup = await backupCells(page);
  };
  const current = await inNotebook(page, (panel) => panel.content.model.sharedModel.cells.length);
  if (cells.length === 1 && current >= 3) {
    await replace([cells[0], { cell_type: 'code', source: '' }], prepare);
    const res = await replace(cells);
    return { ...res, backup };
  }
  const res = await replace(cells, prepare);
  return { ...res, backup };
}

export async function appendCell(page, source, cellType = 'code') {
  return editAndSave(page, () =>
    inNotebook(
      page,
      (panel, [src, type]) => {
        const s = panel.content.model.sharedModel;
        s.insertCell(s.cells.length, { cell_type: type, source: src });
        return { cells: s.cells.length };
      },
      [source, cellType]
    )
  );
}

export async function setCellSource(page, index, source) {
  // Identical source changes nothing, so Kaggle sends no save to wait for.
  const current = await getCells(page);
  if (current[index]?.source === source) return { cells: current.length, changed: false };
  return editAndSave(page, () =>
    inNotebook(
      page,
      (panel, [i, src]) => {
        const s = panel.content.model.sharedModel;
        if (i < 0 || i >= s.cells.length) return { error: `cell ${i} is out of range (0-${s.cells.length - 1})` };
        s.cells[i].setSource(src);
        return { cells: s.cells.length };
      },
      [index, source]
    )
  );
}

export async function deleteCell(page, index) {
  return editAndSave(
    page,
    () =>
      inNotebook(
        page,
        (panel, i) => {
          const s = panel.content.model.sharedModel;
          if (i < 0 || i >= s.cells.length) return { error: `cell ${i} is out of range (0-${s.cells.length - 1})` };
          if (s.cells.length === 1) return { error: 'Cannot delete the only cell. Use set-cell or push instead.' };
          s.deleteCell(i);
          return { cells: s.cells.length };
        },
        index
      ),
    {
      beforeEdit: async () => {
        if ((await settledRunState(page)).busy) throw new KaggleError('The kernel is busy, and the cell may be the running one, which holds its output. Run: interrupt, then wait, and retry.');
      },
    }
  );
}

/* ------------------------------------------------------------ run + outputs */

/**
 * One snapshot of execution state. `[*]` prompts mark running or queued cells and stay
 * set between cells, unlike kernel status. Execution counts alone would read a previous
 * run as finished.
 */
export async function runState(page) {
  return inNotebook(page, (panel) => {
    const nb = panel.content;
    const ctx = panel.sessionContext;
    const cells = nb.model.sharedModel.cells.map((c) => c.toJSON());
    const prompts = nb.widgets.map((w) => (w.promptNode?.textContent ?? '').trim());
    const pending = prompts.flatMap((p, i) => (p.includes('*') ? [i] : []));
    const errors = cells.flatMap((c, i) => ((c.outputs || []).some((o) => o.output_type === 'error') ? [i] : []));
    const interrupted = cells.some((c) => (c.outputs || []).some((o) => o.output_type === 'error' && o.ename === 'KeyboardInterrupt'));
    const notRun = cells.flatMap((c, i) => (c.cell_type === 'code' && String(c.source).trim() && c.execution_count == null ? [i] : []));
    let tail = '';
    if (pending.length) {
      const outs = cells[pending[0]].outputs || [];
      const last = outs.filter((o) => o.output_type === 'stream').pop();
      if (last) tail = [].concat(last.text).join('').slice(-400);
    }
    const status = ctx?.kernelDisplayStatus ?? null;
    const connected = !!ctx?.session?.kernel;
    return {
      connected,
      kernel: status,
      // A kernel running a job cannot answer a tab that has just reconnected, so "unknown"
      // while connected lasts for the rest of that job and has to count as busy.
      busy: pending.length > 0 || status === 'busy' || (connected && status === 'unknown'),
      pending,
      running: pending[0] ?? null,
      errors,
      interrupted,
      notRun,
      tail,
      executed: cells.filter((c) => c.execution_count != null).length,
    };
  });
}

const BUSY_MESSAGE =
  'The kernel is busy or has not answered since this tab connected, so this would wait until any running job ends. Use: resources. To watch it end, use: wait. To stop it, use: interrupt. With sh or exec, --queue runs it afterwards.';

/**
 * Right after a tab opens, the kernel takes a few seconds to connect and the pill can read
 * off before Kaggle has finished loading. Wait for a settled answer, so that a session
 * still reconnecting is not reported as having no session. Trust "off" only once the
 * draft label shows that Kaggle has loaded the notebook.
 */
async function settledRunState(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await runState(page);
    if (r.connected && r.kernel !== 'unknown') return r;
    if (!r.connected && (await sessionState(page)).state === 'off' && (await waitDraftLabel(page, 0))) return r;
    if (Date.now() > deadline) return r;
    await sleep(1000);
  }
}

/**
 * Click Kaggle's Run All, which also boots a cold session. Returns once the run has
 * visibly begun, so a later wait cannot mistake the idle moment before it for the end.
 */
export async function runAll(page, { startTimeoutMs = 300000 } = {}) {
  if ((await settledRunState(page)).busy) throw new KaggleError(BUSY_MESSAGE);
  await closeOverlays(page);
  await inNotebook(page, () => window.jupyterapp.commands.execute('notebook:clear-all-cell-outputs'));
  await page.getByRole('button', { name: /^Run All$/ }).first().click({ timeout: 20000 });
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    const r = await runState(page);
    if (r.busy || r.executed > 0 || r.errors.length) return { started: true };
    await sleep(1000);
  }
  throw new KaggleError(`Run All clicked, but nothing started. Pill: "${(await sessionState(page)).raw}"`, 124);
}

/**
 * Run one cell. It needs a live kernel, so start one first if the session is off. The
 * command's promise lasts as long as the cell does, so it is not awaited here.
 */
export async function runCell(page, index) {
  const count = await inNotebook(page, (panel) => panel.content.widgets.length);
  if (index < 0 || index >= count) throw new KaggleError(`Cell ${index} is out of range (0-${count - 1}).`);
  await startSession(page);
  if ((await settledRunState(page)).busy) throw new KaggleError(BUSY_MESSAGE);
  await inNotebook(
    page,
    (panel, i) => {
      panel.content.activeCellIndex = i;
      panel.content.deselectAll(); // the command runs every selected cell, not just the active one
      void window.jupyterapp.commands.execute('notebook:run-cell');
    },
    index
  );
  await sleep(500);
}

export async function interrupt(page) {
  await inNotebook(page, () => window.jupyterapp.commands.execute('notebook:interrupt-kernel'));
}

/** Restart the kernel and clear outputs through Kaggle's Run menu. */
export async function restartKernel(page, { timeoutMs = 120000 } = {}) {
  await openMenu(page, 'Run');
  await menuItem(page, /Restart & clear cell outputs/i).click({ timeout: 5000 });
  await sleep(2000);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const kernel = await waitForKernel(page, deadline);
    if (kernel.status === 'idle') return { restarted: true, kernel };
    if (Date.now() > deadline) throw new KaggleError(`Kernel is still "${kernel.status}" after the restart.`, 124);
    await sleep(1000);
  }
}

/**
 * Block until the run ends. done is true only when nothing is pending and the kernel
 * has stayed idle across two polls. Returns sessionLost if the kernel stays gone across
 * three polls, because a reconnecting tab can read off for a moment. Returns timedOut if
 * the deadline passes while the run is still going.
 */
export async function waitForRun(page, { timeoutMs = 12 * 3600 * 1000, pollMs = 5000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastTail = '';
  let idlePolls = 0;
  let offPolls = 0;
  let missedSnapshots = 0;
  const LOST = 'Lost the editor while waiting: the tab closed or reloaded. Any job may still be running, and its later output is lost. Check files on disk with: sh';
  for (;;) {
    if (page.isClosed()) throw new KaggleError(LOST, 3);
    const r = await runState(page).catch(() => null);
    if (r) {
      missedSnapshots = 0;
      if (onTick && r.tail && r.tail !== lastTail) {
        lastTail = r.tail;
        onTick(r);
      }
      const session = (await sessionState(page)).state;
      if (session === 'crashed') throw new KaggleError(CRASH_MESSAGE, 3);
      offPolls = !r.connected && session === 'off' ? offPolls + 1 : 0;
      if (offPolls >= 3) return { done: false, sessionLost: true, ...r };
      idlePolls = !r.busy && r.kernel === 'idle' ? idlePolls + 1 : 0;
      if (idlePolls >= 2) return { done: true, errored: r.errors.length > 0, ...r };
    } else if (++missedSnapshots > 12) {
      throw new KaggleError(LOST, 3);
    }
    if (Date.now() > deadline) return { done: false, timedOut: true, ...(r || {}) };
    await sleep(pollMs);
  }
}

/** Cell outputs flattened to text, with execution counts and error flags. */
export async function outputs(page) {
  return inNotebook(page, (panel) =>
    panel.content.model.sharedModel.cells.map((c, index) => {
      const j = c.toJSON();
      const text = (j.outputs || [])
        .map((o) => {
          if (o.output_type === 'stream') return [].concat(o.text).join('');
          if (o.output_type === 'error') return `ERROR ${o.ename}: ${o.evalue}`;
          if (o.data) {
            if (o.data['text/plain']) return [].concat(o.data['text/plain']).join('');
            return `[${Object.keys(o.data).join(', ')}]`;
          }
          return '';
        })
        .join('\n');
      return {
        index,
        type: j.cell_type,
        exec: j.execution_count ?? null,
        head: String(j.source || '').split('\n')[0],
        text,
        error: (j.outputs || []).some((o) => o.output_type === 'error'),
      };
    })
  );
}

/* ------------------------------------------------------- CLI through the kernel */

/**
 * Run code in the live kernel without touching any cell or execution count. This is the
 * channel behind Kaggle's Console, and its output also appears there. Jupyter terminals
 * return 500 on Kaggle, so this is the only shell. Requests queue behind a busy kernel,
 * so refuse by default rather than appear to hang for the length of a training run.
 */
export async function exec(page, code, { timeoutMs = 120000, queue = false } = {}) {
  const r = await settledRunState(page);
  if (!r.connected) throw new KaggleError('No live session. Run: start');
  if (r.busy && !queue) throw new KaggleError(BUSY_MESSAGE);
  const res = await inNotebook(
    page,
    async (panel, [src, ms]) => {
      const kernel = panel.sessionContext.session.kernel;
      const out = { stdout: '', stderr: '', result: '', error: null };
      const future = kernel.requestExecute({ code: src, silent: false, store_history: false, allow_stdin: false, stop_on_error: false });
      future.onIOPub = (m) => {
        const t = m.header.msg_type;
        if (t === 'stream') out[m.content.name === 'stderr' ? 'stderr' : 'stdout'] += m.content.text;
        else if (t === 'execute_result' || t === 'display_data') out.result += m.content.data?.['text/plain'] ?? '';
        else if (t === 'error') out.error = { name: m.content.ename, value: m.content.evalue };
      };
      const reply = await Promise.race([future.done, new Promise((res) => setTimeout(() => res(null), ms))]);
      return { ...out, status: reply ? reply.content.status : 'timeout' };
    },
    [code, timeoutMs]
  );
  if (res.status === 'timeout') {
    throw new KaggleError(`Still running after ${Math.round(timeoutMs / 1000)} s and blocking the kernel. Output so far:\n${res.stdout}${res.stderr}\nRun: interrupt`, 124);
  }
  return res;
}

/** Run a bash script in the session. exitCode is parsed from the kernel's error. */
export async function sh(page, script, opts = {}) {
  const r = await exec(page, `%%bash\n${script}`, opts);
  let exitCode = r.status === 'ok' ? 0 : 1;
  const m = r.error?.value?.match(/non-zero exit status (\d+)/);
  if (m) exitCode = Number(m[1]);
  return { ...r, exitCode };
}

/**
 * Copy a local file into the session. The content travels as base64, so nothing in the
 * file can be read as shell or Python, and the checksum confirms it arrived intact.
 */
export async function putFile(page, localPath, remotePath, opts = {}) {
  const bytes = readFileSync(localPath);
  const target = JSON.stringify(remotePath);
  const run = async (code) => {
    const r = await exec(page, code, opts);
    if (r.status !== 'ok') throw new KaggleError(`Copy failed: ${r.error?.name}: ${r.error?.value}`);
    return r;
  };
  await run(`(lambda P: (P.parent.mkdir(parents=True, exist_ok=True), P.write_bytes(b'')))(__import__('pathlib').Path(${target}));None`);
  const b64 = bytes.toString('base64');
  const CHUNK = 512 * 1024; // a multiple of 4, so each chunk decodes alone
  for (let i = 0; i < b64.length; i += CHUNK) {
    await run(`(lambda f, d: (f.write(d), f.close()))(open(${target}, 'ab'), __import__('base64').b64decode('${b64.slice(i, i + CHUNK)}'));None`);
  }
  const check = await run(`print(__import__('hashlib').sha256(open(${target}, 'rb').read()).hexdigest())`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (check.stdout.trim() !== sha256) throw new KaggleError(`Copy to ${remotePath} did not verify: the checksums differ.`);
  return { path: remotePath, bytes: bytes.length, verified: true };
}

/* ---------------------------------------------------------------- monitoring */

function parseResources(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { accelerator: lines[1] ?? null, sections: [] };
  const LABEL = /^(Session|Disk|CPU|RAM|GPU( ?\d+)?|GPU Memory|GPU RAM|VRAM)$/i;
  for (let i = 2; i < lines.length; i++) {
    if (!LABEL.test(lines[i])) continue;
    const next = lines[i + 1];
    if (!next || LABEL.test(next)) continue; // a section heading such as "CPU" above "CPU"
    const entry = { label: lines[i], value: next };
    if (lines[i + 2] && !LABEL.test(lines[i + 2]) && /max|hours?/i.test(lines[i + 2])) entry.limit = lines[i + 2].replace(/^Max /, '');
    out.sections.push(entry);
  }
  return out;
}

/**
 * Read the panel behind the session pill. It comes from Kaggle's own metrics, not the
 * kernel, so it keeps working during training. It is empty for a few seconds after boot.
 */
export async function resources(page, { timeoutMs = 45000 } = {}) {
  const session = await sessionState(page);
  if (session.state === 'off') return { session: 'off' };
  await closeOverlays(page);
  const read = () =>
    page.evaluate(() => {
      const disk = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && e.textContent.trim() === 'Disk' && e.getBoundingClientRect().width > 0
      );
      for (let c = disk; c; c = c.parentElement) {
        const t = c.innerText || '';
        if (/Session/.test(t) && /RAM/.test(t) && /Max/.test(t) && !/HDD/.test(t)) return t;
      }
      return null;
    });
  const deadline = Date.now() + timeoutMs;
  let text = null;
  while (Date.now() < deadline && !text) {
    await page.locator('button', { hasText: 'Draft Session' }).first().click({ timeout: 5000 });
    await sleep(1500);
    text = await read();
    if (!text) {
      await closeOverlays(page);
      await sleep(3000);
    }
  }
  await closeOverlays(page);
  if (!text) throw new KaggleError(`The resources panel never filled in. Pill: "${(await sessionState(page)).raw}"`, 124);
  const parsed = parseResources(text);
  if (!parsed.sections.length) throw new KaggleError(`Could not read the resources panel. Its layout may have changed. Run: selfcheck. Text: ${JSON.stringify(text.slice(0, 200))}`);
  return { session: 'running', ...parsed };
}

/** Weekly GPU/TPU hours from the official Kaggle CLI, which needs no browser. */
export function quota() {
  try {
    return JSON.parse(execFileSync('kaggle', ['-W', 'quota', '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }));
  } catch (e) {
    throw new KaggleError(`The official kaggle CLI could not report quota: ${e.message.split('\n')[0]}. Weekly hours also appear in the dialog when turning on an accelerator.`);
  }
}

/* --------------------------------------------------------- notebook lifecycle */

/** Create a notebook in a new tab. New notebooks are private. */
export async function newNotebook(ctx, { title = null } = {}) {
  const page = await ctx.newPage();
  await page.goto('https://www.kaggle.com/code', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (page.url().includes('/account/login')) throw new KaggleError('Not signed in to Kaggle. Run: doctor');
  await dismissBanners(page);
  await page.getByRole('button', { name: /new notebook/i }).first().click({ timeout: 30000 });
  await page.waitForURL(EDITOR_RE, { timeout: 60000 });
  await jupyterFrame(page);
  await dismissBanners(page);
  if (title) await renameNotebook(page, title);
  return page;
}

export async function renameNotebook(page, title) {
  await openMenu(page, 'File');
  await menuItem(page, /Rename Notebook/i).click({ timeout: 5000 });
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').first().fill(title);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  await sleep(1500);
  return { title, url: cleanUrl(page.url()) };
}

export async function notebookTitle(page) {
  return page.locator('input[aria-label^="Title:"]').first().inputValue({ timeout: 5000 }).catch(() => null);
}

/** Read Private or Public from the Share panel, then cancel. Changes nothing. */
export async function getVisibility(page) {
  await closeOverlays(page);
  await page.getByRole('button', { name: /Share/ }).first().click({ timeout: 10000 });
  await page.getByText('Only collaborators can view this notebook').waitFor({ state: 'visible', timeout: 10000 });
  await sleep(500);
  const visibility = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[type="radio"]')].filter((r) => r.checked);
    if (radios.length && /public/i.test(radios[0].value + radios[0].getAttribute('aria-label'))) return 'public';
    if (radios.length && /private/i.test(radios[0].value + radios[0].getAttribute('aria-label'))) return 'private';
    const privateCard = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Private');
    let c = privateCard;
    while (c && !(c.innerText || '').includes('Only collaborators')) c = c.parentElement;
    return c && /check_circle|radio_button_checked/.test(c.innerText || '') ? 'private' : null;
  });
  await page.getByRole('button', { name: /^Cancel$/ }).first().click({ timeout: 5000 });
  await sleep(500);
  return visibility;
}

/** Commit a version. commit runs a fresh copy on its own session; quick saves only. */
export async function saveVersion(page, { name = null, quick = false } = {}) {
  if (!(await waitDraftLabel(page, 60000))) {
    throw new KaggleError('Kaggle has not shown "Draft saved" for 60 s, so a version might miss recent edits. Nothing was saved.');
  }
  await closeOverlays(page);
  const before = await versionCount(page);
  await page.getByRole('button', { name: 'Save Version', exact: true }).first().click({ timeout: 10000 });
  const nameBox = page.getByLabel('Version Name');
  await nameBox.waitFor({ state: 'visible', timeout: 10000 });
  if (name) await nameBox.fill(name);
  if (quick) {
    await page.getByText('Save & Run All (Commit)').first().click({ timeout: 5000 });
    await page.getByRole('option', { name: /Quick Save/i }).first().click({ timeout: 5000 });
  }
  await page.getByRole('button', { name: /^Save$/ }).first().click({ timeout: 5000 });
  await nameBox.waitFor({ state: 'hidden', timeout: 20000 });
  // The badge updates some seconds after the panel closes. It is the only confirmation.
  const deadline = Date.now() + 45000;
  let versions = await versionCount(page);
  while (!(versions > before) && Date.now() < deadline) {
    await sleep(1000);
    versions = await versionCount(page);
  }
  if (!(versions > before)) {
    throw new KaggleError(`Clicked Save, but the version count did not rise from ${before} within 45 s. Check with status before retrying, because a second commit spends quota again.`, 3);
  }
  return { saved: true, type: quick ? 'quick' : 'commit', versions };
}

export async function versionCount(page) {
  const t = await page.getByRole('button', { name: 'Show Versions' }).first().innerText({ timeout: 5000 }).catch(() => null);
  return t === null ? null : Number(t.trim());
}

/**
 * Delete this notebook for good. The caller must pass the exact title, and it must match
 * the title Kaggle shows in its own confirm dialog.
 */
export async function deleteNotebook(page, confirmTitle) {
  await openMenu(page, 'File');
  await menuItem(page, /Delete Notebook/i).click({ timeout: 5000 });
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const text = await dialog.innerText();
  const shown = text.match(/'([^']+)'/)?.[1];
  if (shown !== confirmTitle) {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    throw new KaggleError(`Refusing to delete: Kaggle shows '${shown}' but --confirm was '${confirmTitle}'.`);
  }
  await dialog.getByRole('button', { name: 'Yes, delete' }).click();
  await page.waitForURL((u) => !EDITOR_RE.test(u.toString()), { timeout: 30000 });
  // Kaggle lands on /code/deleted/<id>. Anywhere else, such as a login page, proves nothing.
  if (!/\/code\/deleted\//.test(page.url())) {
    throw new KaggleError(`Clicked delete, but landed on ${cleanUrl(page.url())} instead of Kaggle's deleted page. The outcome is unknown, so check with: kaggle kernels list --mine`, 3);
  }
  return { deleted: confirmTitle, landedOn: cleanUrl(page.url()) };
}

/**
 * Attach a dataset, model or similar by its exact Kaggle url. Keyword search could attach
 * the wrong thing, so only a result row linking to that exact path counts, and success
 * means its button has turned from Add to Remove.
 */
export async function addInput(page, url) {
  const match = url.match(/^https:\/\/www\.kaggle\.com(\/(?:datasets|models|competitions|code)\/[^?#]+?)\/?(?:[?#].*)?$/);
  if (!match) throw new KaggleError('Pass the full url of the input, such as https://www.kaggle.com/datasets/<owner>/<name>.');
  const path = match[1];
  await openMenu(page, 'File');
  await menuItem(page, /Add input/i).click({ timeout: 5000 });
  const box = page.getByPlaceholder('Search keyword or URL');
  await box.waitFor({ state: 'visible', timeout: 15000 });
  await box.fill(url);
  await page.keyboard.press('Enter');
  const findRow = () =>
    page.evaluate((wanted) => {
      for (const b of document.querySelectorAll('button[aria-label^="Add "],button[aria-label^="Remove "]')) {
        // The toolbar's "Add cell" buttons also match, and their ancestors hold every link.
        if (b.getBoundingClientRect().width === 0 || /^Add cell/.test(b.getAttribute('aria-label'))) continue;
        let row = b;
        for (let i = 0; i < 8 && row.parentElement; i++) {
          row = row.parentElement;
          if (row.querySelector('a[href]')) break;
        }
        if ([...row.querySelectorAll('a[href]')].some((a) => a.getAttribute('href') === wanted)) return b.getAttribute('aria-label');
      }
      return null;
    }, path);
  const poll = async (accept, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const label = await findRow();
      if (accept(label)) return label;
      if (Date.now() > deadline) return null;
      await sleep(500);
    }
  };
  const found = await poll((l) => !!l, 20000);
  if (!found) {
    await closeOverlays(page);
    throw new KaggleError(`No result links to ${path}. Check the url. Nothing was attached.`);
  }
  const name = found.replace(/^(Add|Remove) /, '').replace(/\s+/g, ' ');
  if (found.startsWith('Remove ')) {
    await closeOverlays(page);
    return { added: false, alreadyAttached: name };
  }
  await page.getByRole('button', { name: found, exact: true }).first().click({ timeout: 5000 });
  const confirmed = await poll((l) => l?.startsWith('Remove '), 20000);
  await closeOverlays(page);
  if (!confirmed) {
    throw new KaggleError(`Clicked Add for ${name}, but Kaggle did not confirm attaching it within 20 s. It may already have been attached, in which case this click may have detached it. Check in a session with: sh 'ls /kaggle/input/datasets/*'`);
  }
  return { added: name };
}

/* -------------------------------------------------------------------- map-ui */

/**
 * Dump the toolbar and every menu, for when selfcheck reports that something moved.
 * Opens menus but changes nothing. Urls are stripped because some hold session tokens.
 */
export async function mapUi(page) {
  const redact = (s) => s.replace(/https?:\/\/\S+/g, '<url>').replace(/eyJ[\w.-]+/g, '<token>');
  await closeOverlays(page);
  const toolbar = await page.evaluate(() =>
    [...document.querySelectorAll('button,[role="button"]')]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => ({ aria: b.getAttribute('aria-label'), text: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) }))
  );
  const menus = {};
  for (const name of ['File', 'Edit', 'View', 'Run', 'Settings', 'Add-ons', 'Help']) {
    await openMenu(page, name);
    const rows = await menuRows(page);
    await closeOverlays(page);
    const submenus = {};
    for (const row of rows.filter((r) => r.endsWith('arrow_right'))) {
      // innerText starts with an icon word such as "memory", which the accessible name lacks.
      const label = row.replace(/\s*arrow_right$/, '').replace(/^[a-z_0-9]+ /, '');
      await openMenu(page, name);
      await menuItem(page, new RegExp(label, 'i')).hover({ timeout: 3000 }).catch(() => {});
      await sleep(1200);
      submenus[label] = (await menuRows(page)).filter((r) => !rows.includes(r));
      await closeOverlays(page);
    }
    menus[name] = { rows, submenus };
  }
  const map = { pill: (await sessionState(page)).raw, toolbar, menus };
  return JSON.parse(JSON.stringify(map), (_, v) => (typeof v === 'string' ? redact(v) : v));
}

/* ------------------------------------------------------------------ selfcheck */

/**
 * Check every anchor this driver relies on, without changing the notebook. When a
 * command breaks, this names what moved so only that part of the page needs reading.
 */
export async function selfcheck(page) {
  const results = [];
  const check = async (name, fn) => {
    try {
      const v = await fn();
      results.push({ name, ok: !!v });
    } catch (e) {
      results.push({ name, ok: false, why: e.message.split('\n')[0].slice(0, 120) });
    }
  };
  await closeOverlays(page);
  await check('iframe: window.jupyterapp', () => jupyterFrame(page, { timeoutMs: 30000 }));
  await check('jupyter: notebook panel + sharedModel', () => getCells(page));
  await check('jupyter: command notebook:run-cell', () => inNotebook(page, () => window.jupyterapp.commands.hasCommand('notebook:run-cell')));
  await check('jupyter: command notebook:interrupt-kernel', () => inNotebook(page, () => window.jupyterapp.commands.hasCommand('notebook:interrupt-kernel')));
  for (const [role, name] of [
    ['button', /^Run All$/],
    ['button', 'Save Version'],
    ['button', 'Show Versions'],
    ['button', /Share/],
    ['button', 'Open console'],
  ]) {
    await check(`toolbar: ${name}`, () => page.getByRole(role, { name }).first().isVisible());
  }
  await check('toolbar: session pill', async () => (await sessionState(page)).state !== 'unknown');
  const expected = {
    File: [/Rename Notebook/i, /Delete Notebook/i, /Add input/i],
    Run: [/Start session|Stop session/i, /Restart & clear cell outputs/i, /Kaggle Jupyter Server/i],
    View: [/(Show|Hide) console/i, /(Show|Hide) sidebar/i],
    Settings: [/Turn (on|off) internet/i, /Accelerator/i, /Environment Preferences/i],
  };
  for (const [menu, items] of Object.entries(expected)) {
    await check(`menu: ${menu} opens`, async () => {
      await openMenu(page, menu);
      return true;
    });
    for (const re of items) await check(`menu: ${menu} > ${re.source}`, () => menuItem(page, re).isVisible());
    await closeOverlays(page);
  }
  for (const [key, label] of Object.entries(ACCELERATORS)) {
    await check(`accelerator: ${key} = "${label}"`, async () => {
      await openAcceleratorSubmenu(page);
      const seen = await page.getByRole('menuitem', { name: new RegExp(`^(check )?${label}$`) }).first().isVisible();
      await closeOverlays(page);
      return seen;
    });
  }
  return { ok: results.every((r) => r.ok), failed: results.filter((r) => !r.ok), checked: results.length };
}
