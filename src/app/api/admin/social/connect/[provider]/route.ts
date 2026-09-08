import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/jwt'
import { resolveTenant } from '@/lib/tenant-context'
import { currentAdminBaseUrl } from '@/lib/brand'
import { buildOAuthUrl, isMetaEnabled } from '@/lib/meta'
import { signAdminState } from '@/app/api/admin/integrations/state'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Facebook/Instagram". Admin-scope gated; tenant from ALS. Signs a state
// (tenantId + nonce) to defend the callback, then redirects to the Meta OAuth dialog. Both
// providers use the same Facebook Login flow (IG posts through the linked Page), so `provider`
// only records intent.
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  if (!isMetaEnabled()) return NextResponse.json({ error: 'Meta integration not configured' }, { status: 503 })

  const { provider } = await params
  if (provider !== 'facebook' && provider !== 'instagram') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  const redirectUri = `${currentAdminBaseUrl()}/api/admin/social/callback`
  const state = signAdminState({ tenantId: tenant.tenantId, provider, nonce: crypto.randomBytes(8).toString('hex') })

  return NextResponse.redirect(buildOAuthUrl(redirectUri, state))
}
