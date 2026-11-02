import { NextRequest, NextResponse } from 'next/server'
import { getTenant, controlPlanePool } from '@/lib/tenant-registry'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Backfill a tenant's own site_settings from the control-plane identity/KYC/bank it was
// provisioned with — for stores provisioned before seedTenantSiteSettings wrote the Legal &
// Banking keys, whose admin card renders blank. Idempotent (the seeder UPSERTs every key).
//
// Auth: Bearer ${CRON_SECRET} (same as the sibling internal routes). Server-to-server only.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCronRequest(_request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })
  if (!tenant.rds_endpoint) {
    return NextResponse.json({ error: 'tenant has no DB endpoint — not yet provisioned' }, { status: 409 })
  }

  const ownerRow = await controlPlanePool()
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId])
    .catch(() => null)
  const ownerId: string | undefined = ownerRow?.rows?.[0]?.owner_id
  if (!ownerId) return NextResponse.json({ error: 'owner not found for tenant' }, { status: 404 })

  try {
    const { seedTenantSiteSettings } = await import('@controller/lib/provisioning/seed-settings')
    await seedTenantSiteSettings(tenantId, ownerId, tenant.rds_endpoint, tenant.rds_db ?? 'jeffi_stores')
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'reseed failed' }, { status: 500 })
  }
  return NextResponse.json({ reseeded: true, tenantId })
}
