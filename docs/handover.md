# Session Handover — 2026-08-05

## 🔴 CRITICAL: PRODUCTION IS DOWN — read "Recovery" first

**`https://jeffistores.in` returns 000 (down).** The EC2 box (`i-0b2466b2a540d6f23`, public IP `32.196.38.130`, Tailscale `jeffi-ec2` / `100.121.227.128`) is **OOM-locked**: both `jeffi-app-blue` and `jeffi-app-green` auto-restart on a 2 GB t4g.small and exhaust memory, wedging `sshd` (SSH fails with "Connection timed out during banner exchange"). Tailscale ping works (kernel) but no shell path works (SSH, `tailscale ssh`, and SSM all blocked — SSM agent not installed).

### ROOT CAUSE
The t4g.small has **2 GB RAM and cannot run blue + green simultaneously** (2 × Next.js standalone × `WEB_CONCURRENCY=4` = 8 heavy Node processes + nginx + redis). The blue-green deploy started `app_green` alongside `app_blue` → OOM. Both containers have `restart: unless-stopped`, so every reboot re-creates the deadlock.

### RECOVERY PROCEDURE (do this first, next session)
There is a **~20–30 s window right after a reboot** where sshd responds before both apps saturate RAM. Catch it and kill green:

```bash
# 1. Reboot to clear the OOM
aws ec2 reboot-instances --instance-ids i-0b2466b2a540d6f23 --region us-east-1

# 2. IMMEDIATELY hammer SSH (public IP 32.196.38.130) and kill green the instant you're in.
#    Start ~30s after reboot, retry every 2-3s. The FIRST successful connect must run:
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@32.196.38.130 \
  'docker update --restart=no jeffi-app-green; docker rm -f jeffi-app-green'
#    (Runbook confirms: caught the window once at "Up 22 seconds" — must be faster next time.)

# 3. Once green is gone, blue serves alone and the box stabilizes. Verify:
ssh ec2-user@32.196.38.130 'free -m; docker ps; curl -s -o /dev/null -w "%{http_code}\n" -H "Host: jeffistores.in" http://localhost/api/health'
curl -s -o /dev/null -w "%{http_code}\n" https://jeffistores.in/    # expect 200
```

**If the window can't be caught:** stop the instance, detach/mount the root volume on a helper instance, edit `/opt/jeffi-stores/docker-compose.green.yml` (or `docker` state) so green can't start — or set both slots to `WEB_CONCURRENCY=2` before restart. Simpler: after reboot, if you get in, also `docker update --restart=no jeffi-app-blue` is NOT needed (blue is the one we want serving).

### THE REAL FIX (so this never recurs)
Blue-green needs both slots running momentarily → **2 GB is not enough.** Options:
1. **Upgrade EC2 t4g.small → t4g.medium (4 GB)** before using blue-green, OR
2. **Lower `WEB_CONCURRENCY` to 2** in `docker-compose.blue.yml`/`green.yml` (halves memory per slot), OR
3. **Abandon blue-green on this box** and revert to the old rolling `docker-compose.prod.yml` (single app service, 2 replicas) which fit in 2 GB fine.

Recommendation: revert to old rolling deploy until the box is upgraded. Blue-green is not viable on 2 GB.

---

