import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { controlPlanePool, getOwnerTenants, getProvisioningJob } from '@/lib/tenant-registry'
import { closeStoreLines } from '@controller/lib/billing/subscription'
import { triggerProvisioning, resolveRestoreKey } from '@controller/lib/provisioning/trigger'
import { describePipeline, ownerPipelineView } from '@controller/lib/provisioning/pipeline-view'

export const dynamic = 'force-dynamic'

// Canonical owner-facing provisioning trigger. Every provisioning/deprovisioning action an
// owner initiates from the ecom portal comes through here. Owner-session gated; the owner
// must own the tenant. The full self-contained payload is built SERVER-SIDE from the tenant
// row (slug/plan/ownerId) — the client only supplies action + tenantId — so a caller can
// never forge plan/slug/hostnames.
//
//  provision    — (re)run the engine to stand up infra (first provision / operator retry)
//  reprovision  — DNS-only re-apply after a plan change (never recreates infra)
//  deprovision  — owner cancel: the store's lines (plan and store add-ons) leave the workspace's
//                 subscription at cycle end (lib/billing closeStoreLines); Showcase sites stay on it.
//                 The store is torn down when its plan line ends (billing sweep / webhook), never
//                 while it is still paid for.

const Schema = z.object({
  action: z.enum(['provision', 'reprovision', 'deprovision']),
  tenantId: z.string().uuid(),
})

/** The owner's view of their store's setup: step labels, states and timing only. */
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const tenantId = z.string().uuid().safeParse(request.nextUrl.searchParams.get('tenantId'))
  if (!tenantId.success) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.some(t => t.id === tenantId.data)) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const job = await getProvisioningJob(tenantId.data)
  if (!job) return NextResponse.json({ pipeline: null })
  const ev = await controlPlanePool()
    .query(
      `SELECT step, status, message, started_at, duration_ms, created_at
         FROM provisioning_step_events WHERE job_id = $1 ORDER BY created_at ASC`,
      [job.id]
    )
    .catch(() => ({ rows: [] }))
  return NextResponse.json({ pipeline: ownerPipelineView(describePipeline(job, ev.rows)) })
}

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
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  if (action === 'deprovision') {
    if (!tenant.razorpay_subscription_id) {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 })
    }
    try {
      const r = await closeStoreLines(tenantId, { email: owner.email, name: owner.name })
      const endsAt = r.status === 'cancelled' ? r.endsAt : r.status === 'scheduled' ? r.effectiveAt : r.quote.current?.currentEnd ?? null
      return NextResponse.json({
        status: 'cancellation_scheduled',
        subscriptionStatus: r.status,
        endsAt: endsAt ? Math.floor(Date.parse(endsAt) / 1000) : null,
        // Showcase sites stay: the lower amount for them is approved here.
        checkoutUrl: r.status === 'scheduled' ? r.checkoutUrl : null,
      })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to cancel subscription' }, { status: 500 })
    }
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
