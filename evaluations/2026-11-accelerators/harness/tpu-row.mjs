import { chromium } from '/Users/alpha/.claude/skills/kaggle-notebooks/node_modules/playwright-core/index.mjs';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = b.contexts()[0];
const page = await ctx.newPage();
await page.goto('https://www.kaggle.com/code', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('button[aria-controls="active-events-panel"]')?.click());
await page.waitForTimeout(1500);
const rows = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="More options for "]')].map((b) => {
  const title = b.getAttribute('aria-label').replace('More options for ', '');
  let row = b; while (row.parentElement && !(row.innerText || '').includes(title)) row = row.parentElement;
  return { title, text: (row.innerText || '').replace(/\n/g, ' | ').slice(0, 120) };
}));
console.log(JSON.stringify(rows.filter((r) => /tpu/i.test(r.title) || /queued/i.test(r.text)), null, 0));
const more = page.locator('button[aria-label="More options for kn-eval-tpu"]').first();
if (await more.count()) {
  await more.evaluate((x) => x.click());
  await page.waitForTimeout(800);
  console.log('menu', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.innerText.replace(/\n/g, ' ')))));
}
await page.close();
process.exit(0);
