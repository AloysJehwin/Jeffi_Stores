import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { respondToRfq, RfqError } from '@/lib/business/rfq-respond'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { action, message, counter_items } = await request.json()
    if (!['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
    }
    const { newStatus } = await respondToRfq(id, user.userId, action, { message, counterItems: counter_items })
    return NextResponse.json({ ok: true, action, newStatus })
  } catch (err: any) {
    if (err instanceof RfqError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
