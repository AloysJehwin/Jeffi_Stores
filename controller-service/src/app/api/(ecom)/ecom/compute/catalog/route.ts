import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { computePlans, getCatalog } from '@controller/lib/compute/catalog'

export const dynamic = 'force-dynamic'

/** Prices, pricing settings and each plan's compute options, for the calculator (inactive plans too: a store may be on one). */
export async function GET(request: NextRequest) {
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const [catalog, plans] = await Promise.all([getCatalog(), computePlans({ includeInactive: true })])
  return NextResponse.json({ catalog, plans })
}
