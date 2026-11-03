import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Backfill a store's own site_settings from its onboarding identity/KYC/warehouse/bank. Fill-only
// unless `{ force: true }`. `?all=1` reseeds every active store in turn (the [id] is ignored).
//
// Auth: Bearer ${CRON_SECRET} (same as the sibling internal routes). Server-to-server only.

interface InfraRow {
  tenant_id: string
  slug: string
  rds_endpoint: string | null
  rds_port: number | null
  rds_db: string | null
  iam_auth: boolean | null
  db_secret_ref: string | null
}

const INFRA_SQL = `SELECT t.id AS tenant_id, t.slug, i.rds_endpoint, i.rds_port, i.rds_db, i.iam_auth, i.db_secret_ref
                     FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id`

async function reseed(row: InfraRow, force: boolean) {
  const { seedTenantSiteSettings } = await import('@controller/lib/provisioning/seed-settings')
  return seedTenantSiteSettings(row.tenant_id, null, {
    endpoint: row.rds_endpoint!,
    port: row.rds_port,
    dbName: row.rds_db,
    iamAuth: row.iam_auth,
    dbSecretRef: row.db_secret_ref,
    force,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const force = body?.force === true
  const all = request.nextUrl.searchParams.get('all') === '1'

  if (all) {
    const rows = (
      await controlPlanePool().query<InfraRow>(
        `${INFRA_SQL} WHERE t.status = 'active' AND i.rds_endpoint IS NOT NULL ORDER BY t.created_at`
      )
    ).rows
    const results: Array<{ tenantId: string; slug: string; written?: number; error?: string }> = []
    for (const row of rows) {
      try {
        const r = await reseed(row, force)
        results.push({ tenantId: row.tenant_id, slug: row.slug, written: r.written })
      } catch (e: any) {
        results.push({ tenantId: row.tenant_id, slug: row.slug, error: e?.message || 'reseed failed' })
      }
    }
    return NextResponse.json({ reseeded: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length, results })
  }

  const { id: tenantId } = await params
  const row = (await controlPlanePool().query<InfraRow>(`${INFRA_SQL} WHERE t.id = $1`, [tenantId])).rows[0]
  if (!row) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })
  if (!row.rds_endpoint) {
    return NextResponse.json({ error: 'tenant has no DB endpoint — not yet provisioned' }, { status: 409 })
  }
  try {
    const r = await reseed(row, force)
    return NextResponse.json({ reseeded: true, tenantId, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'reseed failed' }, { status: 500 })
  }
}
