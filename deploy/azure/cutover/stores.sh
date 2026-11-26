# Store-node rejoin helpers (sourced by cutover.sh and rollback.sh after common.sh). The stores' EC2 nodes (dedicated
# t-<slug>[.gen-i] and the shared pool-basic-N) leave one k3s cluster and join the other in place: the agent is
# uninstalled and re-joined over SSM, the node's EBS disk (the store's Postgres, at /var/lib/jeffi/db) is never touched.
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STORES_ONLY=${STORES_ONLY:-}
export AWS_REGION=${AWS_REGION:-us-east-1}
AZ_PROVISIONING=$REPO/deploy/k8s/overlays/azure/patches/provisioning.yaml

nodes_json() { # the manifest of the nodes as the source cluster knew them; a dry run before the first apply keeps it in scratch
  if $APPLY || [ -s "$RUN_DIR/stores-nodes.json" ]; then echo "$RUN_DIR/stores-nodes.json"; else echo "$SCRATCH/stores-nodes.json"; fi
}
kc_of() { if [ "$1" = azure ]; then echo "$AZ_KUBECONFIG"; else echo "$AWS_KUBECONFIG"; fi; }

# Nodes and store namespaces as the AWS (source) cluster has them: labels and taints are copied from there, so a node
# re-joins with exactly what the controller launched it with. Taken once; after the first node leaves it can't be redone.
discover_nodes() {
  local f; f=$(nodes_json)
  if [ -s "$f" ] && [ -z "${STORES_REDISCOVER:-}" ]; then echo "   using $f (STORES_REDISCOVER=1 reads the AWS cluster again)"; return 0; fi
  aws_tunnel
  KUBECONFIG=$AWS_KUBECONFIG kubectl get nodes -o json > "$SCRATCH/nodes.json"
  KUBECONFIG=$AWS_KUBECONFIG kubectl get ns -l jeffi.io/tier=tenant -o json > "$SCRATCH/ns.json"
  python3 -I - "$SCRATCH/nodes.json" "$SCRATCH/ns.json" > "$f" <<'PY'
import json, sys
nodes = json.load(open(sys.argv[1]))["items"]; ns = json.load(open(sys.argv[2]))["items"]
out = []
for n in nodes:
    l = n["metadata"].get("labels", {})
    # The AWS core (control plane, sometimes a pool node too) retires with its cluster: never re-joined.
    if "node-role.kubernetes.io/control-plane" in l or "node-role.kubernetes.io/master" in l: continue
    if l.get("jeffi.io/role") not in ("dedicated", "pool-basic"): continue
    taints = []
    for t in n["spec"].get("taints") or []:
        if t["key"].startswith("jeffi.io/"): taints.append(f'{t["key"]}{"=" + t["value"] if t.get("value") else ""}:{t["effect"]}')
    out.append({
        "name": n["metadata"]["name"], "slug": l.get("jeffi.io/tenant") or "pool",
        "labels": {k: v for k, v in l.items() if k.startswith("jeffi.io/") and k != "jeffi.io/db-ready"},
        "taints": taints, "dbAgent": l.get("jeffi.io/db-agent") == "true",
    })
json.dump({"nodes": sorted(out, key=lambda x: (x["slug"] == "pool", x["name"])),
           "slugs": sorted(x["metadata"]["name"][len("tenant-"):] for x in ns)}, sys.stdout, indent=1)
PY
  chmod 600 "$f"
}

# "<batch> <node> <node> ..." per line: one batch per store (its own nodes), the pool nodes as batch `pool`. --only <batch> keeps one.
batches() {
  python3 -I - "$(nodes_json)" "$STORES_ONLY" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); only = sys.argv[2]
b = {}
for n in m["nodes"]: b.setdefault(n["slug"], []).append(n["name"])
if only and only not in b: sys.exit(f"--only {only}: no store-node batch of that name (batches: {', '.join(b) or 'none'})")
for k, v in b.items():
    if not only or k == only: print(k, *v)
PY
}
# The store slugs whose objects are re-applied: all, or the --only store (pool stores are re-applied by a run without --only).
slugs_to_apply() {
  python3 -I - "$(nodes_json)" "$STORES_ONLY" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); only = sys.argv[2]
for s in m["slugs"]:
    if not only or s == only: print(s)
PY
}

