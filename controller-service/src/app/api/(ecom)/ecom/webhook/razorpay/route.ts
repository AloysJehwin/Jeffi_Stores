import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/payments/razorpay-subscriptions'
import { getTenantBySubscriptionId, setSubscriptionStatus, controlPlanePool } from '@/lib/tenant-registry'
import { issuePlatformInvoiceLater } from '@/lib/billing/platform-invoice'
import { triggerProvisioning } from '@/lib/provisioning/trigger'
import { startStore } from '@/lib/provisioning/start-store'

export const dynamic = 'force-dynamic'

/**
 * Full teardown on subscription end (cancelled/completed): back the tenant DB up to S3,
 * then delete RDS + bucket. Fire-and-forget from the webhook so Razorpay still gets its
 * 200 promptly; the real AWS provider's backup+delete can take a while.
 */
async function autoDeprovision(tenantId: string, slug: string): Promise<void> {
  const ownerRow = await controlPlanePool()
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId])
    .catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id ?? null
  await triggerProvisioning({
    action: 'deprovision',
    tenantId,
    slug,
    plan: null,
    ownerId,
    reason: 'missed_payment',
  }).catch(() => {})
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
      // First (or recurring) charge succeeded. Mark the SUBSCRIPTION active. On the FIRST charge
      // (tenant still awaiting_payment / not yet live), flip to 'provisioning' and kick the
      // engine — this is the ONLY place real provisioning starts. Do NOT set 'active' here;
      // only the engine's activate step does that, after infra exists + the host verifies.
      // A services workspace whose store application is approved is not live as a store yet either.
      if (tenant.store_request === 'awaiting_payment' || (!tenant.store_request && tenant.status !== 'active' && tenant.status !== 'provisioning')) {
        await startStore(tenant)
      } else {
        // Recurring charge on an already-live tenant — just keep the subscription active.
        await setSubscriptionStatus(tenant.id, 'active')
      }
      await invoiceSubscriptionCharge(tenant.id, sub, payload.payload?.payment?.entity)
      break

    case 'subscription.halted':
      // Razorpay halted after exhausting retries — suspend store (recoverable via
      // 'resumed', so we do NOT delete infra here).
      await setSubscriptionStatus(tenant.id, 'halted', 'suspended')
      break

    case 'subscription.cancelled':
      await setSubscriptionStatus(tenant.id, 'cancelled', 'terminated')
      autoDeprovision(tenant.id, tenant.slug).catch(() => {})
      break

    case 'subscription.completed':
      await setSubscriptionStatus(tenant.id, 'completed', 'terminated')
      autoDeprovision(tenant.id, tenant.slug).catch(() => {})
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

// Tax invoice for every successful plan charge (first and recurring). Plan prices include GST.
async function invoiceSubscriptionCharge(tenantId: string, sub: any, payment: any) {
  if (!payment?.id || !(Number(payment.amount) > 0)) return
  const plan = (await controlPlanePool().query(
    `SELECT p.slug, p.name, t.billing_interval FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id=$1`, [tenantId]
  ).catch(() => null))?.rows[0]
  const d = (sec?: number) => (sec ? new Date(sec * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null)
  const period = d(sub?.current_start) && d(sub?.current_end) ? ` · ${d(sub.current_start)} – ${d(sub.current_end)}` : ''
  const name = plan?.name || (plan?.slug ? plan.slug[0].toUpperCase() + plan.slug.slice(1) : 'Store')
  issuePlatformInvoiceLater({
    tenantId, kind: 'subscription', externalRef: payment.id, sac: '998315',
    description: `Jeffi Commerce ${name} plan (${plan?.billing_interval === 'yearly' ? 'yearly' : 'monthly'})${period}`,
    amountInr: Number(payment.amount) / 100, pricesIncludeGst: true,
  })
}
