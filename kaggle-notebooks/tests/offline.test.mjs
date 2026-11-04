// Offline checks that need no browser and no Kaggle account. Run with: node --test tests/
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clipOutput, lowQuotaWarning, parseCells, parseResources, scrub } from '../scripts/driver.mjs';
import { jobStartScript, jobStopScript, monitorReportScript } from '../scripts/jupyter.mjs';

const CLI = new URL('../scripts/cli.mjs', import.meta.url).pathname;
const cli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', timeout: 20000 });

// Real panel text, as innerText gives it: one value per line.
const CPU_PANEL = `Draft Session
No Accelerator
Session
1m
12 hours
Disk
2GiB
Max 57.6GiB
CPU
CPU
0.00%
RAM
564.8MiB
Max 30GiB`;
const GPU_PANEL = `Draft Session
GPU T4 x2 On
Session
0m
12 hours
Disk
2GiB
Max 57.6GiB
CPU
CPU
78.00%
RAM
563.6MiB
Max 30GiB
GPU
GPU
95.00%
GPU Memory
2.2GiB
Max 15GiB
GPU
GPU
0.00%
GPU Memory
3MiB
Max 15GiB`;

test('parses a CPU panel with every value', () => {
  const r = parseResources(CPU_PANEL);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unrecognised, []);
  assert.equal(r.accelerator, 'No Accelerator');
  assert.equal(r.uptime, '1m');
  assert.equal(r.sessionLimit, '12 hours');
  assert.equal(r.cpuPercent, 0);
  assert.equal(r.ram.usedMiB, 564.8);
  assert.equal(r.ram.maxMiB, 30720);
  assert.equal(r.disk.maxMiB, 58982.4);
  assert.deepEqual(r.gpus, []);
});

test('keeps two GPUs apart, in panel order', () => {
  const r = parseResources(GPU_PANEL);
  assert.deepEqual(r.missing, []);
  assert.equal(r.gpus.length, 2);
  assert.deepEqual(r.gpus[0], { index: 0, utilPercent: 95, memUsedMiB: 2252.8, memMaxMiB: 15360 });
  assert.deepEqual(r.gpus[1], { index: 1, utilPercent: 0, memUsedMiB: 3, memMaxMiB: 15360 });
  assert.deepEqual(r.unrecognised, []);
});

test('reads zero bytes of GPU memory as zero, not as missing', () => {
  const r = parseResources(GPU_PANEL.replace('3MiB', '0Bytes'));
  assert.equal(r.gpus[1].memUsedMiB, 0);
  assert.deepEqual(r.missing, []);
});

test('reports a GPU session with no GPU values as incomplete', () => {
  const r = parseResources(GPU_PANEL.split('\nGPU\nGPU')[0]);
  assert.ok(r.missing.some((m) => m.startsWith('gpu count')));
});

test('reports a GPU with no memory line as incomplete', () => {
  const r = parseResources(GPU_PANEL.replace(/GPU Memory\n3MiB\nMax 15GiB/, ''));
  assert.ok(r.missing.includes('gpu 1'));
});

test('reports missing core values', () => {
  const r = parseResources('Draft Session\nNo Accelerator');
  assert.deepEqual(r.missing.sort(), ['cpu', 'disk', 'ram', 'session']);
});

test('keeps unknown lines rather than dropping them', () => {
  const r = parseResources(`${CPU_PANEL}\nTPU\n12.00%`);
  assert.ok(r.unrecognised.includes('TPU'));
  assert.ok(r.unrecognised.includes('12.00%'));
});

test('an unknown unit is missing, not guessed', () => {
  const r = parseResources(CPU_PANEL.replace('564.8MiB', '564.8furlongs'));
  assert.ok(r.missing.includes('ram'));
});

test('empty and odd panel text never throws', () => {
  for (const text of ['', null, undefined, '\n\n', 'Disk', 'CPU\nCPU']) assert.ok(parseResources(text).missing.length > 0);
});

test('splits .py on markers, with markdown and labels', () => {
  const cells = parseCells('# %%\nprint(1)\n# %% [markdown]\n# # H\n# text\n# %% second\nprint(2)\n');
  assert.deepEqual(cells, [
    { cell_type: 'code', source: 'print(1)' },
    { cell_type: 'markdown', source: '# H\ntext' },
    { cell_type: 'code', source: 'print(2)' },
  ]);
});

test('keeps code before the first marker, and drops comment-only headers', () => {
  assert.equal(parseCells('import x\n# %%\nprint(1)\n').length, 2);
  assert.equal(parseCells('# only a comment\n\n# %%\nprint(1)\n').length, 1);
});

test('a file with no markers is one cell, and an empty file is no cells', () => {
  assert.deepEqual(parseCells('print(1)\n'), [{ cell_type: 'code', source: 'print(1)' }]);
  assert.deepEqual(parseCells(''), []);
});

