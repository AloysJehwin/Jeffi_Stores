import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import {
  resolveImportTenantId,
  withImportLock,
  setSheetsNeedsReconnect,
  setSheetsSpreadsheet,
  ImportBusyError,
} from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { createSheetFromWorkbook } from '@/lib/shared/google-sheets'
import { buildTemplateWorkbook } from '@/lib/import/template'
import { describeGoogleFailure } from '@/lib/import/google-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Build the import template fresh and upload it as a new Google Sheet in the connected account's own
// Drive, then persist the new spreadsheet id. products:write. Requires an already-connected
// google_sheets provider (drive.file scope): the tenant token creates the file, never a platform
// account. Locked per store so a double click makes one sheet.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()

  try {
    const result = await withImportLock(tenantId, 'sheet', async () => {
      let accessToken: string
      try {
        ;({ accessToken } = await resolveGoogleSheetsCreds(tenantId))
      } catch (e) {
        if (e instanceof IntegrationNotConnectedError) {
          return { status: 409, body: { error: 'Connect a Google account first.', code: 'not_connected' } }
        }
        const f = describeGoogleFailure(e)
        if (f.code === 'reauth') await setSheetsNeedsReconnect(tenantId, true).catch(() => {})
        return { status: f.status, body: { error: f.error, code: f.code } }
      }

      let spreadsheetId: string
      try {
        spreadsheetId = await createSheetFromWorkbook('Product import', await buildTemplateWorkbook(), accessToken)
      } catch (e) {
        const f = describeGoogleFailure(e, 'create the sheet in Google Drive')
        if (f.code === 'unknown' || f.code === 'unavailable') {
          console.error('[data-source/google/create] drive', { message: (e as Error)?.message })
        }
        // A 403 here is the drive.file permission, not access to an existing sheet.
        const error =
          f.code === 'no_access' || f.code === 'scope'
            ? 'Google did not allow creating a file in Drive. Reconnect and allow "See, edit, create and delete the Google Drive files you use with this app".'
            : f.error
        return { status: f.status, body: { error, code: f.code === 'no_access' ? 'scope' : f.code } }
      }

      await setSheetsSpreadsheet(tenantId, spreadsheetId)
      return {
        status: 200,
        body: { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` },
      }
    })

    if (result.status === 200) {
      await logAdminAudit({
        adminId: admin.adminId,
        action: 'create',
        entityType: 'product',
        entityId: null,
        summary: 'Created a Google Sheet from the product import template',
        metadata: { spreadsheetId: (result.body as { spreadsheetId: string }).spreadsheetId },
        request,
      })
    }
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    if (e instanceof ImportBusyError) {
      return NextResponse.json({ error: 'Another Google Sheet action is in progress. Try again in a moment.' }, { status: 409 })
    }
    console.error('[data-source/google/create] failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not create the sheet. Try again.' }, { status: 500 })
  }
}
