import { NextRequest, NextResponse } from 'next/server'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { subscribeInbox } from '@/lib/support/events'
import { adminFor, sseStream } from '@/lib/support/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Every support event in the store, for the inbox and open conversations (?s= narrows to one chat).
export async function GET(request: NextRequest) {
  const admin = await adminFor(request, 'customers:read', { passive: true })
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenant().catch(() => null)
  const only = request.nextUrl.searchParams.get('s')
  return sseStream(request, async send => {
    send({ kind: 'hello' })
    return subscribeInbox(tenant?.tenantId ?? null, e => {
      if (only && e.sessionId !== only) return
      send(e)
    })
  })
}
