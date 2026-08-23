import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { cancelSubscription } from '@/lib/razorpay-subscriptions'
import { triggerProvisioning, resolveRestoreKey } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

// Canonical owner-facing provisioning trigger. Every provisioning/deprovisioning action an
// owner initiates from the ecom portal comes through here. Owner-session gated; the owner
// must own the tenant. The full self-contained payload is built SERVER-SIDE from the tenant
// row (slug/plan/ownerId) — the client only supplies action + tenantId — so a caller can
// never forge plan/slug/hostnames.
//
//  provision    — (re)run the engine to stand up infra (first provision / operator retry)
//  reprovision  — DNS-only re-apply after a plan change (never recreates infra)
//  deprovision  — owner cancel: cancel the Razorpay subscription; the resulting
//                 subscription.cancelled webhook performs the actual teardown so we never
//                 tear down while the sub is still charging.

const Schema = z.object({
  action: z.enum(['provision', 'reprovision', 'deprovision']),
  tenantId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { action, tenantId } = parsed.data

  // Ownership check.
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find((t) => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  if (action === 'deprovision') {
    if (!tenant.razorpay_subscription_id) {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 })
    }
    const result = await cancelSubscription(tenant.razorpay_subscription_id, { cancelAtCycleEnd: true })
      .catch((e: any) => ({ error: e?.message } as any))
    if ((result as any)?.error) {
      return NextResponse.json({ error: (result as any).error || 'Failed to cancel subscription' }, { status: 500 })
    }
    return NextResponse.json({
      status: 'cancellation_scheduled',
      subscriptionStatus: (result as any).status,
      endsAt: (result as any).endsAt,
    })
  }

  const restoreFromKey = action === 'provision' ? await resolveRestoreKey(tenantId, tenant.slug) : undefined

  const result = await triggerProvisioning({
    action,
    tenantId,
    slug: tenant.slug,
    plan: tenant.plan,
    ownerId: owner.id,
    restoreFromKey,
    reason: action === 'reprovision' ? 'plan_change' : 'operator',
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, jobStatus: result.jobStatus }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    action,
    jobStatus: result.jobStatus,
    added: result.added,
    removed: result.removed,
  })
}
