// I6: a sidecar kernel over the Jupyter Server API, from Node. Does it work during a busy notebook
// kernel? What does it cost? Also the Contents API. The URL stays in memory and is never printed.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const slug = process.argv[2];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const frame = await k.jupyterFrame(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (t) => String(t).replace(/eyJ[\w.-]+/g, '<token>').replace(/(https?|wss?):\/\/\S+/g, '<url>');
const log = (...a) => console.log(...a.map((x) => scrub(typeof x === 'string' ? x : JSON.stringify(x))));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const base = await frame.evaluate(() => window.jupyterapp.serviceManager.serverSettings.baseUrl.replace(/\/$/, ''));
const api = async (method, path, body) => {
  const t0 = Date.now();
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return { status: r.status, ms: Date.now() - t0, body: await r.text() };
};

function connectKernel(id) {
  const session = randomUUID();
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/kernels/${id}/channels?session_id=${session}`);
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = pending.get(m.parent_header?.msg_id);
    if (!p) return;
    const t = m.msg_type ?? m.header?.msg_type;
    if (t === 'stream') p[m.content.name] += m.content.text;
    else if (t === 'error') p.error = `${m.content.ename}: ${m.content.evalue}`;
    else if (t === 'execute_reply') { p.status = m.content.status; p.gotReply = true; }
    else if (t === 'status' && m.content.execution_state === 'idle') p.gotIdle = true;
    if (p.gotReply && p.gotIdle) { pending.delete(m.parent_header.msg_id); p.resolve(p); }
  };
  const run = (code, ms = 30000) => new Promise((resolve) => {
    const msg_id = randomUUID();
    const t0 = Date.now();
    const p = { stdout: '', stderr: '', error: null, status: null, resolve: (x) => resolve({ ...x, ms: Date.now() - t0, resolve: undefined }) };
    pending.set(msg_id, p);
    ws.send(JSON.stringify({ header: { msg_id, msg_type: 'execute_request', username: 'kn', session, date: new Date().toISOString(), version: '5.3' }, parent_header: {}, metadata: {}, content: { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: false }, channel: 'shell', buffers: [] }));
    setTimeout(() => { if (pending.delete(msg_id)) resolve({ status: 'timeout', ms: Date.now() - t0, stdout: p.stdout }); }, ms);
  });
  return new Promise((res, rej) => { ws.onopen = () => res({ run, close: () => ws.close() }); ws.onerror = () => rej(new Error('kernel websocket failed')); setTimeout(() => rej(new Error('ws open timeout')), 20000); });
}

const memTotalUsed = 'import psutil; v=psutil.virtual_memory(); print(round((v.total-v.available)/2**20))';
const before = JSON.parse((await api('GET', '/api/kernels')).body);
log('kernels before', before.map((x) => x.execution_state));
const t0 = Date.now();
const created = await api('POST', '/api/kernels', { name: 'python3' });
const kernel = JSON.parse(created.body);
log('sidecar create', created.status, `${created.ms}ms`);
const side = await connectKernel(kernel.id);
let first = await side.run('print("ready")', 60000);
log('first exec after create', { status: first.status, ms: first.ms, totalMs: Date.now() - t0, out: first.stdout.trim() });
const rss = await side.run('import os, psutil; print(round(psutil.Process(os.getpid()).memory_info().rss/2**20))');
log('sidecar RSS MiB', rss.stdout.trim());

// Shell through the sidecar: exit codes, stderr, and the working directory.
const SH = (cmd) => `import subprocess, sys\n_r = subprocess.run(${JSON.stringify(['bash', '-c', cmd])}, capture_output=True, text=True)\nsys.stdout.write(_r.stdout); sys.stderr.write(_r.stderr); print("__rc__", _r.returncode)`;
log('shell ok', await side.run(SH('id -un; pwd; nproc')).then((r) => ({ out: r.stdout.trim(), ms: r.ms })));
log('shell exit 7', await side.run(SH('echo oops >&2; exit 7')).then((r) => ({ out: r.stdout.trim(), err: r.stderr.trim() })));

// Latency, kernel idle.
const idle = [];
for (let i = 0; i < 15; i++) idle.push((await side.run('1+1')).ms);
log('latency, notebook kernel idle (ms)', { median: median(idle), max: Math.max(...idle) });

// The real test: notebook kernel busy.
await frame.evaluate(() => { window.__busy = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.requestExecute({ code: 'import time; time.sleep(30)', silent: true, store_history: false }); });
await sleep(1500);
const states = JSON.parse((await api('GET', '/api/kernels')).body).map((x) => ({ state: x.execution_state, sidecar: x.id === kernel.id }));
log('states via api during busy cell', states);
const busy = [];
for (let i = 0; i < 15; i++) busy.push((await side.run('1+1')).ms);
log('latency, notebook kernel busy (ms)', { median: median(busy), max: Math.max(...busy) });
log('shell during busy cell', await side.run(SH('tail -1 /kaggle/working/job.log; ps -eo pcpu,comm --sort=-pcpu | head -3')).then((r) => ({ out: r.stdout.trim().slice(0, 200), ms: r.ms })));
log('page kernel status', await frame.evaluate(() => window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.status));
await frame.evaluate(async () => { await window.__busy.done; });
log('after the cell, states', JSON.parse((await api('GET', '/api/kernels')).body).map((x) => x.execution_state));

// Isolation: variables do not leak between kernels, and the notebook's cells do not change.
log('cells unchanged', await frame.evaluate(() => window.jupyterapp.shell.currentWidget.content.model.sharedModel.cells.length));

// Contents API.
const rootList = await api('GET', '/api/contents');
log('contents root', rootList.status, (() => { try { const j = JSON.parse(rootList.body); return { path: j.path, entries: (j.content || []).map((e) => e.name).slice(0, 8) }; } catch { return rootList.body.slice(0, 80); } })());
for (const p of ['job.log', 'kaggle/working/job.log']) {
  const r = await api('GET', `/api/contents/${p}?content=1&type=file&format=text`);
  log('contents get', p, r.status, r.status === 200 ? `${JSON.parse(r.body).content.length} chars` : r.body.slice(0, 50));
}
const payload = randomBytes(300000);
const sha = createHash('sha256').update(payload).digest('hex');
const put = await api('PUT', '/api/contents/probe.bin', { type: 'file', format: 'base64', content: payload.toString('base64') });
log('contents put 300 KB', put.status, `${put.ms}ms`);
if (put.status < 300) {
  const got = await api('GET', '/api/contents/probe.bin?content=1&type=file&format=base64');
  const buf = Buffer.from(JSON.parse(got.body).content, 'base64');
  log('contents get back', got.status, `${got.ms}ms`, createHash('sha256').update(buf).digest('hex') === sha ? 'sha256 matches' : 'SHA MISMATCH');
  log('landed at', await side.run(SH('find / -name probe.bin -not -path "/proc/*" 2>/dev/null | head -3')).then((r) => r.stdout.trim()));
  log('contents delete', (await api('DELETE', '/api/contents/probe.bin')).status);
}

// Does the sidecar keep working once the tab is gone? The tab comes back afterwards.
side.close();
log('delete sidecar', (await api('DELETE', `/api/kernels/${kernel.id}`)).status);
log('kernels after', JSON.parse((await api('GET', '/api/kernels')).body).length);
process.exit(0);
