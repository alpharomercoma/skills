// I1, stepwise with timeouts. Lists kernels first, removes any stray, then tries a second kernel.
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';
const slug = process.argv[2];
const mode = process.argv[3] || 'list';
const { ctx } = await k.connect();
const page = ctx.pages().find((p) => p.url().includes(`/${slug}/edit`));
const frame = await k.jupyterFrame(page);
const limit = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} still pending after ${ms} ms`)), ms))]);
console.log('kernels', JSON.stringify(await limit(frame.evaluate(async () => {
  const sm = window.jupyterapp.serviceManager;
  await sm.kernels.refreshRunning().catch(() => {});
  const main = window.jupyterapp.shell.currentWidget.sessionContext.session?.kernel;
  return { main: main?.id?.slice(0, 8), mainStatus: main?.status, running: [...sm.kernels.running()].map((x) => ({ id: x.id.slice(0, 8), name: x.name, state: x.execution_state })) };
}), 15000, 'list')));

if (mode === 'clean') {
  console.log('clean', JSON.stringify(await limit(frame.evaluate(async () => {
    const sm = window.jupyterapp.serviceManager;
    const main = window.jupyterapp.shell.currentWidget.sessionContext.session?.kernel;
    const removed = [];
    for (const x of [...sm.kernels.running()]) if (x.id !== main?.id) { await sm.kernels.shutdown(x.id); removed.push(x.id.slice(0, 8)); }
    return removed;
  }), 20000, 'clean')));
}

if (mode === 'second') {
  const started = await limit(frame.evaluate(async () => {
    const sm = window.jupyterapp.serviceManager;
    const t0 = performance.now();
    const conn = await sm.kernels.startNew({ name: 'python3' });
    window.__second = conn;
    return { id: conn.id.slice(0, 8), ms: Math.round(performance.now() - t0) };
  }), 40000, 'startNew').catch((e) => ({ error: e.message }));
  console.log('startNew', JSON.stringify(started));
  if (!started.error) {
    const run = () => frame.evaluate(async () => {
      const conn = window.__second;
      const main = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel;
      const text = [];
      const t0 = performance.now();
      const fut = conn.requestExecute({ code: 'import os\nprint("pid", os.getpid(), "cwd", os.getcwd())\nprint(os.popen("tail -1 /kaggle/working/job.log").read())', store_history: false, allow_stdin: false });
      fut.onIOPub = (m) => { if (m.header.msg_type === 'stream') text.push(m.content.text); if (m.header.msg_type === 'error') text.push(`ERR ${m.content.ename}: ${m.content.evalue}`); };
      const reply = await Promise.race([fut.done, new Promise((res) => setTimeout(() => res(null), 25000))]);
      return { status: reply ? reply.content.status : 'no reply in 25 s', ms: Math.round(performance.now() - t0), secondConn: conn.connectionStatus, secondStatus: conn.status, mainStatus: main.status, text: text.join('').slice(0, 220) };
    });
    console.log('exec idle', JSON.stringify(await limit(run(), 40000, 'exec')));
    // Now make the notebook kernel busy, and ask the second kernel again.
    await frame.evaluate(() => { window.__busy = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.requestExecute({ code: 'import time; time.sleep(20)', silent: true, store_history: false }); });
    await new Promise((r) => setTimeout(r, 1500));
    console.log('exec during busy main', JSON.stringify(await limit(run(), 40000, 'exec-busy')));
    await limit(frame.evaluate(async () => { await window.__busy?.done; }), 40000, 'main busy done').catch((e) => console.log(e.message));
    console.log('shutdown', JSON.stringify(await limit(frame.evaluate(async () => { const sm = window.jupyterapp.serviceManager; const id = window.__second.id; await sm.kernels.shutdown(id); delete window.__second; await sm.kernels.refreshRunning(); return [...sm.kernels.running()].length; }), 20000, 'shutdown').catch((e) => e.message)));
  }
}
process.exit(0);
