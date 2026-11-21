import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { addTenantServices, controlPlanePool, listServiceApprovals, requestServiceApproval } from '@/lib/tenant-registry'
import { sendServicesRequestedEmail } from '@/lib/shared/ecom-emails'
import { parseBody } from '@/lib/shared/validate'
import { kybGate } from '@controller/lib/kyb/gate'

export const dynamic = 'force-dynamic'

/**
 * Request messaging/documents on an existing tenant (or again after a rejection): accepted once the service's KYB is
 * complete (409 kyb_required with what is missing otherwise), usable once Jeffi approves it. Store is added via add-store.
 */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(z.object({ services: z.array(z.enum(['messaging', 'documents'])).min(1) }), await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const have = ctx.tenant.service_types ?? []
  const approvals = await listServiceApprovals(ctx.tenant.id)
  const fresh = parsed.data.services.filter(s => !have.includes(s))
  const again = parsed.data.services.filter(s => have.includes(s) && approvals.find(a => a.service === s)?.status === 'rejected')
  const wanted = [...fresh, ...again]
  if (!wanted.length) return NextResponse.json({ ok: true })
  const gate = await kybGate(ctx.tenant, ctx.owner.id, wanted)
  if (!gate.ok) return NextResponse.json({ error: gate.message, code: 'kyb_required', missing: gate.missing }, { status: 409 })
  if (fresh.length) await addTenantServices(ctx.tenant.id, fresh)
  await requestServiceApproval(ctx.tenant.id, wanted)
  // Messages from a newly approved workspace wait for a look first, as they do after the services-only sign-up.
  if (wanted.includes('messaging'))
    await controlPlanePool().query(`INSERT INTO messaging_tenant_settings (tenant_id, review_required) VALUES ($1, true) ON CONFLICT DO NOTHING`, [ctx.tenant.id])
  sendServicesRequestedEmail({ email: ctx.owner.email, name: ctx.owner.name ?? null }, ctx.tenant.display_name, wanted).catch(() => {})
  return NextResponse.json({ ok: true, pending: wanted })
}
