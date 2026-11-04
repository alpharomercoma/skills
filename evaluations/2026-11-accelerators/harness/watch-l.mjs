// After 05:28 the first long-test processes lost their tabs. L5 continues L3's job with an open tab,
// polled every 5 min through the CLI the way an agent would. L1b watches the foreground tab passively.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const E = new URL('..', import.meta.url).pathname;
const B = 'https://www.kaggle.com/code/alpharomercoma';
const out = `${E}raw/long-runs2.csv`;
const log = (slug, ev, d = '') => { const l = `${new Date().toISOString()},${slug},${ev},${String(d).replace(/,/g, ';').slice(0, 200)}`; appendFileSync(out, l + '\n'); console.log(l.slice(11, 19), slug, ev, String(d).slice(0, 120)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (...a) => new Promise((res) => execFile('node', [`${process.env.HOME}/.claude/skills/kaggle-notebooks/scripts/cli.mjs`, ...a], { timeout: 150000 }, (e, so, se) => res({ code: e ? e.code ?? 'killed' : 0, out: (so || se).replace(/\s+/g, ' ') })));
const { ctx } = await k.connect();
const L5 = `${B}/kn-eval-l3-job-answered/edit`;
const L1 = 'kn-eval-s5-foreground';
const deadline = Date.now() + 80 * 60000;
let l1last = '';
let l1done = false;
let l5done = false;
let tick = 0;
while (Date.now() < deadline && !(l1done && l5done)) {
  if (!l1done) {
    const page = ctx.pages().find((p) => p.url().includes(`/${L1}/edit`));
    if (!page) { log(L1, 'tab missing'); l1done = true; } else {
      const pill = await k.sessionState(page).catch((e) => ({ state: 'read-error', raw: e.message.slice(0, 40) }));
      const dialogs = await k.visibleDialogs(page).catch(() => []);
      const key = `${pill.state}|${dialogs.join(' / ').slice(0, 90)}`;
      if (key !== l1last) { l1last = key; log(L1, 'state', key); }
      if (pill.state === 'off') { l1done = true; log(L1, 'session off', dialogs.join(' / ').slice(0, 150)); }
    }
  }
  if (!l5done && tick % 10 === 0) {
    const r = await cli('job', 'status', 'long', '--url', L5);
    log('L5', 'poll', `exit=${r.code} ${r.out.slice(0, 170)}`);
    if (/"running": ?false|session|exit=2/i.test(r.out) && !/"running": ?true/.test(r.out)) { l5done = true; log('L5', 'ended', r.out.slice(0, 180)); }
  }
  tick += 1;
  await sleep(30000);
}
process.exit(0);
