// I2, I3: other channels into a live session, on one evaluation notebook. I1 is in probe-kernel.mjs.
// Prints shapes and timings only. Urls and values that could hold tokens are never printed.
import { writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const slug = process.argv[2];
const out = process.argv[3];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const frame = await k.jupyterFrame(page);
const report = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// I3: Jupyter Contents API for reading and writing files.
report.i3 = await frame.evaluate(async () => {
  const c = window.jupyterapp.serviceManager.contents;
  const r = {};
  for (const path of ['', 'kaggle/working', 'kaggle/working/job.log', 'job.log', '/kaggle/working/job.log']) {
    try {
      const m = await c.get(path, { content: path.endsWith('.log') });
      r[`get:${path || '(root)'}`] = { ok: true, type: m.type, entries: Array.isArray(m.content) ? m.content.map((e) => e.name).slice(0, 8) : undefined, size: m.size ?? (typeof m.content === 'string' ? m.content.length : null) };
    } catch (e) {
      r[`get:${path || '(root)'}`] = { ok: false, error: String(e.message || e).slice(0, 110) };
    }
  }
  return r;
});

// I2: what does the page fetch while the resources panel is open, and is there a metrics response?
const seen = new Map();
const onResponse = async (res) => {
  const req = res.request();
  const name = new URL(res.url()).pathname.split('/').slice(-2).join('/').slice(0, 70);
  const entry = seen.get(name) ?? { count: 0, method: req.method(), status: res.status(), metricKeys: null };
  entry.count += 1;
  if (!entry.metricKeys && /json|text/.test(res.headers()['content-type'] ?? '')) {
    const body = await res.text().catch(() => '');
    if (/gpu|cpu|memory|disk|utiliz/i.test(body) && body.length < 20000) {
      try { const j = JSON.parse(body.replace(/^\)\]\}'\n/, '')); entry.metricKeys = Object.keys(j).slice(0, 20); entry.sample = JSON.stringify(j, (key, v) => (typeof v === 'string' && v.length > 40 ? '<long>' : v)).slice(0, 500); } catch { entry.metricKeys = ['(not json)']; }
    }
  }
  seen.set(name, entry);
};
const wsFrames = { sockets: 0, metricFrames: 0, sample: null };
const onWs = (ws) => { wsFrames.sockets += 1; ws.on('framereceived', (f) => { const t = String(f.payload ?? ''); if (/gpu|cpu_|memory_|utiliz/i.test(t)) { wsFrames.metricFrames += 1; wsFrames.sample ??= t.replace(/eyJ[\w.-]+/g, '<token>').slice(0, 300); } }); };
page.on('response', onResponse);
page.on('websocket', onWs);
const before = await k.resources(page).catch((e) => ({ error: e.message.slice(0, 80) }));
await page.locator('button', { hasText: 'Draft Session' }).first().click();
await sleep(40000);
await page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
page.off('response', onResponse);
page.off('websocket', onWs);
report.i2 = { panel: before, responses: Object.fromEntries(seen), websockets: wsFrames };
report.i2b = await page.evaluate(() => ({
  perf: performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname.split('/').slice(-1)[0]).filter((n) => /metric|usage|stat|resource|session/i.test(n)).reduce((a, n) => { a[n] = (a[n] || 0) + 1; return a; }, {}),
}));

writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).replace(/https?:\/\/\S+/g, '<url>').replace(/eyJ[\w.-]+/g, '<token>').slice(0, 5500));
process.exit(0);
