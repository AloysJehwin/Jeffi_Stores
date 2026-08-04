# Session Handover — 2026-08-04

## What Was Being Worked On
Infrastructure upgrades for jeffistores.in: created an AWS ALB in front of the EC2 instance, upgraded EC2 from t4g.micro to t4g.small, and implemented Node.js cluster mode (4 workers) to increase concurrent request capacity from ~5 to ~15–20 simultaneous users.

## Branch
`feature-business` — all code changes go here. **Never push to main directly.**

---

## AWS Infrastructure Changed This Session

| Resource | Before | After |
|---|---|---|
| EC2 instance type | t4g.micro (1 vCPU, 1 GB RAM) | t4g.small (2 vCPU, 2 GB RAM) |
| Load balancer | nginx internal only | AWS ALB + nginx internal |
| CloudFront origin | EC2 Elastic IP (HTTP) | ALB DNS (HTTPS-only) |
| EC2 port 80 | Open to internet | ALB SG only |

## AWS Resources Created This Session

| Resource | ID / Value |
|---|---|
| ALB DNS | `jeffi-stores-alb-287793444.us-east-1.elb.amazonaws.com` |
| ALB ARN | `arn:aws:elasticloadbalancing:us-east-1:708835965056:loadbalancer/app/jeffi-stores-alb/4af5bc82562f377f` |
| Target group ARN | `arn:aws:elasticloadbalancing:us-east-1:708835965056:targetgroup/jeffi-stores-tg/4f965ea11b637a5d` |
| ALB SG | `sg-06785e62fbbf4116e` (jeffi-stores-alb) |
| EC2 SG | `sg-0dc5182e111d71d02` — port 80 now locked to ALB SG only |
| CloudFront distribution | `E1M6ZFCWXAMF26` — origin updated to ALB, HTTPS-only, read timeout 60s |
| ACM cert | `arn:aws:acm:us-east-1:708835965056:certificate/4591f2e4-417c-4049-95a0-a30a8e0cfdc5` (`*.jeffistores.in`) |

---

## Current Live Capacity (t4g.small, 2 workers, cluster NOT yet deployed)

| Concurrent users | RPS | Failures | Verdict |
|---|---|---|---|
| 5 | 6.6 | 0% | Stable |
| 10 | 7.4 | 8% | Degrading |
| 15 | 12 | 3% | Errors |

Safe limit: ~5 simultaneous users (~50 active visitors at normal browse pace).

