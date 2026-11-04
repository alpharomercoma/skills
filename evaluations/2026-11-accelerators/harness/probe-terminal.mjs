// I6: full test of the Jupyter Server channel, from Node with no browser in the loop after the URL
// is read. Real terminal over WebSocket, during a busy notebook kernel. Contents API for files.
// The URL carries a token, so it stays in memory; scrub() guards anything printed.
import { createHash, randomBytes } from 'node:crypto';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const slug = process.argv[2];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const frame = await k.jupyterFrame(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (t) => String(t).replace(/eyJ[\w.-]+/g, '<token>').replace(/https?:\/\/\S+/g, '<url>').replace(/wss?:\/\/\S+/g, '<url>');
const log = (...a) => console.log(...a.map((x) => scrub(typeof x === 'string' ? x : JSON.stringify(x))));

const server = await frame.evaluate(() => {
  const s = window.jupyterapp.serviceManager.serverSettings;
  return { base: s.baseUrl.replace(/\/$/, ''), ws: s.wsUrl.replace(/\/$/, ''), token: s.token || '' };
});
const jwtExp = () => {
  const m = server.base.match(/eyJ[\w-]+\.[\w-]*/);
  if (!m) return 'no jwt in path';
  try { const p = JSON.parse(Buffer.from(m[0].split('.')[1] ?? '', 'base64url').toString()); return { hasExp: !!p.exp, minutesLeft: p.exp ? Math.round((p.exp * 1000 - Date.now()) / 60000) : null, keys: Object.keys(p) }; } catch { return 'encrypted token (not readable)'; }
};
log('token info', jwtExp());
const api = async (method, path, body) => {
  const t0 = Date.now();
  const r = await fetch(`${server.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return { status: r.status, ms: Date.now() - t0, body: await r.text() };
};

async function openTerminal() {
  const created = await api('POST', '/api/terminals');
  if (created.status !== 200) throw new Error(`terminal create ${created.status}`);
  const name = JSON.parse(created.body).name;
  const ws = new WebSocket(`${server.ws}/terminals/websocket/${name}`);
  let buffer = '';
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error(`ws error ${e.message ?? ''}`)); setTimeout(() => rej(new Error('ws open timeout')), 15000); });
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m[0] === 'stdout') buffer += m[1]; } catch {} };
  const run = async (cmd, ms = 30000) => {
    const id = randomBytes(4).toString('hex');
    const start = buffer.length;
    const t0 = Date.now();
    ws.send(JSON.stringify(['stdin', `${cmd}; echo __END_${id}__$?\r`]));
    const re = new RegExp(`\\n?__END_${id}__(\\d+)`);
    while (Date.now() - t0 < ms) {
      const m = buffer.slice(start).match(re);
      if (m) {
        const text = buffer.slice(start, start + m.index).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '').split('\n').slice(1).join('\n');
        return { exit: Number(m[1]), ms: Date.now() - t0, text };
      }
      await sleep(30);
    }
    return { exit: null, ms: Date.now() - t0, text: buffer.slice(start).slice(-200) };
  };
  return { name, run, close: async () => { ws.close(); return (await api('DELETE', `/api/terminals/${name}`)).status; } };
}

const t = await openTerminal();
log('terminal open', t.name);
await t.run('stty -echo 2>/dev/null; export PS1=', 5000);
log('whoami', await t.run('id -un; pwd; nproc; python --version'));
log('exit code', await t.run('ls /nonexistent 2>/dev/null; (exit 7)'));
log('env persists', await t.run('FOO=bar; echo $FOO'));

// Latency sample with an idle kernel.
const idle = [];
for (let i = 0; i < 15; i++) idle.push((await t.run('true')).ms);
log('idle-kernel latency ms', { min: Math.min(...idle), median: idle.sort((a, b) => a - b)[7], max: Math.max(...idle) });

// Now make the notebook kernel busy, and show the terminal is unaffected.
await frame.evaluate(() => { window.__busy = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.requestExecute({ code: 'import time; time.sleep(25)', silent: true, store_history: false }); });
await sleep(1500);
const kernels = JSON.parse((await api('GET', '/api/kernels')).body);
log('kernel state via api during busy', kernels.map((x) => ({ state: x.execution_state, conns: x.connections })));
log('page says', await frame.evaluate(() => window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.status));
const busy = [];
for (let i = 0; i < 15; i++) busy.push((await t.run('true')).ms);
log('busy-kernel latency ms', { min: Math.min(...busy), median: busy.sort((a, b) => a - b)[7], max: Math.max(...busy) });
log('shell during busy', await t.run('tail -1 /kaggle/working/job.log; ps -eo pid,pcpu,comm --sort=-pcpu | head -4'));
await frame.evaluate(async () => { await window.__busy.done; });
const after = JSON.parse((await api('GET', '/api/kernels')).body);
log('kernel state after', after.map((x) => x.execution_state));

// Contents API.
log('contents root', await (async () => { const r = await api('GET', '/api/contents'); try { const j = JSON.parse(r.body); return { status: r.status, path: j.path, entries: (j.content || []).map((e) => e.name).slice(0, 10) }; } catch { return { status: r.status, body: r.body.slice(0, 120) }; } })());
for (const p of ['job.log', 'kaggle/working/job.log', 'working/job.log']) {
  const r = await api('GET', `/api/contents/${p}?content=1&type=file&format=text`);
  log('contents get', p, r.status, r.status === 200 ? { size: JSON.parse(r.body).content.length } : r.body.slice(0, 60));
}
const payload = randomBytes(300000);
const sha = createHash('sha256').update(payload).digest('hex');
const put = await api('PUT', '/api/contents/probe.bin', { type: 'file', format: 'base64', content: payload.toString('base64') });
log('contents put 300 KB', put.status, `${put.ms}ms`);
if (put.status < 300) {
  const got = await api('GET', '/api/contents/probe.bin?content=1&type=file&format=base64');
  log('contents get back', got.status, `${got.ms}ms`, Buffer.from(JSON.parse(got.body).content, 'base64').length, createHash('sha256').update(Buffer.from(JSON.parse(got.body).content, 'base64')).digest('hex') === sha ? 'sha256 matches' : 'SHA MISMATCH');
  log('where it landed', await t.run('find / -name probe.bin 2>/dev/null | head -3'));
  log('contents delete', (await api('DELETE', '/api/contents/probe.bin')).status);
}
log('terminal close', await t.close());
log('terminals left', (await api('GET', '/api/terminals')).body);
process.exit(0);
