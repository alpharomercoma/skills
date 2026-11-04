// Close tabs left on this evaluation's deleted notebooks. The TPU attempt's tab and the user's other tabs stay.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const { ctx } = await k.connect();
let closed = 0;
for (const p of ctx.pages()) {
  if (/\/code\/alpharomercoma\/kn-(eval|u[1-6])-/.test(p.url()) && !p.url().includes('/kn-eval-tpu3/')) { await p.close(); closed += 1; }
}
console.log('closed', closed, 'left', ctx.pages().map((p) => p.url().slice(-40)));
process.exit(0);
