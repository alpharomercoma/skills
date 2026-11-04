// Print pill, dialogs, toasts and visible error text for one notebook tab. Read only.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${process.argv[2]}/edit`));
if (!page) { console.log('no tab'); process.exit(1); }
console.log('pill:', (await k.sessionState(page)).raw);
console.log('dialogs:', JSON.stringify(await k.visibleDialogs(page)));
console.log('alerts:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[role="status"],.MuiSnackbar-root,.MuiAlert-root')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300)).filter(Boolean))));
const lines = await page.evaluate(() => document.body.innerText.split('\n').filter((l) => /limit|quota|concurrent|session|maximum|exceed|too many|unable|failed|error/i.test(l)).map((l) => l.slice(0, 200)));
console.log('matching text:', JSON.stringify([...new Set(lines)].slice(0, 12)));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
process.exit(0);
