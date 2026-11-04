# Unattended job. Writes one result file when finished.
import json
import time

import torch

device = "cuda" if torch.cuda.is_available() else "cpu"
a = torch.randn(2048, 2048, device=device)
start = time.time()
total = 0.0
while time.time() - start < 120:
    total += float((a @ a).abs().mean())
result = {"device": device, "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None, "checksum": round(sum(range(1000)) * 3.5, 1)}
with open("/kaggle/working/result.json", "w") as f:
    json.dump(result, f)
print("RESULT", json.dumps(result), flush=True)
