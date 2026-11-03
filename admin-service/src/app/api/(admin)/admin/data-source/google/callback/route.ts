import { NextRequest } from 'next/server'
import { currentAdminBaseUrl, platformOAuthBaseUrl } from '@/lib/catalog/brand'
import { saveIntegrationCredential, getIntegrationCredential, getTenant } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { verifyAdminState, returnToAdmin, safeReturnBase } from '@/lib/shared/oauth-state'
import { tenantAdminUrl } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// OAuth callback for the sheet sync. The admin session cookie is SameSite=Strict and is NOT sent on
// this cross-site return from Google, so trust is carried by the HMAC-signed `state` (issued only by
// the admin-gated connect route). Verifies state, exchanges the code, stores the refresh token +
// spreadsheet id under provider 'google_sheets' keyed to state.tenantId.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  // Google returns to the fixed platform OAuth host with no tenant in context, so this default
  // resolves to the platform admin. The verified state carries the tenant's own admin URL; we
  // switch backTo over to it as soon as state is verified so the user lands on their own admin.
  let backTo = `${currentAdminBaseUrl()}/admin/data-source`

  const err = params.get('error')
  if (err) return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=${encodeURIComponent(err)}`)

  const code = params.get('code')
  const rawState = params.get('state')
  if (!code || !rawState) return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=missing_params`)

  const state = verifyAdminState(rawState)
  if (!state || state.provider !== 'google_sheets') {
    return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=bad_state`)
  }
  // Trust returnBase only when it matches the admin host the verified tenant actually resolves to,
  // so a tampered or stale state can never redirect to another tenant's admin.
  const tenant = await getTenant(state.tenantId)
  if (tenant?.slug) {
    const expected = tenantAdminUrl(tenant.slug)
    backTo = `${safeReturnBase(state.returnBase, expected) ?? expected}/admin/data-source`
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=not_configured`)

    const redirectUri = `${platformOAuthBaseUrl()}/api/admin/data-source/google/callback`
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.refresh_token) {
      console.error('[data-source/google/callback] token exchange failed', {
        ok: res.ok,
        status: res.status,
        redirectUri,
        error: data?.error,
        error_description: data?.error_description,
        has_access_token: Boolean(data?.access_token),
        has_refresh_token: Boolean(data?.refresh_token),
      })
      // Google's reason is logged above; the page gets a fixed code it knows how to explain.
      return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=exchange_failed`)
    }

    // Keep a previously-stored spreadsheet id if this connect didn't carry one.
    let spreadsheetId = state.spreadsheetId || ''
    if (!spreadsheetId) {
      const existing = await getIntegrationCredential(state.tenantId, 'google_sheets')
      if (existing) {
        try {
          spreadsheetId = JSON.parse(decryptToken(existing.config_enc))?.spreadsheet_id || ''
        } catch {}
      }
    }

    // Granular consent lets the user untick a permission: reading sheets is required, Drive (to
    // create the template sheet) is optional and reported to the page.
    const granted = typeof data.scope === 'string' ? data.scope.split(/\s+/) : null
    if (granted && !granted.some((g: string) => g.endsWith('/auth/spreadsheets.readonly') || g.endsWith('/auth/spreadsheets'))) {
      return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=sheets_scope_denied`)
    }
    const canCreate = granted ? granted.some((g: string) => g.endsWith('/auth/drive.file') || g.endsWith('/auth/drive')) : true
    const accountEmail = await driveAccountEmail(String(data.access_token || ''))

    const normalized: Record<string, any> = { oauth_refresh_token: data.refresh_token }
    if (spreadsheetId) normalized.spreadsheet_id = spreadsheetId

    await saveIntegrationCredential({
      tenantId: state.tenantId,
      provider: 'google_sheets',
      label: 'Google Sheet (product sync)',
      configEnc: encryptToken(JSON.stringify(normalized)),
      meta: {
        connected_via: 'oauth',
        can_create: canCreate,
        ...(accountEmail ? { account_email: accountEmail } : {}),
        ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : { needs_spreadsheet_id: true }),
      },
    })

    return returnToAdmin(`${backTo}?tab=google_sheet&connected=google_sheets`)
  } catch (e: any) {
    console.error('[data-source/google/callback] failed', { message: e?.message })
    return returnToAdmin(`${backTo}?tab=google_sheet&connected=0&error=save_failed`)
  }
}

// The connected account's email, for the connection card. drive.file is enough for about.get; the
// connection works without it, so any failure just leaves it blank.
async function driveAccountEmail(accessToken: string): Promise<string | null> {
  if (!accessToken) return null
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    return typeof body?.user?.emailAddress === 'string' ? body.user.emailAddress : null
  } catch {
    return null
  }
}
