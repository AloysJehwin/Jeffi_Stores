"""One part of the platform manifests, for rollout.sh platform <part>.
Reads kubectl JSON (one object, a List, or several in a row) on stdin and writes the part as a List.
Parts: a service's own objects (the controller's with the CronJobs), routes (jeffi.io/routes=platform), and
shared (everything else: namespaces, edge, Redis, RBAC, config)."""
import json
import sys

SERVICES = ("controller", "storefront", "admin", "business", "messaging", "documents", "public-api", "mobile")
NAMES = {f"jeffi-stores-{'document' if s == 'documents' else s}-service": s for s in SERVICES}


def items(text):
    out, i, dec = [], 0, json.JSONDecoder()
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        d, i = dec.raw_decode(text, i)
        out += d["items"] if isinstance(d.get("items"), list) else [d]
    return out


def part_of(o):
    md = o["metadata"]
    if (md.get("labels") or {}).get("jeffi.io/routes") == "platform":
        return "routes"
    if md["name"] in NAMES:
        return NAMES[md["name"]]
    if o["kind"] == "CronJob" and md["name"].startswith("cron-"):
        return "controller"
    return "shared"


want = sys.argv[1]
if want not in (*SERVICES, "routes", "shared"):
    sys.exit(f"unknown platform part: {want}")
picked = [o for o in items(sys.stdin.read()) if part_of(o) == want]
if not picked:
    sys.exit(f"no manifests for platform part {want}")
json.dump({"apiVersion": "v1", "kind": "List", "items": picked}, sys.stdout)
