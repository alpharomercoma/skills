# %%
# C05 / A2: does DataParallel really use both GPUs, and does it train the same as one GPU?
import copy
import time

import torch

torch.manual_seed(812)
torch.backends.cudnn.deterministic = True


class Net(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.body = torch.nn.Sequential(
            torch.nn.Linear(2048, 2048), torch.nn.ReLU(), torch.nn.Linear(2048, 128))
        self.seen = {}

    def forward(self, x):
        k = str(x.device)
        self.seen[k] = self.seen.get(k, 0) + x.shape[0]
        return self.body(x)


x_cpu = torch.randn(512, 2048)
y_cpu = torch.ones(512, 128)
init = Net()


def train(model, dev, steps=10):
    x, y = x_cpu.to(dev), y_cpu.to(dev)
    opt = torch.optim.SGD(model.parameters(), lr=0.03)
    t0 = time.time()
    for _ in range(steps):
        opt.zero_grad()
        loss = (model(x) - y).square().mean()
        loss.backward()
        opt.step()
    torch.cuda.synchronize()
    return time.time() - t0, float(loss)


single = copy.deepcopy(init).to("cuda:0")
t_single, l_single = train(single, "cuda:0")
base = copy.deepcopy(init).to("cuda:0")
dp = torch.nn.DataParallel(base, device_ids=[0, 1])
t_dp, l_dp = train(dp, "cuda:0")
a = torch.cat([p.detach().flatten().cpu() for p in single.parameters()])
b = torch.cat([p.detach().flatten().cpu() for p in base.parameters()])
print("REL_L2", float((a - b).norm() / a.norm()))
print("LOSS", l_single, l_dp)
print("TIME_10_STEPS single", round(t_single, 3), "dp", round(t_dp, 3))

# Throughput on a longer run, and a replica count from the original module.
replicas = torch.nn.DataParallel(copy.deepcopy(init).to("cuda:0"), device_ids=[0, 1])
seen = {}
hooks = []


def hook(mod, inp):
    k = str(inp[0].device)
    seen[k] = seen.get(k, 0) + inp[0].shape[0]


replicas.module.body[0].register_forward_pre_hook(hook)
train(replicas, "cuda:0", steps=4)
print("REPLICA_BATCHES", seen)
print("DEVICES", torch.cuda.device_count(), [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())])

# %%
# Unequal memory, held for reading from outside: 1 GiB on GPU 0 and 3 GiB on GPU 1.
import gc

del single, base, dp, replicas
gc.collect()
torch.cuda.empty_cache()
hold0 = torch.ones(2**30, dtype=torch.uint8, device="cuda:0")
hold1 = torch.ones(3 * 2**30, dtype=torch.uint8, device="cuda:1")
print("HOLDING", float(hold0.float().mean()), float(hold1.float().mean()))
time.sleep(45)
del hold0, hold1
gc.collect()
torch.cuda.empty_cache()
print("RELEASED")
