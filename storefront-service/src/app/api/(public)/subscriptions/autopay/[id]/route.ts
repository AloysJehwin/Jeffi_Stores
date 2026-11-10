import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { zUuid } from '@/lib/shared/validate'
import { resolveRequestTenant } from '@/lib/shared/db'
import { syncAutopaySetup } from '@/lib/subscriptions/autopay'
import { SubscriptionError } from '@/lib/subscriptions/types'

export const dynamic = 'force-dynamic'

// The return page polls this: reads the mandate setup from PhonePe and activates the subscription once paid.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!zUuid.safeParse(id).success) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    const t = await resolveRequestTenant()
    const view = await syncAutopaySetup(id, { userId: user.userId, store: t ? { tenantId: t.tenantId, slug: t.slug } : null })
    return NextResponse.json(view)
  } catch (err) {
    if (err instanceof SubscriptionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[subscriptions/autopay]', err)
    return NextResponse.json({ error: 'Could not check the subscription' }, { status: 502 })
  }
}
