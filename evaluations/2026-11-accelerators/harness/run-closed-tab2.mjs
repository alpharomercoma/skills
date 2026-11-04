// Closed tab, part 2. The first round's job ended near the cancel time, so it could not prove loss,
// and its keep-alive arm mixed REST calls with kernel commands.
//   S4e: 60 min job, tab closed, REST reads only (no kernel execution) every 5 min.
//   S4f: 60 min job, tab closed, nothing at all. After it is cancelled, start again and look for its files.
// Live retests of the fixed commands run in S4e's session before its tab closes.
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const CLI = `${process.env.HOME}/.claude/skills/kaggle-notebooks/scripts/cli.mjs`;
const out = `${E}raw/closed-tab2.csv`;
const retest = `${E}raw/retests.txt`;
const log = (slug, event, detail = '', closedAt = null) => {
  const m = closedAt ? ((Date.now() - closedAt) / 60000).toFixed(1) : '';
  const line = `${new Date().toISOString()},${m},${slug},${event},${String(detail).replace(/,/g, ';').slice(0, 170)}`;
  appendFileSync(out, line + '\n');
  console.log(line.slice(11, 19), m, slug, event, String(detail).slice(0, 130));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (...args) => new Promise((res) => execFile('node', [CLI, ...args], { timeout: 200000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => res({ code: err ? err.code ?? 'killed' : 0, stdout: stdout.trim(), stderr: stderr.trim() })));
const note = (label, r) => { const l = `${new Date().toISOString().slice(11, 19)} ${label} exit=${r.code} ${(r.stdout || r.stderr).replace(/\s+/g, ' ').slice(0, 220)}`; appendFileSync(retest, l + '\n'); console.log(l); };

const SLUGS = { e: 'kn-eval-s4e-closed-rest-only', f: 'kn-eval-s4f-closed-nothing' };
const BEAT = `import time
start = time.time()
while time.time() - start < 3600:
    print("beat", round(time.time() - start), flush=True)
    time.sleep(30)
print("JOB FINISHED", flush=True)
`;
const { ctx } = await k.connect();

// Leave the second CPU run's cap test alone: wait for it to finish first.
while (!(existsSync(`${E}raw/cpu2.txt`) && / stop \{/.test(readFileSync(`${E}raw/cpu2.txt`, 'utf8')))) await sleep(15000);

const open = async (slug) => {
  const page = await k.newNotebook(ctx, { title: slug });
  for (;;) {
    try { await k.startSession(page, { timeoutMs: 240000 }); return page; } catch (e) {
      if (e.code !== 1 || !/cap reached/i.test(e.message)) throw e;
      log(slug, 'waiting for a slot', e.message.slice(0, 50));
      await sleep(60000);
    }
  }
};
const launch = async (page, slug, name) => {
  const base = await k.sessionServer(page);
  await k.sh(page, `cat > /kaggle/working/beat.py <<'EOF'\n${BEAT}EOF`);
  log(slug, 'job', JSON.stringify(await k.jobStart(base, name, 'python /kaggle/working/beat.py')));
  return base;
};

// S4e, with the command retests first.
const pe = await open(SLUGS.e);
const url = pe.url();
note('start returned; immediate sh', await cli('sh', 'echo ready', '--url', url));
note('monitor start', await cli('monitor', 'start', '--url', url));
note('monitor start again, expect exit 1', await cli('monitor', 'start', '--url', url));
note('monitor stop', await cli('monitor', 'stop', '--url', url));
note('job start, parent and child ignore SIGTERM', await cli('job', 'start', 'stubborn', `bash -c 'trap "" TERM; (trap "" TERM; sleep 777) & sleep 778; wait'`, '--url', url));
await sleep(3000);
note('before stop', await cli('sh', 'pgrep -af "sleep 77[78]" | grep -v pgrep | wc -l', '--url', url));
const a = Date.now();
note('job stop', await cli('job', 'stop', 'stubborn', '--url', url));
appendFileSync(retest, `job stop took ${((Date.now() - a) / 1000).toFixed(1)} s\n`);
note('after stop, expect 0', await cli('sh', 'pgrep -af "sleep 77[78]" | grep -v pgrep | wc -l', '--url', url));
note('job status after stop', await cli('job', 'status', 'stubborn', '--url', url));
note('job stop a job that does not exist, expect failure', await cli('job', 'stop', 'nosuchjob', '--url', url));
note('sh timeout path: exit code passes through', await cli('sh', 'exit 7', '--url', url));
note('resources, one reading', await cli('resources', '--url', url));

const baseE = await launch(pe, SLUGS.e, 's4e');
await pe.close();
const closedE = Date.now();
log(SLUGS.e, 'tab closed', '', closedE);

// The second slot may take a while, so run it alongside the watching loop.
let closedF = null;
let baseF = null;
const startF = (async () => {
  const p = await open(SLUGS.f);
  baseF = await launch(p, SLUGS.f, 's4f');
  await p.close();
  closedF = Date.now();
  log(SLUGS.f, 'tab closed', '', closedF);
})().catch((e) => log(SLUGS.f, 'failed to start', e.message));

const restRead = async () => {
  const kernels = await fetch(`${baseE}/api/kernels`, { signal: AbortSignal.timeout(15000) }).then(async (x) => `${x.status} ${x.status === 200 ? (await x.json()).map((q) => `${q.execution_state}/conn${q.connections}`).join(' ') : ''}`).catch((e) => `error ${e.name}`);
  const job = await fetch(`${baseE}/api/contents/s4e.log?type=file&format=text&content=1`, { signal: AbortSignal.timeout(15000) }).then(async (x) => (x.status === 200 ? (await x.json()).content.trim().split('\n').pop() : `status ${x.status}`)).catch((e) => `error ${e.name}`);
  return `${kernels} | ${job}`;
};
const status = async () => {
  const rows = await k.listSessions(ctx, { all: true });
  return Object.fromEntries(rows.map((r) => [r.title, r.status]));
};
const last = {};
let doneE = false;
let doneF = false;
const deadline = closedE + 62 * 60000;
let tick = 0;
while (Date.now() < deadline && !(doneE && doneF)) {
  const now = await status().catch(() => ({}));
  for (const [letter, slug] of Object.entries(SLUGS)) {
    const closed = letter === 'e' ? closedE : closedF;
    if (!closed || !now[slug] || now[slug] === last[slug]) continue;
    last[slug] = now[slug];
    log(slug, 'status', now[slug], closed);
    if (now[slug] === 'cancelled') { if (letter === 'e') doneE = true; else doneF = true; }
  }
  if (tick % 5 === 0 && !doneE) log(SLUGS.e, 'rest read', await restRead(), closedE);
  tick += 1;
  await sleep(60000);
}
await startF;
log(SLUGS.e, 'final rest read', await restRead(), closedE);

if (doneF) {
  // The real question: is anything left of the job once the session has gone?
  const p = await k.notebookPage(ctx, `https://www.kaggle.com/code/alpharomercoma/${SLUGS.f}/edit`);
  await k.startSession(p, { timeoutMs: 240000 });
  const r = await k.sh(p, 'ls -a /kaggle/working | tr "\\n" " "; echo; pgrep -af beat.py | grep -v pgrep | wc -l; tail -1 /kaggle/working/s4f.log 2>&1');
  log(SLUGS.f, 'after restart, working dir / beat processes / log', r.stdout.replace(/\n/g, ' | '));
  await k.stopSession(p);
  await p.close();
}
const list = await status().catch(() => ({}));
log('all', 'end', JSON.stringify({ e: list[SLUGS.e], f: list[SLUGS.f] }));
process.exit(0);
