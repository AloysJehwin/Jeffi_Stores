import { NextRequest, NextResponse } from 'next/server'
import {
  claimNextImportJob,
  failStaleImportJobs,
  updateImportJob,
  PLATFORM_TENANT_ID,
  type PendingDeletion,
} from '@/lib/import/jobs'
import { lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { getImportFile } from '@/lib/shared/s3'
import { runImport } from '@/lib/catalog/product-import'
import { upsertSheetLinks, computeOrphans } from '@/lib/import/sheet-links'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Recurring bulk-import worker. Claims one pending job per tick (multi-instance safe via
// claimNextImportJob's FOR UPDATE SKIP LOCKED), re-enters that tenant's context, reads the
// staged workbook from the tenant bucket, and runs the canonical import engine. Progress is
// written back to import_jobs as each product group completes. Driven by instrumentation.ts.
// Auth: Bearer ${CRON_SECRET}.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A job left running by a worker lost to a restart would otherwise sit "running" forever and block its tenant.
  const reset = await failStaleImportJobs().catch(e => {
    console.error('[import-worker] stale sweep failed', { message: (e as Error)?.message })
    return 0
  })
  const job = await claimNextImportJob()
  if (!job) return NextResponse.json({ success: true, claimed: false, reset })

  // Flagship jobs are keyed to the platform sentinel and run with NO tenant context (platform pool),
  // mirroring flagship product publishing. Tenant jobs re-enter that tenant's ALS context + RDS.
  const isPlatform = job.tenant_id === PLATFORM_TENANT_ID
  let ctx: TenantContext | null = null
  if (!isPlatform) {
    ctx = await lookupTenantContextById(job.tenant_id)
    if (!ctx) {
      await updateImportJob(job.id, { status: 'failed', last_error: 'tenant not found or inactive', finished: true })
      return NextResponse.json({ success: false, jobId: job.id, error: 'tenant not resolvable' })
    }
  }
  if (!job.file_key) {
    await updateImportJob(job.id, { status: 'failed', last_error: 'no file_key on job', finished: true })
    return NextResponse.json({ success: false, jobId: job.id, error: 'no file' })
  }

  const onProgress = async (p: {
    processed: number
    created: number
    updated: number
    errors: number
    rowResults: Awaited<ReturnType<typeof runImport>>['rowResults']
    imageProgress: Awaited<ReturnType<typeof runImport>>['imageProgress']
  }) => {
    await updateImportJob(job.id, {
      processed_rows: p.processed,
      created_count: p.created,
      updated_count: p.updated,
      error_count: p.errors,
      row_results: p.rowResults,
      image_progress: p.imageProgress,
    })
  }

  try {
    const isSheet = job.source === 'google_sheet' && !!job.spreadsheet_id
    const doImport = async () => {
      const buf = await getImportFile(job.file_key!)
      const outcome = await runImport(buf, { onProgress, source: isSheet ? 'google_sheet' : 'upload' })
      // Google-sheet syncs own the products they touch: record links, then flag products this
      // sheet previously owned but that vanished from the current sync as deletion candidates.
      // Both reads/writes needing the tenant store DB (product names) run in this same context.
      // A failure here must not discard the import's own results, so it is reported beside them.
      let pendingDeletions: PendingDeletion[] = []
      let linkError: string | null = null
      if (isSheet) {
        try {
          await upsertSheetLinks(job.tenant_id, job.spreadsheet_id!, job.id, outcome.seenProducts)
          pendingDeletions = await computeOrphans(
            job.tenant_id,
            job.spreadsheet_id!,
            outcome.seenProducts.map(p => p.sku)
          )
        } catch (e) {
          console.error('[import-worker] sheet link tracking failed', { jobId: job.id, message: (e as Error)?.message })
          linkError = 'Products were imported, but removed-from-sheet tracking failed; the next sync will retry it.'
        }
      }
      return { outcome, pendingDeletions, linkError }
    }
    const { outcome, pendingDeletions, linkError } = ctx
      ? await runWithTenantContext(ctx, doImport)
      : await doImport()

    await updateImportJob(job.id, {
      status: 'done',
      total_rows: outcome.totalRows,
      processed_rows: outcome.totalRows,
      created_count: outcome.createdCount,
      updated_count: outcome.updatedCount,
      error_count: outcome.errorCount,
      row_results: outcome.rowResults,
      image_progress: outcome.imageProgress,
      pending_deletions: pendingDeletions,
      last_error: linkError,
      finished: true,
    })
    return NextResponse.json({ success: true, jobId: job.id, ...outcome, pendingDeletions })
  } catch (err: unknown) {
    const message = jobFailureMessage(err)
    await updateImportJob(job.id, { status: 'failed', last_error: message, finished: true }).catch(e =>
      console.error('[import-worker] could not record failure', { jobId: job.id, message: (e as Error)?.message })
    )
    return NextResponse.json({ success: false, jobId: job.id, error: message })
  }
}

// Messages shown on the history row: parser messages are ours and safe; storage and database
// internals are logged and replaced.
function jobFailureMessage(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown; message?: unknown; Code?: unknown }
  const msg = err instanceof Error ? err.message : 'import failed'
  if (e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey') {
    return 'The uploaded file is no longer available. Upload it again.'
  }
  if (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
    console.error('[import-worker] database error', { code: e.code, message: msg })
    return 'A database error stopped the import. Products saved before it are kept; run it again.'
  }
  if (/S3|AccessDenied|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg)) {
    console.error('[import-worker] storage/network error', { message: msg })
    return 'Could not read the uploaded file from storage. Run the import again.'
  }
  return msg
}
