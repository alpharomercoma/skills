// Second CPU run, meeting the written criteria: at least 10 settled samples per phase, the strict
// 20 s settling rule for both baseline and hold, and a saved timing series. Then: cap retest,
// SIGKILL and interrupt controls, the C16 warning replay, and output scrubbing on real text.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const B = 'https://www.kaggle.com/code/alpharomercoma';
const { ctx } = await k.connect();
const out = `${E}raw/cpu2.txt`;
writeFileSync(out, '');
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(l.slice(0, 260)); appendFileSync(out, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await k.newNotebook(ctx, { title: 'kn-eval-cpu2' });
log('start', await k.startSession(page, { timeoutMs: 240000 }));
const base = await k.sessionServer(page);
await k.putFile(base, `${E}harness/sampler.py`, '/kaggle/working/sampler.py');
log('sampler', await k.jobStart(base, 'sampler', 'python /kaggle/working/sampler.py'));
await sleep(15000);

const CELL = `# %%
import multiprocessing as mp, os, time
def mark(name):
    line = f"MARK {name} {time.time():.3f}"
    print(line, flush=True)
    open("/kaggle/working/marks.txt", "a").write(line + "\\n")
def burn(seconds):
    end = time.time() + seconds
    while time.time() < end:
        pass
def write_file(path, gib):
    with open(path, "wb") as f:
        for _ in range(gib * 1024):
            f.write(os.urandom(1024 * 1024))
        f.flush(); os.fsync(f.fileno())
mark("idle_0"); time.sleep(60)
mark("cpu_start")
ps = [mp.Process(target=burn, args=(70,)) for _ in range(os.cpu_count())]
[p.start() for p in ps]; [p.join() for p in ps]
mark("cpu_end"); time.sleep(60)
mark("ram_start")
blob = bytearray(8 * 2**30); blob[::4096] = b"\\x01" * (len(blob) // 4096)
mark("ram_held"); time.sleep(70)
del blob
mark("ram_end"); time.sleep(60)
mark("disk_work_start"); write_file("/kaggle/working/big.bin", 5); mark("disk_work_written"); time.sleep(70)
os.remove("/kaggle/working/big.bin"); mark("disk_work_end"); time.sleep(60)
mark("disk_tmp_start"); write_file("/tmp/big.bin", 5); mark("disk_tmp_written"); time.sleep(70)
os.remove("/tmp/big.bin"); mark("disk_tmp_end"); time.sleep(40)
mark("done")
`;
await k.setCells(page, k.parseCells(CELL, 'c.py'));
await k.runAll(page);
log('phases started');
const panel = `${E}raw/cpu2-panel.jsonl`;
writeFileSync(panel, '');
let n = 0;
let bad = 0;
for (;;) {
  const a = Date.now();
  let r = null;
  let err = null;
  try { r = await k.resources(page, { timeoutMs: 12000 }); } catch (e) { err = e.message.slice(0, 120); bad += 1; }
  appendFileSync(panel, JSON.stringify({ t0: a / 1000, t1: Date.now() / 1000, ok: !!r, err, r }) + '\n');
  n += 1;
  const st = await k.runState(page);
  if (!st.busy && st.kernel === 'idle') break;
  await sleep(1500);
}
log('phases finished; reads', n, 'failed', bad);
await k.getFile(base, '/kaggle/working/truth.jsonl', `${E}raw/cpu2-truth.jsonl`);
await k.getFile(base, '/kaggle/working/marks.txt', `${E}raw/cpu2-marks.txt`);
log('sampler stopped', await k.jobStop(base, 'sampler'));

// Cap retest: with 5 CPU sessions live, a sixth must fail at once with the reason.
const live = (await k.listSessions(ctx)).filter((r) => r.type === 'interactive' && r.accelerator === 'none').length;
log('live CPU sessions', live);
if (live >= 5) {
  const extra = await k.notebookPage(ctx, `${B}/kn-eval-s4b-closed/edit`);
  const t0 = Date.now();
  const r = await k.startSession(extra, { timeoutMs: 120000 }).then((x) => JSON.stringify(x), (e) => `ERROR code=${e.code} ${e.message}`);
  log('CPU cap retest', Math.round((Date.now() - t0) / 1000), 's', r.slice(0, 200));
  await extra.close().catch(() => {});
} else log('CPU cap retest not exercised: fewer than 5 live');

// C15: interrupt timing, then SIGKILL as a crash control.
await k.setCells(page, [{ cell_type: 'code', source: 'import time\nfor i in range(600):\n    print(i, flush=True); time.sleep(1)' }]);
await k.runAll(page);
await sleep(8000);
let t0 = Date.now();
await k.interrupt(page);
let w = await k.waitForRun(page, { timeoutMs: 60000, pollMs: 500 });
log('interrupt to idle', ((Date.now() - t0) / 1000).toFixed(1), 's', { done: w.done, interrupted: w.interrupted, errored: w.errored, kernelRestarted: w.kernelRestarted });

const pid = (await k.exec(page, 'import os; print(os.getpid())')).stdout.trim();
await k.setCells(page, [{ cell_type: 'code', source: 'import time\nfor i in range(600):\n    print(i, flush=True); time.sleep(1)' }]);
await k.runAll(page);
await sleep(8000);
const kills0 = await k.oomKills(page);
log('SIGKILL', pid, await k.sh(page, `kill -9 ${pid}; echo killed`).then((r) => r.stdout.trim()));
t0 = Date.now();
w = await k.waitForRun(page, { timeoutMs: 120000, pollMs: 3000 });
log('after SIGKILL', ((Date.now() - t0) / 1000).toFixed(1), 's', { done: w.done, errored: w.errored, kernelRestarted: w.kernelRestarted, sessionLost: w.sessionLost, notRun: w.notRun }, 'oom kills before', kills0, 'after', await k.oomKills(page));
log('new pid', (await k.exec(page, 'import os; print(os.getpid())', { timeoutMs: 60000 })).stdout.trim());

// A normal restart in a separate process must not read as a lost kernel in a later wait.
await k.setCells(page, [{ cell_type: 'code', source: 'print("ok")' }]);
await k.runAll(page);
w = await k.waitForRun(page, { timeoutMs: 60000, pollMs: 1000 });
log('normal run after restart', { done: w.done, errored: w.errored, kernelRestarted: w.kernelRestarted, notRun: w.notRun });

// C16: warnings on a replay, and none on a normal one.
const replay = async (label, rows) => {
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  await k.sh(page, `cat > /tmp/kn-monitor.jsonl <<'EOF'\n${body}\nEOF`);
  log(label, (await k.monitorReport(base)).warnings);
};
const row = (t, utils, mem, cpu, ram, disk) => ({ t, g: utils.map((u, i) => [i, u, mem[i], 15360]), c: cpu, n: 4, r: ram, rt: 30720, d: disk, dt: 19987 });
const now = Date.now() / 1000;
const series = (fn, secs = 300) => Array.from({ length: secs / 2 }, (_, i) => fn(now - secs + i * 2, i * 2));
await replay('C16 normal, both GPUs busy, expect none', series((t) => row(t, [80, 75], [4000, 4000], 40, 8000, 2000)));
await replay('C16 only GPU 0 used', series((t) => row(t, [80, 0], [4000, 3], 40, 8000, 2000)));
await replay('C16 no GPU, CPU busy', series((t) => row(t, [0, 0], [3, 3], 60, 8000, 2000)));
await replay('C16 GPU use collapses', series((t, s) => row(t, s < 200 ? [90, 90] : [0, 0], [4000, 4000], 40, 8000, 2000)));
await replay('C16 RAM at 95%', series((t) => row(t, [80, 80], [4000, 4000], 40, 29500, 2000)));
await replay('C16 working disk at 95%', series((t) => row(t, [80, 80], [4000, 4000], 40, 8000, 19000)));
await replay('C16 GPU memory at 96%', series((t) => row(t, [80, 80], [14800, 4000], 40, 8000, 2000)));

// Scrubbing on the real process list.
const ps = await k.sh(page, 'ps -ef | grep -i jupyter | grep -v grep | head -3');
log('real ps has a token-looking value', /token/i.test(ps.stdout), 'scrubbed still holds a long value after token:', /token[=:\s"']+[A-Za-z0-9_\-.]{16,}/i.test(k.scrub(ps.stdout).replace(/<token>/g, '')));
log('stop', await k.stopSession(page));
process.exit(0);
