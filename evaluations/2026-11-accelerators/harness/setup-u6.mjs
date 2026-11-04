// U6: a final check of the changed advice, on the final skill. Pre-registered in PLAN.md before any run.
// A job is running in a session whose tab has been closed. Two arms, each with its own session.
import { appendFileSync } from 'node:fs';
import * as k from '/Users/alpha/.claude/skills/kaggle-notebooks/scripts/driver.mjs';

const E = new URL('..', import.meta.url).pathname;
const JOB = `import datetime, time
start = time.time()
while time.time() - start < 3000:
    print("step", round(time.time() - start), "utc", datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S"), flush=True)
    time.sleep(30)
print("TRAINING FINISHED", flush=True)
`;
const { ctx } = await k.connect();
for (const slug of process.argv.slice(2)) {
  const page = await k.newNotebook(ctx, { title: slug });
  await k.startSession(page, { timeoutMs: 240000 });
  await k.sh(page, `cat > /kaggle/working/train_u6.py <<'EOF'\n${JOB}EOF
cd /kaggle/working; nohup python train_u6.py > u6.log 2>&1 < /dev/null &
echo started`);
  await page.close();
  const line = `${new Date().toISOString()},${slug},job started and tab closed`;
  appendFileSync(`${E}raw/u6-setup.csv`, line + '\n');
  console.log(line);
}
process.exit(0);
