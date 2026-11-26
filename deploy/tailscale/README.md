# Tailscale policy for the Azure core

The Azure core (`jeffi-k8s-core-az`, `tag:server-prod`) advertises two routes (`10.60.2.0/24`, the Postgres subnet, and
`168.63.129.16/32`, Azure DNS) and runs Tailscale SSH. CI (`tag:ci`) and the founder reach the API server and Postgres
only if the tailnet policy says so. Nothing here can be applied from the repo: the policy file lives in the Tailscale
admin console.

## What to add

[`azure-acl-snippet.hujson`](azure-acl-snippet.hujson) holds three blocks. It is a snippet, not a policy file; do not
paste it over the existing one.

| Block | Effect |
| --- | --- |
| `acls` rule | `tag:ci` may reach `tag:server-prod:6443` (the core's API) and `10.60.2.0/24:5432` (Azure Postgres). |
| `autoApprovers.routes` | `tag:server-prod` nodes get `10.60.2.0/24` and `168.63.129.16/32` approved on advertise. |
| `ssh` rule | `autogroup:admin` may `tailscale ssh` as `jeffi` to `tag:server-prod` (used by `deploy/azure/fetch-kubeconfig.sh`). |

## Merge steps

1. Open <https://login.tailscale.com/admin/acls/file> and copy the current policy somewhere safe.
2. For each block, find the section of the same name. Append the snippet's entries to the existing list, or add the
   `autoApprovers` / `routes` keys to the existing object. If a section is missing, add it whole. Keep one top-level
   `"acls"`, `"autoApprovers"` and `"ssh"` key each.
3. Check that `tag:ci` and `tag:server-prod` appear in `tagOwners`.
4. If the policy has `"tests"`, add `{"src": "tag:ci", "accept": ["tag:server-prod:6443", "10.60.2.0/24:5432"]}`. The
   console's test runner then shows the rule working before you save.
5. Save. Routes already advertised by the core (cloud-init ran `tailscale up --advertise-routes`) are approved at once.
   If they show "awaiting approval" under the machine's Edit route settings, approve them by hand.

The `ssh` rule uses `"action": "check"`, which asks for a fresh browser sign-in per session. Switch it to `"accept"` for
unattended use.

## Split DNS (console only)

Postgres' name (`jeffi-prod.private.postgres.database.azure.com`) resolves only through Azure DNS, which the core
advertises as `168.63.129.16/32`. The policy file cannot hold DNS settings, so add this in the console:

1. <https://login.tailscale.com/admin/dns> then **Add nameserver** then **Custom**.
2. Nameserver `168.63.129.16`, turn on **Restrict to domain**, domain `postgres.database.azure.com`.
3. Save.

Every tailnet device then sends only `*.postgres.database.azure.com` lookups to Azure DNS, through the core's route.
Clients must accept routes (`tailscale up --accept-routes`; the CI action and `azure-release-setup` already do) and
accept DNS (the default). The core and the AWS edge pass `--accept-dns=false`, so they ignore this setting.

## Check

From a device on the tailnet with `--accept-routes`:

```bash
tailscale status | grep jeffi-k8s-core-az
tailscale ssh jeffi@jeffi-k8s-core-az true          # ssh rule
nc -vz 100.126.223.51 6443                          # as tag:ci: the acls rule
dig +short jeffi-prod.private.postgres.database.azure.com   # split DNS (needs the nameserver above)
```

The founder runs these; nothing in this folder runs them.