## What Was Being Worked On
Merged a large `feature-business` PR (#407) to main — product-delete fix, draft-mode enforcement, admin username/password removal, dashboard redesign — then attempted the **first blue-green + cluster deploy**, which OOM-crashed the 2 GB box. Also mid-session: swapped storefront logo to the JS-circle, cleaned repo cruft, updated the super-admin email on live RDS.

## Systems / Infra
| Resource | Value |
|---|---|
| EC2 instance | `i-0b2466b2a540d6f23`, t4g.small (2 GB), region us-east-1 |
| Public IP (post-reboot) | `32.196.38.130` |
| Tailscale | `jeffi-ec2` / `100.121.227.128` (ping OK, sshd wedged) |
| App dir | `/opt/jeffi-stores` (on `main`) |
| RDS | `jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com` db `jeffi_stores` user `app_user` (IAM auth) |
| Local DB | `postgresql://localhost:5432/jeffi_production_ready` |
| AWS CLI | works locally (used it to reboot) |
| SSM | NOT available (agent not registered) |

## Open PRs
#409 postcss/next, #408 fast-uri, #406 hono, #405 ip-address, #404 js-yaml, #401 hono-node-server, #398 sharp, #396 body-parser — **all Dependabot, none related to this outage.** PR #410 (network fix) was MERGED.

## What Was Completed This Session
- **Product delete** (`api/admin/products/[id]/route.ts`): transactional full cascade incl. GRN/PO history + selling units. Merged.
- **Draft-mode enforcement** (products, brands, categories): edit pages redirect when no draft; `DraftEditButton` + parameterized `DraftConfirmModal`; brands draft POST added. Merged.
- **Admin username/password removal**: 28 files + migration `database/migrations/2026-08-05_admins_drop_username_password.sql` + entity SQL (users/constraints/functions). Merged. **NOTE: this migration has NOT run on live RDS** (deploy never reached the migrate step — good, no half-applied auth change).
- **New-admin cert email** (`src/lib/email.ts`): greeting→full name, Email row, slug filename. Merged.
- **Logo**: `public/images/logo.png` overwritten with 96px JS circle (from `store-logo.png`). Local only — NOT committed.
- **Repo cleanup**: removed `old-files/`, `check-images.js`, `logo_4k/enhanced/upscaled/original_backup.png`, all `.DS_Store`. Local only — NOT committed.
- **Sidebar/top-bar**: "Jeffi Stores" + collapse toggle moved to full-width top bar; folder icon. Local only — NOT committed (AdminShell.tsx, AdminSidebarNav.tsx).
- **Blue-green network fix** (PR #410, MERGED): all compose files pin `networks.internal.name = jeffi_internal`; removed `depends_on: redis` from blue/green.
- **LIVE RDS super-admin email changed**: `aloysjehwin@gmail.com` → `admin@jeffistores.in`, and `google_id` cleared (re-links on next Google login). DONE + committed to DB. `admin@jeffistores.in` confirmed a real Google account.

## What Is In Progress / Partially Done
- **BLUE-GREEN CUTOVER — FAILED, box OOM-locked.** `infra.yml` on main still says `driver: bridge` (should be `external: true`); I patched it server-locally during bootstrap but `git reset --hard` in deploy reverts it. The deploy script runs `infra + green` (external wins) so it starts green → OOM.
- Uncommitted local changes (logo, cleanup, sidebar) still on `feature-business` working tree — not committed/pushed.

## What Needs To Be Done Next (ordered)
1. **RECOVER PRODUCTION** — reboot + race-SSH to kill `jeffi-app-green` (see Recovery above). Get site to 200.
2. **Decide blue-green viability**: upgrade box to 4 GB, OR set `WEB_CONCURRENCY=2` per slot, OR revert to old rolling `docker-compose.prod.yml`. Until then, DO NOT re-run a blue-green deploy — it will OOM again.
3. Fix `docker-compose.infra.yml` on main: `internal` network → `external: true` (must be created out-of-band first). Add to a new PR.
4. Commit the uncommitted local work (logo swap, repo cleanup, sidebar top-bar) — separate clean commits.
5. When ready to deploy the merged `main` app changes safely: the `admins` username/password migration + entity schema-diff WILL run on live RDS on the next successful deploy → **test Google→MFA login immediately after** (super-admin now logs in as `admin@jeffistores.in`).

## Key Decisions Made
- Live super-admin email is now `admin@jeffistores.in` (Google-login capable, google_id cleared for re-link).
- Blue-green network pinned to fixed name `jeffi_internal` across all compose files (PR #410).
- Product-with-history delete = force full delete (removes GRN/PO line items), per user choice.
- Draft editing enforced for products/brands/categories; coupons/suppliers/review-forms were already safe.

## Important File Paths
- `deploy/blue-green-deploy.sh` — health-check loop is 30 attempts × 10s sleep = 5 min max.
- `docker-compose.{infra,blue,green}.yml` — network `jeffi_internal`; blue/green external, infra still `driver: bridge` (BUG).
- `docs/runbooks/blue-green-setup.md` — one-time bootstrap steps (has the two-paths schema section).
- `database/migrations/2026-08-05_admins_drop_username_password.sql` — applied LOCAL only; pending on live.
- `src/lib/admin-identity.ts` — cert-CN now matches `admin_certificates.common_name`, not username.

## Known Issues / Gotchas
- **2 GB box cannot run blue+green together — this is the outage root cause.** Do not retry blue-green until box is upgraded or WEB_CONCURRENCY lowered.
- SSH banner-exchange timeout = OOM symptom, not a network issue (Tailscale ping still works).
- Public IP changed to `32.196.38.130` after reboot (was different before). CloudFront origin is the ALB, not the raw IP, so CF should follow — but verify.
- Old rolling containers (`jeffi-stores-app-1/2`) were REMOVED during bootstrap — the old setup is not trivially restorable without `docker compose -f docker-compose.prod.yml up -d app`.
- Uncommitted local changes on `feature-business` will be lost if branch is reset — commit them.
