import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'
import { currentAdminBaseUrl } from '@/lib/brand'
import { signAdminState } from '@/app/api/admin/integrations/state'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Google Merchant Center". Admin-scope gated; the tenant comes from ALS.
// Signs a state (tenantId + nonce) to defend the callback against CSRF/replay, then redirects to
// the Google OAuth consent screen requesting the Content API scope with offline access.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = getCurrentTenant()
  if (!tenant) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 503 })

  const redirectUri = `${currentAdminBaseUrl()}/api/admin/integrations/google/callback`
  const state = signAdminState({ tenantId: tenant.tenantId, provider: 'google_merchant', nonce: crypto.randomBytes(8).toString('hex') })

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
