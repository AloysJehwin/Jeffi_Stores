import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { handleUpiStatus } from '@/lib/payments/upi/handlers'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ intentId: string }> }) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  return handleUpiStatus(
    (await params).intentId,
    { kind: 'owner', ownerId: ctx.owner.id, tenant: ctx.tenant, tenantIds: ctx.tenants.map(t => t.id) },
    // A new store waiting on its servers' prepayment starts once the top-up lands.
    { onCompleted: i => (i.tenant_id ? startStoreIfReady(i.tenant_id) : Promise.resolve(false)) }
  )
}
