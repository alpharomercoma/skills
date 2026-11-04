// Raw text of each Active Events row. Read only.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes('/kn-eval-s3b-detached-poll/edit')) ?? ctx.pages().find((p) => p.url().startsWith('https://www.kaggle.com'));
await page.evaluate(() => document.querySelectorAll('button[aria-label="Close"]').forEach((b) => b.getBoundingClientRect().width > 0 && b.click()));
const open = await page.locator('button[aria-label^="More options for "]').first().isVisible().catch(() => false);
if (!open) await page.getByRole('button', { name: /Active Events/i }).first().click({ timeout: 8000 });
await page.waitForTimeout(1500);
const rows = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="More options for "]')].map((b) => {
  const title = b.getAttribute('aria-label').replace(/^More options for /, '');
  let row = b; for (let i = 0; i < 12 && row.parentElement; i++) { row = row.parentElement; if ((row.innerText || '').includes(title)) break; }
  return { title, text: (row.innerText || '').trim().replace(/\n+/g, ' | ').slice(0, 170), hasStopIcon: /stop/i.test(row.innerHTML.slice(0, 0)) };
}));
for (const r of rows) console.log(r.title.padEnd(30), r.text);
const header = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /Active Events/.test(t)));
console.log('button text', header);
await page.getByRole('button', { name: /Active Events/i }).first().click({ timeout: 3000 }).catch(() => {});
const first = rows.find((r) => /Running:/.test(r.text));
process.exit(0);
