// L8: does answering the idle prompt save a job? Job, tab open, no commands until the prompt appears.
// Then one normal `job status --url`, which should answer it. L6, the same with no answer, was cancelled
// about 2 min after its prompt. Status comes from the page and from Active Events in a separate tab.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const CLI = `${process.env.HOME}/.claude/skills/kaggle-notebooks/scripts/cli.mjs`;
const slug = 'kn-eval-l8-prompt-answered';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = null;
const log = (event, d = '') => {
  const m = T ? ((Date.now() - T) / 60000).toFixed(2) : '';
  const line = `${new Date().toISOString()},${slug},${m},${event},${String(d).replace(/,/g, ';').slice(0, 220)}`;
  appendFileSync(`${E}raw/prompt-answer.csv`, line + '\n');
  console.log(line.slice(11, 19), m, event, String(d).slice(0, 130));
};
const cli = (...a) => new Promise((res) => execFile('node', [CLI, ...a], { timeout: 150000 }, (e, so, se) => res({ code: e ? e.code ?? 'killed' : 0, out: `${so} ${se}`.replace(/\s+/g, ' ').trim() })));
const JOB = `import time
start = time.time()
while time.time() - start < 5400:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(30)
`;
const { ctx } = await k.connect();
const page = await k.newNotebook(ctx, { title: slug });
await k.startSession(page, { timeoutMs: 240000 });
await k.sh(page, `cat > /kaggle/working/long.py <<'EOF'\n${JOB}EOF`);
const base = await k.sessionServer(page);
const job = await k.jobStart(base, 'long', 'python /kaggle/working/long.py');
T = Date.now();
log('T: job started', JSON.stringify(job));
const url = page.url().split('?')[0];
let answered = false;
let last = '';
const end = T + 56 * 60000;
while (Date.now() < end) {
  const pill = await k.sessionState(page).catch((e) => ({ state: `read-error ${e.message.slice(0, 40)}` }));
  const dialogs = await k.visibleDialogs(page).catch(() => []);
  const prompt = dialogs.some((d) => /Are you still there/i.test(d));
  const key = `${pill.state}|prompt=${prompt}`;
  if (key !== last) { last = key; log('state', key); }
  if (pill.state === 'off') break;
  if (prompt && !answered) {
    answered = true;
    const r = await cli('job', 'status', 'long', '--url', url);
    log('answered with job status', `exit=${r.code} ${(/"logTail": "[^"]*"/.exec(r.out)?.[0] ?? r.out).slice(0, 150)}`);
    log('dialogs after the command', JSON.stringify(await k.visibleDialogs(page).catch(() => 'read failed')).slice(0, 110));
  }
  await sleep(15000);
}
const rows = await k.listSessions(ctx, { all: true }).catch(() => []);
log('final', `${rows.find((r) => r.title === slug)?.status ?? 'not listed'} answered=${answered}`);
process.exit(0);
