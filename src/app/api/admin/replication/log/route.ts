import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { authenticateAdmin, authenticateServiceAccount } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { logAdminAudit } from '@/lib/admin-audit'
import { verifyCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

// -----------------------------------------------------------------------------
// POST — called by the Razer ML box at the end of every replication run.
// Auth: mTLS service account (cert serial validated against DB) OR CRON_SECRET.
// Never trusts x-service-account-id from the caller — that header is internal only.
// -----------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const sa = await authenticateServiceAccount(request)
  const cronOk = verifyCronRequest(request)

  if (!sa && !cronOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (sa && !sa.allowed_scopes.includes('replication:write') && !sa.allowed_scopes.includes('replication')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: {
    run_id?: string
    status?: 'ok' | 'failed' | 'partial' | 'started'
    duration_seconds?: number | null
    row_count?: number | null
    dump_bytes?: number | null
    message?: string | null
    source?: string | null
    started_at?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.run_id || typeof body.run_id !== 'string') {
    return NextResponse.json({ error: 'run_id required' }, { status: 400 })
  }
  const validStatus = ['ok', 'failed', 'partial', 'started']
  if (!body.status || !validStatus.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${validStatus.join(', ')}` }, { status: 400 })
  }

  // Derive started_at from the run_id (format: repl-YYYYMMDDTHHMMSSZ) if not provided.
  let startedAt: Date | null = null
  if (body.started_at) {
    const d = new Date(body.started_at)
    if (!isNaN(d.getTime())) startedAt = d
  }
  if (!startedAt) {
    const m = /^repl-(\d{8})T(\d{6})Z$/.exec(body.run_id)
    if (m) {
      const iso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`
      const d = new Date(iso)
      if (!isNaN(d.getTime())) startedAt = d
    }
  }

  await query(
    `INSERT INTO replication_runs
       (run_id, source, status, started_at, duration_seconds, row_count, dump_bytes, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (run_id) DO UPDATE SET
       status           = EXCLUDED.status,
       started_at       = COALESCE(replication_runs.started_at, EXCLUDED.started_at),
       duration_seconds = EXCLUDED.duration_seconds,
       row_count        = EXCLUDED.row_count,
       dump_bytes       = EXCLUDED.dump_bytes,
       message          = EXCLUDED.message,
       recorded_at      = NOW()`,
    [
      body.run_id,
      body.source || 'razer',
      body.status,
      startedAt,
      body.duration_seconds ?? null,
      body.row_count ?? null,
      body.dump_bytes ?? null,
      body.message ?? null,
    ]
  )

  await logAdminAudit({
    adminId: null,
    action: 'create',
    entityType: 'system',
    entityId: body.run_id,
    summary: `Replication run ${body.run_id} recorded: status=${body.status}${body.row_count != null ? `, rows=${body.row_count}` : ''}${body.duration_seconds != null ? `, duration=${body.duration_seconds}s` : ''}`,
    metadata: {
      source: body.source || 'razer',
      status: body.status,
      row_count: body.row_count ?? null,
      dump_bytes: body.dump_bytes ?? null,
      duration_seconds: body.duration_seconds ?? null,
      ...(sa ? { service_account: sa.name } : {}),
    },
    request,
  })

  return NextResponse.json({ ok: true, run_id: body.run_id })
}

// -----------------------------------------------------------------------------
// GET — paginated history for the /admin/replication page.
// Admin-scoped; same auth pattern as other /api/admin/* routes.
// -----------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'replication:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50', 10)))
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10))

  const runs = await queryMany(
    `SELECT id, run_id, source, status, started_at,
            duration_seconds, row_count, dump_bytes, message, recorded_at
     FROM replication_runs
     ORDER BY recorded_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )

  return NextResponse.json({ runs, limit, offset })
}
