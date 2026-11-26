# Phase E cutover: platform core from AWS to Azure

Tooling for the one announced window (30-60 minutes). Stores stay on AWS behind the tenant edge (plan §6a). Design: [`docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md`](../../../docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md), runbook step 11 in [`../README.md`](../README.md).

| File | What |
|---|---|
| `cutover.sh` | Named steps: `preflight freeze final-dump-restore identity dns cloudfront smoke unfreeze`. Dry run by default (reads only), `--apply` acts, `--step <name>`, `--from <name>`, `--list`. Typed confirmation before each step that changes something. |
| `rollback.sh` | `azure-quiesce dns cloudfront identity unfreeze`, from the files the cutover saved. Same flags. |
| `common.sh` | Shared helpers (sourced). |

Everything lands in `~/Documents/db-backups/cutover-<date>/` (dump, `route53-rollback.json`, `cloudfront-before-<id>.json`, restore log, `done.txt`); step timestamps in `~/Documents/db-backups/cutover-<date>.log`. **Export `CUTOVER_DATE=YYYYMMDD` once at T-0** so a window that crosses midnight keeps one folder, and use the same value for `rollback.sh`.

```bash
export CUTOVER_DATE=$(date +%Y%m%d) EDGE_IP=<tenant edge EIP> AZURE_IP=52.172.147.62 CUTOVER_SHA=<sha Release - Azure deployed>
bash deploy/azure/cutover/cutover.sh                 # rehearse the whole thing, nothing changes
bash deploy/azure/cutover/cutover.sh --apply         # the window
bash deploy/azure/cutover/cutover.sh --apply --from dns   # resume after a stop
```

## What each step does

1. **preflight**: tools, `EDGE_IP`/`AZURE_IP`, backups writable, both kubeconfigs, `route53-plan.sh --lower-ttl` has nothing left to lower, Azure Postgres answers as `app_user`, `smoke.sh flagship` passes on Azure (public hosts through `--connect-to $AZURE_IP`).
2. **freeze**: `freeze.sh on` on the live AWS cluster (platform and every store; Redis stays). The maintenance page shows through CloudFront. `maintenance.sh` is the old EC2 compose script and is not used.
3. **final-dump-restore**: `pg_dump -Fc jeffi_stores` from the RDS (tunnel via the AWS core, IAM token), Azure platform pods to 0, `pg_restore --no-owner --no-privileges -j 4` as `app_user` through a 0600 `PGPASSFILE` from Key Vault (never echoed; the local client when new enough, else a matching `postgres:<major>-alpine` with the file mounted). Refuses a non-empty target unless `RESTORE_CLEAN=1`; stops on `pg_restore` errors unless `RESTORE_ALLOW_ERRORS=1`. Compares table counts.
4. **identity**: sets `federation_rule_id = fdrl_01QsmDKrzxm6y34Ho52LNwk5` on the platform row (tenant `0000…0000`, provider `anthropic`, service account `svac_01HXWF7V5MmqFNXzAaxbofaH`) in the **Azure** database. Idempotent; prints only the before/after rule ids. Then resumes the Azure pods on the restored data.
5. **dns**: `route53-plan.sh --apply` (stores to `EDGE_IP`, platform hosts and `origin` to `AZURE_IP`, TTL 60). The rollback batch is kept as `route53-rollback.json`.
6. **cloudfront**: checks `origin.jeffistores.in` answers TLS on the Azure IP, then repoints every custom origin of the website distribution (`E1M6ZFCWXAMF26`) and the mobile one (found by alias) to `origin.jeffistores.in`, keeping their custom headers (`X-Jeffi-Edge`). The before-config is saved first. Waits for `Deployed`.
7. **smoke**: waits for DNS on 1.1.1.1, then `smoke.sh flagship` on the live hosts (add `SMOKE_TENANTS=1` for the stores in the Azure cluster).
8. **unfreeze**: resumes anything still quiesced on Azure. **The AWS cluster stays frozen** (its platform would run on the stale RDS); `UNFREEZE_AWS=1` overrides, see Assumptions.

## Window checklist

