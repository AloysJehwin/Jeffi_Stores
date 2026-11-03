import { addTenantServices, controlPlanePool, getTenant, setStoreRequest, setTenantStatus } from '@/lib/tenant-registry'
import { sendStoreLiveEmail } from '@/lib/shared/ecom-emails'
import { triggerProvisioning, resolveRestoreKey } from './trigger'

const OWNER_SQL = `SELECT o.id, o.email, o.name, t.display_name, t.slug, p.slug AS plan
       FROM owner_tenants ot
       JOIN owners o ON o.id = ot.owner_id
       JOIN tenants t ON t.id = ot.tenant_id
       LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ot.tenant_id=$1 LIMIT 1`

/**
 * Start the store: after the first payment, or straight from KYC approval while payments are off.
 * A new store tenant goes to 'provisioning'; a services workspace applying for a store keeps its
 * status (messaging/documents stay live), gains 'store' and tracks the build on store_request. The
 * engine's activate step finishes both. subscription_status is left alone: the webhook owns it, and
 * with payments off there is no subscription behind the store.
 */
export async function startStore(tenant: { id: string; store_request?: string | null }): Promise<void> {
  if (tenant.store_request) {
    await addTenantServices(tenant.id, ['store'])
    await setStoreRequest(tenant.id, 'provisioning')
  } else {
    await setTenantStatus(tenant.id, 'provisioning')
  }
  const ownerRow = await controlPlanePool()
    .query(OWNER_SQL, [tenant.id])
    .catch(() => null)
  const row = ownerRow?.rows[0]
  if (!row) return
  const restoreFromKey = await resolveRestoreKey(tenant.id, row.slug)
  // Fire-and-forget so the caller returns fast; the engine self-advances (AWS) or runs inline (stub).
  triggerProvisioning({
    action: 'provision',
    tenantId: tenant.id,
    slug: row.slug,
    plan: row.plan,
    ownerId: row.id,
    restoreFromKey,
    reason: 'first_payment',
  }).catch(() => {})
}

/**
 * Email the owner that the store is live. Called by the engine once the store is actually serving.
 * Once per tenant: the claim is a 'store_live_email' row in provisioning_step_events, so a retried
 * activate or a later re-provision of the same store does not send it again. Never throws; true
 * when this call sent it.
 */
export async function notifyStoreLive(tenantId: string): Promise<boolean> {
  try {
    const pool = controlPlanePool()
    const claimed = await pool.query(
      `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message)
       SELECT j.id, $1, 'store_live_email', 'ok', 'store live email sent'
         FROM provisioning_jobs j
        WHERE j.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM provisioning_step_events e
                           WHERE e.tenant_id = $1 AND e.step = 'store_live_email' AND e.status = 'ok')
        ORDER BY j.created_at DESC LIMIT 1
       RETURNING id`,
      [tenantId]
    )
    if (!claimed.rowCount) return false
    const row = (await pool.query(OWNER_SQL, [tenantId])).rows[0]
    if (!row) return false
    await sendStoreLiveEmail({ email: row.email, name: row.name }, { display_name: row.display_name, slug: row.slug, plan: row.plan })
    return true
  } catch {
    return false
  }
}

/**
 * Start a store waiting on payment once its subscription is active. The subscription now covers
 * both the plan fee and infra, so no wallet prepayment is required. Called from the subscription
 * webhook, the checkout return page and the provisioning worker; only the first of them starts it.
 */
export async function startStoreIfReady(tenantId: string): Promise<boolean> {
  const t = await getTenant(tenantId)
  if (!t || t.subscription_status !== 'active') return false
  const waiting = t.store_request ? t.store_request === 'awaiting_payment' : t.status === 'awaiting_payment'
  if (!waiting) return false
  const claimed = await controlPlanePool().query(
    t.store_request
      ? `UPDATE tenants SET store_request = 'provisioning', updated_at = now() WHERE id = $1 AND store_request = 'awaiting_payment'`
      : `UPDATE tenants SET status = 'provisioning', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'`,
    [tenantId]
  )
  if (!claimed.rowCount) return false
  await startStore({ id: tenantId, store_request: t.store_request })
  return true
}
