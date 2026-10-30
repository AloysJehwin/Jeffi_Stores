import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { TENANT_COOKIE } from '@controller/lib/ecom/owner-context'

export const dynamic = 'force-dynamic'

const Schema = z.object({ slug: z.string().min(1).max(64) })

/** Remember which store the owner is working on across /dashboard/* pages. */
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.slug === parsed.data.slug)) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(TENANT_COOKIE, parsed.data.slug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
    ...cookieDomainOption(),
  })
  return res
}
