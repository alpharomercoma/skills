// Closed-tab survival, on CPU, with minute-level timing from Active Events.
//   b: detached job, tab closed, nothing else
//   c: same, plus a REST call to the session's server every 5 min from Node
//   d: same, plus a kernel WebSocket held open from Node for the whole run
// The base url stays in memory. Status is read from a separate tab and logged on each change.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
import * as j from '/Users/alpha/skills/kaggle-notebooks/scripts/jupyter.mjs';

const E = new URL('..', import.meta.url).pathname;
const { ctx } = await k.connect();
const WATCH_TAB = 'kn-eval-s3a-detached-nopoll';
const out = `${E}raw/closed-tab.csv`;
writeFileSync(out, 'utc,minutes_since_close,slug,event,detail\n');
const log = (slug, event, detail = '', closedAt = null) => {
  const m = closedAt ? ((Date.now() - closedAt) / 60000).toFixed(1) : '';
  appendFileSync(out, `${new Date().toISOString()},${m},${slug},${event},${String(detail).replace(/,/g, ';').slice(0, 160)}\n`);
  console.log(new Date().toISOString().slice(11, 19), m, slug, event, String(detail).slice(0, 120));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const variants = { 'kn-eval-s4b-closed': 'b', 'kn-eval-s4c-closed-rest': 'c', 'kn-eval-s4d-closed-ws': 'd' };
const state = {};
for (const slug of Object.keys(variants)) {
  let page = k.openEditors(ctx).find((p) => p.url().includes(`/${slug}/edit`));
  if (!page) page = await k.newNotebook(ctx, { title: slug });
  await k.startSession(page, { timeoutMs: 180000 });
  for (let i = 0; i < 40; i++) { const st = await k.runState(page); if (st.connected && st.kernel === 'idle') break; await sleep(1500); }
  await k.putFile(page, `${E}harness/job_heartbeat.py`, '/kaggle/working/job.py');
  const r = await k.sh(page, 'cd /kaggle/working; nohup python job.py > job.log 2>&1 < /dev/null & echo $!');
  const base = await j.serverBase(await k.jupyterFrame(page));
  state[slug] = { base, closedAt: null };
  log(slug, 'job started', `pid ${r.stdout.trim()}`);
  if (variants[slug] === 'd') {
    // Hold a socket to the notebook kernel from Node, with nothing else running through it.
    const kernels = await (await fetch(`${base}/api/kernels`)).json();
    state[slug].ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/kernels/${kernels[0].id}/channels?session_id=keepalive-test`);
    await new Promise((res, rej) => { state[slug].ws.onopen = res; state[slug].ws.onerror = () => rej(new Error('ws failed')); setTimeout(res, 8000); });
    log(slug, 'socket open', `readyState ${state[slug].ws.readyState}`);
  }
  await page.close();
  state[slug].closedAt = Date.now();
  log(slug, 'tab closed', '', state[slug].closedAt);
}

const watch = ctx.pages().find((p) => p.url().includes(`/${WATCH_TAB}/edit`));
await watch.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
const rows = async () => {
  const open = await watch.locator('button[aria-label^="More options for "]').first().isVisible().catch(() => false);
  if (!open) { await watch.getByRole('button', { name: /Active Events/i }).first().click({ timeout: 8000 }).catch(() => {}); await sleep(1200); }
  return watch.evaluate(() => [...document.querySelectorAll('button[aria-label^="More options for "]')].map((b) => {
    const title = b.getAttribute('aria-label').replace(/^More options for /, '');
    let row = b; for (let i = 0; i < 12 && row.parentElement; i++) { row = row.parentElement; if ((row.innerText || '').includes(title)) break; }
    const t = (row.innerText || '').trim().split('\n').map((x) => x.trim()).filter(Boolean);
    return { title, status: t.find((x) => /^(Running|Queued|Cancelled|Successful|Failed|Error|Stopped|Starting)/i.test(x)) ?? t.slice(1, 3).join(' ') };
  }));
};
const last = new Map();
const deadline = Date.now() + 70 * 60000;
let tick = 0;
while (Date.now() < deadline) {
  const list = await rows().catch(() => []);
  for (const r of list) {
    const key = r.status.replace(/^Running.*/, 'Running');
    if (last.get(r.title) !== key) {
      last.set(r.title, key);
      const v = state[r.title];
      log(r.title, 'status', r.status, v?.closedAt ?? null);
    }
  }
  if (tick % 5 === 0) {
    const s = state['kn-eval-s4c-closed-rest'];
    if (s?.base) {
      const r = await fetch(`${s.base}/api/kernels`, { signal: AbortSignal.timeout(15000) }).then(async (x) => `${x.status} ${x.status === 200 ? (await x.json()).map((q) => `${q.execution_state}/conn${q.connections}`).join(' ') : ''}`).catch((e) => `error ${e.name}`);
      log('kn-eval-s4c-closed-rest', 'rest poll', r, s.closedAt);
      const job = await j.shell(s.base, 'tail -1 /kaggle/working/job.log').then((x) => x.stdout.trim()).catch((e) => `shell failed: ${e.message.slice(0, 70)}`);
      log('kn-eval-s4c-closed-rest', 'job via sidecar', job, s.closedAt);
    }
    const d = state['kn-eval-s4d-closed-ws'];
    if (d?.ws) log('kn-eval-s4d-closed-ws', 'socket state', d.ws.readyState, d.closedAt);
  }
  tick += 1;
  await sleep(60000);
}
process.exit(0);
