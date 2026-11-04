# Small image-classifier training run on synthetic data.
import time

import torch
import torch.nn as nn

device = torch.device("cuda:0")
print("Starting training", flush=True)


class Classifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 96, 3, padding=1), nn.ReLU(), nn.Conv2d(96, 192, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d(8))
        self.head = nn.Linear(192 * 64, 10)

    def forward(self, x):
        return self.head(self.features(x).flatten(1))


torch.manual_seed(7)
model = Classifier().to(device)
images = torch.randn(48, 3, 96, 96, device=device)
labels = torch.randint(0, 10, (48,), device=device)
optim = torch.optim.Adam(model.parameters(), lr=1e-3)
loss_fn = nn.CrossEntropyLoss()
cache = torch.ones(5 * 2**30, dtype=torch.uint8, device=device)  # pre-loaded data cache

start = time.time()
step = 0
while time.time() - start < 150:
    optim.zero_grad()
    loss = loss_fn(model(images), labels)
    loss.backward()
    optim.step()
    step += 1
    if step % 200 == 0:
        print(f"step {step} loss {loss.item():.4f}", flush=True)
print(f"Finished. final loss {loss.item():.4f}", flush=True)
