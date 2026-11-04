# %%
# A4: fill GPU 0 until PyTorch raises its out-of-memory error. The exception is not caught.
import os

import torch

print("KERNEL_PID", os.getpid(), flush=True)
blocks = []
while True:
    blocks.append(torch.empty(256 * 1024 * 1024, dtype=torch.uint8, device="cuda:0").fill_(1))

# %%
print("SENTINEL_SHOULD_NOT_RUN", flush=True)

# %%
# Recovery, run on its own afterwards.
import gc
import os

import torch

blocks = None
gc.collect()
torch.cuda.empty_cache()
print("RECOVERY", os.getpid(), float((torch.ones(8, device="cuda:0") * 2).sum()), flush=True)