test('reads notebooks, keeping raw cells and attachments', () => {
  const nb = { cells: [{ cell_type: 'markdown', source: ['# a\n', 'b'], attachments: { 'x.png': {} } }, { cell_type: 'raw', source: 'r' }, { cell_type: 'code', source: 'print(1)', outputs: [] }] };
  const cells = parseCells(JSON.stringify(nb), 'n.ipynb');
  assert.equal(cells.length, 3);
  assert.equal(cells[0].source, '# a\nb');
  assert.ok(cells[0].attachments);
  assert.equal(cells[1].cell_type, 'raw');
});

for (const [args, pattern] of [
  [['stop', '--url'], /--url needs a value/],
  [['stop', '--url', ''], /--url needs a value/],
  [['stop'], /needs --url/],
  [['push', 'x.py'], /needs --url/],
  [['save-version', '--quik', '--url', 'u'], /does not take --quik/],
  [['accel', 'none', '--force', 'false', '--url', 'u'], /takes 1 argument/],
  [['wait', '--timeout', 'oops'], /positive number/],
  [['wait', '--timeout', '-5'], /positive number/],
  [['nosuch'], /Unknown command/],
  [['put', 'a', '--url', 'u'], /needs 2 argument/],
  [['run', '--url', '--wait'], /--url needs a value/],
  [['quota', '--url', 'u'], /does not take --url/],
  [['job', '--url', 'u'], /at least 1 argument/],
  [['push', '/no/such/file.py', '--url', 'u'], /No such file/],
  [['append', '/no/such/file.py', '--url', 'u'], /No such file/],
  [['set-cell', '0', '/no/such/file.py', '--url', 'u'], /No such file/],
  [['put', '/no/such/file', '/kaggle/working/x', '--url', 'u'], /No such file/],
  [['sh', '--file', '/no/such/file', '--url', 'u'], /No such file/],
  [['exec', '--file', '/no/such/file', '--url', 'u'], /No such file/],
  [['exec', '--file', '-', '--url', 'u'], /No such file/],
  [['push', '-', '--url', 'u'], /No such file/],
  [['append', '/tmp', '--url', 'u'], /No such file/],
]) {
  test(`refuses before connecting: ${args.join(' ') || '(empty)'}`, () => {
    const r = cli(...args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, pattern);
  });
}

test('prints usage with no arguments, and exits 0', () => {
  const r = cli();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /kaggle-notebooks CLI/);
});

test('every command in the usage text is known to the parser', () => {
  const usage = execFileSync('node', [CLI], { encoding: 'utf8' });
  for (const c of ['doctor', 'sessions', 'sessions-stop', 'monitor', 'job', 'get', 'put', 'resources', 'quota']) assert.ok(usage.includes(c), c);
});

const GPU1_REMOVED = GPU_PANEL.split('\nGPU\nGPU\n0.00%')[0];

test('a dropped GPU block is incomplete, because the label says x2', () => {
  assert.ok(parseResources(GPU1_REMOVED).missing.some((m) => m.startsWith('gpu count')));
});

test('missing limits are incomplete', () => {
  const r = parseResources(CPU_PANEL.replace('Max 30GiB', '').replace('Max 57.6GiB', '').replace('12 hours', ''));
  assert.ok(r.missing.includes('ram'));
  assert.ok(r.missing.includes('disk'));
  assert.ok(r.missing.includes('session'));
});

test('a memory line with no GPU above it is reported, not given to the wrong device', () => {
  const noHeading = GPU_PANEL.replace('GPU\nGPU\n95.00%\n', '');
  const r = parseResources(noHeading);
  assert.ok(r.missing.length > 0, JSON.stringify(r));
  assert.notEqual(r.gpus[0]?.memUsedMiB, 2252.8);
});

test('memory goes with the GPU directly above it', () => {
  const r = parseResources(GPU_PANEL);
  assert.equal(r.gpus[0].memUsedMiB, 2252.8);
  assert.equal(r.gpus[1].memUsedMiB, 3);
});

test('a single GPU is complete when the label has no count', () => {
  const one = GPU_PANEL.split('\nGPU\nGPU\n0.00%')[0].replace('GPU T4 x2 On', 'GPU P100 On');
  assert.deepEqual(parseResources(one).missing, []);
});

test('scrub keeps ordinary text and removes credentials', () => {
  assert.equal(scrub('{"keyJSON":"value"}'), '{"keyJSON":"value"}');
  assert.ok(!scrub('hello eyJabcdefghijklmnopqrstuvwxyz1234.abc world').includes('eyJabc'));
  assert.ok(!scrub('--ServerApp.token=abcdef0123456789abcdef').includes('abcdef0123456789'));
  assert.ok(!scrub('https://kkb-production.jupyter-proxy.kaggle.net/k/1/abc/proxy').includes('kkb-production'));
  assert.equal(scrub('tokens are nice'), 'tokens are nice');
});

for (const [name, panel] of [['CPU', CPU_PANEL], ['GPU', GPU_PANEL]]) {
  test(`removing any one line of a ${name} panel is never silently incomplete`, () => {
    const lines = panel.split('\n');
    const whole = JSON.stringify(parseResources(panel));
    lines.forEach((line, i) => {
      const r = parseResources(lines.filter((_, j) => j !== i).join('\n'));
      const flagged = r.missing.length > 0 || r.unrecognised.length > 0;
      assert.ok(flagged || JSON.stringify(r) === whole, `line ${i} (${line}) changed the values with no flag`);
    });
  });
}

