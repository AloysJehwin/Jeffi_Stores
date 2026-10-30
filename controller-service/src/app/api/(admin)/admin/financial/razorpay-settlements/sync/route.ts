import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { channelError, readJson } from '@/lib/channels/route'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { syncRazorpaySettlements } from '@/lib/payments/rzp-settlements'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — sync settlements from Razorpay now. { full: true } re-reads the last three months.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if ((await razorpayAccountFor()).kind === 'route') return NextResponse.json({ error: 'This store is paid out through Route.' }, { status: 404 })
  try {
    const full = (await readJson(request))?.full === true
    return NextResponse.json(await syncRazorpaySettlements({ full }))
  } catch (e) {
    return channelError(e, 'Set the Razorpay keys first.')
  }
}
