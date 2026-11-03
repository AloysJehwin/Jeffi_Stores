import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { addTenantServices, requestServiceApproval } from '@/lib/tenant-registry'
import { sendServicesRequestedEmail } from '@/lib/shared/ecom-emails'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

/** Request messaging/documents on an existing tenant: added now, usable once Jeffi approves it. Store is added via add-store. */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(z.object({ services: z.array(z.enum(['messaging', 'documents'])).min(1) }), await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const fresh = parsed.data.services.filter(s => !(ctx.tenant.service_types ?? []).includes(s))
  if (!fresh.length) return NextResponse.json({ ok: true })
  await addTenantServices(ctx.tenant.id, fresh)
  await requestServiceApproval(ctx.tenant.id, fresh)
  sendServicesRequestedEmail({ email: ctx.owner.email, name: ctx.owner.name ?? null }, ctx.tenant.display_name, fresh).catch(() => {})
  return NextResponse.json({ ok: true, pending: fresh })
}
