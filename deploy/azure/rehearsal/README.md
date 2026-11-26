# Phase D: rehearsal tooling

Plan: [`docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md`](../../../docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md), Phase D. Both scripts are a dry run unless given `--apply`. Nothing here has been run.

| File | What it does |
|---|---|
| `common.sh` | Sourced by both. Loads `deploy/k8s/db/lib.sh` with `JEFFI_CLOUD=azure`, and adds `--apply`, per-step timings (`timed`) and the timing table. |
| `restore-dump.sh` | Dumps prod RDS `jeffi_stores` (`pg_dump -Fc`, over the core's SSH/SSM tunnel, IAM token) into `~/Documents/db-backups/rehearsal-<stamp>/`, then restores it into the Azure Postgres as `app_user` (`--no-owner --no-acl`). The four extensions and the schema grant go through the admin, as in `pg-init.sh`. |
| `rehearse.sh` | Brings the platform up on the Azure core under a test hostname, smoke-tests it, and creates then deletes a throwaway store. Writes the timing report. |

Passwords: the RDS IAM token and the Key Vault passwords go into 0600 `PGPASSFILE`s in private temp dirs (removed on exit). None is in argv, the environment or the output.

## Prerequisites

1. Postgres `jeffi-prod-pg` created (waits on the Microsoft quota) and `deploy/azure/pg-init.sh --apply` done.
2. Kubeconfig at `~/.kube/jeffi-azure.yaml`; IRSA (README step 7) and the overlay values (step 8) done. `CLUSTER_INGRESS_IP` is a REPLACE_ME until the AWS edge exists: pass `--ingress-ip <ip>` for the rehearsal.
3. `az login` (subscription "Azure subscription 1"), AWS credentials, Tailscale up and accepting routes.
4. For `--restore` or `restore-dump.sh`: docker running, and the core's SSH key or `session-manager-plugin` (the tunnel to RDS).
5. For `rehearse.sh --apply`: `certs/ca-cert.pem` and friends in the repo root (`secrets.sh`), and for the store round trip a file with an administrator's `Cookie: ...` header line (see below).

## Order

```bash
bash deploy/azure/rehearsal/restore-dump.sh                  # dry run
bash deploy/azure/rehearsal/restore-dump.sh --apply          # dump + restore (add --reset on a second run)
bash deploy/azure/rehearsal/rehearse.sh --ingress-ip <ip>    # dry run: checks, host rewrite preview
bash deploy/azure/rehearsal/rehearse.sh --apply --restore --with-dns --admin-cookie-file ~/admin.cookie --ingress-ip <ip>
```

`restore-dump.sh` flags: `--target-db` (default `jeffi_stores`), `--dump FILE` (reuse a dump, no fresh one), `--dump-only`, `--reset` (drops schema public first), `--jobs N`.

`rehearse.sh` steps, each timed:

1. `--restore`: `restore-dump.sh --apply`, then `release-db.sh --cloud=azure` (schema diff and migrations on the restored copy).
2. `secrets.sh`, `apply-platform.sh <tag>` and `rollout.sh <tag> platform`, all with `JEFFI_CLOUD=azure`, then wait for the wildcard certificate. A `kubectl` shim, on `PATH` for these scripts only, rewrites every `*jeffistores.in` host in what they render, so routes, the wildcard certificate and `PUBLIC_*_URL` become `<domain>` and `<app>.<domain>` (default `az-rehearsal.jeffistores.in`). `oidc.`, `wif-voice.`, `origin.` and `@jeffistores.in` addresses are kept. Production DNS is not touched; the only Route 53 write is the certificate's temporary `_acme-challenge` TXT record.
3. `smoke.sh` on a copy with the hosts rewritten, connecting to the Azure IP directly (`SMOKE_CONNECT_TO`), so no DNS is needed.
4. `--with-dns`: A records for `<domain>` and `*.<domain>` to the Azure IP (new names only; refuses if they exist). The rollback batch is saved to `~/Documents/db-backups/route53-rehearsal-rollback-<stamp>.json` and the command to apply it is printed.
5. Store round trip (unless `--skip-store`): inserts the tenant rows the way `createTenant()` does (tenant, infra, wallet, provisioning job), lets the provisioning worker build it (and kicks the advance route), prints each step change, smoke-tests the store, then calls the admin deprovision route and checks the tenant namespace is gone. `--keep-store` skips the delete.

Confirmations (skip with `--yes`): applying the platform (Let's Encrypt issuance), DNS records, store creation (an AWS EC2 node, an EBS volume and Route 53 records for `<slug>.jeffistores.in`), and in `restore-dump.sh` the dump, a database create, and a schema reset.

Admin cookie: log in as an administrator (the rehearsal's `https://admin.<domain>`, via `--with-dns`, or your hosts file) and save the request's `Cookie: name=value; ...` line to a file. The script sends it with `curl -H @file` and probes it before creating anything, so a store is never made that it cannot delete.

## What to look at in the report

`~/Documents/db-backups/rehearsal-<date>.log` (appended per run; the timing table is at the end).

- **Timings:** `dump`, `restore` (the big one for the cutover window), `release-db`, `apply-platform`, `rollout-platform`, `wildcard-certificate`, `store-provision`, `store-delete`. Phase E needs the sum of dump + restore + release-db + rollout.
- **restore log:** `restore-jeffi_stores.log` beside the dump. Missing-role or extension lines are expected; anything about a table, index or constraint is not.
- **Smoke:** every flagship line is 200-ish; no `FAIL`. Store checks: the pod answers, and the store host (`<slug>.jeffistores.in`) needs the edge or `--ingress-ip` to answer.
- **Store round trip:** how long `provisioning_jobs` took per step, and that deprovision left no namespace, EC2 node or EBS volume (the last command printed checks EC2).
- **Cross-cloud latency:** the cached control-plane reads from store pods (plan section 6a) are not measured here; read them from Coroot during the store smoke.

## Caveats

- The apps hold `jeffistores.in` in code (middleware, host classification). If a rehearsal host answers but the page misbehaves, that is the cause: the rewrite only changes the manifests. The smoke checks still prove the pods and routes.
- The rehearsal applies to the real Azure cluster. The Phase E release re-applies the production hosts over it; the rewritten resources have the same names and are replaced.
- Let's Encrypt allows a few identical certificate requests a week: avoid re-running step 2 repeatedly.
- The tenant insert mirrors `createTenant()` at the time of writing; if the `tenants` table gains a required column the insert fails loudly before anything is built.
