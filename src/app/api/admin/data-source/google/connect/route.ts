import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/jwt'
import { platformOAuthBaseUrl, currentAdminBaseUrl } from '@/lib/brand'
import { signAdminState } from '@/lib/oauth-state'
import { extractSpreadsheetId } from '@/lib/import/google-sync'
import { resolveImportTenantId } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'

// OAuth start for Google Sheet product sync. Uses provider 'google_sheets' (distinct from
// google_merchant) so it never clobbers the Merchant Center token.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin
  const tenantId = await resolveImportTenantId()

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 503 })

  const spreadsheetId = extractSpreadsheetId(request.nextUrl.searchParams.get('sheet') || '')

  const redirectUri = `${platformOAuthBaseUrl()}/api/admin/data-source/google/callback`
  const state = signAdminState({
    tenantId,
    provider: 'google_sheets',
    nonce: crypto.randomBytes(8).toString('hex'),
    returnBase: currentAdminBaseUrl(),
    ...(spreadsheetId ? { spreadsheetId } : {}),
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file'
  )
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
