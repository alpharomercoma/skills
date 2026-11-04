// L tests: what really ends a long run? 90 minutes, on CPU, with no edits to the notebook.
//   L2: detached job, tab open, idle prompt left unanswered
//   L3: detached job, tab open, idle prompt answered with Continue editing
//   L1: foreground cell, tab open, idle prompt left unanswered
// Logs every change of pill, dialog and row status. Uses only passive reads, plus the click in L3.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const out = `${E}raw/long-runs.csv`;
const which = process.argv.slice(2); // e.g. L2 L3
const { ctx } = await k.connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (slug, event, detail = '') => {
  appendFileSync(out, `${new Date().toISOString()},${slug},${event},${String(detail).replace(/,/g, ';').slice(0, 200)}\n`);
  console.log(new Date().toISOString().slice(11, 19), slug, event, String(detail).slice(0, 110));
};
try { readFileSync(out); } catch { writeFileSync(out, 'utc,slug,event,detail\n'); }

const JOB = `import time
start = time.time()
for i in range(360):
    print(f"beat {i} elapsed_s={time.time() - start:.0f} utc={time.time():.0f}", flush=True)
    time.sleep(15)
print("JOB FINISHED", flush=True)
`;
const FG = `# %%
import time
start = time.time()
for i in range(360):
    print("beat", i, round(time.time() - start), flush=True)
    time.sleep(15)
print("FOREGROUND_DONE", flush=True)
`;
const plan = {
  L2: { slug: 'kn-eval-l2-job-unanswered', mode: 'job', answer: false },
  L3: { slug: 'kn-eval-l3-job-answered', mode: 'job', answer: true },
  L1: { slug: 'kn-eval-s5-foreground', mode: 'fg', answer: false },
  L4: { slug: 'kn-eval-l4-prompt-cancel', mode: 'idle', answer: 'cancel' }, // what does Cancel do?
};
const runs = [];
for (const id of which) {
  const p = plan[id];
  let page = k.openEditors(ctx).find((x) => x.url().includes(`/${p.slug}/edit`));
  if (!page) page = await k.newNotebook(ctx, { title: p.slug });
  await k.startSession(page, { timeoutMs: 240000 });
  for (let i = 0; i < 40; i++) { const st = await k.runState(page); if (st.connected && st.kernel === 'idle') break; await sleep(1500); }
  if (p.mode === 'job') {
    const base = await k.sessionServer(page);
    const write = await k.sh(page, `cat > /kaggle/working/long.py <<'EOF'\n${JOB}EOF`);
    const r = await k.jobStart(base, 'long', 'python /kaggle/working/long.py');
    log(p.slug, 'job started', JSON.stringify({ write: write.exitCode, pid: r.pid }));
  } else if (p.mode === 'fg') {
    await k.setCells(page, k.parseCells(FG, 'fg.py'));
    await k.runAll(page);
    log(p.slug, 'foreground started');
  } else {
    log(p.slug, 'idle session started');
  }
  runs.push({ ...p, id, page, startedAt: Date.now(), last: '', base: await k.sessionServer(page).catch(() => null) });
}

const deadline = Date.now() + 100 * 60000;
while (Date.now() < deadline && runs.some((r) => !r.ended)) {
  for (const r of runs) {
    if (r.ended) continue;
    const mins = ((Date.now() - r.startedAt) / 60000).toFixed(1);
    const pill = await k.sessionState(r.page).catch(() => ({ state: 'read-error', raw: '' }));
    const dialogs = await k.visibleDialogs(r.page).catch(() => []);
    const idlePrompt = dialogs.some((d) => /Are you still there/i.test(d));
    const key = `${pill.state === 'running' ? 'running' : pill.raw}|prompt=${idlePrompt}`;
    if (key !== r.last) { r.last = key; log(r.slug, `state at ${mins} min`, key); }
    if (idlePrompt && r.answer === 'cancel') {
      const clicked = await r.page.evaluate(() => {
        for (const d of document.querySelectorAll('[role="dialog"]')) {
          if (d.getBoundingClientRect().width > 0 && /Are you still there/i.test(d.innerText || '')) {
            const b = [...d.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Cancel');
            if (b) { b.click(); return true; }
          }
        }
        return false;
      });
      log(r.slug, `clicked Cancel at ${mins} min`, clicked);
    } else if (idlePrompt && r.answer) {
      const did = await k.answerIdlePrompt(r.page);
      log(r.slug, `answered prompt at ${mins} min`, did);
    }
    if (pill.state === 'off') {
      r.ended = true;
      log(r.slug, `session off at ${mins} min`, dialogs.join(' / ').slice(0, 160));
    }
  }
  // Every 10 min, read the job's progress for the runs that have one.
  const tenMin = Math.floor(Date.now() / 600000);
  for (const r of runs) {
    if (!r.ended && r.mode === 'job' && r.base && r.tenMin !== tenMin) {
      r.tenMin = tenMin;
      // Read-only, through REST, so that this itself isn't a notebook change.
      const res = await fetch(`${r.base}/api/contents/long.log?content=1&type=file&format=text`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
      const last = res?.ok ? (await res.json()).content.trim().split('\n').pop() : `status ${res?.status}`;
      log(r.slug, 'job progress', last);
    }
  }
  await sleep(30000);
}
for (const r of runs) log(r.slug, 'test ended', r.ended ? 'session had ended' : 'session still running');
process.exit(0);
