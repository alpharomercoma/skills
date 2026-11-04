// Time each step of opening the panel, by pointer click and by DOM click.
import * as k from '/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = k.openEditors(ctx).find((p) => p.url().includes(`/${process.argv[2]}/edit`));
const timed = async (n, f) => { const a = Date.now(); const r = await f(); console.log(n.padEnd(34), Date.now() - a, 'ms'); return r; };
const read = () => page.evaluate(() => {
  const disk = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Disk' && e.getBoundingClientRect().width > 0);
  for (let c = disk; c; c = c.parentElement) { const t = c.innerText || ''; if (/Session/.test(t) && /RAM/.test(t) && /Max/.test(t) && !/HDD/.test(t)) return t; }
  return null;
});
const close = () => page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
await close(); await new Promise((r) => setTimeout(r, 400));
await timed('read with panel closed', read);
await timed('pointer click on pill', () => page.locator('button', { hasText: 'Draft Session' }).first().click({ timeout: 8000 }));
let text = null; const a = Date.now(); while (!text && Date.now() - a < 5000) text = await read();
console.log('time until text after pointer click'.padEnd(34), Date.now() - a, 'ms');
await timed('one read with panel open', read);
console.log('parse', JSON.stringify(k.parseResources(text)).slice(0, 200));
await timed('close (DOM)', close); await new Promise((r) => setTimeout(r, 300));
await timed('DOM click on pill', () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Draft Session/.test(b.innerText || ''))?.click()));
text = null; const b = Date.now(); while (!text && Date.now() - b < 5000) text = await read();
console.log('time until text after DOM click'.padEnd(34), Date.now() - b, 'ms', text ? 'got text' : 'no text');
await close();
process.exit(0);
