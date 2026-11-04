# %%
# A long training run, already in progress when the agent arrives.
import json
import time

import torch

device = "cuda:1"
net = torch.nn.Sequential(torch.nn.Linear(2048, 4096), torch.nn.ReLU(), torch.nn.Linear(4096, 128)).to(device)
hold = torch.ones(3 * 2**30, dtype=torch.uint8, device=device)
x = torch.randn(1024, 2048, device=device)
y = torch.ones(1024, 128, device=device)
opt = torch.optim.SGD(net.parameters(), lr=0.01)
start = time.time()
step = 0
while time.time() - start < 1200:
    opt.zero_grad()
    loss = (net(x) - y).square().mean()
    loss.backward()
    opt.step()
    step += 1
    if step % 2000 == 0:
        print(f"step {step} loss {loss.item():.5f}", flush=True)
        with open("/kaggle/working/progress.json", "w") as f:
            json.dump({"step": step, "t": time.time()}, f)
print("TRAINING_FINISHED", step, flush=True)
