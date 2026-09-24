import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { uploadImportFile } from '@/lib/s3'
import { parseWorkbook } from '@/lib/import/parse'
import { SHEET_ORDER } from '@/lib/import/columns'
import { enqueueImportJob, resolveImportTenantId } from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { listSheetTitles, readSheetValues, readSheetValuesBatch, wholeSheetRange } from '@/lib/google-sheets'
import { extractSpreadsheetId, valuesToWorkbookBuffer, type SheetMatrix } from '@/lib/import/google-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LEGACY_RANGE = 'A:DZ'

/**
 * Stage the tenant's connected sheet as a workbook and enqueue via the shared upload worker path.
 * A sheet created from the template has a Products tab plus the Variants / Sub-variants /
 * attribute tabs: every template tab present is read so the sync sees exactly what the .xlsx
 * upload would. A sheet without a Products tab is read as the legacy single flat grid.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()

  const overrideSheet = extractSpreadsheetId((await request.json().catch(() => ({})))?.sheet || '')

  let accessToken: string
  let spreadsheetId: string | null
  try {
    const creds = await resolveGoogleSheetsCreds(tenantId)
    accessToken = creds.accessToken
    spreadsheetId = overrideSheet || creds.spreadsheetId
  } catch (e: unknown) {
    if (e instanceof IntegrationNotConnectedError) {
      return NextResponse.json({ error: 'Connect a Google Sheet first' }, { status: 409 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to resolve Google credentials' }, { status: 502 })
  }

  if (!spreadsheetId) {
    return NextResponse.json({ error: 'No spreadsheet configured — connect a sheet or pass one' }, { status: 400 })
  }

  let sheets: SheetMatrix | Record<string, SheetMatrix>
  try {
    const titles = await listSheetTitles(spreadsheetId, accessToken)
    if (titles.includes('Products')) {
      const tabs = SHEET_ORDER.filter(t => titles.includes(t))
      const matrices = await readSheetValuesBatch(spreadsheetId, tabs.map(wholeSheetRange), accessToken)
      sheets = Object.fromEntries(tabs.map((t, i) => [t, matrices[i]]))
    } else {
      sheets = await readSheetValues(spreadsheetId, LEGACY_RANGE, accessToken)
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read the sheet' }, { status: 502 })
  }

  const buf = valuesToWorkbookBuffer(sheets)
  const parsed = parseWorkbook(buf)
  if (parsed.fatal) return NextResponse.json({ error: parsed.fatal }, { status: 400 })

  const fileKey = await uploadImportFile(buf, `google-sheet-${spreadsheetId}.xlsx`)
  const job = await enqueueImportJob({
    tenantId,
    source: 'google_sheet',
    fileKey,
    spreadsheetId,
    totalRows: parsed.rows.length,
    createdBy: admin.adminId,
  })

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'import',
    entityType: 'product',
    entityId: job.id,
    summary: `Queued Google Sheet product import (${parsed.rows.length} rows)`,
    metadata: { jobId: job.id, source: 'google_sheet', spreadsheetId, rows: parsed.rows.length },
    request,
  })

  return NextResponse.json({ jobId: job.id, status: job.status, totalRows: parsed.rows.length })
}
