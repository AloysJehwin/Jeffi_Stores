import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getTenant, controlPlanePool } from '@/lib/tenant-registry'
import { STEPS } from '@controller/lib/provisioning/steps'
import { describePipeline } from '@controller/lib/provisioning/pipeline-view'

export const dynamic = 'force-dynamic'

// Provisioning instance detail — the job's current step, status, attempts, error, the
// resources it has created so far, and timestamps. Powers the live logs view on the
// provisioning detail page (polled client-side). Platform-admin gated. `pipeline` is the job's
// pinned pipeline with each step's state (pipeline-view.ts); `steps`/`events` stay for older clients.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'ecom_customers:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const r = await controlPlanePool().query(
    `SELECT id, step, status, attempts, last_error, next_attempt_at, created_resources,
            created_at, updated_at, step_started_at, pipeline
     FROM provisioning_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [id]
  )
  const row = r.rows[0] ?? null
  const { pipeline: _pinned, ...job } = row ?? {}

  // Per-stage history. provisioning_jobs only ever holds the current step, so without these
  // rows the UI can show which stage a job is on but nothing about what the earlier ones did.
  const ev = row
    ? await controlPlanePool()
        .query(
          `SELECT step, status, message, detail, started_at, duration_ms, created_at
           FROM provisioning_step_events
          WHERE job_id = $1
          ORDER BY created_at ASC`,
          [row.id]
        )
        .catch(() => ({ rows: [] }))
    : { rows: [] }

  return NextResponse.json({
    events: ev.rows,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      rds_endpoint: tenant.rds_endpoint,
      s3_bucket: tenant.s3_bucket,
      region: tenant.region,
    },
    steps: STEPS,
    job: row ? job : null,
    pipeline: row ? describePipeline(row, ev.rows) : null,
  })
}
