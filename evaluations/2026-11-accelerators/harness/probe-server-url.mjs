// I1b: does the official "Kaggle Jupyter Server" URL allow what the page's proxy refuses?
// The URLs carry a token, so they stay in memory and are never printed or saved.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const slug = process.argv[2];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /^Run$/ }).first().click(); await sleep(900);
await page.getByRole('menuitem', { name: /Kaggle Jupyter Server/i }).first().click(); await sleep(2500);
const urls = await page.evaluate(() => {
  const found = [];
  document.querySelectorAll('.MuiDrawer-root input, .MuiDrawer-root textarea').forEach((e) => { if (/^https?:/.test(e.value || '')) found.push(e.value); });
  document.querySelectorAll('.MuiDrawer-root *').forEach((e) => { if (e.children.length === 0 && /^https?:\/\/kkb/.test((e.textContent || '').trim())) found.push(e.textContent.trim()); });
  return [...new Set(found)];
});
await page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
console.log('urls found', urls.length, urls.map((u) => { const x = new URL(u); return { host: x.host.split('.')[0], segs: x.pathname.split('/').length, q: [...x.searchParams.keys()] }; }));
const scrub = (t) => t.replace(/eyJ[\w.-]+/g, '<token>').replace(/https?:\/\/\S+/g, '<url>').slice(0, 220);
for (const raw of urls) {
  const u = new URL(raw);
  const base = (u.origin + u.pathname).replace(/\/$/, '');
  const qs = u.search;
  const call = async (method, path, body) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}${path}${qs}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      return { status: r.status, ms: Date.now() - t0, text };
    } catch (e) { return { status: 'error', ms: Date.now() - t0, text: String(e.message) }; }
  };
  console.log('--- url variant, segments', u.pathname.split('/').length, 'query', [...u.searchParams.keys()]);
  for (const [m, p] of [['GET', '/api'], ['GET', '/api/kernels'], ['GET', '/api/sessions'], ['GET', '/api/terminals'], ['GET', '/api/contents/kaggle/working'], ['GET', '/api/kernelspecs']]) {
    const r = await call(m, p);
    console.log(m, p, r.status, `${r.ms}ms`, scrub(r.text));
  }
  const created = await call('POST', '/api/kernels', { name: 'python3' });
  console.log('POST /api/kernels', created.status, `${created.ms}ms`, scrub(created.text));
  if (created.status === 201 || created.status === 200) {
    const id = JSON.parse(created.text).id;
    const del = await call('DELETE', `/api/kernels/${id}`);
    console.log('DELETE kernel', del.status);
  }
  const term = await call('POST', '/api/terminals');
  console.log('POST /api/terminals', term.status, `${term.ms}ms`, scrub(term.text));
  if (term.status === 200) { const n = JSON.parse(term.text).name; console.log('DELETE terminal', (await call('DELETE', `/api/terminals/${n}`)).status); }
}
process.exit(0);
