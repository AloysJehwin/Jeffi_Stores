import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { numberProvider } from '@controller/lib/messaging/number-provider'

export const dynamic = 'force-dynamic'

// Numbers the platform could buy for a store (Twilio, its own account): ?country=US&areaCode=872. Platform admins only.

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const country = (request.nextUrl.searchParams.get('country') || 'US').toUpperCase().slice(0, 2)
  const areaCode = (request.nextUrl.searchParams.get('areaCode') || '').replace(/\D/g, '').slice(0, 4) || undefined
  try {
    const p = numberProvider()
    const [numbers, monthlyUsd] = await Promise.all([p.search({ country, areaCode, limit: 8 }), p.monthlyPriceUsd(country)])
    return NextResponse.json({ numbers, monthlyUsd, live: p.live })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not search numbers' }, { status: 502 })
  }
}
