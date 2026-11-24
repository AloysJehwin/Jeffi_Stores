import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { redeemClaim, type ClaimCode } from '@controller/lib/outreach/claim'

// Claim an outreach Showcase for the signed-in owner: body { token }. Rate-limited per IP in the middleware
// (lib/shared/rate-limit.ts). No tenant needed: a new owner gets one from the claim. The token is never logged.

const STATUS: Record<ClaimCode, number> = { invalid: 400, expired: 410, used: 409, no_site: 404 }

export async function POST(request: NextRequest) {
  // Only ecom's own pages post here.
  const origin = request.headers.get('origin')
  if (origin && origin !== 'null') {
    let from = ''
    try {
      from = new URL(origin).host
    } catch {}
    const hosts = [request.headers.get('x-forwarded-host'), request.headers.get('host')].filter(Boolean)
    if (!hosts.includes(from)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, extractSessionSignals(request)).catch(() => null)
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let token: unknown
  try {
    token = (await request.json())?.token
  } catch {}
  if (typeof token !== 'string' || !token || token.length > 256) return NextResponse.json({ error: 'A claim token is required' }, { status: 400 })

  try {
    const r = await redeemClaim(token, owner.id)
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: STATUS[r.code] })
    return NextResponse.json({ ok: true, siteId: r.siteId, already: r.already, url: `/dashboard/showcase/${r.siteId}` })
  } catch (e) {
    console.error('[ecom-claim] failed:', (e as Error)?.message || e)
    return NextResponse.json({ error: 'The site could not be claimed. Please try again.' }, { status: 500 })
  }
}