**T-1 day**
- [ ] AWS tenant edge is up (`launch-edge.sh --apply`), its Elastic IP is `EDGE_IP`, and it is the `CLUSTER_INGRESS_IP` in the Azure overlay.
- [ ] Azure Postgres `jeffi-prod-pg` exists, `pg-init.sh` ran, Phase D rehearsal passed, and the latest release is deployed to Azure (`CUTOVER_SHA`).
- [ ] `EDGE_IP=… AZURE_IP=… bash deploy/aws/edge/route53-plan.sh --lower-ttl --apply`, then wait out the old TTL.
- [ ] `bash deploy/azure/cutover/cutover.sh` (dry run) is green, including preflight.
- [ ] Window announced; no release or migration in flight; Tailscale up with `--accept-routes`; `az login` and `aws sso` fresh (an SSO expiry mid-window is the commonest stop).
- [ ] AWS EC2 and RDS stay as they are (no snapshots to wait for; `00-backup.sh` is optional insurance).

**T-0** (everything is `--apply`; each step asks you to type its name)
- [ ] `export CUTOVER_DATE=…`, same `EDGE_IP`/`AZURE_IP`/`CUTOVER_SHA`.
- [ ] `preflight`, `freeze`, `final-dump-restore`, `identity`, `dns`, `cloudfront`, `smoke`, `unfreeze`: one at a time or all together.
- [ ] Manual console steps (below), the Anthropic rename after the smoke passes.

**Verify**
- [ ] `https://jeffistores.in/`, `https://ecom.jeffistores.in/`, a store host, `https://mobile.jeffistores.in/healthz`, the app signs in.
- [ ] An order or payment intent lands in the Azure DB; the controller shows tenants; messaging sends one test message.
- [ ] An AI call through the gateway succeeds on Claude (identity step); check the gateway logs for 401s from the federation exchange.
- [ ] The log shows the step timings; note them for the next rehearsal.

**Rollback triggers** (decide in the first hour; later, Azure holds writes the RDS lacks)
- Smoke fails on a platform host and is not fixed within 15 minutes.
- Checkout, login or the restore is wrong (table counts, missing recent rows).
- Stores unreachable through the edge and not fixed within 15 minutes.
- Then: `bash deploy/azure/cutover/rollback.sh` (dry run), then `--apply`. Users lose anything written on Azure since the switch.

**After**
- [ ] AWS EC2 and RDS stay **stopped but intact for 14 days** as the rollback (about $50 extra, once). Do not delete the RDS snapshots.
- [ ] Day 14, if stable, delete: the core EC2, the RDS instance, the core's Elastic IP, its EBS volumes and the snapshots. Later: Secrets Manager (~$5.4/mo) once nothing reads it; `launch-edge.sh` must first write the k3s token in the way the controller does (plan, edge node join).
- [ ] Re-run `mobile-cloudfront.sh stage` is NOT needed: the cloudfront step already repointed the origin.

## Manual founder steps

- **Anthropic console** (after the identity step and a clean smoke): archive the Razer rule `jeffi-production-next` (`fdrl_015c1KmN69fVRfNYSuA5pZMF`), then rename `jeffi-production-azure` (`fdrl_01QsmDKrzxm6y34Ho52LNwk5`) to `jeffi-production`. Do the rename last: rolling back needs the Razer rule alive.
- **GitHub**: set the repository variable `AZURE_TARGET=true` (releases also run DB · Azure, Deploy · Azure and Release · Azure), and **unset `AZURE_INGRESS_IP`**.
- Later, as in the plan: archive the old Anthropic service accounts and the `jeffi-t-testco` rule and workspace.

## Rollback notes

- **Identity**: nothing to undo in a database. The RDS row was never changed and still holds the Razer rule `fdrl_015c1KmN69fVRfNYSuA5pZMF`; only the console rename (above) needs reversing, and only if you already did it.
- DNS and CloudFront come back from the saved batch and configs; the AWS cluster resumes from `freeze-state.txt`; Azure pods are scaled to 0 so no CronJob keeps writing to the Azure copy.

## Assumptions to check before the window

- **Where the existing stores' pods run after cutover is not covered here.** The freeze scales every store namespace of the *AWS* cluster to 0 and `unfreeze` leaves them there. If the stores still live in that cluster, you need them back (`UNFREEZE_AWS=1` does it, but it also resumes the AWS platform against the stale RDS; scale `jeffi` back down right after), or join their nodes to the Azure k3s first.
- Only `jeffi_stores` is dumped (the control plane is already merged into it at go-live). Add `jeffi_control_plane` to the dump if it is not.
- CloudFront forwards the viewer `Host` to the origin (origin request policy), and `origin.jeffistores.in` has a valid certificate from the Azure ingress.
- `app_user` can run `pg_restore --no-owner` into `jeffi_stores` (as the rehearsal did); the restore does not touch roles or extensions.
- Nothing here was run: the scripts passed `bash -n` only.
