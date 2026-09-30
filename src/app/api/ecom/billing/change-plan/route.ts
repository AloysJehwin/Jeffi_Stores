import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants, listPlans, updateTenantPlan } from '@/lib/tenant-registry'
import { upgradeSubscription, downgradeSubscription, type BillingInterval } from '@/lib/razorpay-subscriptions'
import { triggerProvisioning } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  tenantId: z.string().uuid(),
  planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
  billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
})

export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { tenantId, planSlug, billingInterval } = parsed.data

  // Verify the owner owns this tenant.
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.razorpay_subscription_id)
    return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })

  // Determine upgrade vs downgrade by comparing plan tiers.
  const plans = await listPlans()
  const currentPlan = plans.find(p => p.slug === tenant.plan)
  const newPlan = plans.find(p => p.slug === planSlug)
  if (!newPlan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const currentTier = currentPlan?.tier ?? 1
  const newTier = newPlan.tier

  const isSamePlanAndInterval = planSlug === tenant.plan && billingInterval === (tenant.billing_interval ?? 'monthly')
  if (isSamePlanAndInterval) return NextResponse.json({ error: 'Already on this plan and interval' }, { status: 400 })

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const callbackUrl = `${baseUrl}/dashboard/billing?upgraded=1`

  const isUpgrade =
    newTier > currentTier ||
    (newTier === currentTier && billingInterval === 'yearly' && (tenant.billing_interval ?? 'monthly') === 'monthly')

  if (isUpgrade) {
    // Cancel old sub + create new sub immediately with prorated credit.
    const result = await upgradeSubscription({
      oldSubscriptionId: tenant.razorpay_subscription_id,
      newPlanSlug: planSlug,
      newPlanName: newPlan.name,
      newInterval: billingInterval as BillingInterval,
      ownerEmail: owner.email,
      ownerName: owner.name,
      tenantId,
      tenantSlug: tenant.slug,
      callbackUrl,
    })

    await updateTenantPlan(tenantId, {
      planSlug,
      billingInterval,
      newSubscriptionId: result.subscriptionId,
    })

    // Re-apply DNS to match the new (higher) tier — adds the tier's extra subdomains.
    // DNS-only; never recreates infra. Non-fatal if it fails (drift sweep would catch it).
    await triggerProvisioning({
      action: 'reprovision',
      tenantId,
      slug: tenant.slug,
      plan: planSlug,
      ownerId: owner.id,
      reason: 'plan_change',
    }).catch(() => {})

    return NextResponse.json({
      status: 'upgrade',
      checkoutUrl: result.shortUrl,
      proratedCreditInr: Math.round(result.proratedCreditPaise / 100),
      effectiveAt: 'now',
    })
  } else {
    // Schedule downgrade at end of current cycle.
    const result = await downgradeSubscription({
      subscriptionId: tenant.razorpay_subscription_id,
      newPlanSlug: planSlug,
      newPlanName: newPlan.name,
      newInterval: billingInterval as BillingInterval,
    })

    await updateTenantPlan(tenantId, { planSlug, billingInterval })

    // Re-apply DNS to match the new (lower) tier — removes the higher-tier subdomains now
    // (D1: immediate, single path for up- and downgrades). DNS-only; never touches infra.
    await triggerProvisioning({
      action: 'reprovision',
      tenantId,
      slug: tenant.slug,
      plan: planSlug,
      ownerId: owner.id,
      reason: 'plan_change',
    }).catch(() => {})

    return NextResponse.json({
      status: 'downgrade_scheduled',
      scheduledAt: result.scheduledAt,
      effectiveAt: 'cycle_end',
    })
  }
}
