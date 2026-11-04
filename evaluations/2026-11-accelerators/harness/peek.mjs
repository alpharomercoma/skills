import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${process.argv[2]}/edit`));
if (!page) { console.log('no tab'); process.exit(0); }
console.log(JSON.stringify({ title: await page.title(), pill: await k.sessionState(page), dialogs: await k.visibleDialogs(page), run: await k.runState(page).catch((e) => e.message.slice(0, 90)), visibility: await page.evaluate(() => document.visibilityState) }).slice(0, 500));
await page.screenshot({ path: process.argv[3] }).catch(() => {});
process.exit(0);
