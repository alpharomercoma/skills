// L9: is a busy cell treated differently from a background job? A cell runs for 90 min, tab open, no
// commands and no answer to any prompt. L6, a background job with an idle kernel, was cancelled at about 40 min.
// Passive only: the page's pill, dialogs and progress are read, and nothing is clicked.
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const slug = 'kn-eval-l9-foreground-untouched';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = null;
const log = (event, d = '') => {
  const m = T ? ((Date.now() - T) / 60000).toFixed(2) : '';
  const line = `${new Date().toISOString()},${slug},${m},${event},${String(d).replace(/,/g, ';').slice(0, 200)}`;
  appendFileSync(`${E}raw/foreground.csv`, line + '\n');
  console.log(line.slice(11, 19), m, event, String(d).slice(0, 120));
};
const { ctx } = await k.connect();
const page = await k.newNotebook(ctx, { title: slug });
await k.startSession(page, { timeoutMs: 240000 });
await k.setCells(page, k.parseCells(`# %%
import time
start = time.time()
while time.time() - start < 5400:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(30)
print("CELL_DONE", flush=True)
`, 'fg.py'));
await k.runAll(page);
T = Date.now();
log('T: cell started');
let last = '';
let lastTail = -1;
const end = T + Number(process.argv[2] ?? 62) * 60000;
while (Date.now() < end) {
  const pill = await k.sessionState(page).catch((e) => ({ state: `read-error ${e.message.slice(0, 40)}` }));
  const dialogs = await k.visibleDialogs(page).catch(() => []);
  const prompt = dialogs.some((d) => /Are you still there/i.test(d));
  const key = `${pill.state}|prompt=${prompt}`;
  if (key !== last) { last = key; log('state', key); }
  const minute = Math.floor((Date.now() - T) / 300000);
  if (minute !== lastTail) {
    lastTail = minute;
    const r = await k.runState(page).catch(() => null);
    log('progress', (r?.tail ?? '').trim().split('\n').pop());
  }
  if (pill.state === 'off') break;
  await sleep(15000);
}
const rows = await k.listSessions(ctx, { all: true }).catch(() => []);
log('final', rows.find((r) => r.title === slug)?.status ?? 'not listed');
process.exit(0);