node_ready() { # <kubeconfig> <node>
  [ "$(KUBECONFIG=$1 kubectl get node "$2" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)" = True ]
}
# Ready, with the labels and taints the manifest holds (and db-ready for a node with a database disk).
wait_node() { # <kubeconfig> <node>
  local i out
  for i in $(seq 1 60); do
    out=$(KUBECONFIG=$1 kubectl get node "$2" -o json 2>/dev/null | python3 -I -c '
import json, sys
m = json.load(open(sys.argv[1])); e = next(x for x in m["nodes"] if x["name"] == sys.argv[2])
try: n = json.load(sys.stdin)
except Exception: print("not registered"); sys.exit(1)
l = n["metadata"].get("labels", {}); t = {f'"'"'{x["key"]}:{x["effect"]}'"'"' for x in n["spec"].get("taints") or []}
miss = [f"{k}={v}" for k, v in e["labels"].items() if l.get(k) != v]
miss += [x for x in e["taints"] if x.rsplit(":", 1)[0].split("=")[0] + ":" + x.rsplit(":", 1)[1] not in t]
if e["dbAgent"] and l.get("jeffi.io/db-ready") != "true": miss.append("jeffi.io/db-ready=true")
ready = any(c["type"] == "Ready" and c["status"] == "True" for c in n["status"].get("conditions", []))
if not ready: miss.append("Ready")
print("missing: " + ", ".join(miss) if miss else "ok"); sys.exit(1 if miss else 0)' "$(nodes_json)" "$2" 2>&1) && { echo "   $2 Ready with its labels and taints"; return 0; }
    [ $((i % 6)) = 0 ] && echo "   waiting for $2: ${out##*$'\n'}"
    sleep 10
  done
  echo "   $2 never became Ready with its labels: ${out##*$'\n'}" >&2; return 1
}

# The k3s token and Tailscale key, from the backend that holds them, into a 0600 file in the 0700 scratch dir. Never echoed.
fetch_join_secret() { # <keyvault|aws> <outfile>
  case $1 in
    keyvault) az keyvault secret show --vault-name "${AZ_KEY_VAULT:-jeffi-prod-kv}" --name jeffi-production-k3s --query value -o tsv > "$2" ;;
    aws) aws secretsmanager get-secret-value --secret-id jeffi/production/k3s --query SecretString --output text > "$2" ;;
    *) die "unknown secrets backend $1 (keyvault|aws)" ;;
  esac
  [ -s "$2" ] || die "jeffi-production-k3s (backend $1) came back empty"
}

# SSM parameters for one node: uninstall the agent, accept the core's routes, then node-user-data.ts's cross-cloud join
# (secrets inside, no tracing), then restart the disk agent so it labels db-ready again. File 0600, deleted after the send.
build_params() { # <node> <server> <overTailscale true|false> <backend> -> $SCRATCH/params.json
  local n=$1 server=$2 ts=$3 backend=$4
  ( umask 077
    fetch_join_secret "$backend" "$SCRATCH/sec.json"
    python3 -I - "$(nodes_json)" "$n" "$server" "$ts" "$SCRATCH/sec.json" > "$SCRATCH/spec.json" <<'PY'
import json, sys
m, name, server, ts, sec = sys.argv[1:]
e = next(x for x in json.load(open(m))["nodes"] if x["name"] == name); s = json.load(open(sec))
spec = {"nodeName": name, "labels": e["labels"], "taints": e["taints"], "server": server,
        "join": {"k3sToken": s["K3S_TOKEN"], "tsAuthKey": s["TS_AUTHKEY"]}}
if ts == "true": spec["overTailscale"] = True
json.dump(spec, sys.stdout)
PY
    (cd "$REPO" && npx --no-install tsx "$HERE/join-script.ts" < "$SCRATCH/spec.json" > "$SCRATCH/join.sh")
    python3 -I - "$SCRATCH/join.sh" "$(nodes_json)" "$n" > "$SCRATCH/params.json" <<'PY'
import json, sys
body = open(sys.argv[1]).read().splitlines()
db = next(x for x in json.load(open(sys.argv[2]))["nodes"] if x["name"] == sys.argv[3])["dbAgent"]
lines = ["#!/bin/bash", "set -euo pipefail",
         "[ -x /usr/local/bin/k3s-agent-uninstall.sh ] && /usr/local/bin/k3s-agent-uninstall.sh >/dev/null 2>&1 || true",
         "! command -v tailscale >/dev/null || tailscale set --accept-routes=true"]
lines += [x for x in body if not x.startswith("#!")]
if db: lines.append("systemctl restart jeffi-db-volume.service 2>/dev/null || true")
json.dump({"commands": lines, "executionTimeout": ["900"]}, sys.stdout)
PY
    rm -f "$SCRATCH/sec.json" "$SCRATCH/spec.json" "$SCRATCH/join.sh" )
}

