# Disaster Recovery Runbook — Jeffi Stores

**Last Updated:** 2026-06-18
**Owner:** Engineering
**Review Cycle:** Quarterly

---

## 1. RTO / RPO Targets

| Tier | Scenario | RTO | RPO |
|------|----------|-----|-----|
| P1 | Database down | 4 hours | 1 hour |
| P1 | App server down | 1 hour | — (stateless) |
| P2 | Payment gateway outage | 2 hours (vendor SLA) | — |
| P2 | Shipping API outage | 4 hours (vendor SLA) | — |
| P3 | Partial service degradation | 8 hours | 1 hour |

**Definitions**
- **RTO** (Recovery Time Objective): maximum tolerable downtime before service is restored.
- **RPO** (Recovery Point Objective): maximum tolerable data loss measured in time.

---

## 2. Database Recovery

### 2.1 Overview

| Item | Value |
|------|-------|
| Engine | PostgreSQL on AWS RDS |
| Live DB name | `jeffi_stores` |
| Live host | accessed via SSH tunnel on `localhost:5433` |
| Local mirror | `jeffi_production_ready` on `localhost:5432` |
| Automated backups | Enabled (RDS automated backups, 7-day retention recommended) |
| Multi-AZ | Verify in RDS console; enable if not already active |

### 2.2 Establishing the SSH Tunnel

Before connecting to the live database, open the SSH tunnel:

```bash
# Replace <BASTION_HOST> and <RDS_ENDPOINT> with actual values
ssh -N -L 5433:<RDS_ENDPOINT>:5432 ec2-user@<BASTION_HOST> -i ~/.ssh/jeffi-bastion.pem &
```

Verify the tunnel:

```bash
psql -h localhost -p 5433 -U <DB_USER> -d jeffi_stores -c "SELECT NOW();"
```

### 2.3 Restore from RDS Automated Snapshot

1. Open the AWS RDS console.
2. Navigate to **Databases > jeffi_stores > Maintenance & backups**.
3. Under **Snapshots**, select the most recent automated snapshot before the incident.
4. Click **Actions > Restore snapshot**.
5. Choose a new DB instance identifier (e.g. `jeffi-stores-restored-<date>`).
6. Select the same instance class, VPC, and security groups as the production instance.
7. Click **Restore DB Instance** and wait for status to become `Available` (typically 10–30 min).
8. Update the RDS endpoint in `DATABASE_URL` (or SSH tunnel target) to point to the restored instance.
9. Verify data integrity:
   ```bash
   psql -h localhost -p 5433 -U <DB_USER> -d jeffi_stores \
     -c "SELECT COUNT(*) FROM orders;"
   ```

### 2.4 Point-in-Time Recovery (PITR)

Use PITR when you need to recover to a specific moment (e.g. before a bad migration).

1. In the RDS console, select the database instance.
2. Click **Actions > Restore to point in time**.
3. Choose **Custom date and time** and enter the target UTC timestamp.
4. Provide a new DB instance identifier.
5. Complete the restore (same VPC/security group settings as above).
6. Validate and cut over as in steps 8–9 of Section 2.3.

**Note:** PITR requires automated backups to be enabled and the target time to be within the backup retention window.

### 2.5 Post-Restore Checklist

- [ ] Update `DATABASE_URL` environment variable in the deployment environment.
- [ ] Restart the application to pick up the new connection string.
- [ ] Run a smoke test: place a test order, verify it appears in the admin panel.
- [ ] Check for any pending migrations (`npx prisma migrate status` or equivalent).
- [ ] Notify stakeholders once service is confirmed stable.

---

## 3. Application Recovery

### 3.1 Re-deploy the Next.js Application

The application is stateless. Recovery is a re-deploy from the latest passing build.

```bash
# On the deployment machine or CI/CD runner
git checkout main
git pull origin main
npm ci
npm run build
# Deploy using your configured deployment method (AWS Lambda / EC2 / ECS)
```

If using a deployment script or CI/CD pipeline, trigger the pipeline for the `main` branch.

### 3.2 Environment Variables Checklist

All variables below must be present in the deployment environment before starting the application. Confirm each one is set and non-empty.

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string (points to RDS via tunnel or direct) | AWS Secrets Manager / .env |
| `RAZORPAY_KEY_ID` | Razorpay public key | Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | Razorpay secret key | Razorpay dashboard |
| `DELHIVERY_API_KEY` | Delhivery shipping API key | Delhivery partner portal |
| `JWT_SECRET` | JWT signing secret (session tokens) | Secrets Manager |
| `NEXTAUTH_SECRET` | NextAuth.js secret | Secrets Manager |
| `ENABLE_GST` | GST feature flag (`true` / `false`) | Config |
| `BUSINESS_STATE_CODE` | State code for GST calculations | Config |
| `DELHIVERY_SELLER_ADDRESS` | Seller address sent to Delhivery | Config |

Verify at runtime:

```bash
# Quick check — will list any undefined variables
node -e "
const required = [
  'DATABASE_URL','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET',
  'DELHIVERY_API_KEY','JWT_SECRET','NEXTAUTH_SECRET',
  'ENABLE_GST','BUSINESS_STATE_CODE','DELHIVERY_SELLER_ADDRESS'
];
const missing = required.filter(k => !process.env[k]);
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
console.log('All env vars present.');
"
```

### 3.3 Health Check

After deployment, confirm the application is healthy:

```bash
curl -f https://<APP_DOMAIN>/api/health || echo "Health check failed"
```

If `/api/health` is not implemented, test a known public endpoint (e.g. the homepage or `/api/products`).

---

## 4. Incident Runbooks

