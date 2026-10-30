import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { uploadImportFile } from '@/lib/shared/s3'
import { parseWorkbook } from '@/lib/import/parse'
import { summarizeRows } from '@/lib/import/validate-row'
import {
  enqueueImportJob,
  resolveImportTenantId,
  withImportLock,
  findActiveUploadByFingerprint,
  ImportBusyError,
} from '@/lib/import/jobs'
import { formFile, readForm } from '@/lib/shared/form-file'
import { checkImportFile, IMPORT_MAX_BYTES } from '@/lib/import/file-check'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Accept an uploaded workbook, validate it parses, stage it to the tenant bucket, and enqueue
// a background import job. products:write gated; tenant comes from ALS (admin host), never the
// client. The heavy work (image fetch + publish) runs in the import worker.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  // Refuse an oversize body before reading it (multipart overhead allowed).
  const declared = Number(request.headers.get('content-length'))
  if (declared > IMPORT_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'File is larger than 15 MB. Split it into smaller files.' }, { status: 413 })
  }

  const tenantId = await resolveImportTenantId()

  const file = formFile(await readForm(request, 'admin/data-source/import'), 'file', 'admin/data-source/import')
  if (!file) return NextResponse.json({ error: 'No file received. Choose a .xlsx or .csv file.' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const bad = checkImportFile(file.name || '', buf)
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status })

  const parsed = parseWorkbook(buf)
  if (parsed.fatal) return NextResponse.json({ error: parsed.fatal }, { status: 400 })
  const summary = summarizeRows(parsed.rows)

  // Same file twice (double click, second tab) while the first is still queued/running: return that job.
  const fingerprint = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  const safeName = (file.name || 'import.xlsx').replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80)

  let result: { job: { id: string; status: string }; duplicate: boolean }
  try {
    result = await withImportLock(tenantId, 'upload', async () => {
      const existing = await findActiveUploadByFingerprint(tenantId, fingerprint)
      if (existing) return { job: existing, duplicate: true }
      const fileKey = await uploadImportFile(buf, `${fingerprint}-${safeName}`)
      const job = await enqueueImportJob({
        tenantId,
        source: 'upload',
        fileKey,
        totalRows: summary.units,
        createdBy: admin.adminId,
      })
      return { job, duplicate: false }
    })
  } catch (e: unknown) {
    if (e instanceof ImportBusyError) {
      return NextResponse.json({ error: 'Another upload is being queued. Try again in a moment.' }, { status: 409 })
    }
    console.error('[data-source/import] staging failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not store the file for import. Try again.' }, { status: 502 })
  }

  if (result.duplicate) {
    return NextResponse.json({
      jobId: result.job.id,
      status: result.job.status,
      totalRows: summary.units,
      duplicate: true,
      warnings: parsed.warnings ?? [],
    })
  }

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'import',
    entityType: 'product',
    entityId: result.job.id,
    summary: `Queued bulk product import (${summary.units} rows)`,
    metadata: { jobId: result.job.id, source: 'upload', rows: summary.units, file: safeName },
    request,
  })

  return NextResponse.json({
    jobId: result.job.id,
    status: result.job.status,
    totalRows: summary.units,
    products: summary.products,
    invalid: summary.invalid,
    warnings: parsed.warnings ?? [],
  })
}
