import { controlPlanePool } from './shared'
import { clearTenantCache } from './host-resolution'
import { getTenant } from './tenants'
import { getDraft } from './kyc'

/** Set a tenant's status (e.g. provisioning->active) or instance_state (running/stopped). */
export async function setTenantStatus(tenantId: string, status: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET status=$1, updated_at=now() WHERE id=$2`, [status, tenantId])
}

/**
 * Reconciliation sweep: find tenants marked 'active' but whose infra is gone (rds_endpoint
 * NULL) — an inconsistent state where the resolver would route to a non-existent DB (or, if
 * infra is null, silently fall back to the platform DB). Flip them to 'suspended' so they
 * stop being served and surface for operator attention. Returns the affected tenant ids.
 * Safe + idempotent; run periodically from the provisioning cron worker.
 */
export async function reconcileOrphanedTenants(): Promise<string[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `UPDATE tenants t SET status='suspended', updated_at=now()
     WHERE t.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM tenant_infra i WHERE i.tenant_id = t.id AND i.rds_endpoint IS NOT NULL
       )
     RETURNING t.id`
  )
  if (res.rowCount && res.rowCount > 0) clearTenantCache()
  return res.rows.map(r => r.id as string)
}
export async function saveLinkedAccountId(tenantId: string, linkedAccountId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET razorpay_linked_account_id=$1, updated_at=now() WHERE id=$2`, [
    linkedAccountId,
    tenantId,
  ])
}

/**
 * Switch a tenant between collecting on its own Razorpay account (skip Route split, zero platform
 * charges) and the platform account (full Route split). Enabling own-account requires connected
 * tenant Razorpay credentials — enforced by the caller, not here.
 */
export async function setOwnRazorpay(tenantId: string, value: boolean): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET own_razorpay=$1, updated_at=now() WHERE id=$2`, [value, tenantId])
}

/**
 * Flip whether a tenant ships on their own Delhivery token. Enabling requires a connected Delhivery
 * token — enforced by the caller (delivery-mode route), not here.
 */
export async function setOwnDelhivery(tenantId: string, value: boolean): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET own_delhivery=$1, updated_at=now() WHERE id=$2`, [value, tenantId])
}

/**
 * Copy the Razorpay linked account (acc_xxx) onto the owner-scoped bank row so it survives a
 * hard tenant purge. tenant_bank_accounts cascades off owners (not tenants), so this value
 * outlives the tenant DELETE and lets a re-onboarding owner reuse their existing Route account
 * (Razorpay enforces one linked account per merchant email). Idempotent.
 */
export async function persistLinkedAccountToOwnerBank(ownerId: string, linkedAccountId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_bank_accounts SET linked_account_id=$2, updated_at=now()
     WHERE owner_id=$1 AND linked_account_id IS DISTINCT FROM $2`,
    [ownerId, linkedAccountId]
  )
}

export async function saveSubscriptionId(
  tenantId: string,
  subscriptionId: string,
  billingInterval?: string,
  checkoutUrl?: string
): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenants SET razorpay_subscription_id=$1, subscription_status='created',
      billing_interval=COALESCE($3, billing_interval),
      razorpay_checkout_url=COALESCE($4, razorpay_checkout_url),
      updated_at=now() WHERE id=$2`,
    [subscriptionId, tenantId, billingInterval ?? null, checkoutUrl ?? null]
  )
}

export async function setSubscriptionStatus(
  tenantId: string,
  subscriptionStatus: string,
  tenantStatus?: string
): Promise<void> {
  const pool = controlPlanePool()
  if (tenantStatus) {
    await pool.query(`UPDATE tenants SET subscription_status=$1, status=$2, updated_at=now() WHERE id=$3`, [
      subscriptionStatus,
      tenantStatus,
      tenantId,
    ])
  } else {
    await pool.query(`UPDATE tenants SET subscription_status=$1, updated_at=now() WHERE id=$2`, [
      subscriptionStatus,
      tenantId,
    ])
  }
}

export async function getTenantBySubscriptionId(
  subscriptionId: string
): Promise<{ id: string; slug: string; status: string } | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT id, slug, status FROM tenants WHERE razorpay_subscription_id=$1`, [subscriptionId])
  return r.rows[0] ?? null
}

export async function updateTenantPlan(
  tenantId: string,
  opts: {
    planSlug: string
    billingInterval: string
    newSubscriptionId?: string
  }
): Promise<void> {
  const pool = controlPlanePool()
  const planRow = await pool.query(`SELECT id FROM plans WHERE slug=$1`, [opts.planSlug])
  const planId = planRow.rows[0]?.id ?? null
  await pool.query(
    `UPDATE tenants SET plan_id=$1, billing_interval=$2,
      razorpay_subscription_id=COALESCE($3, razorpay_subscription_id),
      subscription_status=CASE WHEN $3 IS NOT NULL THEN 'created' ELSE subscription_status END,
      updated_at=now() WHERE id=$4`,
    [planId, opts.billingInterval, opts.newSubscriptionId ?? null, tenantId]
  )
}

export async function setTenantInstanceState(tenantId: string, state: 'running' | 'stopped'): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET instance_state=$1, updated_at=now() WHERE id=$2`, [state, tenantId])
}
/** Write resolved infra pointers after provisioning. */
/**
 * Record a step outcome that happened outside the provisioning worker — the Route linked
 * account is created at KYC approval, not by a job. Without this the only trace was a stderr
 * line, which the next blue-green deploy discarded, so a failure could not be diagnosed after
 * the fact. Attaches to the tenant's most recent job (job_id is NOT NULL) and never throws.
 */
