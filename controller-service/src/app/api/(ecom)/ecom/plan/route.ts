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
import { specKey } from '@/lib/compute/presets'

export const dynamic = 'force-dynamic'

const Body = z.object({
  tenantId: z.string().uuid(),
  planSlug: z.string().min(1),
  spec: ComputeSpecSchema,
  billingInterval: z.enum(['monthly', 'yearly']).optional(),
  applyMode: z.enum(['window', 'now']).default('window'),
})

// Off until KYC-approved stores are charged; the Razorpay path below stays for when it is on.
const paymentsEnabled = () => process.env.ECOM_PAYMENTS_ENABLED === 'true'

/**
 * Unified plan + spec change for a live store. Computes the new monthly subscription price (plan fee + infra margin + GST).
 * Payments off: the plan and spec change now. Payments on:
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

  const { tenantId, planSlug, spec, billingInterval: wantInterval, applyMode } = parsed.data
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  if (paymentsEnabled() && !tenant.razorpay_subscription_id) return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })

  const plans = await listPlans()
  const newPlan = plans.find(p => p.slug === planSlug)
  if (!newPlan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  const billingInterval = (wantInterval ?? tenant.billing_interval ?? 'monthly') as BillingInterval
  const planChanged = planSlug !== tenant.plan
  const samePlan = !planChanged && billingInterval === (tenant.billing_interval ?? 'monthly')

  // Server-side check of the spec on the plan it moves to — plan.minPreset, fit, capacity.
  const check = await checkComputeChange(tenantId, spec, { planSlug, billingChanged: !samePlan })
  if (check.status !== 200) return NextResponse.json({ error: check.error, quote: check.quote }, { status: check.status })

  const newPrice = await priceInrMonthForPlan(planSlug, spec)
  if (!newPrice || newPrice <= 0) return NextResponse.json({ error: 'Could not price the new servers.' }, { status: 400 })

  if (!paymentsEnabled()) {
    if (!samePlan) {
      await updateTenantPlan(tenantId, { planSlug, billingInterval })
      await setPendingPlan(tenantId, null)
      invalidatePlanCache(tenantId)
    }
    // Saved after the plan moves, so its price is the new plan's; the compute worker applies it.
    if (planChanged || specKey(spec) !== specKey(check.current ?? spec)) await saveDesiredCompute(tenantId, spec, applyMode)
    const prov = planChanged
      ? await triggerProvisioning({ action: 'reprovision', tenantId, slug: tenant.slug, plan: planSlug, ownerId: owner.id, reason: 'plan_change' }).catch(
          (e: any) => ({ ok: false, error: e?.message || 'reprovision failed' })
        )
      : null
    return NextResponse.json({
      status: 'applied',
      priceInrMonth: newPrice,
      effectiveAt: 'now',
      provisioning: prov ? { ok: prov.ok, error: prov.error ?? null } : null,
    })
  }
  const subscriptionId = tenant.razorpay_subscription_id as string

  const currentPrice = Number(
    (
      await controlPlanePool().query<{ price: number | null }>(
        `SELECT price_inr_month::int AS price FROM tenant_compute WHERE tenant_id = $1`,
        [tenantId]
      )
    ).rows[0]?.price ?? 0
  )

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const callbackUrl = `${baseUrl}/dashboard/billing?upgraded=1`
  const isUpgrade = newPrice > currentPrice || (billingInterval === 'yearly' && (tenant.billing_interval ?? 'monthly') === 'monthly')

  if (isUpgrade) {
    const result = await upgradeSubscription({
      oldSubscriptionId: subscriptionId,
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
    await saveDesiredCompute(tenantId, spec, applyMode)
    await cancelOldSubscription(subscriptionId).catch(async (e: any) => {
      const { alertProvisioningFailure } = await import('@controller/lib/provisioning/alerts')
      await alertProvisioningFailure(tenant.slug, 'plan_upgrade', `old subscription ${subscriptionId} not cancelled: ${e?.message}`, tenantId).catch(() => {})
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
    subscriptionId,
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
