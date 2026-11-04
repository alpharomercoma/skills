// Isolated GPU run. No other GPU work is running, so quota changes can be attributed to this.
//   A1: three T4 cold starts. C05b: unequal memory held and read. Cap retest with a second T4.
//   S6 + Q1: a detached job on T4 for 22 min with no cell activity. Then stop, and Q2/C09 from the log.
import { appendFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const B = 'https://www.kaggle.com/code/alpharomercoma';
const { ctx } = await k.connect();
const out = `${E}raw/gpu2.txt`;
writeFileSync(out, '');
const log = (...a) => { const l = `${new Date().toISOString()} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(l.slice(11, 240)); appendFileSync(out, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gpu = () => k.quota().find((q) => q.resource === 'GPU').used;
const ledger = (label) => { const q = k.quota(); appendFileSync(`${E}raw/quota-ledger.csv`, `${new Date().toISOString()},${label},${q.find((x) => x.resource === 'GPU').used},${q.find((x) => x.resource === 'TPU').used}\n`); log('ledger', label, q.map((x) => `${x.resource} ${x.used}`)); };
const open = (slug) => k.notebookPage(ctx, `${B}/${slug}/edit`);

ledger('gpu2-start');
const page = await open('kn-eval-gpu');
log('accel', await k.setAccelerator(page, 't4x2'));

// A1: three cold starts.
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now();
  const r = await k.startSession(page, { timeoutMs: 240000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  log(`A1 start ${i}`, secs, 's', r.kernel?.status ?? r);
  appendFileSync(`${E}raw/start-times.csv`, `${new Date().toISOString()},t4x2-a1,${secs}\n`);
  const hw = await k.sh(page, 'nvidia-smi --query-gpu=name --format=csv,noheader | sort | uniq -c | tr -s " "');
  log(`A1 hardware ${i}`, hw.stdout.trim(), 'exit', hw.exitCode);
  log(`A1 stop ${i}`, await k.stopSession(page));
  await sleep(5000);
}
ledger('after-a1');

// C05b: unequal memory, held long enough to read it at least 10 times.
await k.startSession(page, { timeoutMs: 240000 });
log('monitor', await k.monitorStart(await k.sessionServer(page)));
await k.setCells(page, k.parseCells(`# %%
import time, torch
hold0 = torch.ones(2**30, dtype=torch.uint8, device="cuda:0")
hold1 = torch.ones(3 * 2**30, dtype=torch.uint8, device="cuda:1")
print("HOLDING", hold0.sum().item() == 2**30, hold1.sum().item() == 3 * 2**30, flush=True)
time.sleep(70)
del hold0, hold1
torch.cuda.empty_cache()
print("RELEASED", flush=True)
`, 'u.py'));
await k.runAll(page);
await sleep(20000);
const reads = [];
for (let i = 0; i < 14; i++) {
  const a = Date.now();
  const r = await k.resources(page);
  reads.push({ ms: Date.now() - a, gpus: r.gpus.map((g) => [g.utilPercent, g.memUsedMiB]) });
  await sleep(1500);
}
log('C05b panel reads', reads.length, 'latency ms', reads.map((x) => x.ms).join(' '));
log('C05b panel gpu mem', reads.slice(0, 5).map((x) => x.gpus.map((g) => g[1]).join('/')).join(' '));
const truth = await k.sh(page, 'nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits | tr "\\n" ";"');
log('C05b truth now', truth.stdout.trim());
const w = await k.waitForRun(page, { timeoutMs: 120000, pollMs: 3000 });
log('C05b wait', { done: w.done, errored: w.errored, kernelRestarted: w.kernelRestarted });
log('C05b output', (await k.outputs(page)).map((c) => c.text).join(' ').slice(0, 140));

// Cap retest: a second T4 must be refused at once, with the reason.
const p2 = await open('kn-eval-gpu2');
const t0 = Date.now();
const cap = await k.startSession(p2, { timeoutMs: 120000 }).then((r) => JSON.stringify(r), (e) => `ERROR code=${e.code} ${e.message}`);
log('Cap retest', Math.round((Date.now() - t0) / 1000), 's', cap.slice(0, 200));
await p2.close().catch(() => {});

// S6 + Q1: detached job, no cell activity, 22 minutes. Only the quota logger is watching.
const base = await k.sessionServer(page);
await k.sh(page, `cat > /kaggle/working/s6.py <<'EOF'
import time
start = time.time()
while time.time() - start < 1320:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(10)
print("S6_FINISHED", flush=True)
EOF`);
log('S6 start', await k.jobStart(base, 's6', 'python /kaggle/working/s6.py'));
ledger('s6-start');
await sleep(22.5 * 60000);
log('S6 status', await k.jobStatus(base, 's6', { lines: 2 }));
log('S6 pill', (await k.sessionState(page)).raw, 'dialogs', await k.visibleDialogs(page));
log('monitor report', await k.monitorReport(base));
ledger('s6-end');
log('stop', await k.stopSession(page));
ledger('stopped');
process.exit(0);