**After cluster deploy (PR #357 merged): expected ~15–20 concurrent, ~3× improvement.**

---

## What Was Completed This Session

- AWS ALB created — HTTP→HTTPS redirect listener + HTTPS forward listener (TLS 1.3, ACM wildcard cert)
- ALB idle timeout set to 150s (matches AI route maxDuration)
- EC2 port 80 locked to ALB SG only (security hardening)
- CloudFront origin switched from EC2 Elastic IP → ALB DNS, protocol HTTPS-only
- EC2 upgraded t4g.micro → t4g.small (2 GB RAM, removes memory bottleneck)
- nginx `proxy_read_timeout 150s` added to storefront + business subdomains (was missing, caused silent 504s on AI routes)
- `cluster-server.js` created — Node.js cluster wrapper, forks `WEB_CONCURRENCY` workers, auto-restarts crashed workers
- `Dockerfile` updated: CMD changed to `node cluster-server.js`, COPY for cluster-server.js added
- `docker-compose.prod.yml`: `WEB_CONCURRENCY=2` added

---

## What Is In Progress / Partially Done

- **Cluster mode not yet deployed** — `cluster-server.js` + Dockerfile + docker-compose changes are on `feature-business`, not merged. Needs PR #357 merge to go live.
- **CloudFront origin read timeout stuck at 60s** — needs AWS support case for 180s increase (free support tier blocks API-based case creation).

---

## What Needs To Be Done Next

1. **Merge PR #357** → pipeline auto-deploys cluster mode → capacity ~3× improvement
2. **Raise CloudFront timeout support case manually**:
   - URL: https://console.aws.amazon.com/support/home#/case/create
   - Type: Service limit increase → CloudFront
   - Distribution ID: `E1M6ZFCWXAMF26`, Origin ID: `jeffi-stores-ec2`
   - Request: `OriginReadTimeout = 180 seconds`
   - Reason: AI/LLM routes take up to 120s; 60s limit causes 504 on customer-facing AI features
   - Once approved, patch `/tmp/cf-config3-fixed.json` → set `OriginReadTimeout: 180` → `aws cloudfront update-distribution --id E1M6ZFCWXAMF26 --if-match <latest-etag> --distribution-config file:///tmp/cf-config3-fixed.json`
3. **After cluster deploy, re-run load test**: `ab -n 200 -c 20 https://jeffistores.in/` to confirm improvement
4. **Optional next scale step**: upgrade RDS `db.t4g.micro` → `db.t4g.small` (+~$13/month) — becomes bottleneck after cluster is live

---

## Key Decisions Made

- ALB uses HTTPS-only to origin — CloudFront → ALB on port 443 with ACM cert (HTTP caused redirect loop)
- CloudFront failover group `jeffi-stores-failover-group` kept intact — EC2/ALB primary, S3 maintenance bucket failover on 502/503/504
- Default CloudFront cache behavior changed from `jeffi-stores-failover-group` → `jeffi-stores-ec2` directly — failover group was serving S3 during EC2 restart
- `WEB_CONCURRENCY=2` per container — matches t4g.small's 2 vCPU; 2 replicas × 2 workers = 4 total handlers
- console.log removed from cluster-server.js — project hook blocks log statements in JS files

---

## Important File Paths

| File | Change |
|---|---|
| `cluster-server.js` | New — Node.js cluster wrapper for Next.js standalone |
| `Dockerfile` | CMD → `node cluster-server.js`; COPY cluster-server.js added |
| `docker-compose.prod.yml` | `WEB_CONCURRENCY=2` added to app environment |
| `deploy/nginx.conf` | `proxy_connect_timeout 10s`, `proxy_send_timeout 150s`, `proxy_read_timeout 150s` added to storefront (443) and business.jeffistores.in blocks |

---

## Known Issues / Gotchas

- **EC2 direct port 80 is now blocked** — external curl to `http://32.196.38.130` will fail. Internal `localhost` (CI pipeline health checks) still works fine.
- **CloudFront OriginReadTimeout capped at 60s** on standard accounts — AI routes taking >60s will still 504 at CloudFront edge until support case is approved.
- **Site went down briefly** during EC2 instance type change (stop→modify→start). CloudFront failed over to S3 maintenance. Root cause: CloudFront default behavior was pointing to failover group, not EC2 directly. Fixed.
- **Dependabot PRs** (#396–#405) are open but unreviewed — not urgent, no security criticals.

---

## Previous Session Context (2026-08-03)

Key items still pending from last session:

- **AI email generation** (`src/app/api/admin/ai-generate-email/route.ts`) — was broken in Turbopack dev, may work in prod. Test after deploy.
- **AdvancedFilterPanel layout** — fix: `mode="trigger"` + `mode="content"` split in products/orders pages (see memory `feedback_filter_panel_layout.md`)
- **coupon_drafts migration** — `database/migrations/coupon-drafts.sql` needs to be applied to live RDS
- `feature-business` is 106+ commits ahead of main

## Open PRs

| PR | Description |
|---|---|
| #405 | bump ip-address 10.2.0 → 10.4.0 |
| #404 | bump js-yaml 4.2.0 → 4.3.0 |
| #403 | bump postcss 8.5.15 → 8.5.18 |
| #402 | bump hono 4.12.26 → 4.12.32 |
| #401 | bump @hono/node-server + @modelcontextprotocol/sdk |
| #400 | bump next 15.5.19 → 15.5.21 |
| #399 | bump fast-uri 3.1.2 → 3.1.4 |
| #398 | bump sharp 0.33.5 → 0.35.0 |
| #396 | bump body-parser 2.2.2 → 2.3.0 |
