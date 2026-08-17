import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/razorpay-subscriptions'
import { getTenantBySubscriptionId, setSubscriptionStatus, getOwnerById, controlPlanePool } from '@/lib/tenant-registry'
import { sendPaymentConfirmedEmail, sendStoreLiveEmail } from '@/lib/ecom-emails'
import { provisionTenantOwnerAdmin } from '@/lib/tenant-admin-provision'
import { getProvisioningProvider } from '@/lib/provisioning'
import { deprovisionTenant } from '@/lib/provisioning/steps'

export const dynamic = 'force-dynamic'

/**
 * Full teardown on subscription end (cancelled/completed): back the tenant DB up to S3,
 * then delete RDS + bucket. Fire-and-forget from the webhook so Razorpay still gets its
 * 200 promptly; the real AWS provider's backup+delete can take a while.
 */
async function autoDeprovision(tenantId: string): Promise<void> {
  const ownerRow = await controlPlanePool().query(
    `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId],
  ).catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id ?? null
  const provider = getProvisioningProvider()
  await deprovisionTenant(tenantId, provider, { ownerId }).catch(() => {})
}

// Razorpay sends the raw body for HMAC — we must NOT use request.json() here.
// Body parsing must be done from the raw buffer.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const rawBody = await request.text()

  try {
    verifyWebhookSignature(rawBody, signature)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event: string = payload.event ?? ''
  const sub = payload.payload?.subscription?.entity

  if (!sub?.id) {
    // Not a subscription event we care about — acknowledge and move on.
    return NextResponse.json({ ok: true })
  }

  const tenant = await getTenantBySubscriptionId(sub.id)
  if (!tenant) {
    // Unknown subscription — possibly a test; acknowledge so Razorpay stops retrying.
    return NextResponse.json({ ok: true })
  }

  switch (event) {
    case 'subscription.authenticated':
      // Owner authenticated their card; first charge not yet collected.
      await setSubscriptionStatus(tenant.id, 'authenticated')
      break

    case 'subscription.charged':
      // First (or recurring) charge succeeded → tenant goes live.
      await setSubscriptionStatus(tenant.id, 'active', 'active')
      // Notify owner on first charge (tenant was provisioning → now active)
      if (tenant.status !== 'active') {
        const { controlPlanePool } = await import('@/lib/tenant-registry')
        const pool = controlPlanePool()
        const ownerRow = await pool.query(
          `SELECT o.id, o.email, o.name, t.display_name, t.slug, t.billing_interval,
                  p.slug AS plan
           FROM owner_tenants ot
           JOIN owners o ON o.id = ot.owner_id
           JOIN tenants t ON t.id = ot.tenant_id
           LEFT JOIN plans p ON p.id = t.plan_id
           WHERE ot.tenant_id=$1 LIMIT 1`, [tenant.id]
        ).catch(() => null)
        const row = ownerRow?.rows[0]
        if (row) {
          sendStoreLiveEmail(
            { email: row.email, name: row.name },
            { display_name: row.display_name, slug: row.slug, plan: row.plan }
          ).catch(() => {})
          // Provision super_admin + mTLS cert in tenant DB (fire-and-forget)
          provisionTenantOwnerAdmin({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            ownerEmail: row.email,
            ownerName: row.name,
          }).catch(() => {})
        }
      }
      break

    case 'subscription.halted':
      // Razorpay halted after exhausting retries — suspend store (recoverable via
      // 'resumed', so we do NOT delete infra here).
      await setSubscriptionStatus(tenant.id, 'halted', 'suspended')
      break

    case 'subscription.cancelled':
      await setSubscriptionStatus(tenant.id, 'cancelled', 'terminated')
      autoDeprovision(tenant.id).catch(() => {})
      break

    case 'subscription.completed':
      await setSubscriptionStatus(tenant.id, 'completed', 'terminated')
      autoDeprovision(tenant.id).catch(() => {})
      break

    case 'subscription.expired':
      await setSubscriptionStatus(tenant.id, 'expired', 'suspended')
      break

    case 'subscription.pending':
      // Charge attempt failed; Razorpay will retry — keep current tenant status.
      await setSubscriptionStatus(tenant.id, 'halted')
      break

    case 'subscription.resumed':
      // Recovered after halted — reactivate.
      await setSubscriptionStatus(tenant.id, 'active', 'active')
      break

    default:
      // Unhandled event — acknowledge silently.
      break
  }

  return NextResponse.json({ ok: true })
}
