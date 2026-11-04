#!/usr/bin/env node
// Command line over driver.mjs. Run with no arguments for the command list.
// Exit codes: 0 ok, 1 failed or a cell errored, 2 session lost, 3 outcome unknown
// (tab closed or editor crashed during the run), 124 timed out, possibly still running.

import { readFileSync } from 'node:fs';
import * as k from './driver.mjs';

const USAGE = `kaggle-notebooks CLI. --url <notebook url> picks the notebook, and is required for
any command that changes something. If that notebook's tab is closed, --url opens it.

Setup      doctor | tabs | selfcheck | map-ui | screenshot <out.png> | close-tab
Notebook   new [--title T] | status | rename <title> | visibility
           save-version [--name N] [--quick] | delete --confirm <exact title>
Settings   accel none|t4x2|tpu [--force] | internet on|off | add-input <kaggle url>
Session    start [--timeout S] | stop | restart | resources | quota
Cells      push <file.py|file.ipynb> | cells | append <file|-> [--markdown]
           set-cell <i> <file|-> | delete-cell <i>
Run        run [--wait] [--timeout S] | run-cell <i> [--wait] [--timeout S]
           wait [--timeout S] | interrupt | outputs [--cell i] [--max N] [--json]
Shell      sh <script> | exec <python>   (or --file F; also --timeout S, --queue)
Files      put <local file> <path in session>`;

// args: how many positionals. write: changes something, so must name its notebook.
const SPEC = {
  help: {},
  quota: {},
  doctor: {},
  tabs: {},
  new: { flags: ['title'] },
  status: {},
  rename: { args: 1, write: true },
  visibility: {},
  accel: { args: 1, flags: ['force'], write: true },
  internet: { args: 1, write: true },
  'add-input': { args: 1, write: true },
  start: { flags: ['timeout'], write: true },
  stop: { write: true },
  restart: { write: true },
  resources: {},
  push: { args: 1, write: true },
  cells: {},
  append: { args: 1, flags: ['markdown'], write: true },
  'set-cell': { args: 2, write: true },
  'delete-cell': { args: 1, write: true },
  put: { args: 2, flags: ['timeout', 'queue'], write: true },
  run: { flags: ['wait', 'timeout'], write: true },
  'run-cell': { args: 1, flags: ['wait', 'timeout'], write: true },
  wait: { flags: ['timeout'] },
  interrupt: { write: true },
  outputs: { flags: ['cell', 'max', 'json'] },
  sh: { maxArgs: 1, flags: ['file', 'timeout', 'queue'], write: true },
  exec: { maxArgs: 1, flags: ['file', 'timeout', 'queue'], write: true },
  'save-version': { flags: ['name', 'quick'], write: true },
  delete: { flags: ['confirm'], write: true },
  'close-tab': { write: true },
  selfcheck: {},
  'map-ui': {},
  screenshot: { args: 1 },
};
const VALUE_FLAGS = new Set(['url', 'title', 'name', 'confirm', 'timeout', 'cell', 'max', 'file']);
const NO_NOTEBOOK = new Set(['help', 'quota', 'doctor', 'tabs', 'new']);
// Crash-recovery commands, which must still work on a crashed tab.
const SKIP_HEALTH = new Set(['close-tab', 'screenshot']);

const fail = (message) => {
  throw new k.KaggleError(message);
};

/** Parse and check the whole command line, so a typo can never change what a command does. */
function parseArgs(argv) {
  const cmd = argv[0] || 'help';
  const spec = SPEC[cmd] ?? fail(`Unknown command "${cmd}".\n\n${USAGE}`);
  const allowed = new Set([...(spec.flags ?? []), ...(NO_NOTEBOOK.has(cmd) ? [] : ['url']), 'help']);
  const flags = {};
  const pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!allowed.has(name)) fail(`"${cmd}" does not take --${name}. Run with no arguments for usage.`);
    if (!VALUE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    // A missing value must never fall through to a default, such as another notebook.
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail(`--${name} needs a value. If it came from a shell variable, that variable is empty.`);
    flags[name] = value;
  }
  if (flags.help) return { cmd: 'help', flags: {}, pos: [] };
  const max = spec.maxArgs ?? spec.args ?? 0;
  if (pos.length > max) fail(`"${cmd}" takes ${max} argument(s), but got ${pos.length}: ${pos.join(' ')}`);
  if (spec.args !== undefined && pos.length < spec.args) fail(`"${cmd}" needs ${spec.args} argument(s).\n\n${USAGE}`);
  if (spec.write && !flags.url) fail(`"${cmd}" changes something, so it needs --url <notebook url>.`);
  if (flags.timeout !== undefined && !(Number(flags.timeout) > 0)) fail(`--timeout must be a positive number of seconds, not "${flags.timeout}".`);
  return { cmd, flags, pos };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
const { cmd, flags, pos } = args;

