import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import {
  controlPlanePool,
  getOwnerTenants,
  listPlans,
  setPendingPlan,
  updateTenantPlan,
} from '@/lib/tenant-registry'
import { invalidatePlanCache } from '@/lib/auth/plan-gate'
import {
  cancelOldSubscription,
  downgradeSubscription,
  upgradeSubscription,
  type BillingInterval,
} from '@controller/lib/payments/razorpay-subscriptions'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'
import { ComputeSpecSchema } from '@controller/lib/compute/schema'
import { checkComputeChange } from '@controller/lib/compute/change'
import { saveDesiredCompute, patchTenantCompute } from '@controller/lib/compute/store'
import { priceInrMonthForPlan } from '@controller/lib/compute/pricing-month'

export const dynamic = 'force-dynamic'

const Body = z.object({
  tenantId: z.string().uuid(),
  planSlug: z.string().min(1),
  spec: ComputeSpecSchema,
  billingInterval: z.enum(['monthly', 'yearly']).optional(),
})

/**
 * Unified plan + spec change for a live store. Computes the new monthly subscription price (plan margin + GST):
 *   higher than today → upgradeSubscription now (returns checkoutUrl), spec saved as pending
 *   lower            → downgradeSubscription at cycle end; spec queued on tenant_compute (status 'scheduled')
 *                       and the plan change held on tenants.pending_plan_id until the webhook moves it
 */
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const { tenantId, planSlug, spec, billingInterval: wantInterval } = parsed.data
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  if (!tenant.razorpay_subscription_id) return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })

  const plans = await listPlans()
  const newPlan = plans.find(p => p.slug === planSlug)
  if (!newPlan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  const billingInterval = (wantInterval ?? tenant.billing_interval ?? 'monthly') as BillingInterval

  // Server-side price check for the new (plan, spec) — validates compat with plan.minPreset, capacity, etc.
  const check = await checkComputeChange(tenantId, spec)
  if (check.status !== 200) return NextResponse.json({ error: check.error, quote: check.quote }, { status: check.status })

  const newPrice = await priceInrMonthForPlan(planSlug, spec)
  if (!newPrice || newPrice <= 0) return NextResponse.json({ error: 'Could not price the new servers.' }, { status: 400 })

  const currentPrice = Number(
    (
      await controlPlanePool().query<{ price: number | null }>(
        `SELECT price_inr_month::int AS price FROM tenant_compute WHERE tenant_id = $1`,
        [tenantId]
      )
    ).rows[0]?.price ?? 0
  )

  const samePlan = planSlug === tenant.plan && billingInterval === (tenant.billing_interval ?? 'monthly')
  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const callbackUrl = `${baseUrl}/dashboard/billing?upgraded=1`
  const isUpgrade = newPrice > currentPrice || (billingInterval === 'yearly' && (tenant.billing_interval ?? 'monthly') === 'monthly')

  if (isUpgrade) {
    const result = await upgradeSubscription({
      oldSubscriptionId: tenant.razorpay_subscription_id,
      newPlanSlug: planSlug,
      newPlanName: newPlan.name,
      newInterval: billingInterval,
      priceInrMonth: newPrice,
      ownerEmail: owner.email,
      ownerName: owner.name,
      tenantId,
      tenantSlug: tenant.slug,
      callbackUrl,
    })
    if (!samePlan) {
      await updateTenantPlan(tenantId, { planSlug, billingInterval, newSubscriptionId: result.subscriptionId })
      await setPendingPlan(tenantId, null)
      invalidatePlanCache(tenantId)
    }
    await saveDesiredCompute(tenantId, spec)
    await cancelOldSubscription(tenant.razorpay_subscription_id).catch(async (e: any) => {
      const { alertProvisioningFailure } = await import('@controller/lib/provisioning/alerts')
      await alertProvisioningFailure(tenant.slug, 'plan_upgrade', `old subscription ${tenant.razorpay_subscription_id} not cancelled: ${e?.message}`, tenantId).catch(() => {})
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
      priceInrMonth: newPrice,
      proratedCreditInr: Math.round(result.proratedCreditPaise / 100),
      effectiveAt: 'now',
      provisioning: { ok: prov.ok, error: prov.error ?? null },
    })
  }

  // Downgrade: price drops at the next cycle. Hold the plan + spec until the webhook moves them (applyPendingPlan).
  const result = await downgradeSubscription({
    subscriptionId: tenant.razorpay_subscription_id,
    newPlanSlug: planSlug,
    newPlanName: newPlan.name,
    newInterval: billingInterval,
    priceInrMonth: newPrice,
  })
  if (!samePlan) await setPendingPlan(tenantId, { planSlug, billingInterval })
  // Queue the new spec on tenant_compute (status 'scheduled'); provisioning picks it up after cycle_end.
  await patchTenantCompute(tenantId, { status: 'scheduled', next_at: result.scheduledAt ? new Date(result.scheduledAt * 1000) : null })
  await controlPlanePool().query(`UPDATE tenant_compute SET desired = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, JSON.stringify(spec)])
  return NextResponse.json({
    status: 'downgrade_scheduled',
    scheduledAt: result.scheduledAt,
    priceInrMonth: newPrice,
    effectiveAt: 'cycle_end',
  })
}
