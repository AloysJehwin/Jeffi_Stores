import { addTenantServices, controlPlanePool, setStoreRequest, setSubscriptionStatus } from '@/lib/tenant-registry'
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
