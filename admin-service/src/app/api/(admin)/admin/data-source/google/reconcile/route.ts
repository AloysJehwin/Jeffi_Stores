import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import {
  getImportJob,
  updateImportJob,
  resolveImportTenantId,
  latestJobBySource,
  hasActiveSheetSync,
  withImportLock,
  isUuid,
  ImportBusyError,
  PLATFORM_TENANT_ID,
  type RowResult,
} from '@/lib/import/jobs'
import { applyOrphanRemoval, removeSheetLinks, type SheetOrphan } from '@/lib/import/sheet-links'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Apply the deletion decision on a Google-sheet sync's pending orphans (products that left the
// sheet). approve → retire each (deactivate if referenced, else hard-delete) + drop its link.
// keep → drop the links only, so kept products go unmanaged and stop being flagged. Either way,
// pending_deletions is cleared so the warning card disappears. products:write gated. Runs under
// the per-store sheet lock, only on the latest finished sync, and never while a sync is queued.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const body = await request.json().catch(() => ({}))
  const jobId: unknown = body?.jobId
  const decision: unknown = body?.decision
  const productIds: unknown = body?.productIds
  if (!isUuid(jobId) || (decision !== 'approve' && decision !== 'keep')) {
    return NextResponse.json({ error: 'jobId and decision (approve|keep) are required' }, { status: 400 })
  }
  if (productIds !== undefined && (!Array.isArray(productIds) || !productIds.every(isUuid))) {
    return NextResponse.json({ error: 'productIds must be a list of product ids' }, { status: 400 })
  }

  const tenantId = await resolveImportTenantId()
  try {
    return await withImportLock(tenantId, 'sheet', () =>
      reconcile(request, admin.adminId, tenantId, jobId, decision, productIds as string[] | undefined)
    )
  } catch (e) {
    if (e instanceof ImportBusyError) {
      return NextResponse.json({ error: 'Another Google Sheet action is in progress. Try again in a moment.' }, { status: 409 })
    }
    console.error('[data-source/google/reconcile] failed', { message: (e as Error)?.message })
    return NextResponse.json({ error: 'Could not apply the decision. Try again.' }, { status: 500 })
  }
}

async function reconcile(
  request: NextRequest,
  adminId: string,
  tenantId: string,
  jobId: string,
  decision: 'approve' | 'keep',
  productIds: string[] | undefined
) {
  const job = await getImportJob(jobId, tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.source !== 'google_sheet' || !job.spreadsheet_id) {
    return NextResponse.json({ error: 'Job is not a Google Sheet sync' }, { status: 400 })
  }

  if (job.status !== 'done') return NextResponse.json({ error: 'That sync has not finished.' }, { status: 409 })
  const latest = await latestJobBySource(tenantId, 'google_sheet')
  if (latest && latest.id !== job.id) {
    return NextResponse.json(
      { error: 'A newer sync replaced this list. Review the removals on the latest sync.' },
      { status: 409 }
    )
  }
  if (await hasActiveSheetSync(tenantId)) {
    return NextResponse.json({ error: 'A sync is queued or running. Decide once it finishes.' }, { status: 409 })
  }

  const pending = job.pending_deletions ?? []
  if (pending.length === 0) {
    return NextResponse.json({ error: 'No pending deletions on this job' }, { status: 409 })
  }

  // Optional subset: only reconcile the productIds the user selected, leaving the rest pending.
  const selectedIds = productIds ? new Set(productIds) : null
  const targets: SheetOrphan[] = selectedIds ? pending.filter(p => selectedIds.has(p.productId)) : pending
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No matching pending deletions' }, { status: 409 })
  }
  const targetIds = new Set(targets.map(t => t.productId))
  const remaining = pending.filter(p => !targetIds.has(p.productId))

  const spreadsheetId = job.spreadsheet_id

  const isPlatform = tenantId === PLATFORM_TENANT_ID
  const ctx = isPlatform ? null : await lookupTenantContextById(tenantId)
  if (!isPlatform && !ctx) return NextResponse.json({ error: 'Tenant not resolvable' }, { status: 404 })

  let summary: string
  let auditMeta: Record<string, unknown>

  if (decision === 'approve') {
    const run = () => applyOrphanRemoval(tenantId, spreadsheetId, targets)
    const outcomes = ctx ? await runWithTenantContext(ctx, run) : await run()

    const deletionRows: RowResult[] = outcomes.map(o => ({
      row: 0,
      sku: o.sku,
      outcome: 'deleted',
      message: `${o.name} (${o.sku}) ${o.action} — removed from sheet`,
    }))
    await updateImportJob(job.id, {
      row_results: [...job.row_results, ...deletionRows],
      pending_deletions: remaining,
    })
    summary = `Removed ${outcomes.length} product(s) no longer in the Google Sheet`
    auditMeta = { jobId: job.id, spreadsheetId, decision, outcomes }
  } else {
    const run = () =>
      removeSheetLinks(
        tenantId,
        spreadsheetId,
        targets.map(t => t.productId)
      )
    if (ctx) await runWithTenantContext(ctx, run)
    else await run()
    await updateImportJob(job.id, { pending_deletions: remaining })
    summary = `Kept ${targets.length} product(s); unlinked from the Google Sheet`
    auditMeta = { jobId: job.id, spreadsheetId, decision, productIds: targets.map(t => t.productId) }
  }

  await logAdminAudit({
    adminId,
    action: 'import',
    entityType: 'product',
    entityId: job.id,
    summary,
    metadata: auditMeta,
    request,
  })

  return NextResponse.json({ ok: true, decision, applied: targets.length, remaining: remaining.length })
}
