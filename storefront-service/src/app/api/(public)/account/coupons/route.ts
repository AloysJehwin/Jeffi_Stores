import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { listAccountCoupons } from '@/lib/rewards/account-coupons'

export const dynamic = 'force-dynamic'

/** The signed-in customer's personal coupons with their status; `?status=usable` for just the usable ones. */
export async function GET(request: NextRequest) {
  const auth = await authenticateAnyUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const usableOnly = request.nextUrl.searchParams.get('status') === 'usable'
    const coupons = await listAccountCoupons(auth.userId, { usableOnly })
    return NextResponse.json({ coupons }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[account/coupons]', err)
    return NextResponse.json({ error: 'Failed to load coupons' }, { status: 500 })
  }
}
