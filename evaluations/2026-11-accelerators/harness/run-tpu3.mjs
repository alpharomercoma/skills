// A3 / U3, last attempt, at the owner's request: queue a TPU session and wait, up to the given hours. If it starts,
// run JAX and PyTorch XLA for real, stop it, and delete this test notebook. A queued request isn't billed.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const SLUG = 'kn-eval-tpu3';
const { ctx } = await k.connect();
const out = `${E}raw/tpu3.txt`;
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(l); appendFileSync(out, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = `https://www.kaggle.com/code/alpharomercoma/${SLUG}/edit`;
let page = await k.newNotebook(ctx, { title: SLUG });
const maxMin = Number(process.argv[2] || 6) * 60;
log('accel', await k.setAccelerator(page, 'tpu'));
await k.startSession(page, { timeoutMs: 15000 }).then((r) => log('start', r), (e) => log('requested; start returned', String(e.code), e.message.slice(0, 90)));
const cleanUp = async (why) => {
  log('cleaning up:', why);
  log('sessions-stop', await k.stopSessionByTitle(ctx, SLUG).catch((e) => e.message.slice(0, 120)));
  log('final quota', k.quota().map((q) => `${q.resource} ${q.used}`));
  try { execFileSync('kaggle', ['-W', 'kernels', 'delete', `alpharomercoma/${SLUG}`, '-y'], { stdio: 'ignore' }); log('notebook deleted'); } catch (e) { log('delete failed', e.message.slice(0, 80)); }
  await page.close().catch(() => {});
  process.exit(0);
};

const t0 = Date.now();
let lastPill = '';
let live = false;
while (Date.now() - t0 < maxMin * 60000) {
  // The tab can vanish, as it did at 05:28. Reopen it and carry on, since the request belongs to the session.
  if (page.isClosed()) { log('tab gone, reopening'); page = await k.notebookPage(ctx, URL_); }
  const s = await k.sessionState(page).catch(() => ({ state: 'read-error', raw: 'read-error' }));
  if (s.state === 'read-error') { await sleep(10000); continue; }
  if (s.raw !== lastPill) { log('pill', `+${((Date.now() - t0) / 60000).toFixed(1)}min`, s.raw); lastPill = s.raw; }
  const r = await k.runState(page).catch(() => ({}));
  if (r.connected && r.kernel === 'idle') { live = true; break; }
  if (s.state === 'off') { log('session went off while waiting'); break; }
  await sleep(30000);
}
log('waited minutes', ((Date.now() - t0) / 60000).toFixed(1), 'live', live, 'quota', k.quota().map((q) => `${q.resource} ${q.used}`));
if (!live) await cleanUp('it never started');
// Any failure below must still stop the session, so that it can't spend quota unattended.
process.on('uncaughtException', (e) => { log('error', e.message.slice(0, 160)); cleanUp('error').catch(() => process.exit(1)); });
process.on('unhandledRejection', (e) => { log('error', String(e?.message ?? e).slice(0, 160)); cleanUp('error').catch(() => process.exit(1)); });
setTimeout(() => cleanUp('50 min cap on TPU time').catch(() => process.exit(1)), 50 * 60000);

const rawPanel = async () => {
  await page.locator('button', { hasText: 'Draft Session' }).first().click();
  await sleep(2000);
  const t = await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Disk' && e.getBoundingClientRect().width > 0);
    for (let c = lbl; c; c = c.parentElement) { const x = c.innerText || ''; if (/Session/.test(x) && /Max/.test(x) && !/HDD/.test(x)) return x; }
    return null;
  });
  await page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
  return (t || 'none').split('\n').filter(Boolean).join(' | ');
};
await sleep(15000);
log('RAW PANEL idle', await rawPanel());
log('SKILL resources idle', await k.resources(page).catch((e) => e.message.slice(0, 160)));
log('truth', await k.sh(page, 'nproc; free -g | sed -n 2p; df -h / /kaggle/working | tail -2; ls /dev/accel* 2>/dev/null | wc -l; ls /dev/vfio 2>/dev/null | wc -l').then((r) => r.stdout.replace(/\n/g, ' | ')).catch((e) => e.message.slice(0, 120)));

const JAX = `import time, jax, jax.numpy as jnp
print("JAX", jax.__version__, "backend", jax.default_backend(), "local devices", jax.local_device_count())
print([str(d) for d in jax.devices()][:8])
x = jnp.ones((jax.local_device_count(), 512, 512), dtype=jnp.float32)
f = jax.pmap(lambda a: a @ a)
t0 = time.time(); y = f(x); y.block_until_ready(); t1 = time.time()
for _ in range(10):
    y = f(x); y.block_until_ready()
t2 = time.time()
print("first_ms", round((t1 - t0) * 1000), "warm10_ms", round((t2 - t1) * 1000))
print("correct", bool(jnp.all(y == 512)), "platforms", {s.device.platform for s in y.addressable_shards}, "shards", len(y.addressable_shards))
end = time.time() + 60
n = 0
while time.time() < end:
    y = f(x); y.block_until_ready(); n += 1
print("sustained_iters", n)`;
await k.setCells(page, [{ cell_type: 'code', source: JAX }]);
await k.runAll(page);
log('JAX run started');
await sleep(25000);
log('RAW PANEL during compute', await rawPanel());
log('SKILL resources during compute', await k.resources(page).catch((e) => e.message.slice(0, 160)));
const w = await k.waitForRun(page, { timeoutMs: 240000, pollMs: 3000 });
log('wait', { done: w.done, errored: w.errored, timedOut: !!w.timedOut });
log('JAX OUTPUT', (await k.outputs(page)).map((c) => c.text).join('\n').slice(0, 900));
log('quota', k.quota().map((q) => `${q.resource} ${q.used}`));

const XLA = `import time, torch
print("torch", torch.__version__)
import torch_xla, torch_xla.core.xla_model as xm, torch_xla.runtime as xr
print("torch_xla", torch_xla.__version__)
d = xm.xla_device()
t0 = time.time()
x = torch.ones((1024, 1024), device=d)
for _ in range(10):
    y = x @ x
    xm.mark_step()
print("device", d, "count", xr.global_runtime_device_count(), "ms", round((time.time() - t0) * 1000))
print("sum_ok", float(y.sum().cpu()) == 1024**3)`;
await k.setCells(page, [{ cell_type: 'code', source: XLA }]);
log('restart for XLA', await k.restartKernel(page).catch((e) => e.message.slice(0, 120)));
await k.runAll(page);
const w2 = await k.waitForRun(page, { timeoutMs: 240000, pollMs: 3000 });
log('XLA wait', { done: w2.done, errored: w2.errored, timedOut: !!w2.timedOut });
log('XLA OUTPUT', (await k.outputs(page)).map((c) => c.text).join('\n').slice(0, 900));
await cleanUp('tests finished');
