# %%
# M4, M5, M6: known CPU, RAM and disk changes, each with timestamps, against the panel.
import multiprocessing as mp
import os
import time


def mark(name):
    line = f"MARK {name} {time.time():.3f}"
    print(line, flush=True)
    with open("/kaggle/working/marks.txt", "a") as f:
        f.write(line + "\n")


def burn(seconds):
    end = time.time() + seconds
    x = 0
    while time.time() < end:
        x += 1


mark("idle_0")
time.sleep(25)

mark("cpu_start")
procs = [mp.Process(target=burn, args=(70,)) for _ in range(os.cpu_count())]
[p.start() for p in procs]
[p.join() for p in procs]
mark("cpu_end")
time.sleep(30)

mark("ram_start")
blob = bytearray(8 * 2**30)
blob[::4096] = b"\x01" * (len(blob) // 4096)
mark("ram_held")
time.sleep(60)
del blob
mark("ram_end")
time.sleep(30)


def write_file(path, gib):
    with open(path, "wb") as f:
        for _ in range(gib * 1024):
            f.write(os.urandom(1024 * 1024))
        f.flush()
        os.fsync(f.fileno())


mark("disk_work_start")
write_file("/kaggle/working/big.bin", 5)
mark("disk_work_written")
time.sleep(45)
os.remove("/kaggle/working/big.bin")
mark("disk_work_end")
time.sleep(25)

mark("disk_tmp_start")
write_file("/tmp/big.bin", 5)
mark("disk_tmp_written")
time.sleep(45)
os.remove("/tmp/big.bin")
mark("disk_tmp_end")
time.sleep(20)
mark("done")
