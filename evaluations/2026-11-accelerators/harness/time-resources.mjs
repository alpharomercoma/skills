// Where does the time in resources go? Times each step, on the repo copy.
import * as k from '/Users/alpha/skills/kaggle-notebooks/scripts/driver.mjs';
const t = [Date.now()];
const lap = (n) => { t.push(Date.now()); console.log(n.padEnd(22), t[t.length - 1] - t[t.length - 2], 'ms'); };
const { ctx } = await k.connect(); lap('connect');
const page = k.openEditors(ctx).find((p) => p.url().includes(`/${process.argv[2]}/edit`)); lap('find tab');
await k.assertHealthy(page); lap('assertHealthy');
const samples = [];
for (let i = 0; i < 4; i++) { const a = Date.now(); const r = await k.resources(page).catch((e) => ({ err: e.message.slice(0, 80) })); samples.push(Date.now() - a); if (r.err) console.log(r.err); }
console.log('resources ms', samples.join(' '));
process.exit(0);
