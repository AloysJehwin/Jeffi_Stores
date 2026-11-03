"""Whether the core node can schedule the flagship's store pods that don't run yet (rollout.sh platform).
Args: the store-step manifests, the core node, the pods on it and the existing jeffi deployments, all as kubectl JSON.
Exits 1 with the shortfall when they can't fit."""
import json
import sys


def cpu(v):
    v = str(v or "0")
    return int(v[:-1]) if v.endswith("m") else int(float(v) * 1000)


def items(path):
    # One object, a List, or several objects one after another (kubectl create -o json).
    text, out, i, dec = open(path).read(), [], 0, json.JSONDecoder()
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        d, i = dec.raw_decode(text, i)
        out += d["items"] if isinstance(d.get("items"), list) else [d]
    return out


manifests, node, pods, deploys = sys.argv[1:5]
objs = items(manifests)
running = {d["metadata"]["name"] for d in items(deploys)}
min_reps = {o["spec"]["scaleTargetRef"]["name"]: o["spec"].get("minReplicas", 1) for o in objs if o["kind"] == "HorizontalPodAutoscaler"}
need, new = 0, []
for o in objs:
    name = o["metadata"]["name"]
    if o["kind"] != "Deployment" or name in running:
        continue
    reps = o["spec"].get("replicas") or min_reps.get(name, 1)
    need += reps * sum(cpu(c.get("resources", {}).get("requests", {}).get("cpu")) for c in o["spec"]["template"]["spec"]["containers"])
    new.append(f"{name}×{reps}")
node = items(node)[0]
used = sum(
    cpu(c.get("resources", {}).get("requests", {}).get("cpu"))
    for p in items(pods)
    if p["status"].get("phase") not in ("Succeeded", "Failed")
    for c in p["spec"]["containers"]
)
free = cpu(node["status"]["allocatable"]["cpu"]) - used
if not new:
    print(f"core: {free}m CPU free; the store services already run")
elif need > free:
    print(f"core: {free}m CPU free, the new store pods ({', '.join(new)}) request {need}m. Free room on the core first.", file=sys.stderr)
    sys.exit(1)
else:
    print(f"core: {free}m CPU free for the new store pods' {need}m ({', '.join(new)})")