const print = (o) => console.log(JSON.stringify(o, null, 2));
const index = (v) => {
  const n = Number(v);
  if (v === undefined || !Number.isInteger(n)) fail(`Not a cell index: ${v}`);
  return n;
};
const readSource = (p) => readFileSync(p === '-' ? 0 : p, 'utf8');
const timeoutMs = (fallback) => (flags.timeout ? Number(flags.timeout) * 1000 : fallback);

/** A last resort, so that a frozen page cannot hang a command forever. */
function startWatchdog() {
  const waiting = cmd === 'wait' || ((cmd === 'run' || cmd === 'run-cell') && flags.wait);
  let ms = 360000;
  if (waiting) ms = timeoutMs(12 * 3600 * 1000) + 360000;
  else if (cmd === 'sh' || cmd === 'exec') ms = timeoutMs(120000) + 120000;
  else if (cmd === 'start') ms = timeoutMs(300000) + 120000;
  else if (cmd === 'put') ms = 900000;
  setTimeout(() => {
    console.error(`ERROR: "${cmd}" got no answer from the page within ${Math.round(ms / 1000)} s, so its outcome is unknown. The tab may be frozen. Run: screenshot, then close-tab, then check status and cells with --url before retrying, because a job may still be running.`);
    process.exit(124);
  }, ms).unref();
}

const printOutputs = (cells, max = 4000) =>
  cells.forEach((c) => {
    if (c.type === 'markdown') return;
    console.log(`\n===== cell ${c.index}  exec=${c.exec ?? '·'}${c.error ? '  ERROR' : ''}  ${c.head}`);
    if (c.text) console.log(c.text.length > max ? `…(${c.text.length - max} earlier chars cut)…\n${c.text.slice(-max)}` : c.text);
  });

/**
 * Wait, print the tail as it moves, then the final outputs. Returns the exit code. With
 * onlyCell, report that cell alone, because other cells may hold errors from earlier runs.
 */
async function waitAndReport(page, onlyCell = null) {
  const r = await k.waitForRun(page, {
    timeoutMs: timeoutMs(12 * 3600 * 1000),
    onTick: ({ tail }) => console.log(tail.trim().split('\n').slice(-3).join('\n')),
  });
  const scoped = onlyCell !== null;
  // Errors are only meaningful at the end: until then they may be left from an earlier run.
  const errorCells = r.done ? (r.errors ?? []).filter((i) => !scoped || i === onlyCell) : [];
  // Finished with no error, yet code cells have no execution count: this tab was closed or
  // reloaded during the run, so the notebook no longer knows what happened.
  const missing = (r.notRun ?? []).filter((i) => !scoped || i === onlyCell);
  const indeterminate = !!r.done && !errorCells.length && missing.length > 0;
  if (!r.timedOut) {
    const cells = await k.outputs(page);
    printOutputs(scoped ? [cells[onlyCell]] : cells);
  }
  print({
    done: r.done,
    errored: errorCells.length > 0,
    interrupted: r.done ? (r.interrupted ?? false) : false,
    errorCells,
    notRunCells: r.done && !scoped ? r.notRun : undefined,
    indeterminate,
    sessionLost: r.sessionLost ?? false,
    timedOut: r.timedOut ?? false,
    runningCell: r.timedOut ? r.running : undefined,
  });
  if (indeterminate) console.error('Kernel is idle, but the notebook has no record of these cells. Output was lost when the tab closed or reloaded. Check files on disk with: sh');
  if (r.timedOut) return 124;
  if (r.sessionLost) return 2;
  if (errorCells.length) return 1;
  return indeterminate ? 3 : 0;
}

/** Print a kernel exec result and turn its status into an exit code. */
function reportExec(r) {
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.result) console.log(r.result);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) console.error(`${r.error.name}: ${r.error.value}`);
  return r.exitCode ?? (r.status === 'ok' ? 0 : 1);
}

