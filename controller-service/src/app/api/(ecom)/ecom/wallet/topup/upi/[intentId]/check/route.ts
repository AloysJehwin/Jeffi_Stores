import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { handleUpiCheck } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return handleUpiCheck((await params).intentId, { kind: 'owner', ownerId: ctx.owner.id, tenant: ctx.tenant, tenantIds: ctx.tenants.map(t => t.id) })
}
