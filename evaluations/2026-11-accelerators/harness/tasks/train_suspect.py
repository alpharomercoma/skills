# Training run for the churn model. The accelerator should be turned on for this notebook.
import time

import torch
import torch.nn as nn

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}", flush=True)

CONFIG = {"hidden": 2048, "batch": 512, "seconds": 150, "lr": 1e-3, "place": "cpu"}


def build(cfg):
    net = nn.Sequential(nn.Linear(1024, cfg["hidden"]), nn.ReLU(), nn.Linear(cfg["hidden"], cfg["hidden"]), nn.ReLU(), nn.Linear(cfg["hidden"], 2))
    return net.to(cfg["place"])


model = build(CONFIG)
x = torch.randn(CONFIG["batch"], 1024).to(CONFIG["place"])
y = torch.randint(0, 2, (CONFIG["batch"],)).to(CONFIG["place"])
opt = torch.optim.Adam(model.parameters(), lr=CONFIG["lr"])
start = time.time()
step = 0
while time.time() - start < CONFIG["seconds"]:
    opt.zero_grad()
    loss = nn.functional.cross_entropy(model(x), y)
    loss.backward()
    opt.step()
    step += 1
    if step % 100 == 0:
        print(f"step {step} loss {loss.item():.4f}", flush=True)
print("Training complete", flush=True)
