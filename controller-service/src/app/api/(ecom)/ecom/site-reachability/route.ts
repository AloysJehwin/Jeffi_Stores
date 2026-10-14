import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
const PROBE_TIMEOUT_MS = 5000

/** Owner-scoped probe: only the owner's own storefront hosts are allowed. */
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = request.nextUrl.searchParams.get('url')
  let parsed: URL | null = null
  try {
    parsed = raw ? new URL(raw) : null
  } catch {}
  if (!parsed || parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  const tenants = await getOwnerTenants(owner.id)
  const allowed = tenants.some(
    t => parsed!.hostname === `${t.slug}.${PLATFORM_DOMAIN}` || parsed!.hostname === t.custom_domain
  )
  if (!allowed) return NextResponse.json({ error: 'Disallowed url' }, { status: 403 })

  const url = parsed.toString()
  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const resp = await fetch(url, { redirect: 'manual', signal: ctrl.signal })
    clearTimeout(timer)
    return NextResponse.json({ url, ok: resp.status > 0, status: resp.status, latencyMs: Date.now() - start })
  } catch (err: any) {
    return NextResponse.json({ url, ok: false, status: 0, latencyMs: Date.now() - start, error: err?.message })
  }
}
