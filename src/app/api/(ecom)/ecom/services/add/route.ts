import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@/lib/ecom/owner-api'
import { addTenantServices } from '@/lib/tenant-registry'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

/** Enable messaging/documents on an existing tenant (store or services-only). Store is added via add-store. */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(z.object({ services: z.array(z.enum(['messaging', 'documents'])).min(1) }), await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  await addTenantServices(ctx.tenant.id, parsed.data.services)
  return NextResponse.json({ ok: true })
}
