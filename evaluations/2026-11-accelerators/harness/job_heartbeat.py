# Detached test job: one timestamped line every 30 s for 40 minutes, flushed each time.
import time

start = time.time()
for i in range(80):
    print(f"beat {i} elapsed_s={time.time() - start:.0f} utc={time.time():.0f}", flush=True)
    time.sleep(30)
print("JOB FINISHED", flush=True)
