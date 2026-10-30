import { addTenantServices, controlPlanePool, getTenant, setStoreRequest, setSubscriptionStatus } from '@/lib/tenant-registry'
import { sendStoreLiveEmail } from '@/lib/shared/ecom-emails'
import { triggerProvisioning, resolveRestoreKey } from './trigger'

/**
 * First payment (or the payment bypass): start the store. A new store tenant goes to 'provisioning';
 * a services workspace applying for a store keeps its status (messaging/documents stay live), gains
 * 'store' and tracks the build on store_request. The engine's activate step finishes both.
 */
export async function startStore(tenant: { id: string; store_request?: string | null }): Promise<void> {
  if (tenant.store_request) {
    await setSubscriptionStatus(tenant.id, 'active')
    await addTenantServices(tenant.id, ['store'])
    await setStoreRequest(tenant.id, 'provisioning')
  } else {
    await setSubscriptionStatus(tenant.id, 'active', 'provisioning')
  }
  const ownerRow = await controlPlanePool()
    .query(
      `SELECT o.id, o.email, o.name, t.display_name, t.slug, p.slug AS plan
       FROM owner_tenants ot
       JOIN owners o ON o.id = ot.owner_id
       JOIN tenants t ON t.id = ot.tenant_id
       LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ot.tenant_id=$1 LIMIT 1`,
      [tenant.id]
    )
    .catch(() => null)
  const row = ownerRow?.rows[0]
  if (!row) return
  sendStoreLiveEmail(
    { email: row.email, name: row.name },
    { display_name: row.display_name, slug: row.slug, plan: row.plan }
  ).catch(() => {})
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
 * Start a store waiting on payment once its plan is paid (subscription active) and its wallet holds the
 * servers' first days (billing/prepay.ts). Called from the subscription webhook, the checkout return page,
 * an owner's top-up and the provisioning worker; only the first of them starts it.
 */
export async function startStoreIfReady(tenantId: string): Promise<boolean> {
  const t = await getTenant(tenantId)
  if (!t || t.subscription_status !== 'active') return false
  const waiting = t.store_request ? t.store_request === 'awaiting_payment' : t.status === 'awaiting_payment'
  if (!waiting) return false
  const { storePrepay } = await import('@controller/lib/billing/prepay')
  const p = await storePrepay(tenantId, t.plan ?? null)
  if (p.balance < p.requiredInr) return false
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
