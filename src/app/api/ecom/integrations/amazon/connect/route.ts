import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { signState } from '@/app/api/ecom/social/state'

export const dynamic = 'force-dynamic'

// Owner-facing "Connect Amazon Seller" entry point. Owner-gated; verifies the owner owns the
// (active) tenant, signs a state (tenantId + nonce) to defend the callback against CSRF/replay,
// and redirects to Amazon Seller Central's LWA consent screen (SP-API OAuth flow).
export async function GET(request: NextRequest) {
  const appId = process.env.AMAZON_LWA_APP_CLIENT_ID
  if (!appId) return NextResponse.json({ error: 'Amazon OAuth not configured' }, { status: 503 })

  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const tenantId = request.nextUrl.searchParams.get('tenantId') || ''
  const tenant = (await getOwnerTenants(owner.id)).find((t) => t.id === tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.status !== 'active') return NextResponse.json({ error: 'Store is not provisioned yet' }, { status: 409 })

  const state = signState({ tenantId, provider: 'amazon_seller', ownerId: owner.id, nonce: crypto.randomBytes(8).toString('hex') })

  const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent')
  url.searchParams.set('application_id', appId)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
