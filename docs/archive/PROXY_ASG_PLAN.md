# RDS Proxy + EC2 Auto Scaling — Implementation Design

> ⚠️ **PARTIALLY SUPERSEDED (2026-08-18).** RDS Proxy + ASG are still **not executed** (that part
> stands), but the doc's blocking prerequisite — *"`/api/health` returns ok unconditionally"* — is
> **already fixed**: health is now split into liveness (`/api/health`) and readiness
> (`/api/ready`, which checks DB + Redis and is what the ALB/blue-green gate should poll).
> Multi-tenant current state: **`docs/SAAS_MULTITENANT_STATUS.md`**.

> Status: **Design for review. NOT executed.** Grounded in live infra facts (Aug 2026) + AWS-doc research.
> Hard requirement (owner): **container-level blue/green zero-downtime deploy MUST be preserved.**
> Execute deliberately, step-by-step, in a fresh session — not tacked onto a long day. Nothing here has been provisioned.

---

## Context: why these, and why NOT urgent

The Aug outage was a DB connection-exhaustion + memory issue on an under-provisioned `db.t4g.micro`. It's **already fixed** by resizing to `db.t4g.small` (→ `max_connections=181`, real headroom, default param group). So:

- **RDS Proxy** = connection *safety at scale* (pools/multiplexes so many app instances never exhaust RDS). **Prerequisite for safe autoscaling.**
- **EC2 ASG** = capacity *on traffic spikes*. Adds instances under load, removes them when idle.

Neither fixes an active problem — both are hardening for growth + the SaaS build. Do them deliberately.

## Live infra facts (verified)

| Resource | Value |
|---|---|
| Account / Region | 708835965056 / us-east-1 |
| VPC | `vpc-04bd02e91e0bc0882` |
| RDS | `jeffi-stores-db`, PostgreSQL 16, **`db.t4g.small`** (2 vCPU / ~2GB), IAM auth **enabled**, master `postgres`, default param group |
| RDS SG | `sg-0e361f0f1b093bd83` (already allows EC2 SG on 5432) |
| RDS subnets | 6 subnets across us-east-1a–f (default subnet group) |
| App EC2 | `i-0b2466b2a540d6f23`, `t4g.small` arm64, AMI `ami-0db69647f2908f537`, subnet `subnet-01ed5f7b63fd320c1`, key `jeffi-stores-key` |
| EC2 SG | `sg-0dc5182e111d71d02` |
| EC2 instance profile | `jeffi-stores-ec2-profile` |
| ALB | `jeffi-stores-alb` (HTTP:80 + HTTPS:443 listeners) |
| Target group | `jeffi-stores-tg` → EC2:80, **static/manual target, currently the single box** |
| App DB user | `app_user` (passwordless, `rds_iam` role) |
| Deploy | GitHub Action → `appleboy/ssh-action` to **one** resolved EC2 IP → `blue-green-deploy.sh` (pull GHCR image, health-check idle slot, swap nginx upstream) |
| Secrets | AWS Secrets Manager `jeffi/production` (~116 keys) loaded at container boot |

**⚠️ Blocking prerequisite for BOTH:** `src/app/api/health/route.ts` returns `{status:'ok'}` **unconditionally — no DB/Redis check.** This is why the Aug outage served 500s while "healthy," and it will make the ALB route traffic to half-booted ASG instances. **Fix health first.**

---

# Part A — RDS Proxy (do first; prerequisite for ASG)

### A.1 Recommended path: **end-to-end IAM auth** (no Secrets Manager password needed)

Your `app_user` is passwordless IAM (`rds_iam`). Modern RDS Proxy supports `DefaultAuthScheme=IAM_AUTH` — the proxy authenticates to RDS with IAM too, so **no secret, no password**. This keeps `app_user` passwordless (AWS *warns against* mixing a password with `rds_iam` — it causes connection instability).

> The classic path (Secrets Manager username/password) **cannot** use a passwordless IAM-only user — you'd have to create a separate password-based DB user. Avoid; use end-to-end IAM.

### A.2 Steps (all reversible; the only app change is one env var)

1. **IAM role for the proxy** — trusted by `rds.amazonaws.com`, inline policy allowing `rds-db:connect` on `arn:aws:rds-db:us-east-1:708835965056:dbuser:<DbiResourceId>/app_user`. (Get `DbiResourceId` from `aws rds describe-db-instances --query 'DBInstances[].DbiResourceId'`.) No `secretsmanager:*` needed on this path.
2. **Proxy security group** `sg-rdsproxy` in `vpc-04bd02e91e0bc0882`.
3. **Create proxy:**
   ```
   aws rds create-db-proxy --db-proxy-name jeffi-stores-proxy \
     --engine-family POSTGRESQL --role-arn <proxy-role-arn> \
     --vpc-subnet-ids <2+ subnets from the DB subnet group> \
     --vpc-security-group-ids sg-rdsproxy --require-tls \
     --default-auth-scheme IAM_AUTH
   ```
