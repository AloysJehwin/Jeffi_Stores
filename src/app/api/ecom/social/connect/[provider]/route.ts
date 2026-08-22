import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { buildOAuthUrl, isMetaEnabled } from '@/lib/meta'
import { signState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Owner-facing "Connect Facebook/Instagram" entry point. Owner-gated; verifies the owner owns
// the tenant they're connecting, signs a state (tenantId + nonce) to defend the callback
// against CSRF/replay, and redirects to the Meta OAuth dialog. Both providers use the same
// Facebook Login flow (IG posts through the linked Page), so `provider` only records intent.
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  if (!isMetaEnabled()) return NextResponse.json({ error: 'Meta integration not configured' }, { status: 503 })

  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { provider } = await params
  if (provider !== 'facebook' && provider !== 'instagram') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  const tenantId = request.nextUrl.searchParams.get('tenantId') || ''
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find((t) => t.id === tenantId)) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const redirectUri = `${baseUrl}/api/ecom/social/callback`
  const state = signState({ tenantId, provider, ownerId: owner.id, nonce: crypto.randomBytes(8).toString('hex') })

  return NextResponse.redirect(buildOAuthUrl(redirectUri, state))
}