test('warns about low GPU quota only below half an hour', () => {
  assert.match(lowQuotaWarning('0.40h'), /0\.40h/);
  assert.equal(lowQuotaWarning('0.50h'), null);
  assert.equal(lowQuotaWarning('28.61h'), null);
  assert.equal(lowQuotaWarning(undefined), null);
});

test('early errors are scrubbed', () => {
  const secret = 'eyJabcdefghijklmnopqrstuvwxyz1234.abc';
  const r = cli('push', `/no/such/${secret}`, '--url', 'u');
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes(secret), r.stderr);
});

// The report script is plain Python that reads the sampler's log, so it can run on constructed logs.
const replay = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'kn-monitor-'));
  const log = join(dir, 'log.jsonl');
  writeFileSync(log, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return JSON.parse(execFileSync('python3', ['-c', monitorReportScript(log)], { encoding: 'utf8' }));
};
const row = (t, utils, mem = [4000, 4000], { cpu = 40, ram = 8000, disk = 2000 } = {}) => ({ t, g: utils.map((u, i) => [i, u, mem[i], 15360]), c: cpu, n: 4, r: ram, rt: 30720, d: disk, dt: 19987 });
// Read the clock here, not once at load: earlier tests can take long enough to make these samples look stale.
const series = (fn, secs = 300) => {
  const now = Date.now() / 1000;
  return Array.from({ length: secs / 2 }, (_, i) => fn(now - secs + i * 2, i * 2));
};

test('a normal run gives no warnings', () => {
  assert.deepEqual(replay(series((t) => row(t, [80, 75]))).warnings, []);
});
test('warns on one of two GPUs unused', () => {
  assert.ok(replay(series((t) => row(t, [80, 0], [4000, 3]))).warnings.some((w) => /Only GPU 0 of 2/.test(w)));
});
test('warns on no GPU use with a busy CPU', () => {
  assert.ok(replay(series((t) => row(t, [0, 0], [3, 3], { cpu: 60 }))).warnings.some((w) => /probably on the CPU/.test(w)));
});
test('warns when GPU use collapses', () => {
  assert.ok(replay(series((t, s) => row(t, s < 200 ? [90, 90] : [0, 0]))).warnings.some((w) => /GPU use has stopped/.test(w)));
});
test('warns on high RAM, disk and GPU memory', () => {
  assert.ok(replay(series((t) => row(t, [80, 80], [4000, 4000], { ram: 29500 }))).warnings.some((w) => /RAM reached 90%/.test(w)));
  assert.ok(replay(series((t) => row(t, [80, 80], [4000, 4000], { disk: 19000 }))).warnings.some((w) => /above 90% full/.test(w)));
  assert.ok(replay(series((t) => row(t, [80, 80], [14800, 4000]))).warnings.some((w) => /GPU 0 memory reached 95%/.test(w)));
});
test('missing GPU readings are reported as unknown, not as stopped use', () => {
  const r = replay(series((t, s) => (s < 100 ? row(t, [95, 95], [8000, 8000]) : { ...row(t, [0, 0]), g: [] })));
  assert.ok(r.warnings.some((w) => /nvidia-smi may be failing/.test(w)), JSON.stringify(r.warnings));
  assert.ok(!r.warnings.some((w) => /GPU use has stopped/.test(w)), JSON.stringify(r.warnings));
  assert.equal(r.gpus[0].lastMemMiB, null);
});

test('one GPU going missing is reported for that GPU alone', () => {
  const r = replay(series((t, s) => {
    const full = row(t, [95, 95], [8000, 8000]);
    return s < 100 ? full : { ...full, g: [full.g[0]] };
  }));
  assert.ok(r.warnings.some((w) => /GPU 1 for the last/.test(w)), JSON.stringify(r.warnings));
  assert.equal(r.gpus[0].lastMemMiB, 8000);
  assert.equal(r.gpus[1].lastMemMiB, null);
});

test('cutting output cannot expose a credential by removing its prefix', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop';
  for (const max of [secret.length, secret.length + 3, 10, 4000]) {
    assert.ok(!clipOutput(`token=${secret}`, max).includes(secret.slice(0, 16)), `max ${max}`);
  }
  assert.equal(clipOutput('short', 100), 'short');
  assert.match(clipOutput('x'.repeat(50), 10), /40 earlier chars cut/);
});

// A bad escape in a template literal only shows up on Kaggle otherwise, as it did once during testing.
for (const [name, script] of [['job start', jobStartScript('x', 'echo hi')], ['job stop', jobStopScript('x')], ['monitor report', monitorReportScript()]]) {
  test(`the generated Python for ${name} is valid`, () => {
    assert.ok(!script.includes('\0'), 'contains a NUL byte');
    execFileSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: script });
  });
}
