import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { parseServiceAccountJson } from '@/lib/shared/google-credentials'
import { googleOAuthAccessToken, googleServiceAccountAccessToken, GOOGLE_SHEETS_SCOPES } from '@/lib/integrations/resolve'
import { resolveImportTenantId, withImportLock, ImportBusyError } from '@/lib/import/jobs'
import { extractSpreadsheetId, describeGoogleFailure } from '@/lib/import/google-sync'
import { listSheetTitles } from '@/lib/shared/google-sheets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('oauth'),
    clientId: z.string().trim().regex(/\.apps\.googleusercontent\.com$/, 'OAuth client ID ends with .apps.googleusercontent.com'),
    clientSecret: z.string().trim().min(10, 'Paste the OAuth client secret'),
    refreshToken: z.string().trim().min(20, 'Paste the OAuth refresh token'),
    sheet: z.string().optional(),
  }),
  z.object({
    mode: z.literal('service_account'),
    serviceAccountJson: z.string().trim().min(20, 'Paste the service account key (JSON)'),
    sheet: z.string().optional(),
  }),
])

// The store's own Google access for the sheet sync, instead of signing in through the platform:
// its own OAuth client plus a refresh token, or a service account it shares the sheet with.
// Proves the credentials (and access to the sheet, when one is set) before saving. products:write.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const body = parsed.data
  const sheet = extractSpreadsheetId(body.sheet || '')
  if (body.sheet?.trim() && !sheet) {
    return NextResponse.json({ error: 'That does not look like a Google Sheets link or id.' }, { status: 400 })
  }

  let config: Record<string, string>
  let meta: Record<string, unknown>
  if (body.mode === 'oauth') {
    config = { oauth_refresh_token: body.refreshToken, client_id: body.clientId, client_secret: body.clientSecret }
    meta = { connected_via: 'own_oauth', can_create: true }
  } else {
    let sa: any
    try {
      sa = parseServiceAccountJson(body.serviceAccountJson)
    } catch {
      return NextResponse.json({ error: 'Invalid service account JSON' }, { status: 400 })
    }
    if (!/gserviceaccount\.com$/.test(String(sa?.client_email ?? '')) || !String(sa?.private_key ?? '').includes('PRIVATE KEY')) {
      return NextResponse.json({ error: 'That is not a Google service account key' }, { status: 400 })
    }
    config = { client_email: String(sa.client_email), private_key: String(sa.private_key) }
    // A service account has no Drive of its own to create the template sheet in.
    meta = { connected_via: 'service_account', account_email: sa.client_email, can_create: false }
  }

  const tenantId = await resolveImportTenantId()
  let accessToken: string
  try {
    accessToken =
      body.mode === 'oauth'
        ? (await googleOAuthAccessToken(body.refreshToken, 'Google Sheets', { clientId: body.clientId, clientSecret: body.clientSecret })).token
        : (await googleServiceAccountAccessToken(config.client_email, config.private_key, GOOGLE_SHEETS_SCOPES)).token
  } catch (e) {
    return NextResponse.json({ error: `Google refused these credentials: ${(e as Error)?.message || 'unknown error'}` }, { status: 400 })
  }

  const spreadsheetId = sheet || (await storedSpreadsheetId(tenantId))
  if (spreadsheetId) {
    try {
      await listSheetTitles(spreadsheetId, accessToken)
    } catch (e) {
      const f = describeGoogleFailure(e)
      const error =
        f.code === 'no_access' && body.mode === 'service_account'
          ? `Share the sheet with ${config.client_email} (Viewer), then save again.`
          : f.error
      return NextResponse.json({ error, code: f.code }, { status: 400 })
    }
    config.spreadsheet_id = spreadsheetId
    meta.spreadsheet_id = spreadsheetId
  } else {
    meta.needs_spreadsheet_id = true
  }

  try {
    await withImportLock(tenantId, 'sheet', () =>
      saveIntegrationCredential({
        tenantId,
        provider: 'google_sheets',
        label: 'Google Sheet (product sync)',
        configEnc: encryptToken(JSON.stringify(config)),
        meta,
      })
    )
  } catch (e) {
    if (e instanceof ImportBusyError) {
      return NextResponse.json({ error: 'Another Google Sheet action is in progress. Try again in a moment.' }, { status: 409 })
    }
    throw e
  }
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'product',
    entityId: null,
    summary: `Connected the Google Sheet sync with ${body.mode === 'oauth' ? 'its own OAuth client' : 'a service account'}`,
    request,
  })
  return NextResponse.json({ ok: true })
}

async function storedSpreadsheetId(tenantId: string): Promise<string | null> {
  const row = await getIntegrationCredential(tenantId, 'google_sheets').catch(() => null)
  if (!row) return null
  try {
    return JSON.parse(decryptToken(row.config_enc))?.spreadsheet_id || null
  } catch {
    return null
  }
}
