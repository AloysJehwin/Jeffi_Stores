import { NextRequest, NextResponse } from 'next/server'
import { runMigrationFanout } from '@/lib/tenant-migrations'

export const dynamic = 'force-dynamic'
// The fan-out opens a connection per tenant and applies the full schema to each.
export const maxDuration = 300

// Applies the desired-state schema to every active tenant's own RDS.
//
// The same work is reachable from /api/admin/ecom/migrations/run, but that needs an admin JWT,
// which the deploy pipeline has no way to obtain. This mirrors the reconcile sweep instead:
// Bearer ${CRON_SECRET}, called from the box over localhost right after a deploy, so a schema
// change on main reaches every customer database rather than only the flagship.
//
// Safe to call repeatedly — runMigrationFanout skips any tenant already recorded against this
// gitSha, and the schema itself is now re-appliable (see tenant-migrations-schema.ts).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}) as { gitSha?: string })
  const gitSha = body.gitSha || process.env.GIT_SHA || `manual-${Date.now()}`

  const result = await runMigrationFanout(gitSha)
  // 500 on any failure so the deploy step surfaces it; the body still names which tenants
  // failed, because the ones that succeeded are already migrated and must not be retried blindly.
  return NextResponse.json({ ok: result.failed === 0, result }, { status: result.failed === 0 ? 200 : 500 })
}
