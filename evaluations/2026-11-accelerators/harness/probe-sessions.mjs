// I5: where does "Manage active sessions" go, and can closed-tab sessions be listed and stopped?
// Read only: nothing is stopped here. Also captures the network call behind the list.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const slug = process.argv[2];
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];
page.on('response', async (res) => {
  const u = new URL(res.url());
  if (!u.pathname.includes('/api/i/')) return;
  const name = u.pathname.split('/').pop();
  if (!/session|active|running|kernelrun|ListKernel/i.test(name)) return;
  let shape = null;
  try { const j = await res.json(); shape = JSON.stringify(j, (key, v) => (typeof v === 'string' && v.length > 60 ? '<long>' : v)).slice(0, 900); } catch {}
  calls.push({ name, status: res.status(), body: res.request().postData()?.slice(0, 200), shape });
});
const dialogBtn = page.getByRole('button', { name: /Manage active sessions/i }).first();
console.log('dialog button visible', await dialogBtn.isVisible().catch(() => false));
if (await dialogBtn.isVisible().catch(() => false)) { await dialogBtn.click(); await sleep(3500); }
else {
  const events = page.getByRole('button', { name: /View Active Events/i }).first();
  console.log('active events button', await events.isVisible().catch(() => false));
  await events.click(); await sleep(3500);
}
await page.screenshot({ path: process.argv[3] });
const panel = await page.evaluate(() => {
  const out = {};
  out.url = location.pathname;
  out.dialogs = [...document.querySelectorAll('[role="dialog"],.MuiDrawer-root,.MuiPopover-root,[role="menu"]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || '').trim().replace(/\n+/g, ' | ').slice(0, 900));
  out.links = [...document.querySelectorAll('a[href*="/code/"]')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')).slice(0, 12);
  out.buttons = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && /stop|shut|kill|terminate|more_vert|close/i.test((b.getAttribute('aria-label') || '') + (b.innerText || ''))).map((b) => ({ aria: b.getAttribute('aria-label'), text: (b.innerText || '').trim().slice(0, 30) })).slice(0, 16);
  return out;
});
console.log(JSON.stringify(panel, null, 1));
console.log('API CALLS', JSON.stringify(calls, null, 1));
process.exit(0);
