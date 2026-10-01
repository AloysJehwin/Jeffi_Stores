import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { uploadImportFile } from '@/lib/shared/s3'
import { parseWorkbook } from '@/lib/import/parse'
import { enqueueImportJob, resolveImportTenantId } from '@/lib/import/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 15 * 1024 * 1024

// Accept an uploaded workbook, validate it parses, stage it to the tenant bucket, and enqueue
// a background import job. products:write gated; tenant comes from ALS (admin host), never the
// client. The heavy work (image fetch + publish) runs in the import worker.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded (expected multipart field "file")' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 15MB limit' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())

  const parsed = parseWorkbook(buf)
  if (parsed.fatal) return NextResponse.json({ error: parsed.fatal }, { status: 400 })

  let job
  try {
    const fileKey = await uploadImportFile(buf, file.name || 'import.xlsx')
    job = await enqueueImportJob({
      tenantId,
      source: 'upload',
      fileKey,
      totalRows: parsed.rows.length,
      createdBy: admin.adminId,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to stage import'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'import',
    entityType: 'product',
    entityId: job.id,
    summary: `Queued bulk product import (${parsed.rows.length} rows)`,
    metadata: { jobId: job.id, source: 'upload', rows: parsed.rows.length },
    request,
  })

  return NextResponse.json({ jobId: job.id, status: job.status, totalRows: parsed.rows.length })
}
