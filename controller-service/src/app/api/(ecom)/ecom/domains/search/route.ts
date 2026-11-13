import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { searchDomains } from '@controller/lib/domains/orders'
import { domainPurchaseEnabled } from '@controller/lib/domains/providers'

export const dynamic = 'force-dynamic'

// GET ?q= → availability and the yearly price across the TLDs we sell, plus suggestions. Any signed-in owner:
// onboarding searches before the store exists.
export async function GET(request: NextRequest) {
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!domainPurchaseEnabled()) return NextResponse.json({ error: 'Buying domains is not available yet.' }, { status: 503 })
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  if (q.trim().length < 2) return NextResponse.json({ results: [], suggestions: [] })
  try {
    const out = await searchDomains(q)
    if (out.error) return NextResponse.json({ ...out }, { status: 400 })
    return NextResponse.json(out)
  } catch (e: any) {
    console.warn('[domains] search failed', e?.message || e)
    return NextResponse.json({ error: 'Search is unavailable right now. Try again shortly.' }, { status: 502 })
  }
}
