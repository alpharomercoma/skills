// Passive session watcher. Reads the session pill of open editor tabs and logs every change.
// It never clicks and never talks to the kernel, so it cannot count as activity.
//   node watch.mjs <minutes> <out.csv> <slug>...
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const [minutes, out, ...slugs] = process.argv.slice(2);
const { ctx } = await k.connect();
if (!existsSync(out)) writeFileSync(out, 'utc,slug,state,pill\n');
const last = new Map();
const deadline = Date.now() + Number(minutes) * 60000;

while (Date.now() < deadline) {
  for (const slug of slugs) {
    const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
    let state = 'tab-closed';
    let raw = '';
    if (page) {
      const s = await k.sessionState(page).catch(() => ({ state: 'read-error', raw: '' }));
      state = s.state;
      raw = (s.raw || '').replace(/,/g, ' ');
    }
    const key = state === 'running' ? 'running' : `${state}|${raw}`; // ignore the uptime ticking
    if (last.get(slug) !== key) {
      last.set(slug, key);
      appendFileSync(out, `${new Date().toISOString()},${slug},${state},${raw}\n`);
    }
  }
  await new Promise((r) => setTimeout(r, 15000));
}
process.exit(0);
