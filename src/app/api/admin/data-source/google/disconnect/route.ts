import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { logAdminAudit } from '@/lib/admin-audit'
import { deleteIntegrationCredential, lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenant-context'
import {
  resolveImportTenantId,
  isSheetSyncRunning,
  cancelPendingSheetSyncs,
  PLATFORM_TENANT_ID,
} from '@/lib/import/jobs'
import { forgetSheetOwnership, releaseSheetProducts } from '@/lib/import/sheet-links'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The credential goes last so a partial failure stays connected and retryable. The Google grant is
// not revoked: it is per account and our shared OAuth client, so revoking would cut other stores too.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'products:write')
  if (admin instanceof NextResponse) return admin

  const tenantId = await resolveImportTenantId()
  if (await isSheetSyncRunning(tenantId)) {
    return NextResponse.json({ error: 'A Google Sheet sync is running. Disconnect once it finishes.' }, { status: 409 })
  }

  const isPlatform = tenantId === PLATFORM_TENANT_ID
  const ctx = isPlatform ? null : await lookupTenantContextById(tenantId)
  if (!isPlatform && !ctx) return NextResponse.json({ error: 'Tenant not resolvable' }, { status: 404 })

  const cancelled = await cancelPendingSheetSyncs(tenantId, 'Google Sheet disconnected before this sync ran')
  const unlinked = await forgetSheetOwnership(tenantId)
  const released = ctx ? await runWithTenantContext(ctx, releaseSheetProducts) : await releaseSheetProducts()
  await deleteIntegrationCredential(tenantId, 'google_sheets')

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'product',
    entityId: null,
    summary: `Disconnected the Google Sheet; ${released} synced product(s) are now managed manually`,
    metadata: { released, unlinked, cancelled },
    request,
  })

  return NextResponse.json({ ok: true, released })
}
