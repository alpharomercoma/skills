// I2, time-boxed: does a network message carry the panel's numbers? Passive only: no clicks, no edits.
// Paths are masked and bodies are never saved. Only whether a body mentions a metric-like word is kept.
import { writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const SLUG = process.argv[2] ?? 'kn-eval-cpu2';
const SECS = Number(process.argv[3] ?? 90);
const E = new URL('..', import.meta.url).pathname;
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${SLUG}/edit`));
if (!page) throw new Error(`no tab for ${SLUG}`);
const METRIC = /gpu.?util|gpu.?mem|memory.?used|cpu.?(usage|percent|util)|disk.?used|memoryUsage|cpuUsage|diskUsage|gpuUsage/i;
const mask = (u) => { try { const x = new URL(u); return `${x.host.replace(/^kkb[^.]*/, 'kkb*')}${x.pathname.replace(/[0-9a-f]{8,}|eyJ[\w.-]+/gi, '*')}`; } catch { return 'unparsable'; } };
const rows = new Map();
const note = (key, hit, bytes) => { const r = rows.get(key) ?? { count: 0, metricHits: 0, bytes: 0 }; r.count += 1; r.metricHits += hit ? 1 : 0; r.bytes += bytes; rows.set(key, r); };

page.on('response', async (res) => {
  const type = res.headers()['content-type'] ?? '';
  let body = '';
  if (/json|text|proto|grpc/.test(type)) body = await res.text().catch(() => '');
  note(`HTTP ${res.request().method()} ${mask(res.url())}`, METRIC.test(body), body.length);
});
for (const target of [page, ...page.frames().filter((f) => f !== page.mainFrame())]) {
  try {
    const cdp = await ctx.newCDPSession(target);
    await cdp.send('Network.enable');
    const names = new Map();
    cdp.on('Network.webSocketCreated', (e) => names.set(e.requestId, mask(e.url)));
    cdp.on('Network.webSocketFrameReceived', (e) => note(`WS ${names.get(e.requestId) ?? 'existing socket'}`, METRIC.test(e.response.payloadData ?? ''), (e.response.payloadData ?? '').length));
  } catch { /* out-of-process frames may refuse a session */ }
}
await new Promise((r) => setTimeout(r, SECS * 1000));
const inPage = await page.evaluate((src) => {
  const re = new RegExp(src, 'i');
  const hits = [];
  for (const key of Object.keys(window)) { if (re.test(key)) hits.push(key); }
  return hits.slice(0, 20);
}, METRIC.source).catch(() => []);
const out = { slug: SLUG, seconds: SECS, globalsMatching: inPage, rows: [...rows].map(([key, r]) => ({ key, ...r })).sort((a, b) => b.metricHits - a.metricHits || b.count - a.count) };
writeFileSync(`${E}raw/i2-network.json`, JSON.stringify(out, null, 1));
console.log(`${out.rows.length} endpoints; with metric words: ${out.rows.filter((r) => r.metricHits).length}`);
for (const r of out.rows.slice(0, 14)) console.log(r.metricHits, r.count, r.bytes, r.key.slice(0, 100));
process.exit(0);
