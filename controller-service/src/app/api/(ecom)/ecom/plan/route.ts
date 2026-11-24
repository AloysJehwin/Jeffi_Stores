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
import type { BillingInterval } from '@controller/lib/payments/razorpay-subscriptions'
import { changeStorePlan } from '@controller/lib/billing/subscription'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'
import { ComputeSpecSchema } from '@controller/lib/compute/schema'
import { checkComputeChange } from '@controller/lib/compute/change'
import { saveDesiredCompute, patchTenantCompute } from '@controller/lib/compute/store'
import { priceInrMonthForPlan } from '@controller/lib/compute/pricing-month'
import { specKey } from '@/lib/compute/presets'
import { paymentRequired } from '@/lib/billing/payment-required'

export const dynamic = 'force-dynamic'

const Body = z.object({
  tenantId: z.string().uuid(),
  planSlug: z.string().min(1),
  spec: ComputeSpecSchema,
  billingInterval: z.enum(['monthly', 'yearly']).optional(),
  applyMode: z.enum(['window', 'now']).default('window'),
})

/**
 * Unified plan + spec change for a live store. Computes the new monthly subscription price (plan fee + infra margin + GST).
 * Optional store (tenants.payment_required false): the plan and spec change now, unbilled. Mandatory store, through the
 * workspace's subscription (lib/billing changeStorePlan):
 *   higher → a replacement subscription (returns checkoutUrl) collecting the difference for the rest of the cycle; the
 *            plan and spec move when the owner authorises it (pending_change). Nothing is cancelled before that.
 *   lower  → the price drops at cycle end (a replacement the owner approves, else the difference is refunded on each
 *            charge); spec queued on tenant_compute (status 'scheduled') and the plan held on tenants.pending_plan_id
 *            until the next charge moves it
 *   same   → the plan moves now
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
  const billed = paymentRequired(tenant)
  if (billed && !tenant.razorpay_subscription_id) return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })

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

  if (!billed) {
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
  const payer = { email: owner.email, name: owner.name }
  let result
  try {
    result = await changeStorePlan(tenantId, { planSlug, interval: billingInterval, priceInrMonth: newPrice, spec, applyMode, ownerId: owner.id }, payer)
  } catch (e: any) {
    console.error('[plan] subscription change failed', e?.message || e)
    return NextResponse.json({ error: 'Could not update your subscription. Please try again.' }, { status: 502 })
  }

  if (result.status === 'checkout') {
    return NextResponse.json({
      status: 'upgrade',
      checkoutUrl: result.checkoutUrl,
      priceInrMonth: newPrice,
      upfrontInr: Math.round(result.quote.upfrontPaise / 100),
      effectiveAt: 'on_approval',
    })
  }

  if (result.status === 'scheduled') {
    // Held until the next charge (storeCharged applyPendingPlan); the spec waits on tenant_compute.
    if (!samePlan) await setPendingPlan(tenantId, { planSlug, billingInterval })
    const at = result.effectiveAt ? new Date(result.effectiveAt) : null
    await patchTenantCompute(tenantId, { status: 'scheduled', next_at: at })
    await controlPlanePool().query(`UPDATE tenant_compute SET desired = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, JSON.stringify(spec)])
    return NextResponse.json({
      status: 'downgrade_scheduled',
      scheduledAt: at ? Math.floor(at.getTime() / 1000) : null,
      checkoutUrl: result.checkoutUrl,
      priceInrMonth: newPrice,
      effectiveAt: 'cycle_end',
    })
  }

  // Same price: nothing to charge, the plan and servers move now.
  if (!samePlan) {
    await updateTenantPlan(tenantId, { planSlug, billingInterval })
    await setPendingPlan(tenantId, null)
    invalidatePlanCache(tenantId)
  }
  if (planChanged || specKey(spec) !== specKey(check.current ?? spec)) await saveDesiredCompute(tenantId, spec, applyMode)
  const prov = planChanged
    ? await triggerProvisioning({ action: 'reprovision', tenantId, slug: tenant.slug, plan: planSlug, ownerId: owner.id, reason: 'plan_change' }).catch(
        (e: any) => ({ ok: false, error: e?.message || 'reprovision failed' })
      )
    : null
  return NextResponse.json({ status: 'applied', priceInrMonth: newPrice, effectiveAt: 'now', provisioning: prov ? { ok: prov.ok, error: prov.error ?? null } : null })
}
