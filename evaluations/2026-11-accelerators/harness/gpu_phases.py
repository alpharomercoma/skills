# %%
# C01 / M1-M3: idle, load GPU 0, idle, load GPU 1, idle. Marks every transition with a timestamp.
import gc
import time

import torch


def mark(name):
    line = f"MARK {name} {time.time():.3f}"
    print(line, flush=True)
    with open("/kaggle/working/marks.txt", "a") as f:
        f.write(line + "\n")


def load(dev, seconds, hold_gib):
    # Hold a known amount of memory and train for a fixed time, synchronising every step.
    mark(f"load_start_{dev}")
    hold = torch.ones(int(hold_gib * 2**30), dtype=torch.uint8, device=dev)
    net = torch.nn.Sequential(
        torch.nn.Linear(2048, 2048), torch.nn.ReLU(), torch.nn.Linear(2048, 128)).to(dev)
    x = torch.randn(512, 2048, device=dev)
    y = torch.ones(512, 128, device=dev)
    opt = torch.optim.SGD(net.parameters(), lr=0.03)
    end = time.monotonic() + seconds
    steps = 0
    while time.monotonic() < end:
        opt.zero_grad()
        loss = (net(x) - y).square().mean()
        loss.backward()
        opt.step()
        torch.cuda.synchronize()
        steps += 1
    mark(f"load_end_{dev}")
    print(f"{dev} steps={steps} loss={float(loss):.4f} held={float(hold.float().mean()):.1f}", flush=True)
    del hold, net, x, y, opt, loss
    gc.collect()
    torch.cuda.empty_cache()
    mark(f"released_{dev}")


mark("idle_0")
time.sleep(30)
load("cuda:0", 120, 2)
time.sleep(30)
load("cuda:1", 120, 2)
time.sleep(30)
mark("done")
