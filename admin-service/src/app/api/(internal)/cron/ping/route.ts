import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { queryOne } from '@/lib/shared/db'
import { resolveTenant } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'

// Cron reachability: the controller's connect_crons step calls this where the fan-out will, with the
// store's Host and CRON_SECRET, so a pass proves routing, auth and the store's own backends.
type Check = 'ok' | 'error' | 'n/a'

async function health(base: string | undefined): Promise<Check> {
  if (!base) return 'n/a'
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(3000), cache: 'no-store' })
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await resolveTenant().catch(() => null)
  const [db, messaging, documents] = await Promise.all([
    queryOne('SELECT 1 AS ok').then(
      () => 'ok' as const,
      () => 'error' as const
    ),
    health(process.env.MESSAGING_URL),
    health(process.env.DOCUMENTS_URL),
  ])
  const ok = db === 'ok' && messaging !== 'error' && documents !== 'error'
  return NextResponse.json({ ok, tenant: tenant?.slug ?? null, db, messaging, documents })
}
