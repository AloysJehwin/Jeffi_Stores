import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { runMigrationFanout, getMigrationRuns } from '@/lib/tenant-migrations'

export const dynamic = 'force-dynamic'

// GET  → recent migration runs (admin visibility)
// POST → trigger a fan-out: apply current desired-state schema to all active tenants.
//        Body: { gitSha?: string } — defaults to env GIT_SHA or 'manual-<timestamp>'.

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin || admin.role !== 'super_admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const runs = await getMigrationRuns(100)
  return NextResponse.json({ runs })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin || admin.role !== 'super_admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const gitSha = body.gitSha || process.env.GIT_SHA || `manual-${Date.now()}`

  const result = await runMigrationFanout(gitSha)
  return NextResponse.json({ ok: result.failed === 0, result })
}
