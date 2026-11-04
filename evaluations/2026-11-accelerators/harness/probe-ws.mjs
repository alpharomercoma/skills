// Why does the terminal WebSocket fail? Try the upgrade by hand and report status codes.
// Prints url shapes, never urls. Also tries the same socket from inside the page's frame.
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const slug = process.argv[2];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const frame = await k.jupyterFrame(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await frame.evaluate(() => { const x = window.jupyterapp.serviceManager.serverSettings; return { base: x.baseUrl.replace(/\/$/, ''), ws: x.wsUrl.replace(/\/$/, '') }; });
// The two urls from the Kaggle Jupyter Server drawer.
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /^Run$/ }).first().click(); await sleep(900);
await page.getByRole('menuitem', { name: /Kaggle Jupyter Server/i }).first().click(); await sleep(2500);
const drawer = await page.evaluate(() => { const f = []; document.querySelectorAll('.MuiDrawer-root input, .MuiDrawer-root textarea').forEach((e) => { if (/^https?:/.test(e.value || '')) f.push(e.value); }); return [...new Set(f)]; });
await page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));

const pathUrl = drawer.find((u) => !new URL(u).search) ?? s.base;
const tokenUrl = drawer.find((u) => new URL(u).searchParams.has('token'));
const samePath = pathUrl.replace(/\/$/, '') === s.base;
console.log('drawer urls', drawer.length, 'path variant equals page baseUrl:', samePath);

const fetchJson = async (u, method = 'GET') => { const r = await fetch(u, { method, signal: AbortSignal.timeout(15000) }); const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 80) }; } };
const base = pathUrl.replace(/\/$/, '');
for (const t of (await fetchJson(`${base}/api/terminals`)).json ?? []) console.log('removing stray terminal', t.name, (await fetch(`${base}/api/terminals/${t.name}`, { method: 'DELETE' })).status);
const term = await fetchJson(`${base}/api/terminals`, 'POST');
console.log('terminal', term.status, term.json?.name);
const kernels = (await fetchJson(`${base}/api/kernels`)).json;

const upgrade = (urlStr, headers = {}) => new Promise((res) => {
  const u = new URL(urlStr.replace(/^ws/, 'http'));
  const req = https.request({ host: u.hostname, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...headers }, timeout: 10000 });
  req.on('upgrade', (r, sock) => { res({ upgraded: r.statusCode, proto: r.headers['sec-websocket-protocol'] ?? null }); sock.destroy(); });
  req.on('response', (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b.replace(/eyJ[\w.-]+/g, '<token>').slice(0, 120) })); });
  req.on('error', (e) => res({ error: e.message.slice(0, 80) }));
  req.on('timeout', () => { req.destroy(); res({ error: 'timeout' }); });
  req.end();
});
const wsBase = base.replace(/^http/, 'ws');
const host = new URL(base).origin;
const tq = tokenUrl ? new URL(tokenUrl).search : '';
const root = tokenUrl ? new URL(tokenUrl).origin : host;
const targets = {
  'terminal, path url': `${wsBase}/terminals/websocket/${term.json?.name}`,
  'terminal, path url, /api': `${wsBase}/api/terminals/websocket/${term.json?.name}`,
  'terminal, token query': `${root.replace(/^http/, 'ws')}/terminals/websocket/${term.json?.name}${tq}`,
  'kernel channels, path url': `${wsBase}/api/kernels/${kernels?.[0]?.id}/channels`,
};
for (const [name, url] of Object.entries(targets)) {
  for (const [hname, h] of Object.entries({ 'no origin': {}, 'origin=proxy': { Origin: host }, 'origin=kaggle': { Origin: 'https://www.kaggle.com' } })) {
    console.log(name.padEnd(28), hname.padEnd(14), JSON.stringify(await upgrade(url, h)));
  }
}
// From inside the page, where the proxy already carries a working kernel socket.
const pageTry = await frame.evaluate(async (name) => {
  const x = window.jupyterapp.serviceManager.serverSettings;
  const url = `${x.wsUrl.replace(/\/$/, '')}/terminals/websocket/${name}`;
  return await new Promise((res) => {
    const ws = new WebSocket(url);
    const out = [];
    const t = setTimeout(() => { ws.close(); res({ result: 'timeout', out: out.join('').slice(-200) }); }, 7000);
    ws.onopen = () => ws.send(JSON.stringify(['stdin', 'echo inside-page-$((6*7))\r']));
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m[0] === 'stdout') out.push(m[1]); } catch {} if (out.join('').includes('inside-page-42')) { clearTimeout(t); ws.close(); res({ result: 'works', out: 'inside-page-42' }); } };
    ws.onerror = () => { clearTimeout(t); res({ result: 'error' }); };
  });
}, term.json?.name);
console.log('from inside the page', JSON.stringify(pageTry));
console.log('kernel websocket currently used by page:', await frame.evaluate(() => { const k = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel; return { conn: k.connectionStatus, username: !!k.username, hasWsUrl: !!k.serverSettings.wsUrl, sameBase: k.serverSettings.wsUrl.startsWith(window.jupyterapp.serviceManager.serverSettings.wsUrl) }; }));
console.log('delete terminal', (await fetch(`${base}/api/terminals/${term.json?.name}`, { method: 'DELETE' })).status);
process.exit(0);
