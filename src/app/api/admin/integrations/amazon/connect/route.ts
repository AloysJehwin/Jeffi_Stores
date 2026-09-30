import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/jwt'
import { resolveTenant } from '@/lib/tenant-context'
import { signAdminState } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

// Store-admin "Connect Amazon Seller". Admin-scope gated; tenant from ALS. Signs a state
// (tenantId + nonce) to defend the callback, then redirects to Amazon Seller Central's LWA
// consent screen (SP-API OAuth flow).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const appId = process.env.AMAZON_LWA_APP_CLIENT_ID
  if (!appId) return NextResponse.json({ error: 'Amazon OAuth not configured' }, { status: 503 })

  const state = signAdminState({
    tenantId: tenant.tenantId,
    provider: 'amazon_seller',
    nonce: crypto.randomBytes(8).toString('hex'),
  })

  const url = new URL('https://sellercentral.amazon.com/apps/authorize/consent')
  url.searchParams.set('application_id', appId)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
