import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { uploadImportFile } from '@/lib/shared/s3'
import { parseWorkbook } from '@/lib/import/parse'
import { summarizeRows } from '@/lib/import/validate-row'
import { SHEET_ORDER } from '@/lib/import/columns'
import {
  enqueueImportJob,
  resolveImportTenantId,
  withImportLock,
  hasActiveSheetSync,
  setSheetsNeedsReconnect,
  setSheetsSpreadsheet,
  ImportBusyError,
} from '@/lib/import/jobs'
import { resolveGoogleSheetsCreds, IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { listSheetTitles, readSheetValues, readSheetValuesBatch, wholeSheetRange } from '@/lib/shared/google-sheets'
import {
  extractSpreadsheetId,
  valuesToWorkbookBuffer,
  describeGoogleFailure,
  type SheetMatrix,
} from '@/lib/import/google-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LEGACY_RANGE = 'A:DZ'

class SyncRefusal extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

/**
 * Stage the tenant's connected sheet as a workbook and enqueue via the shared upload worker path.
 * A sheet created from the template has a Products tab plus the Variants / Sub-variants /
 * attribute tabs: every template tab present is read so the sync sees exactly what the .xlsx
 * upload would. A sheet without a Products tab is read as the legacy single flat grid.
 * One sync per store at a time: a per-tenant lock plus a check for a queued/running sync.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()
  const rawSheet = (await request.json().catch(() => ({})))?.sheet
  const overrideSheet = extractSpreadsheetId(typeof rawSheet === 'string' ? rawSheet : '')
  if (typeof rawSheet === 'string' && rawSheet.trim() && !overrideSheet) {
    return NextResponse.json({ error: 'That does not look like a Google Sheets link or id.' }, { status: 400 })
  }

  try {
    const out = await withImportLock(tenantId, 'sheet', () => stageSync(tenantId, overrideSheet, admin.adminId))
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'import',
      entityType: 'product',
      entityId: out.jobId,
      summary: `Queued Google Sheet product import (${out.totalRows} rows)`,
      metadata: { jobId: out.jobId, source: 'google_sheet', spreadsheetId: out.spreadsheetId, rows: out.totalRows },
      request,
    })
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof ImportBusyError) {
      return NextResponse.json({ error: 'Another Google Sheet action is in progress. Try again in a moment.' }, { status: 409 })
    }
    if (e instanceof SyncRefusal) {
      return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status })
    }
    console.error('[data-source/google/sync] failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not queue the sync. Try again.' }, { status: 500 })
  }
}

async function stageSync(tenantId: string, overrideSheet: string, adminId: string) {
  if (await hasActiveSheetSync(tenantId)) {
    throw new SyncRefusal(409, 'A sync is already queued or running. Wait for it to finish.', 'busy')
  }

  let accessToken: string
  let storedSheet: string | null
  try {
    const creds = await resolveGoogleSheetsCreds(tenantId)
    accessToken = creds.accessToken
    storedSheet = creds.spreadsheetId
  } catch (e: unknown) {
    if (e instanceof IntegrationNotConnectedError) {
      throw new SyncRefusal(409, 'Connect a Google account first.', 'not_connected')
    }
    const f = describeGoogleFailure(e)
    if (f.code === 'reauth') await setSheetsNeedsReconnect(tenantId, true).catch(() => {})
    else console.error('[data-source/google/sync] token', { message: (e as Error)?.message })
    throw new SyncRefusal(f.status, f.error, f.code)
  }
  await setSheetsNeedsReconnect(tenantId, false).catch(() => {})

  const spreadsheetId = overrideSheet || storedSheet
  if (!spreadsheetId) {
    throw new SyncRefusal(400, 'No sheet is set. Create one from the template or paste a sheet link.', 'no_sheet')
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
    const f = describeGoogleFailure(e, 'read the Google Sheet')
    if (f.code === 'unknown' || f.code === 'unavailable') {
      console.error('[data-source/google/sync] read', { message: (e as Error)?.message })
    }
    throw new SyncRefusal(f.status, f.error, f.code)
  }

  const buf = valuesToWorkbookBuffer(sheets)
  const parsed = parseWorkbook(buf)
  if (parsed.fatal) throw new SyncRefusal(400, parsed.fatal, 'invalid_sheet')
  const summary = summarizeRows(parsed.rows)

  if (overrideSheet && overrideSheet !== storedSheet) await setSheetsSpreadsheet(tenantId, overrideSheet)

  const fileKey = await uploadImportFile(buf, `google-sheet-${spreadsheetId}.xlsx`)
  const job = await enqueueImportJob({
    tenantId,
    source: 'google_sheet',
    fileKey,
    spreadsheetId,
    totalRows: summary.units,
    createdBy: adminId,
  })
  return {
    jobId: job.id,
    status: job.status,
    totalRows: summary.units,
    products: summary.products,
    invalid: summary.invalid,
    spreadsheetId,
    warnings: parsed.warnings ?? [],
  }
}
