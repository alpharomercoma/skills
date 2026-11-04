// A queued TPU request: what does its row hold, and can sessions-stop cancel it?
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const E = new URL('..', import.meta.url).pathname;
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.join(' ')}`; console.log(l.slice(0, 300)); appendFileSync(`${E}raw/tpu-stop-test.txt`, l + '\n'); };
const cli = (...a) => new Promise((res) => execFile('node', [`${process.env.HOME}/.claude/skills/kaggle-notebooks/scripts/cli.mjs`, ...a], { timeout: 110000 }, (e, so, se) => res({ code: e ? e.code ?? 'killed' : 0, out: `${so} ${se}`.replace(/\s+/g, ' ').trim() })));
const { ctx } = await k.connect();
const page = await k.newNotebook(ctx, { title: 'kn-eval-tpu-stop' });
log('accel', JSON.stringify(await k.setAccelerator(page, 'tpu')));
await k.startSession(page, { timeoutMs: 12000 }).then((r) => log('start', JSON.stringify(r)), (e) => log('start returned', String(e.code), e.message.slice(0, 80)));
await new Promise((r) => setTimeout(r, 8000));
const dump = async () => {
  const p = await ctx.newPage();
  await p.goto('https://www.kaggle.com/code', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelector('button[aria-controls="active-events-panel"]')?.click());
  await p.waitForTimeout(1500);
  const rows = await p.evaluate(() => [...document.querySelectorAll('button[aria-label^="More options for "]')].flatMap((b) => {
    const title = b.getAttribute('aria-label').replace('More options for ', '');
    if (title !== 'kn-eval-tpu-stop') return [];
    let row = b; while (row.parentElement && !(row.innerText || '').includes(title)) row = row.parentElement;
    return [JSON.stringify(row.innerText)];
  }));
  await p.close();
  return rows;
};
log('raw rows', (await dump()).join(' ;; '));
log('sessions', (await cli('sessions')).out.slice(0, 170));
const s = await cli('sessions-stop', 'kn-eval-tpu-stop');
log('sessions-stop', `exit=${s.code}`, s.out.slice(0, 200));
log('raw rows after', (await dump()).join(' ;; '));
process.exit(0);
