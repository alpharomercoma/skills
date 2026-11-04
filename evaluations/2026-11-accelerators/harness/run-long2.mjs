// The first long tests lost their tabs at 05:28, so these replace them, with tab presence logged.
//   L6: detached job, tab open throughout, no commands, idle prompt left unanswered.
//   L7: detached job, tab closed at +1 min, reopened at +10 min by a normal `job status --url`,
//       then polled with `job status` every 5 min, the way an agent would. The CLI answers a prompt.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const CLI = `${process.env.HOME}/.claude/skills/kaggle-notebooks/scripts/cli.mjs`;
const out = `${E}raw/long-runs3.csv`;
const log = (slug, ev, d = '') => { const l = `${new Date().toISOString()},${slug},${ev},${String(d).replace(/,/g, ';').slice(0, 220)}`; appendFileSync(out, l + '\n'); console.log(l.slice(11, 19), slug, ev, String(d).slice(0, 130)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (...a) => new Promise((res) => execFile('node', [CLI, ...a], { timeout: 150000 }, (e, so, se) => res({ code: e ? e.code ?? 'killed' : 0, out: `${so} ${se}`.replace(/\s+/g, ' ').trim() })));
const JOB = `import time
start = time.time()
while time.time() - start < 6000:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(30)
print("JOB FINISHED", flush=True)
`;
const { ctx } = await k.connect();
const launch = async (slug) => {
  const page = await k.newNotebook(ctx, { title: slug });
  await k.startSession(page, { timeoutMs: 240000 });
  await k.sh(page, `cat > /kaggle/working/long.py <<'EOF'\n${JOB}EOF`);
  const base = await k.sessionServer(page);
  log(slug, 'job', JSON.stringify(await k.jobStart(base, 'long', 'python /kaggle/working/long.py')));
  return { page, startedAt: Date.now(), url: page.url().split('?')[0], slug, base };
};
const L6 = await launch('kn-eval-l6-job-tab-open');
const L7 = await launch('kn-eval-l7-job-reopened-polled');
await sleep(45000);
await L7.page.close();
L7.page = null;
log(L7.slug, 'tab closed', `${((Date.now() - L7.startedAt) / 60000).toFixed(1)} min`);

const mins = (r) => ((Date.now() - r.startedAt) / 60000).toFixed(1);
const watch = async (r) => {
  const page = ctx.pages().find((p) => p.url().includes(`/${r.slug}/edit`));
  if (!page) { const key = 'no tab'; if (r.last !== key) { r.last = key; log(r.slug, `state at ${mins(r)} min`, key); } return; }
  const pill = await k.sessionState(page).catch((e) => ({ state: 'read-error', raw: e.message.slice(0, 40) }));
  const dialogs = await k.visibleDialogs(page).catch(() => []);
  const key = `${pill.state}|${dialogs.join(' / ').slice(0, 110)}`;
  if (key !== r.last) { r.last = key; log(r.slug, `state at ${mins(r)} min`, key); }
};
// Read L6's log through REST at the end only: nothing touches it while it runs.
const deadline = L6.startedAt + 95 * 60000;
let lastPoll = 0;
let reopened = false;
let polling = true;
while (Date.now() < deadline) {
  await watch(L6);
  const sinceStart = (Date.now() - L7.startedAt) / 60000;
  if (sinceStart >= 10) await watch(L7);
  if (polling && sinceStart >= 10 && Date.now() - lastPoll >= 5 * 60000) {
    lastPoll = Date.now();
    const r = await cli('job', 'status', 'long', '--url', L7.url);
    if (!reopened) { reopened = true; log(L7.slug, `reopened by job status at ${mins(L7)} min`); }
    log(L7.slug, `poll at ${mins(L7)} min`, `exit=${r.code} ${(/"logTail": "[^"]*"/.exec(r.out)?.[0] ?? r.out).slice(0, 170)}`);
    if (r.code !== 0) polling = false;
  }
  await sleep(30000);
}
for (const r of [L6, L7]) {
  const live = await fetch(`${r.base}/api/contents/long.log?content=1&type=file&format=text`, { signal: AbortSignal.timeout(15000) }).then(async (x) => (x.status === 200 ? (await x.json()).content.trim().split('\n').pop() : `status ${x.status}`)).catch((e) => `error ${e.name}`);
  log(r.slug, `final at ${mins(r)} min`, live);
}
process.exit(0);
