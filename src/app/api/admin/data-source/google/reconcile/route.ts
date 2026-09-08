import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenant-context'
import {
  getImportJob,
  updateImportJob,
  resolveImportTenantId,
  PLATFORM_TENANT_ID,
  type RowResult,
} from '@/lib/import/jobs'
import { applyOrphanRemoval, removeSheetLinks, type SheetOrphan } from '@/lib/import/sheet-links'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Apply the deletion decision on a Google-sheet sync's pending orphans (products that left the
// sheet). approve → retire each (deactivate if referenced, else hard-delete) + drop its link.
// keep → drop the links only, so kept products go unmanaged and stop being flagged. Either way,
// pending_deletions is cleared so the warning card disappears. products:write gated.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const body = await request.json().catch(() => ({}))
  const jobId: unknown = body?.jobId
  const decision: unknown = body?.decision
  const productIds: unknown = body?.productIds
  if (typeof jobId !== 'string' || (decision !== 'approve' && decision !== 'keep')) {
    return NextResponse.json({ error: 'jobId and decision (approve|keep) are required' }, { status: 400 })
  }

  const tenantId = await resolveImportTenantId()
  const job = await getImportJob(jobId, tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.source !== 'google_sheet' || !job.spreadsheet_id) {
    return NextResponse.json({ error: 'Job is not a Google Sheet sync' }, { status: 400 })
  }

  const pending = job.pending_deletions ?? []
  if (pending.length === 0) {
    return NextResponse.json({ error: 'No pending deletions on this job' }, { status: 409 })
  }

  // Optional subset: only reconcile the productIds the user selected, leaving the rest pending.
  const selectedIds = Array.isArray(productIds) ? new Set(productIds.map(String)) : null
  const targets: SheetOrphan[] = selectedIds
    ? pending.filter((p) => selectedIds.has(p.productId))
    : pending
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No matching pending deletions' }, { status: 409 })
  }
  const targetIds = new Set(targets.map((t) => t.productId))
  const remaining = pending.filter((p) => !targetIds.has(p.productId))

  const spreadsheetId = job.spreadsheet_id

  const isPlatform = tenantId === PLATFORM_TENANT_ID
  const ctx = isPlatform ? null : await lookupTenantContextById(tenantId)
  if (!isPlatform && !ctx) return NextResponse.json({ error: 'Tenant not resolvable' }, { status: 404 })

  let summary: string
  let auditMeta: Record<string, unknown>

  if (decision === 'approve') {
    const run = () => applyOrphanRemoval(tenantId, spreadsheetId, targets)
    const outcomes = ctx ? await runWithTenantContext(ctx, run) : await run()

    const deletionRows: RowResult[] = outcomes.map((o) => ({
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
    const run = () => removeSheetLinks(tenantId, spreadsheetId, targets.map((t) => t.productId))
    if (ctx) await runWithTenantContext(ctx, run)
    else await run()
    await updateImportJob(job.id, { pending_deletions: remaining })
    summary = `Kept ${targets.length} product(s); unlinked from the Google Sheet`
    auditMeta = { jobId: job.id, spreadsheetId, decision, productIds: targets.map((t) => t.productId) }
  }

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'import',
    entityType: 'product',
    entityId: job.id,
    summary,
    metadata: auditMeta,
    request,
  })

  return NextResponse.json({ ok: true, decision, applied: targets.length, remaining: remaining.length })
}
