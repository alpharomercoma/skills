// Direct channel to a live session's Jupyter Server, the same server Kaggle's "Kaggle Jupyter
// Server" panel offers to external editors. It needs no clicks and is independent of the notebook
// kernel, so it keeps working during a busy cell. See ../references/ui-map.md, section 9.
//
// The base url contains a session token. It must stay in memory: never print it or write it to a
// file. Errors from this module carry no url.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const NOTEBOOK_PATH = '__notebook_source__.ipynb';
const CHUNK_BYTES = 4 * 1024 * 1024;

export class ChannelError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** Read the server's base url from the JupyterLab frame. */
export function serverBase(frame) {
  return frame.evaluate(() => window.jupyterapp.serviceManager.serverSettings.baseUrl.replace(/\/$/, ''));
}

async function call(base, method, path, body, timeoutMs = 30000) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ChannelError(`The session's Jupyter server did not answer ${method} ${path.split('?')[0]} (${e.name}). The session may have ended. Run: status`);
  }
  const text = await res.text();
  return { status: res.status, text, json: () => JSON.parse(text) };
}

/**
 * The notebook kernel's true state, straight from the server: idle, busy, starting, restarting
 * or dead. A tab that has just reconnected cannot tell, because a busy kernel can't answer it.
 */
export async function notebookKernel(base, kernelId = null) {
  const r = await call(base, 'GET', '/api/kernels');
  if (r.status !== 200) throw new ChannelError(`Listing kernels returned ${r.status}.`);
  let kernel = null;
  if (kernelId) kernel = r.json().find((k) => k.id === kernelId);
  else {
    // With no id to match, only trust the session that is this notebook's. Sidecars have no session.
    const sessions = await call(base, 'GET', '/api/sessions');
    const session = sessions.status === 200 ? sessions.json().filter((x) => x.path === NOTEBOOK_PATH) : [];
    if (session.length === 1) kernel = r.json().find((k) => k.id === session[0].kernel.id);
  }
  if (!kernel) return null;
  return { state: kernel.execution_state, lastActivity: kernel.last_activity, connections: kernel.connections };
}

