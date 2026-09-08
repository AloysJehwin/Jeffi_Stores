import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { resolveImportTenantId } from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { createSheetFromWorkbook } from '@/lib/google-sheets'
import { buildTemplateWorkbook } from '@/lib/import/template'
import { saveIntegrationCredential, getIntegrationCredential } from '@/lib/tenant-registry'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Build the import template fresh and upload it as a new Google Sheet in the connected account's own
// Drive, then persist the new spreadsheet id. products:write. Requires an already-connected
// google_sheets provider (drive.file scope) — the tenant token creates the file, never a platform
// account (no fallback). Self-contained: does not depend on a shared master template file.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()

  let accessToken: string
  try {
    ({ accessToken } = await resolveGoogleSheetsCreds(tenantId))
  } catch (e) {
    if (e instanceof IntegrationNotConnectedError) {
      return NextResponse.json({ error: 'Connect a Google account first' }, { status: 409 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  let spreadsheetId: string
  try {
    const workbook = await buildTemplateWorkbook()
    spreadsheetId = await createSheetFromWorkbook('Product import', workbook, accessToken)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  const existing = await getIntegrationCredential(tenantId, 'google_sheets')
  const config: Record<string, any> = existing
    ? (() => { try { return JSON.parse(decryptToken(existing.config_enc)) } catch { return {} } })()
    : {}
  config.spreadsheet_id = spreadsheetId

  await saveIntegrationCredential({
    tenantId,
    provider: 'google_sheets',
    label: 'Google Sheet (product sync)',
    configEnc: encryptToken(JSON.stringify(config)),
    meta: { connected_via: 'oauth', spreadsheet_id: spreadsheetId },
  })

  return NextResponse.json({
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  })
}
