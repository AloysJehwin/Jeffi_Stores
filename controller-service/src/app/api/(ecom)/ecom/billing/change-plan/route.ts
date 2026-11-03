import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, listPlans, setPendingPlan, updateTenantPlan } from '@/lib/tenant-registry'
import { invalidatePlanCache } from '@/lib/auth/plan-gate'
import { cancelOldSubscription, upgradeSubscription, downgradeSubscription, type BillingInterval } from '@controller/lib/payments/razorpay-subscriptions'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'
import { dedicatedCapacityError } from '@controller/lib/k8s/capacity'
import { computeSpecEnabled, planCompute } from '@controller/lib/compute/catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { getTenantCompute } from '@controller/lib/compute/store'
import { planCompatibilityError } from '@/lib/compute/validate'
import { priceInrMonthForPlan } from '@controller/lib/compute/pricing-month'

export const dynamic = 'force-dynamic'

// Back-compat: plan-only change. New UI should call /api/ecom/plan with both planSlug + spec; the new route
// supersedes this one and the compute PUT route. Kept so the existing BillingClient keeps working until the UI
// follow-up removes its last caller.

const Schema = z.object({
  tenantId: z.string().uuid(),
  planSlug: z.string().min(1),
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

  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.razorpay_subscription_id)
    return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })

  const plans = await listPlans()
  const currentPlan = plans.find(p => p.slug === tenant.plan)
  const newPlan = plans.find(p => p.slug === planSlug)
  if (!newPlan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const currentTier = currentPlan?.tier ?? 1
  const newTier = newPlan.tier
  const isSame = planSlug === tenant.plan && billingInterval === (tenant.billing_interval ?? 'monthly')
  if (isSame) return NextResponse.json({ error: 'Already on this plan and interval' }, { status: 400 })

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const callbackUrl = `${baseUrl}/dashboard/billing?upgraded=1`

  // Keep whatever spec the store already runs/wants, and check it fits the new plan.
  const compute = computeSpecEnabled()
  const row = await getTenantCompute(tenantId)
  const spec = row?.desired ?? row?.applied ?? legacySpecFor(tenant.plan)
  if (compute) {
    const target = await planCompute(planSlug)
    const why = target && planCompatibilityError(spec, target)
    if (why) {
      return NextResponse.json(
        { error: `Your servers don't fit the ${newPlan.name} plan: ${why} Change them on the Servers page first.`, code: 'compute' },
        { status: 409 }
      )
    }
  }

  const newPrice = await priceInrMonthForPlan(planSlug, spec)
  if (!newPrice || newPrice <= 0) return NextResponse.json({ error: 'Could not price the new plan.' }, { status: 400 })

  const isUpgrade =
    newTier > currentTier ||
    (newTier === currentTier && billingInterval === 'yearly' && (tenant.billing_interval ?? 'monthly') === 'monthly')

  if (isUpgrade) {
    const capacityError = compute ? null : await dedicatedCapacityError(planSlug)
    if (capacityError) return NextResponse.json({ error: capacityError, code: 'capacity' }, { status: 409 })

    const result = await upgradeSubscription({
      oldSubscriptionId: tenant.razorpay_subscription_id,
      newPlanSlug: planSlug,
      newPlanName: newPlan.name,
      newInterval: billingInterval as BillingInterval,
      priceInrMonth: newPrice,
      ownerEmail: owner.email,
      ownerName: owner.name,
      tenantId,
      tenantSlug: tenant.slug,
      callbackUrl,
    })

    await updateTenantPlan(tenantId, { planSlug, billingInterval, newSubscriptionId: result.subscriptionId })
    await setPendingPlan(tenantId, null)
    invalidatePlanCache(tenantId)
    await cancelOldSubscription(tenant.razorpay_subscription_id).catch(async (e: any) => {
      const { alertProvisioningFailure } = await import('@controller/lib/provisioning/alerts')
      await alertProvisioningFailure(tenant.slug, 'plan_upgrade', `old subscription ${tenant.razorpay_subscription_id} not cancelled (still charging): ${e?.message}`, tenantId).catch(() => {})
    })

    const prov = await triggerProvisioning({
      action: 'reprovision',
      tenantId,
      slug: tenant.slug,
      plan: planSlug,
      ownerId: owner.id,
      reason: 'plan_change',
    }).catch((e: any) => ({ ok: false, error: e?.message || 'reprovision failed' }))

    return NextResponse.json({
      status: 'upgrade',
      checkoutUrl: result.shortUrl,
      proratedCreditInr: Math.round(result.proratedCreditPaise / 100),
      effectiveAt: 'now',
      provisioning: { ok: prov.ok, error: prov.error ?? null },
    })
  }

  const result = await downgradeSubscription({
    subscriptionId: tenant.razorpay_subscription_id,
    newPlanSlug: planSlug,
    newPlanName: newPlan.name,
    newInterval: billingInterval as BillingInterval,
    priceInrMonth: newPrice,
  })
  await setPendingPlan(tenantId, { planSlug, billingInterval })

  return NextResponse.json({
    status: 'downgrade_scheduled',
    scheduledAt: result.scheduledAt,
    effectiveAt: 'cycle_end',
  })
}
