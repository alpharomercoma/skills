// M4-M8 on CPU, then A6 (disk full) and A5 (RAM exhaustion kills the kernel), using the skill as
// it is installed today. Everything a user would see is recorded, including how long it took.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const SLUG = 'kn-eval-s5-foreground';
const { ctx } = await k.connect();
const page = k.openEditors(ctx).find((p) => p.url().includes(`/${SLUG}/edit`));
const out = `${E}raw/cpu-chain.txt`;
writeFileSync(out, '');
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(l); appendFileSync(out, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log('accelerator', await k.setAccelerator(page, 'none'));
log('start', await k.startSession(page, { timeoutMs: 180000 }));
await k.putFile(page, `${E}harness/sampler.py`, '/kaggle/working/sampler.py');
const sh = await k.sh(page, 'cd /kaggle/working; rm -f truth.jsonl marks.txt; nohup python sampler.py > sampler.log 2>&1 < /dev/null & echo $!');
log('sampler', sh.stdout.trim());
await sleep(15000);
await k.setCells(page, k.parseCells(readFileSync(`${E}harness/cpu_phases.py`, 'utf8'), 'cpu_phases.py'));
await k.runAll(page);
log('M4-M6 run started');
const panelOut = `${E}raw/cpu-panel.jsonl`;
writeFileSync(panelOut, '');
let reads = 0;
let fails = 0;
for (;;) {
  const before = Date.now();
  let r = null;
  let err = null;
  try { r = await k.resources(page, { timeoutMs: 12000 }); } catch (e) { err = e.message.slice(0, 120); fails += 1; }
  appendFileSync(panelOut, JSON.stringify({ t0: before / 1000, t1: Date.now() / 1000, ok: !!r, err, r }) + '\n');
  reads += 1;
  const st = await k.runState(page);
  if (!st.busy && st.kernel === 'idle') break;
  await sleep(2000);
}
log('M4-M6 finished, reads', reads, 'failed', fails);
log('cell output tail', (await k.outputs(page)).map((c) => c.text).join('\n').slice(-120).replace(/\n/g, ' | '));
for (const [remote, local] of [['truth.jsonl', 'cpu-truth.jsonl'], ['marks.txt', 'cpu-marks.txt']]) {
  const r = await k.exec(page, `print(open('/kaggle/working/${remote}').read())`, { timeoutMs: 60000 });
  writeFileSync(`${E}raw/${local}`, r.stdout);
}

// A6: fill /kaggle/working until the filesystem refuses.
const FILL = `import errno, os, shutil, time
print("before", shutil.disk_usage("/kaggle/working"), flush=True)
path = "/kaggle/working/fill.bin"
written = 0
chunk = os.urandom(1024 * 1024)
start = time.time()
with open(path, "wb") as f:
    while time.time() - start < 170:
        f.write(chunk)
        written += 1
        if written % 1024 == 0:
            f.flush(); os.fsync(f.fileno()); print("GiB", written // 1024, round(time.time() - start), flush=True)
print("NO_ERROR_WROTE_MIB", written, flush=True)`;
await k.setCells(page, [{ cell_type: 'code', source: FILL }, { cell_type: 'code', source: 'print("AFTER_FILL_SHOULD_NOT_RUN")' }]);
await k.runAll(page);
log('A6 fill started');
let w = await k.waitForRun(page, { timeoutMs: 200000, pollMs: 5000 });
log('A6 wait', { done: w.done, errored: w.errored, timedOut: !!w.timedOut, errors: w.errors, notRun: w.notRun });
log('A6 output', (await k.outputs(page)).map((c) => c.text).join('\n').slice(-420).replace(/\n/g, ' | '));
log('A6 panel', await k.resources(page, { timeoutMs: 15000 }).then((r) => r.sections.filter((s) => s.label === 'Disk')).catch((e) => e.message.slice(0, 100)));
log('A6 df + file', await k.sh(page, 'df -h /kaggle/working | tail -1; ls -la /kaggle/working/fill.bin | cut -d" " -f5; rm -f /kaggle/working/fill.bin; df -h /kaggle/working | tail -1').then((r) => r.stdout.replace(/\n/g, ' | ')).catch((e) => e.message.slice(0, 160)));

// A5: exhaust system RAM in the notebook kernel. The skill has never seen a kernel die in a run.
const pid0 = await k.exec(page, 'import os; print(os.getpid())').then((r) => r.stdout.trim());
log('A5 kernel pid before', pid0);
const OOM = `blocks = []
while True:
    b = bytearray(256 * 2**20)
    b[::4096] = b"\\x01" * (len(b) // 4096)
    blocks.append(b)
    print("allocated_gib", len(blocks) / 4, flush=True)`;
await k.setCells(page, [{ cell_type: 'code', source: OOM }, { cell_type: 'code', source: 'print("AFTER_OOM_SHOULD_NOT_RUN")' }]);
const t0 = Date.now();
await k.runAll(page);
log('A5 started');
const trace = [];
const poll = setInterval(async () => {
  const st = await k.runState(page).catch(() => null);
  const pill = await k.sessionState(page).catch(() => ({}));
  const line = `${st?.kernel}/${st?.connected}/busy=${st?.busy}/pending=${st?.pending} pill=${pill.raw?.slice(14, 40)}`;
  if (trace[trace.length - 1]?.[1] !== line) { trace.push([Math.round((Date.now() - t0) / 1000), line]); log('A5 state +' + Math.round((Date.now() - t0) / 1000) + 's', line); }
}, 2000);
w = await k.waitForRun(page, { timeoutMs: 240000, pollMs: 5000 }).catch((e) => ({ threw: e.message.slice(0, 160) }));
clearInterval(poll);
log('A5 wait returned after', Math.round((Date.now() - t0) / 1000), 's', { done: w.done, errored: w.errored, sessionLost: w.sessionLost, timedOut: !!w.timedOut, errors: w.errors, notRun: w.notRun, threw: w.threw, kernel: w.kernel });
log('A5 output tail', await k.outputs(page).then((c) => c.map((x) => x.text).join('\n').slice(-260).replace(/\n/g, ' | ')).catch((e) => e.message.slice(0, 100)));
log('A5 dialogs', await k.visibleDialogs(page));
log('A5 pill', (await k.sessionState(page)).raw);
const after = await k.exec(page, 'import os; print(os.getpid())', { timeoutMs: 60000 }).then((r) => r.stdout.trim()).catch((e) => `exec failed: ${e.message.slice(0, 120)}`);
log('A5 kernel pid after', after, after === pid0 ? 'SAME PID' : 'different');
log('A5 status', await k.kernelStatus(page).catch((e) => e.message.slice(0, 100)));
process.exit(0);