async function main() {
  if (cmd === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (cmd === 'quota') {
    print(k.quota());
    return 0;
  }
  startWatchdog();

  const { ctx } = await k.connect();
  const page = async () => {
    const p = await k.notebookPage(ctx, flags.url ?? null);
    if (!SKIP_HEALTH.has(cmd)) await k.assertHealthy(p);
    return p;
  };

  switch (cmd) {
    case 'doctor': {
      const user = await k.whoAmI(ctx);
      print({ cdp: k.CDP_URL, signedIn: !!user, user, editorTabs: k.openEditors(ctx).map((p) => p.url().split('?')[0]) });
      if (!user) {
        console.error('Not signed in. Ask the user to sign in, in the automation Chrome window, at https://www.kaggle.com/account/login');
        return 1;
      }
      return 0;
    }
    case 'tabs':
      print(k.openEditors(ctx).map((p) => p.url().split('?')[0]));
      return 0;
    case 'new': {
      const p = await k.newNotebook(ctx, { title: flags.title ?? null });
      print({ url: p.url().split('?')[0], title: await k.notebookTitle(p) });
      return 0;
    }
    case 'status': {
      const p = await page();
      const title = await k.notebookTitle(p);
      const session = await k.sessionState(p);
      const accelerator = await k.getAccelerator(p);
      const internet = await k.getInternet(p);
      const cells = await k.getCells(p);
      const run = await k.runState(p);
      print({
        url: p.url().split('?')[0],
        title,
        accelerator,
        internet,
        session: session.state,
        uptime: session.uptime ?? null,
        kernel: run.kernel,
        busy: run.busy,
        cells: cells.length,
        versions: await k.versionCount(p),
        dialogs: await k.visibleDialogs(p),
      });
      return 0;
    }
    case 'rename':
      print(await k.renameNotebook(await page(), pos[0]));
      return 0;
    case 'visibility':
      print({ visibility: await k.getVisibility(await page()) });
      return 0;
    case 'accel':
      print(await k.setAccelerator(await page(), pos[0], { force: !!flags.force }));
      return 0;
    case 'internet': {
      if (!['on', 'off'].includes(pos[0])) fail('Use: internet on|off');
      print(await k.setInternet(await page(), pos[0] === 'on'));
      return 0;
    }
    case 'add-input':
      print(await k.addInput(await page(), pos[0]));
      return 0;
    case 'start':
      print(await k.startSession(await page(), { timeoutMs: timeoutMs(300000) }));
      return 0;
    case 'stop':
      print(await k.stopSession(await page()));
      return 0;
    case 'restart':
      print(await k.restartKernel(await page()));
      return 0;
    case 'resources':
      print(await k.resources(await page()));
      return 0;
    case 'push':
      print({ from: pos[0], ...(await k.setCells(await page(), k.parseCells(readFileSync(pos[0], 'utf8'), pos[0]))) });
      return 0;
    case 'cells':
      print(await k.getCells(await page()));
      return 0;
    case 'append':
      print(await k.appendCell(await page(), readSource(pos[0]), flags.markdown ? 'markdown' : 'code'));
      return 0;
    case 'set-cell':
      print(await k.setCellSource(await page(), index(pos[0]), readSource(pos[1])));
      return 0;
    case 'delete-cell':
      print(await k.deleteCell(await page(), index(pos[0])));
      return 0;
    case 'put':
      print(await k.putFile(await page(), pos[0], pos[1], { timeoutMs: timeoutMs(120000), queue: !!flags.queue }));
      return 0;
    case 'run': {
      const p = await page();
      await k.runAll(p, { startTimeoutMs: 300000 });
      console.log('run started');
      return flags.wait ? waitAndReport(p) : 0;
    }
    case 'run-cell': {
      const p = await page();
      const i = index(pos[0]);
      await k.runCell(p, i);
      console.log(`cell ${i} started`);
      return flags.wait ? waitAndReport(p, i) : 0;
    }
    case 'wait':
      return waitAndReport(await page());
    case 'interrupt':
      await k.interrupt(await page());
      print({ interruptSent: true });
      return 0;
    case 'outputs': {
      const cells = await k.outputs(await page());
      let chosen = cells;
      if (flags.cell !== undefined) {
        const i = index(flags.cell);
        if (!cells[i]) fail(`Cell ${i} is out of range (0-${cells.length - 1}).`);
        chosen = [cells[i]];
      }
      if (flags.json) print(chosen);
      else printOutputs(chosen, flags.max ? Number(flags.max) : 4000);
      return 0;
    }
    case 'sh':
    case 'exec': {
      if (!flags.file && !pos[0]) fail(`"${cmd}" needs code to run, or --file.`);
      const source = flags.file ? readFileSync(flags.file, 'utf8') : pos[0];
      const opts = { timeoutMs: timeoutMs(120000), queue: !!flags.queue };
      const p = await page();
      return reportExec(cmd === 'sh' ? await k.sh(p, source, opts) : await k.exec(p, source, opts));
    }
    case 'save-version':
      print(await k.saveVersion(await page(), { name: flags.name ?? null, quick: !!flags.quick }));
      return 0;
    case 'delete': {
      if (!flags.confirm) fail('delete needs --confirm <exact notebook title>.');
      const p = await page();
      const r = await k.deleteNotebook(p, flags.confirm);
      await p.close();
      print(r);
      return 0;
    }
    case 'close-tab':
      await (await page()).close();
      print({ closed: true });
      return 0;
    case 'selfcheck': {
      const r = await k.selfcheck(await page());
      print(r);
      return r.ok ? 0 : 1;
    }
    case 'map-ui':
      print(await k.mapUi(await page()));
      return 0;
    case 'screenshot': {
      await (await page()).screenshot({ path: pos[0] });
      print({ screenshot: pos[0] });
      return 0;
    }
    default:
      fail(`Unknown command "${cmd}".`);
  }
}

// Disconnecting on exit leaves Chrome, the tab and the Kaggle session running.
main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('ERROR: ' + e.message);
    process.exit(e.code ?? 1);
  });
