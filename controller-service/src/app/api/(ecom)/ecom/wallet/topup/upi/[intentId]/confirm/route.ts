import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { handleUpiConfirm } from '@/lib/payments/upi/handlers'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return handleUpiConfirm(request, (await params).intentId, { kind: 'owner', ownerId: ctx.owner.id, tenant: ctx.tenant, tenantIds: ctx.tenants.map(t => t.id) })
}
