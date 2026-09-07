import { NextRequest, NextResponse } from 'next/server'
import { runMigrationFilesFanout } from '@/lib/tenant-migrations'

export const dynamic = 'force-dynamic'
// The fan-out opens a connection per tenant and applies each pending migration file.
export const maxDuration = 300

// Applies pending database/migrations/*.sql files to every active tenant's own RDS.
//
// Mirrors the desired-state fanout endpoint: Bearer ${CRON_SECRET}, called from the deploy box
// over localhost right after the flagship migration apply, so a migration on main reaches every
// customer database rather than only the flagship. Idempotent — each tenant DB's own
// schema_migrations ledger decides which files are still pending, so re-calls are safe.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({} as { gitSha?: string }))
  const gitSha = body.gitSha || process.env.GIT_SHA || `manual-${Date.now()}`

  const result = await runMigrationFilesFanout(gitSha)
  return NextResponse.json({ ok: result.failed === 0, result }, { status: result.failed === 0 ? 200 : 500 })
}