function connect(base, kernelId) {
  const session = randomUUID();
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/kernels/${kernelId}/channels?session_id=${session}`);
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = pending.get(m.parent_header?.msg_id);
    if (!p) return;
    const type = m.msg_type ?? m.header?.msg_type;
    if (type === 'stream') p[m.content.name === 'stderr' ? 'stderr' : 'stdout'] += m.content.text;
    else if (type === 'execute_result') p.result += m.content.data?.['text/plain'] ?? '';
    else if (type === 'error') p.error = { name: m.content.ename, value: m.content.evalue };
    else if (type === 'execute_reply') p.status = m.content.status;
    else if (type === 'status' && m.content.execution_state === 'idle') p.idle = true;
    if (p.status && p.idle) {
      pending.delete(m.parent_header.msg_id);
      p.finish();
    }
  };
  const run = (code, timeoutMs = 60000) =>
    new Promise((resolve) => {
      const msg_id = randomUUID();
      const p = { stdout: '', stderr: '', result: '', error: null, status: null, idle: false };
      const timer = setTimeout(() => {
        pending.delete(msg_id);
        resolve({ ...p, status: 'timeout' });
      }, timeoutMs);
      p.finish = () => {
        clearTimeout(timer);
        resolve(p);
      };
      pending.set(msg_id, p);
      ws.send(JSON.stringify({
        header: { msg_id, msg_type: 'execute_request', username: 'kaggle-notebooks', session, date: new Date().toISOString(), version: '5.3' },
        parent_header: {},
        metadata: {},
        content: { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: false },
        channel: 'shell',
        buffers: [],
      }));
    });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ChannelError('Could not connect to the sidecar kernel within 20 s.')), 20000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({ run, close: () => ws.close() });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new ChannelError('The sidecar kernel connection failed.'));
    };
  });
}

/**
 * Run fn(sidecar) with a short-lived second kernel in the session, and always remove it. It has no
 * link to the notebook kernel, so it doesn't wait for a running cell and can't change a variable.
 */
export async function withSidecar(base, fn) {
  const created = await call(base, 'POST', '/api/kernels', { name: 'python3' });
  if (created.status !== 201) throw new ChannelError(`Starting a sidecar kernel returned ${created.status}. Commands can still run with: exec`);
  const id = created.json().id;
  let side = null;
  try {
    side = await connect(base, id);
    const ready = await side.run('None', 60000);
    if (ready.status !== 'ok') throw new ChannelError('The sidecar kernel did not become ready within 60 s.');
    return await fn(side);
  } finally {
    side?.close();
    let removed = false;
    for (let i = 0; i < 3 && !removed; i++) {
      const del = await call(base, 'DELETE', `/api/kernels/${id}`).catch(() => null);
      removed = del?.status === 204 || del?.status === 404;
    }
    // Not fatal to the command's result, but it holds memory until the session ends.
    if (!removed) process.stderr.write(`Warning: could not remove sidecar kernel ${id.slice(0, 8)}. It uses about 100 MiB until the session ends.\n`);
  }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const py = (s) => `__import__('base64').b64decode('${b64(s)}').decode()`;

/**
 * Run a bash script in the session, in its own process group so that removing the sidecar can't
 * kill anything it started. On timeout the group is killed, so the command can't linger unseen.
 */
export async function shell(base, script, { timeoutMs = 120000 } = {}) {
  const marker = `__kn_rc_${randomUUID().slice(0, 8)}__`;
  const code = `
import os, signal, subprocess, sys
_p = subprocess.Popen(["bash", "-c", ${py(script)}], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True, cwd="/kaggle/working")
try:
    _o, _e = _p.communicate(timeout=${timeoutMs / 1000})
    _rc = _p.returncode
except subprocess.TimeoutExpired:
    os.killpg(_p.pid, signal.SIGKILL)
    _o, _e = _p.communicate()
    _rc = "timeout"
sys.stdout.write(_o)
sys.stderr.write(_e)
print("\\n${marker}", _rc)
`;
  return withSidecar(base, async (side) => {
    const r = await side.run(code, timeoutMs + 30000);
    if (r.status === 'timeout') throw new ChannelError('The sidecar did not answer in time.', 124);
    if (r.error) throw new ChannelError(`Shell runner failed: ${r.error.name}: ${r.error.value}`);
    const at = r.stdout.lastIndexOf(`\n${marker} `);
    if (at < 0) throw new ChannelError('The shell runner gave no exit code.');
    const rc = r.stdout.slice(at + marker.length + 2).trim();
    return { stdout: r.stdout.slice(0, at), stderr: r.stderr, exitCode: rc === 'timeout' ? 124 : Number(rc), timedOut: rc === 'timeout' };
  });
}

/* ------------------------------------------------------------------- jobs */

const JOB_DIR = '/kaggle/working/.kn-jobs';
const JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const checkName = (name) => {
  if (!JOB_NAME.test(name ?? '')) throw new ChannelError(`Job names use letters, digits, - and _, not "${name}".`);
};

/** Run Python in a sidecar and parse the one JSON line it prints. */
async function pyJson(base, code, timeoutMs = 60000) {
  return withSidecar(base, async (side) => {
    const r = await side.run(code, timeoutMs);
    if (r.status === 'timeout') throw new ChannelError('The sidecar did not answer in time.', 124);
    if (r.error) throw new ChannelError(`${r.error.name}: ${r.error.value}`);
    const line = r.stdout.trim().split('\n').pop();
    return JSON.parse(line);
  });
}

const JOB_STATE = `
import json, os, signal, subprocess, time
D = ${JSON.stringify(JOB_DIR)}
def alive(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except Exception:
        return False
def is_ours(pid, name):
    # PIDs can be reused, so a process belongs to a job only if it carries that run's tag.
    try:
        tag = ("KN_JOB=" + name + ":" + open(os.path.join(D, name + ".start")).read()).encode()
        return tag in open(f"/proc/{pid}/environ", "rb").read().split(b"\\0")
    except Exception:
        return False
def members(pgid):
    # A group of only zombies has nothing left to stop.
    found = []
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                with open(f"/proc/{pid}/stat") as f:
                    fields = f.read().rsplit(")", 1)[1].split()
                if int(fields[2]) == pgid and fields[0] != "Z":
                    found.append(pid)
            except Exception:
                pass
    return found
def survivors(name, pgid):
    return [pid for pid in members(pgid) if is_ours(pid, name)]
def info(name, lines=5):
    base = os.path.join(D, name)
    if not os.path.exists(base + ".pid"):
        return {"name": name, "exists": False}
    pid = int(open(base + ".pid").read())
    started = float(open(base + ".start").read())
    exit_code = int(open(base + ".exit").read()) if os.path.exists(base + ".exit") else None
    stopped_by = open(base + ".stopped").read() if os.path.exists(base + ".stopped") else None
    # The job is running while any of its processes is, even if the wrapper that started them has died.
    # That includes work left in the background after the wrapper recorded its own exit code.
    running = bool(survivors(name, pid))
    log = f"/kaggle/working/{name}.log"
    tail = subprocess.run(["tail", "-n", str(lines), log], capture_output=True, text=True, errors="replace").stdout if os.path.exists(log) else ""
    return {"name": name, "exists": True, "running": running, "pid": pid, "exitCode": exit_code,
            "stoppedBy": stopped_by,
            "lostWithoutExitCode": (not running and exit_code is None and stopped_by is None),
            "elapsedSeconds": round(time.time() - started), "log": log,
            "logBytes": os.path.getsize(log) if os.path.exists(log) else 0, "logTail": tail}
`;

/** Start a detached job. It survives closed tabs, and records its exit code when it finishes. */
export function jobStart(base, name, command) {
  checkName(name);
  return pyJson(base, jobStartScript(name, command));
}

export const jobStartScript = (name, command) => `${JOB_STATE}
name = ${JSON.stringify(name)}
os.makedirs(D, exist_ok=True)
cur = info(name)
if cur.get("running"):
    print(json.dumps({"error": f"Job {name} is already running.", **cur}))
elif cur.get("exists") and survivors(name, cur["pid"]):
    print(json.dumps({"error": f"Processes from the last run of {name} are still alive. Run: job stop {name}", **cur}))
else:
    b = os.path.join(D, name)
    for suffix in (".exit", ".pid", ".start", ".stopped"):
        if os.path.exists(b + suffix):
            os.remove(b + suffix)
    started = str(time.time())
    open(b + ".start", "w").write(started)
    wrapped = "(" + ${py(command)} + "\\n); echo $? > " + b + ".exit"
    log = open(f"/kaggle/working/{name}.log", "w")
    p = subprocess.Popen(["bash", "-c", wrapped], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, cwd="/kaggle/working", env=dict(os.environ, KN_JOB=name + ":" + started))
    open(b + ".pid", "w").write(str(p.pid))
    print(json.dumps({"started": True, "name": name, "pid": p.pid, "log": f"/kaggle/working/{name}.log"}))
`;

export function jobStatus(base, name, { lines = 5 } = {}) {
  checkName(name);
  return pyJson(base, `${JOB_STATE}\nprint(json.dumps(info(${JSON.stringify(name)}, ${Number(lines)})))\n`);
}

export function jobList(base) {
  return pyJson(base, `${JOB_STATE}
names = sorted(f[:-4] for f in os.listdir(D) if f.endswith(".pid")) if os.path.isdir(D) else []
print(json.dumps([{k: v for k, v in info(n, 0).items() if k != "logTail"} for n in names]))
`);
}

export function jobStop(base, name) {
  checkName(name);
  return pyJson(base, jobStopScript(name));
}

export const jobStopScript = (name) => `${JOB_STATE}
name = ${JSON.stringify(name)}
cur = info(name)
def group_alive(pgid):
    return bool(survivors(name, pgid))
if not cur.get("exists"):
    print(json.dumps({"stopped": False, **cur}))
elif not cur["running"] and not survivors(name, cur["pid"]):
    print(json.dumps({"stopped": False, "alreadyEnded": True, **cur}))
else:
    pgid = cur["pid"]
    sent = "SIGTERM"
    os.killpg(pgid, signal.SIGTERM)
    for _ in range(25):
        if not group_alive(pgid):
            break
        time.sleep(0.2)
    else:
        sent = "SIGKILL"
        os.killpg(pgid, signal.SIGKILL)
        time.sleep(0.5)
    stopped = not group_alive(pgid)
    # The wrapper that records an exit code usually dies with the job, so keep any real code it
    # wrote and never invent one. Record separately how the job was stopped.
    if stopped:
        open(os.path.join(D, name + ".stopped"), "w").write(sent)
    after = info(name, 0)
    print(json.dumps({"stopped": stopped, "name": name, "stoppedBy": sent, "exitCode": after.get("exitCode")}))
`;

/* ---------------------------------------------------------------- monitor */

const MONITOR_LOG = '/tmp/kn-monitor.jsonl';
const MONITOR_JOB = 'kn-monitor';

// Samples every 2 s, so a peak between two polls by the agent is not missed.
const SAMPLER = `
import json, shutil, subprocess, time
import psutil
psutil.cpu_percent(None)
# The session's real memory limit. psutil reports the host, which is more than the session gets.
try:
    limit = int(open("/sys/fs/cgroup/memory.max").read()) / 2**20
except Exception:
    limit = psutil.virtual_memory().total / 2**20
with open(${JSON.stringify(MONITOR_LOG)}, "a", buffering=1) as f:
    while True:
        t = time.time()
        gpus = []
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=index,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
            for line in out.strip().splitlines():
                i, u, m, total = [x.strip() for x in line.split(",")]
                gpus.append([int(i), float(u), float(m), float(total)])
        except Exception:
            gpus = []
        v = psutil.virtual_memory()
        w = shutil.disk_usage("/kaggle/working")
        f.write(json.dumps({"t": t, "g": gpus, "c": psutil.cpu_percent(None), "n": psutil.cpu_count(), "r": (v.total - v.available) / 2**20, "rt": limit, "d": w.used / 2**20, "dt": w.total / 2**20}) + "\\n")
        time.sleep(max(0.0, 2.0 - (time.time() - t)))
`;

export async function monitorStart(base) {
  // Check first: removing the log under a running sampler would lose its history.
  const current = await jobStatus(base, MONITOR_JOB, { lines: 0 });
  if (current.running) return { error: 'The monitor is already running. Read it with: monitor report. Restart it with: monitor stop, then monitor start.', ...current };
  await shell(base, `rm -f ${MONITOR_LOG}`);
  const command = `exec python -c "$(echo ${b64(SAMPLER)} | base64 -d)"`;
  return jobStart(base, MONITOR_JOB, command);
}

export const monitorStop = (base) => jobStop(base, MONITOR_JOB);

/**
 * Summarise everything sampled since monitor start. Warnings are observations for the agent to
 * interpret: GPU idle while the CPU is busy usually means training never reached the GPU.
 */
export const monitorReport = (base) => pyJson(base, monitorReportScript());

export const monitorReportScript = (log = MONITOR_LOG) => `
import json, os, time
p = ${JSON.stringify(log)}
if not os.path.exists(p):
    print(json.dumps({"error": "Nothing sampled yet. Run: monitor start"}))
else:
    rows = [json.loads(l) for l in open(p) if l.strip()]
    if not rows:
        print(json.dumps({"error": "No samples yet. Try again in a few seconds."}))
    else:
        now = time.time()
        report = {"samples": len(rows), "seconds": round(rows[-1]["t"] - rows[0]["t"]), "lastSampleAgeSeconds": round(now - rows[-1]["t"], 1)}
        ids = sorted({g[0] for r in rows for g in r["g"]})
        report["gpus"] = []
        for i in ids:
            s = [g for r in rows for g in r["g"] if g[0] == i]
            report["gpus"].append({"index": i, "peakMemMiB": max(x[2] for x in s), "lastMemMiB": s[-1][2], "totalMemMiB": s[0][3], "meanUtil": round(sum(x[1] for x in s) / len(s), 1), "peakUtil": max(x[1] for x in s), "activePercent": round(100 * sum(x[1] > 5 for x in s) / len(s), 1)})
        report["cpu"] = {"meanPercentOfAllCores": round(sum(r["c"] for r in rows) / len(rows), 1), "peakPercentOfAllCores": max(r["c"] for r in rows), "cores": rows[-1]["n"]}
        report["ram"] = {"peakMiB": round(max(r["r"] for r in rows)), "lastMiB": round(rows[-1]["r"]), "totalMiB": round(rows[-1]["rt"])}
        report["diskWorking"] = {"lastMiB": round(rows[-1]["d"]), "totalMiB": round(rows[-1]["dt"])}
        warn = []
        if report["lastSampleAgeSeconds"] > 20:
            warn.append("Sampler has stopped: these numbers are old.")
        # No reading is not the same as no use, so a GPU's current values need a recent reading.
        last_seen = {i: max(r["t"] for r in rows if any(g[0] == i for g in r["g"])) for i in ids}
        stale = [i for i in ids if rows[-1]["t"] - last_seen[i] > 20]
        if stale:
            names = ", ".join(str(i) for i in stale)
            warn.append(f"No readings from GPU {names} for the last {round(rows[-1]['t'] - min(last_seen[i] for i in stale))} s, so its current use is unknown. nvidia-smi may be failing.")
            for g in report["gpus"]:
                if g["index"] in stale:
                    g["lastMemMiB"] = None
        if ids and report["seconds"] >= 20:
            active = [g for g in report["gpus"] if g["peakUtil"] > 5]
            if not active:
                msg = "No GPU was used"
                warn.append(msg + (", while the CPU was busy, so the work is probably on the CPU." if report["cpu"]["meanPercentOfAllCores"] > 15 else "."))
            elif len(active) < len(ids):
                warn.append("Only GPU " + ",".join(str(g["index"]) for g in active) + " of " + str(len(ids)) + " was used.")
            # GPU use that stopped: active earlier, and nothing in the last minute, with the CPU busy.
            recent = [r for r in rows if r["t"] >= rows[-1]["t"] - 60]
            if active and report["seconds"] >= 120 and sum(1 for r in recent if r["g"]) >= 10 and not stale:
                recent_peak = max((g[1] for r in recent for g in r["g"]), default=0)
                recent_cpu = sum(r["c"] for r in recent) / len(recent)
                if recent_peak <= 5:
                    warn.append("GPU use has stopped: none in the last minute" + (", while the CPU is still busy." if recent_cpu > 15 else "."))
        if report["ram"]["peakMiB"] >= 0.9 * report["ram"]["totalMiB"]:
            warn.append("RAM reached 90% of its limit. Running out kills the kernel.")
        if report["diskWorking"]["lastMiB"] >= 0.9 * report["diskWorking"]["totalMiB"]:
            warn.append("/kaggle/working is above 90% full.")
        for g in report["gpus"]:
            if g["peakMemMiB"] >= 0.95 * g["totalMemMiB"]:
                warn.append(f"GPU {g['index']} memory reached 95% of its limit.")
        try:
            events = dict(line.split() for line in open("/sys/fs/cgroup/memory.events"))
            report["oomKills"] = int(events.get("oom_kill", 0))
            if report["oomKills"]:
                warn.append(f"The memory limit has killed {report['oomKills']} process(es) in this session.")
        except Exception:
            report["oomKills"] = None
        report["warnings"] = warn
        print(json.dumps(report))
`;

/* ------------------------------------------------------------------ files */

/**
 * Copy a local file into the session, to any path. The content travels as base64, so nothing in the
 * file can be read as shell or Python, and the checksum confirms it arrived whole.
 */
export function putFile(base, localPath, remotePath) {
  const bytes = readFileSync(localPath);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const target = JSON.stringify(remotePath);
  return withSidecar(base, async (side) => {
    const must = async (code) => {
      const r = await side.run(code, 120000);
      if (r.status !== 'ok') throw new ChannelError(`Copy failed: ${r.error?.name ?? r.status}: ${r.error?.value ?? ''}`);
      return r;
    };
    // Write beside the target and swap it in only once verified, so a failed copy can't damage an existing file.
    await must(`import base64, hashlib, os, pathlib, shutil, uuid\n_P = pathlib.Path(${target})\n_P.parent.mkdir(parents=True, exist_ok=True)\n_T = _P.with_name(_P.name + ".kn-" + uuid.uuid4().hex)\n_f = open(_T, "wb")\ndef _sha(p):\n    h = hashlib.sha256()\n    with open(p, "rb") as f:\n        for chunk in iter(lambda: f.read(2**20), b""):\n            h.update(chunk)\n    return h.hexdigest()`);
    try {
      for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
        await must(`_f.write(base64.b64decode("${bytes.subarray(i, i + CHUNK_BYTES).toString('base64')}"));None`);
      }
      const check = await must('_f.close()\nprint(_sha(_T))');
      if (check.stdout.trim() !== sha) throw new ChannelError(`Copy to ${remotePath} did not verify: the checksums differ. The original is unchanged.`);
      await must('if _P.exists():\n    shutil.copymode(_P, _T)\nos.replace(_T, _P)');
    } catch (e) {
      await side.run('_f.close()\nif os.path.exists(_T):\n    os.remove(_T)', 20000).catch(() => {});
      throw e;
    }
    return { path: remotePath, bytes: bytes.length, verified: true };
  });
}

/** Copy a file out of the session, and confirm its checksum before writing it locally. */
export function getFile(base, remotePath, localPath) {
  const target = JSON.stringify(remotePath);
  return withSidecar(base, async (side) => {
    const must = async (code) => {
      const r = await side.run(code, 120000);
      if (r.status !== 'ok') throw new ChannelError(`Copy failed: ${r.error?.name ?? r.status}: ${r.error?.value ?? ''}`);
      return r;
    };
    const head = await must(`import base64, hashlib, os\n_f = open(${target}, "rb")\n_size = os.path.getsize(${target})\n_h = hashlib.sha256()\nprint(_size)`);
    const size = Number(head.stdout.trim());
    const parts = [];
    for (let got = 0; got < size; ) {
      const r = await must(`_d = _f.read(${CHUNK_BYTES})\n_h.update(_d)\nprint(base64.b64encode(_d).decode())`);
      const part = Buffer.from(r.stdout.trim(), 'base64');
      if (part.length === 0) throw new ChannelError(`${remotePath} ended at ${got} of ${size} bytes: it changed during the copy. Copy it again when it is not being written.`);
      parts.push(part);
      got += part.length;
    }
    const sha = (await must('print(_h.hexdigest())')).stdout.trim();
    const bytes = Buffer.concat(parts);
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new ChannelError(`Copy of ${remotePath} did not verify: the checksums differ.`);
    writeFileSync(localPath, bytes);
    return { path: localPath, bytes: bytes.length, verified: true };
  });
}