export async function recordTenantStepEvent(
  tenantId: string,
  step: string,
  status: 'ok' | 'error',
  message: string | null,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    await controlPlanePool().query(
      `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail)
       SELECT j.id, $1, $2, $3, $4, $5::jsonb
         FROM provisioning_jobs j WHERE j.tenant_id = $1
         ORDER BY j.created_at DESC LIMIT 1`,
      [tenantId, step, status, message, JSON.stringify(detail)]
    )
  } catch {
    /* a log line must never fail the operation it describes */
  }
}

export async function writeTenantInfra(
  tenantId: string,
  infra: { rdsEndpoint: string; s3Bucket: string }
): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET rds_endpoint=$1, s3_bucket=$2, iam_auth=true, updated_at=now() WHERE tenant_id=$3`,
    [infra.rdsEndpoint, infra.s3Bucket, tenantId]
  )
}

/** Null the infra pointers after deprovisioning (resources deleted). */
export async function clearTenantInfra(tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET rds_endpoint=NULL, ec2_instance_id=NULL, updated_at=now() WHERE tenant_id=$1`,
    [tenantId]
  )
  clearTenantCache()
}

/**
 * Permanently purge a deprovisioned tenant: preserve the owner's Razorpay linked account, delete
 * both S3 backup copies, then DELETE the tenant row (cascades to all tenant-scoped tables). The
 * owners row and the owner-scoped tenant_bank_accounts row are intentionally kept so a returning
 * owner can reuse their existing Route account. No restore after this.
 *
 * Refuses a tenant that still has live infra — the caller must deprovision first.
 */
export async function purgeTenant(tenantId: string): Promise<{ ok: boolean; error?: string; deletedBackups?: number }> {
  const pool = controlPlanePool()
  const tenant = await getTenant(tenantId)
  if (!tenant) return { ok: false, error: 'Tenant not found' }
  if (tenant.rds_endpoint || (tenant.status !== 'terminated' && tenant.status !== 'deprovisioned')) {
    return { ok: false, error: 'Tenant must be deprovisioned before it can be deleted' }
  }

  const ownerRow = await pool
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId])
    .catch(() => null)
  const ownerId: string | null = ownerRow?.rows[0]?.owner_id ?? null

  if (ownerId && tenant.razorpay_linked_account_id) {
    await persistLinkedAccountToOwnerBank(ownerId, tenant.razorpay_linked_account_id)
  }

  // Delhivery has no delete for a client warehouse — deactivate the pickup address so the purged
  // store's origin stops being usable. Deprovision already does this; repeated here so a purge of
  // a tenant deprovisioned before that change (or a partial teardown) still retires it.
  if (ownerId) {
    const draft = await getDraft(ownerId).catch(() => null)
    const pickupName = (draft?.data as any)?.wh?.pickupLocation || tenant.slug
    const { deactivateDelhiveryPickupLocation } = await import('@/lib/shipping/delhivery')
    await deactivateDelhiveryPickupLocation(pickupName).catch(() => {})
  }

  let deletedBackups = 0
  if (ownerId) {
    const { deleteTenantBackups } = await import('@/lib/tenancy/tenant-backup-store')
    const res = await deleteTenantBackups({ ownerId, slug: tenant.slug })
    deletedBackups = res.deleted
  }

  await pool.query(`DELETE FROM tenants WHERE id=$1`, [tenantId])
  clearTenantCache()
  return { ok: true, deletedBackups }
}

/** Platform-wide infra KV (e.g. the shared pool EC2 instance id/ip). */
export async function getPlatformInfra(key: string): Promise<string | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT value FROM platform_infra WHERE key=$1`, [key])
  return r.rows[0]?.value ?? null
}

export async function setPlatformInfra(key: string, value: string | null): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO platform_infra (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, value]
  )
}

/** Persist a tenant's serving EC2 target (dedicated instance IP or pool IP) + optional instance id. */
export async function writeTenantEc2(
  tenantId: string,
  ec2Target: string,
  ec2InstanceId?: string | null
): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET ec2_target=$1, ec2_instance_id=COALESCE($2, ec2_instance_id), updated_at=now() WHERE tenant_id=$3`,
    [ec2Target, ec2InstanceId ?? null, tenantId]
  )
}
