import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes('/kn-eval-s1-idle-open/edit'));
if (!page) { console.log('no tab'); process.exit(0); }
console.log('pill', (await k.sessionState(page)).raw);
console.log('dialogs', JSON.stringify(await k.visibleDialogs(page)));
console.log('text', JSON.stringify(await page.evaluate(() => document.body.innerText.split('\n').filter((l) => /session|idle|timed out|stopped|expired|inactiv|restart/i.test(l)).map((l) => l.slice(0, 160)).slice(0, 14))));
await page.screenshot({ path: process.argv[2] });
process.exit(0);
