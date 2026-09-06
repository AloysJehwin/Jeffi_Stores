import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { uploadImportFile } from '@/lib/s3'
import { parseWorkbook } from '@/lib/import/parse'
import { enqueueImportJob, resolveImportTenantId } from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { readSheetValues } from '@/lib/google-sheets'
import { extractSpreadsheetId, valuesToWorkbookBuffer } from '@/lib/import/google-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_RANGE = 'A:DZ' // wide enough for the full ~119-column template

// Stage the tenant's connected sheet as a workbook and enqueue via the shared upload worker path.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = resolveImportTenantId()

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

  let values: string[][]
  try {
    values = await readSheetValues(spreadsheetId, DEFAULT_RANGE, accessToken)
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read the sheet' }, { status: 502 })
  }
  if (values.length < 2) {
    return NextResponse.json({ error: 'Sheet has no data rows under the header' }, { status: 400 })
  }

  const buf = valuesToWorkbookBuffer(values)
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
