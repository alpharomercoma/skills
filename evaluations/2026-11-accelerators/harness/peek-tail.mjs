import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${process.argv[2]}/edit`));
const r = await k.runState(page);
const pill = await k.sessionState(page);
console.log(JSON.stringify({ at: new Date().toISOString(), pill: pill.state, tail: r.tail.trim().split('\n').pop(), pending: r.pending, dialogs: await k.visibleDialogs(page) }));
process.exit(0);
