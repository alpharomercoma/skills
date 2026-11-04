// Read the open active-events panel as text, and what a row's menu offers. Stops nothing.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${process.argv[2]}/edit`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button[aria-label^="More options for "]')].filter((b) => b.getBoundingClientRect().width > 0);
  return btns.map((b) => {
    let c = b; for (let i = 0; i < 6 && c.parentElement; i++) { c = c.parentElement; if ((c.innerText || '').split('\n').length >= 2 && c.getBoundingClientRect().height > 30) break; }
    return { aria: b.getAttribute('aria-label'), row: (c.innerText || '').trim().replace(/\n+/g, ' | ').slice(0, 160), hrefs: [...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).slice(0, 3), box: Math.round(b.getBoundingClientRect().y) };
  });
});
console.log('rows', JSON.stringify(rows, null, 1));
const heading = await page.evaluate(() => { const b = document.querySelector('button[aria-label^="More options for "]'); let c = b; for (let i = 0; i < 12 && c?.parentElement; i++) { c = c.parentElement; if ((c.innerText || '').length > 200) break; } return (c?.innerText || '').replace(/\n+/g, ' | ').slice(0, 700); });
console.log('panel text', heading);
if (rows.length) {
  await page.getByRole('button', { name: rows[0].aria, exact: true }).first().click(); await sleep(1200);
  console.log('row menu', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ')))));
  await page.keyboard.press('Escape'); await sleep(400);
}
process.exit(0);
