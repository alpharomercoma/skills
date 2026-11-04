// M1, M2, M3, M7, M8, C01: read the skill's resources output continuously during the phased GPU
// load, then fetch the independent truth files for scoring by score-gpu.py.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const SLUG = process.argv[2] || 'kn-eval-gpu';
const URL_ = `https://www.kaggle.com/code/alpharomercoma/${SLUG}/edit`;
const { ctx } = await k.connect();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let page = k.openEditors(ctx).find((p) => p.url().includes(`/${SLUG}/edit`));
if (!page) { const p = await k.newNotebook(ctx, { title: SLUG }); page = p; }
log('accel', JSON.stringify(await k.setAccelerator(page, 't4x2')));
log('push', JSON.stringify((await k.setCells(page, k.parseCells(readFileSync(`${E}harness/gpu_phases.py`, 'utf8'), 'gpu_phases.py'))).cells));
const t0 = Date.now();
const started = await k.startSession(page);
log('start', JSON.stringify(started), 'seconds', Math.round((Date.now() - t0) / 1000));
appendFileSync(`${E}raw/start-times.csv`, `${new Date().toISOString()},t4x2,${Math.round((Date.now() - t0) / 1000)}\n`);
await k.putFile(page, `${E}harness/sampler.py`, '/kaggle/working/sampler.py');
const sh = await k.sh(page, 'cd /kaggle/working; rm -f truth.jsonl marks.txt; nohup python sampler.py > sampler.log 2>&1 < /dev/null & echo $!');
log('sampler pid', sh.stdout.trim(), 'exit', sh.exitCode);
await new Promise((r) => setTimeout(r, 15000)); // let metrics begin flowing before the run

const out = `${E}raw/gpu-panel.jsonl`;
writeFileSync(out, '');
await k.runAll(page);
log('run started');
let reads = 0;
let fails = 0;
for (;;) {
  const before = Date.now();
  let r = null;
  let err = null;
  try { r = await k.resources(page, { timeoutMs: 12000 }); } catch (e) { err = e.message.slice(0, 120); fails += 1; }
  const after = Date.now();
  reads += 1;
  appendFileSync(out, JSON.stringify({ t0: before / 1000, t1: after / 1000, ok: !!r, err, r }) + '\n');
  const state = await k.runState(page);
  if (!state.busy && state.kernel === 'idle') break;
  await new Promise((res) => setTimeout(res, 3000));
}
log('run finished. resources reads', reads, 'failed', fails);
const cells = await k.outputs(page);
writeFileSync(`${E}raw/gpu-cell-output.txt`, cells.map((c) => c.text).join('\n'));
log(cells.map((c) => c.text).join('\n').split('\n').filter((l) => /steps=|ERROR/.test(l)).join(' | '));
// Fetch truth with the kernel, on the same channel any user would have.
for (const [remote, local] of [['truth.jsonl', 'gpu-truth.jsonl'], ['marks.txt', 'gpu-marks.txt']]) {
  const r = await k.exec(page, `print(open('/kaggle/working/${remote}').read())`, { timeoutMs: 60000 });
  writeFileSync(`${E}raw/${local}`, r.stdout);
  log('fetched', remote, r.stdout.length, 'chars');
}
process.exit(0);
