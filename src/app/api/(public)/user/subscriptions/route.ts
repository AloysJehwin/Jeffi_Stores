import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { loadCustomerSubscriptions } from '@/lib/subscriptions/customer'

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ subscriptions: await loadCustomerSubscriptions(user.userId) })
  } catch (err) {
    console.error('[user/subscriptions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
