import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { query } from '@/lib/shared/db'
import { listActiveTenantTargets, tenantPool } from '@/lib/tenant-migrations'
import { backfillBlurhashes, countMissingBlurhashes, type Db } from '@/lib/content/blurhash-backfill'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Blurhashes for images that predate the columns, on this store's DB and every active tenant's
// (deploy/k8s/db/60-live-content.sh). Bearer ${CRON_SECRET}. Without { apply: true } it only counts.
// With it, it works ~45s per call (the node is shared with the live site) and returns `next`; post `next` back
// until it is null. Targets are 'main' then each tenant slug.
const BUDGET_MS = 45_000
const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in').replace(/\/$/, '')

interface Next {
  target: string
  col: number
  after: string | null
}

async function withTarget<T>(target: string, fn: (db: Db, site: string) => Promise<T>): Promise<T> {
  if (target === 'main') return fn({ query }, SITE)
  const t = (await listActiveTenantTargets()).find(x => x.slug === target)
  if (!t) throw new Error(`No active tenant ${target}`)
  const pool = tenantPool({ rdsEndpoint: t.rds_endpoint, rdsPort: t.rds_port || 5432, rdsDb: t.rds_db || 'jeffi_stores' })
  try {
    return await fn(pool, '')
  } finally {
    await pool.end().catch(() => {})
  }
}

export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { apply?: boolean; next?: Next | null }
  try {
    const targets = ['main', ...(await listActiveTenantTargets()).map(t => t.slug).sort()]
    // One store's DB being unreachable is reported and skipped; the rest still run.
    if (body.apply !== true) {
      const counts = []
      for (const target of targets)
        counts.push(
          await withTarget(target, db => countMissingBlurhashes(db)).then(
            columns => ({ target, columns }),
            (err: unknown) => ({ target, error: err instanceof Error ? err.message : String(err) })
          )
        )
      return NextResponse.json({ ok: true, applied: false, counts })
    }
    const deadline = Date.now() + BUDGET_MS
    let at: Next = body.next ?? { target: targets[0], col: 0, after: null }
    let updated = 0
    const failed: string[] = []
    for (;;) {
      const r = await withTarget(at.target, (db, site) => backfillBlurhashes(db, at, deadline, site)).catch(
        (err: unknown) => ({ next: null, updated: 0, failed: [`unreachable: ${err instanceof Error ? err.message : String(err)}`] })
      )
      updated += r.updated
      failed.push(...r.failed.map(f => `${at.target} ${f}`))
      if (r.next) return NextResponse.json({ ok: true, applied: true, updated, failed, next: { target: at.target, ...r.next } })
      const i = targets.indexOf(at.target)
      if (i < 0 || i === targets.length - 1) return NextResponse.json({ ok: true, applied: true, updated, failed, next: null })
      at = { target: targets[i + 1], col: 0, after: null }
    }
  } catch (err) {
    console.error('[internal/content/blurhash]', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
