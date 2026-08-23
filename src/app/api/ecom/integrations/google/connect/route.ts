import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { signState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Owner-facing "Connect Google Merchant Center" entry point. Owner-gated; verifies the owner
// owns the (active) tenant, signs a state (tenantId + nonce) to defend the callback against
// CSRF/replay, and redirects to the Google OAuth consent screen requesting the Content API
// scope with offline access (so we receive a refresh token).
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 503 })

  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const tenantId = request.nextUrl.searchParams.get('tenantId') || ''
  const tenant = (await getOwnerTenants(owner.id)).find((t) => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Store is not provisioned yet' }, { status: 409 })

  const baseUrl = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'
  const redirectUri = `${baseUrl}/api/ecom/integrations/google/callback`
  const state = signState({ tenantId, provider: 'google_merchant', ownerId: owner.id, nonce: crypto.randomBytes(8).toString('hex') })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/content')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