### 4.1 Database Down

**Symptoms:** 500 errors site-wide; logs show `Connection refused` or `ECONNREFUSED` on port 5433.

| Step | Action |
|------|--------|
| 1 | Check RDS console: confirm instance status (`Available` / `Stopped` / `Failed`). |
| 2 | If instance is stopped, start it from the console. Wait for `Available`. |
| 3 | If SSH tunnel is down, re-establish it (Section 2.2). |
| 4 | If instance is in a failed state, initiate snapshot restore (Section 2.3). |
| 5 | Update `DATABASE_URL` if the endpoint changed. |
| 6 | Restart the application. |
| 7 | Run smoke tests (place test order, check admin panel). |
| 8 | Post incident update to stakeholders. |

**Escalate if:** RDS instance cannot be started and no recent snapshot exists.

---

### 4.2 App Server Down

**Symptoms:** Site returns 502/504; CloudWatch shows no running tasks/instances.

| Step | Action |
|------|--------|
| 1 | Check the deployment platform (Lambda / ECS / EC2) for instance/function status. |
| 2 | Check recent deployment logs for build failures. |
| 3 | Trigger a re-deploy from the last known-good build (Section 3.1). |
| 4 | Confirm all environment variables are present (Section 3.2). |
| 5 | Monitor health check endpoint until it returns 200. |
| 6 | Roll back to the previous deployment if the new build remains unhealthy. |

**Escalate if:** Re-deploy succeeds but health check continues to fail after 15 minutes.

---

### 4.3 Payment Gateway Outage (Razorpay)

**Symptoms:** Checkout errors; Razorpay status page shows degraded service.

| Step | Action |
|------|--------|
| 1 | Check https://status.razorpay.com for active incidents. |
| 2 | Do NOT disable checkout — orders in progress may complete once Razorpay recovers. |
| 3 | Post a banner on the site informing users of payment delays (edit homepage notice or use a feature flag). |
| 4 | Monitor Razorpay webhooks; do not manually mark orders as paid without webhook confirmation. |
| 5 | Once Razorpay recovers, audit `orders` table for any orders stuck in `payment_pending` and reconcile via Razorpay dashboard. |
| 6 | Re-enable checkout (remove banner). |
| 7 | Document any orders that required manual reconciliation. |

**Escalate if:** Outage exceeds 2 hours or any orders show inconsistent payment state.

---

### 4.4 Shipping API Outage (Delhivery)

**Symptoms:** Shipment creation fails at order fulfillment; logs show Delhivery API errors.

| Step | Action |
|------|--------|
| 1 | Check Delhivery status / contact Delhivery support to confirm outage. |
| 2 | Orders can still be placed and paid; only fulfillment (AWB generation) is blocked. |
| 3 | Pause automated fulfillment jobs if any are configured. |
| 4 | Queue affected orders for manual re-processing once API recovers. |
| 5 | Once Delhivery recovers, process queued orders through the admin panel. |
| 6 | Notify customers of expected dispatch delay if it exceeds 24 hours. |

**Escalate if:** Outage exceeds 4 hours or there is a backlog of more than 50 unshipped orders.

---

## 5. Contacts & Escalation

| Role | Name | Email | Phone |
|------|------|-------|-------|
| Engineering Lead | _TBD_ | _TBD_ | _TBD_ |
| Database Admin | _TBD_ | _TBD_ | _TBD_ |
| DevOps / Infra | _TBD_ | _TBD_ | _TBD_ |
| Business Owner | _TBD_ | _TBD_ | _TBD_ |
| Razorpay Support | — | support@razorpay.com | 1800-123-1272 |
| Delhivery Support | — | support@delhivery.com | — |
| AWS Support | — | (via console) | — |

**Escalation Path:**
1. On-call engineer attempts initial recovery (Sections 4.1–4.4).
2. If unresolved within 30 minutes, escalate to Engineering Lead.
3. If unresolved within 2 hours (P1) or 4 hours (P2), escalate to Business Owner.
4. For AWS infrastructure issues, open an AWS Support case at severity "Urgent" or "Critical".

---

## 6. Backup Verification Schedule

Regular restore drills ensure backups are valid and the team is practiced before a real incident.

| Frequency | Activity | Owner | Record |
|-----------|----------|-------|--------|
| Monthly | Restore latest RDS snapshot to a temporary instance; verify row counts in `orders`, `products`, `inventory`. Destroy the temporary instance after verification. | Database Admin | Drill log in `docs/ops/drill-log.md` |
| Quarterly | Full DR drill: restore DB snapshot + re-deploy app to staging; run smoke tests end-to-end. | Engineering Lead | Drill log in `docs/ops/drill-log.md` |
| After each RDS backup retention change | Verify retention period in RDS console matches policy (minimum 7 days). | DevOps | — |
| After each major deployment | Confirm automated backups are still enabled and the latest snapshot timestamp is recent. | Engineering Lead | — |

### Monthly Restore Drill Steps

1. In the RDS console, identify the most recent automated snapshot.
2. Restore it to a new instance named `jeffi-dr-drill-<YYYY-MM>`.
3. Connect via a test SSH tunnel on a different local port (e.g. 5434).
4. Run verification queries:
   ```sql
   SELECT COUNT(*) FROM orders;
   SELECT COUNT(*) FROM products;
   SELECT MAX(created_at) FROM orders;
   ```
5. Confirm the latest order timestamp matches expectations (within the RPO window).
6. Delete the `jeffi-dr-drill-<YYYY-MM>` instance.
7. Record the drill result (pass/fail, any anomalies) in `docs/ops/drill-log.md`.
