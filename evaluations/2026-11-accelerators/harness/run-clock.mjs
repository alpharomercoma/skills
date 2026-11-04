// What starts the no-tab clock? These two tests can prove the "last activity" idea wrong.
//   h: job starts at T. Tab stays open, untouched, until T+15, then closes. No commands or REST at all.
//      Gone near T+41 means the clock doesn't run from closing. Gone near T+56 means it does.
//   g: job starts at T. Tab closes at T+1. One command through the session's server at T+20, then nothing.
//      Gone near T+41 means a command doesn't reset the clock. Alive past T+45 means it does.
// Status comes only from Active Events in a separate temporary tab, which doesn't touch the session.
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
import * as j from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/jupyter.mjs';

const variant = process.argv[2];
const plan = { h: { slug: 'kn-eval-clock-h-close-at-15', closeAt: 15, commandAt: null }, g: { slug: 'kn-eval-clock-g-command-at-20', closeAt: 1, commandAt: 20 } }[variant];
const E = new URL('..', import.meta.url).pathname;
const out = `${E}raw/clock-test.csv`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T = null;
const log = (event, detail = '') => {
  const mins = T ? ((Date.now() - T) / 60000).toFixed(2) : '';
  const line = `${new Date().toISOString()},${plan.slug},${mins},${event},${String(detail).replace(/,/g, ';').slice(0, 170)}`;
  appendFileSync(out, line + '\n');
  console.log(line.slice(11, 19), plan.slug, mins, event, String(detail).slice(0, 110));
};
const JOB = `import time
start = time.time()
while time.time() - start < 5400:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(30)
print("JOB FINISHED", flush=True)
`;
const { ctx } = await k.connect();
const page = await k.newNotebook(ctx, { title: plan.slug });
await k.startSession(page, { timeoutMs: 240000 });
await k.sh(page, `cat > /kaggle/working/long.py <<'EOF'\n${JOB}EOF`);
const base = await k.sessionServer(page);
const job = await k.jobStart(base, 'long', 'python /kaggle/working/long.py');
T = Date.now();
log('T: job started', JSON.stringify(job));
await sleep(plan.closeAt * 60000);
await page.close();
log('tab closed');
let commanded = plan.commandAt === null;
let last = null;
for (;;) {
  const mins = (Date.now() - T) / 60000;
  if (!commanded && mins >= plan.commandAt) {
    commanded = true;
    const r = await j.shell(base, 'tail -1 /kaggle/working/long.log').then((x) => x.stdout.trim()).catch((e) => `failed: ${e.message.slice(0, 70)}`);
    log('the one command', r);
  }
  const rows = await k.listSessions(ctx, { all: true }).catch((e) => [{ title: plan.slug, status: `read failed: ${e.message.slice(0, 50)}` }]);
  const status = rows.find((r) => r.title === plan.slug)?.status ?? 'not listed';
  if (status !== last) { last = status; log('status', status); }
  if (status === 'cancelled') break;
  if (mins > 70) { log('still live at the end of the test', status); break; }
  await sleep(60000);
}
process.exit(0);