# Move one node into <target> (aws|azure): checks (a dry run stops after them), delete its stale Node object and
# node-password secret there (k3s refuses a re-installed agent with a new password under the old name), uninstall + join over
# SSM, wait for Ready with its labels.
rejoin_node() { # <node> <target> <server> <overTailscale> <backend>
  local n=$1 target=$2 server=$3 ts=$4 backend=$5 kc id ping cmd st i
  kc=$(kc_of "$target")
  if node_ready "$kc" "$n"; then echo "   $n is already Ready in the $target cluster"; return 0; fi
  id=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=jeffi-k8s-$n" Name=instance-state-name,Values=running \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  [[ $id =~ ^i-[0-9a-f]+$ ]] || die "no single running instance named jeffi-k8s-$n (got: ${id:-none})"
  ping=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$id" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$ping" = Online ] || die "$n ($id) is not Online in SSM (${ping:-no answer}): the instance profile needs AmazonSSMManagedInstanceCore"
  echo "   $n = $id, SSM Online; would join $server (tailscale=$ts, secrets from $backend)"
  $APPLY || return 0
  KUBECONFIG=$kc kubectl delete node "$n" --ignore-not-found --wait=false >/dev/null
  KUBECONFIG=$kc kubectl -n kube-system delete secret "$n.node-password.k3s" --ignore-not-found >/dev/null
  build_params "$n" "$server" "$ts" "$backend"
  cmd=$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript --parameters "file://$SCRATCH/params.json" \
    --comment "jeffi cutover: rejoin $n" --query Command.CommandId --output text)
  rm -f "$SCRATCH/params.json"
  echo "   SSM command $cmd sent; waiting"
  for i in $(seq 1 90); do
    st=$(aws ssm get-command-invocation --command-id "$cmd" --instance-id "$id" --query Status --output text 2>/dev/null || echo Pending)
    case $st in
      Success) break ;;
      Failed|Cancelled|TimedOut)
        aws ssm get-command-invocation --command-id "$cmd" --instance-id "$id" --query StandardErrorContent --output text 2>/dev/null | tail -15 >&2 || true
        die "the rejoin of $n ended $st" ;;
    esac
    sleep 10
  done
  [ "$st" = Success ] || die "the rejoin of $n did not finish in 15 minutes ($st)"
  wait_node "$kc" "$n"
}

# Rejoin every node of every selected batch into <target>; one typed confirmation per batch, in order (the canary first
# unless --only picks one).
rejoin_all() { # <target> <server> <overTailscale> <backend>
  local target=$1 server=$2 ts=$3 backend=$4 b key nodes n
  b=$(batches); [ -n "$b" ] || die "no store nodes to move (manifest $(nodes_json))"
  echo "   batches: $(cut -d' ' -f1 <<<"$b" | tr '\n' ' ')"
  # Batches arrive on fd 3 so the typed confirmation reads the terminal, not the list.
  while read -r key nodes <&3; do
    say "Batch $key"
    if $APPLY; then confirm_typed "$key" "move the node(s) of $key into the $target cluster; the store is down until it is re-applied"; fi
    for n in $nodes; do rejoin_node "$n" "$target" "$server" "$ts" "$backend"; done
  done 3<<<"$b"
}

# A store is back on Azure: its Postgres pod Running (on the node that holds its disk) and its storefront answering through the edge.
verify_store() { # <slug>
  local slug=$1 ns=tenant-$1 phase host code pg
  export KUBECONFIG=$AZ_KUBECONFIG
  pg=$(kubectl -n "$ns" get deploy,statefulset -l jeffi.io/service=postgres -o name 2>/dev/null | head -1 || true)
  if [ -n "$pg" ]; then
    kubectl -n "$ns" wait --for=condition=Available "$pg" --timeout=600s >/dev/null 2>&1 || { echo "   FAIL $slug: $pg not Available in 10 minutes" >&2; return 1; }
    phase=$(kubectl -n "$ns" get pod -l jeffi.io/service=postgres -o jsonpath='{.items[0].status.phase} on {.items[0].spec.nodeName}' 2>/dev/null || true)
    echo "   $slug: postgres $phase"
    case $phase in Running*) ;; *) echo "   FAIL $slug: postgres pod is $phase" >&2; return 1 ;; esac
  else echo "   $slug: no on-node Postgres in the namespace (its database is elsewhere)"; fi
  host=$(kubectl -n "$ns" get ingressroute store -o jsonpath='{.spec.routes[0].match}' 2>/dev/null | grep -oE 'Host\(`[^`]+`\)' | head -1 | sed -E 's/^Host\(`([^`]+)`\)$/\1/' || true)
  [ -n "$host" ] || { echo "   FAIL $slug: no storefront host in its IngressRoute" >&2; return 1; }
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --connect-to "$host:443:$EDGE_IP:443" "https://$host/api/health" || true)
    case $code in 000|5??|404|'') sleep 10 ;; *) echo "   $slug: https://$host/api/health -> $code through the edge"; return 0 ;; esac
  done
  echo "   FAIL $slug: https://$host answers ${code:-nothing} through the edge $EDGE_IP" >&2; return 1
}