4. **Register target:** `aws rds register-db-proxy-targets --db-proxy-name jeffi-stores-proxy --db-instance-identifiers jeffi-stores-db` → wait for target health `AVAILABLE`.
5. **Security groups:** proxy SG inbound 5432 from EC2 SG `sg-0dc5182e111d71d02`; RDS SG `sg-0e361f0f1b093bd83` inbound 5432 from proxy SG.
6. **Extend the EC2/app IAM role** (`jeffi-stores-ec2-profile`'s role) `rds-db:connect` to include the proxy resource: `arn:aws:rds-db:us-east-1:708835965056:dbuser:<prx-XXXX>/app_user` (proxy resource id from `describe-db-proxies`).
7. **App change (the only code/config change):** point `RDS_HOST` at the proxy endpoint (`jeffi-stores-proxy.proxy-xxxx.us-east-1.rds.amazonaws.com`), keep port 5432. In `src/lib/db.ts`, the `@aws-sdk/rds-signer` `Signer` is constructed from `RDS_HOST` — the IAM token is **host:port-specific**, so it must sign for the proxy endpoint. Practically: **just change the `RDS_HOST` value in the `jeffi/production` secret.** TLS `ca: global-bundle.pem` still works against the proxy. No pool/password changes.

### A.3 Gotchas (from AWS docs)
- IAM token is bound to the exact host it's signed for — if `RDS_HOST` still points at the instance but you connect to the proxy (or vice versa), auth fails. The one edit is making the signer host = proxy endpoint.
- `--require-tls` is mandatory with IAM auth; keep `rejectUnauthorized:true` + the CA (don't fall back to `rejectUnauthorized:false`).
- Do **not** add a password to `app_user` while it has `rds_iam`.
- RDS Proxy for PG doesn't support: `CancelRequest`, streaming replication; `lastval()` can be inaccurate under multiplexing → use `INSERT … RETURNING` (verify the codebase already does).
- The default `postgres` DB must exist (it does).

### A.4 Cost
$0.015/vCPU-hr, **min 2 vCPU billed** → `db.t4g.small` (2 vCPU) ≈ **$0.03/hr ≈ ~$22/mo (~₹1,900).** (Cheaper alternative if only pooling is wanted: PgBouncer on the EC2 box — but Proxy is managed + IAM-native and the right call for autoscaling.)

### A.5 Rollback
Revert `RDS_HOST` to the instance endpoint, redeploy. Proxy can sit unused or be deleted. Zero data risk (Proxy is stateless plumbing).

---

# Part B — EC2 Auto Scaling Group (min 1, max 3) — **blue/green preserved**

### B.0 The core requirement & how we honor it

**Blue/green (per-instance, container-level) = zero-downtime deploys → KEEP.** Autoscaling (fleet-level) = add/remove instances → SEPARATE layer. They compose:

- Each ASG instance still runs `blue-green-deploy.sh` locally (nginx + blue/green slots, atomic swap). **Unchanged.**
- Deploy **fans out to ALL instances** via **SSM Run Command** (by tag) instead of SSH-to-one-IP. Each instance does its own zero-downtime slot swap. ALB never sees a gap.
- Autoscaling adds/removes instances *underneath* that model.

> We do **NOT** use ASG "instance refresh" as the deploy path (the app image is `:latest` outside the AMI). Instance refresh is only for AMI/base changes.

### B.1 The blocker (why a naive ASG breaks)
Today everything is coupled to **one hand-provisioned box**: deploy SSHes to a fixed IP; containers mount **local files** from `/opt/jeffi-stores` (`./certs`, `jeffi-stores-76e9ecaecdd6.json` Google service-account, compose files, nginx confs). A fresh ASG instance has none of these.

### B.2 Steps

1. **FIX `/api/health` FIRST (blocking).** Make it verify Postgres `SELECT 1` (short timeout) + Redis `PING`, return 503 on failure. Optionally split `/api/health` (liveness, always 200) vs `/api/ready` (dependencies). Point `jeffi-stores-tg`'s health check at the real one. *Without this the ALB routes traffic to half-booted instances* — exactly the Aug failure mode. **This is also a standalone win worth doing now regardless of ASG.**

2. **Decide the TLS/nginx boundary.** Per-box nginx mounting `/etc/letsencrypt` + `./certs` is the biggest ASG friction (certs are per-host local files). **Strongly recommended: terminate HTTPS at the ALB with an ACM cert** for `jeffistores.in` + `admin.jeffistores.in`; ALB forwards HTTP:80 to instances. Then instances need no certs/certbot/mounts. *(If nginx must stay on-box for the blue/green upstream swap, keep it but pull certs from S3/Secrets Manager at boot — messier. Prefer ALB TLS.)*
   - ⚠️ **mTLS note:** `admin.` uses client-cert mTLS (nginx + API-GW truststore). ALB doesn't do mTLS the same way — the admin path needs separate thought (keep the API-GW mTLS path, or handle admin mTLS at ALB via a dedicated listener). Flag for the execution session.

3. **Build a golden AMI** (hybrid, recommended over pure user-data). From AL2023 arm64: bake **Docker + compose plugin, SSM Agent (enabled), AWS CLI, the `docker-compose.*.yml` + `nginx-*.conf`, `/opt/jeffi-stores` skeleton**. Do **NOT** bake: secrets, GHCR token, certs, Google JSON, or the app image. Rationale: baking the slow bits avoids a multi-minute install on every scale-out; user-data then only does fast dynamic steps. Version the AMI.

4. **Launch Template + instance profile.** Pin golden AMI, `t4g.small`, arm64, subnets/SG, instance profile granting: `secretsmanager:GetSecretValue` on `jeffi/production` + a new `jeffi/ghcr-token`; `s3:GetObject` on a config bucket (Google JSON / certs if kept); and `AmazonSSMManagedInstanceCore`. Tag instances `app=jeffi-stores, role=web` for SSM targeting.

5. **User-data (self-provision on boot):** (a) fetch GHCR token from SM → `docker login ghcr.io`; (b) fetch Google JSON / certs from S3 (or skip if TLS→ALB); (c) app reads `SM_SECRET_ID=jeffi/production` at runtime via instance role (no on-disk .env — and note the in-progress PR #423 fix makes secret→app env propagation correct); (d) `docker compose -f docker-compose.infra.yml up -d` (redis; nginx only if kept), bring up one app slot, write `active_slot`; (e) log user-data to CloudWatch. Idempotent.

6. **Create ASG + attach existing target group.** ASG min 1 / max 3 from the Launch Template. Attach **target group `jeffi-stores-tg`** (not the ALB directly). Enable **ELB health checks** so the ASG replaces ALB-unhealthy instances. Health-check grace ~300s (user-data + GHCR pull + app start on t4g.small); tune down after measuring. Remove the current static manual target — registration becomes automatic.

7. **Replace SSH-to-one-host deploy with SSM Run Command fan-out.** Change CI Stage 4 from `appleboy/ssh-action` (one IP) to:
   ```
   aws ssm send-command --document-name AWS-RunShellScript \
     --targets Key=tag:app,Values=jeffi-stores \
     --parameters commands='cd /opt/jeffi-stores && bash deploy/blue-green-deploy.sh'
   ```
   Runs the **same `blue-green-deploy.sh`** (pull `:latest`, swap on-box slot) on **every** ASG instance at once → preserves container-level blue/green zero-downtime, now N hosts. Poll invocation status; fail the deploy if any instance fails. Prefer GitHub OIDC role over long-lived AWS keys.

### B.3 Scaling policy
Target-tracking on CPU (e.g. 60%). Min 1 / Max 3. Extra instances only run during spikes → ~₹50–150/mo typical.

### B.4 Cost
Auto Scaling itself: **free.** Pay only for extra instances while running (each `t4g.small` ≈ ₹1,080/mo if 24/7; far less if spiky). ALB already exists.

### B.5 Rollback
ASG min=max=1 pins to one instance; or detach the ASG and re-attach the static target. Keep the old SSH-deploy job path until SSM fan-out is proven.

---

## Recommended execution order (fresh session, step-by-step)

1. **Fix `/api/health`** (real DB/Redis check) — standalone win, unblocks ASG, low risk. *(Could ship now via PR.)*
2. **RDS Proxy** (Part A) — end-to-end IAM, flip `RDS_HOST`, verify, keep instance endpoint as rollback.
3. **Golden AMI + Launch Template + user-data** (Part B 3–5) — build & boot-test ONE instance manually before any ASG.
4. **ASG + target group + ELB health** (Part B 6).
5. **SSM fan-out deploy** (Part B 7) — keep old SSH job until proven.
6. Decommission static target + old deploy path.

Each step is independently reversible. Do them one at a time, verifying the store stays green between each.

## Open decisions for the execution session
1. **TLS at ALB (ACM) vs keep per-box nginx?** Recommend ALB — but resolve the **`admin.` mTLS** path first (it can't move to a plain ALB listener as-is).
2. **GHCR auth on ASG instances** — new `jeffi/ghcr-token` secret + instance-role read.
3. **Config files** (Google JSON, any certs) — S3 + instance-role `GetObject`, or eliminate (certs) by moving TLS to ALB.
4. Confirm `db.t4g.small`'s 2-vCPU RDS Proxy min-billing (~₹1,900/mo) is acceptable, or defer Proxy until multiple app instances actually exist (single instance doesn't strictly need it).

---

*Grounded in: live AWS describe calls (RDS/EC2/ALB/SG/subnets), the CI workflow + `blue-green-deploy.sh` + `docker-compose.green.yml`, and AWS-doc research on RDS Proxy IAM auth + ASG-with-blue/green. Cost figures at ~₹88/USD.*
