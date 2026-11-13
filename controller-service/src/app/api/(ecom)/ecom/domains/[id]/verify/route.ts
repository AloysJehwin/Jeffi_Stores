import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, getCustomDomain } from '@/lib/tenant-registry'
import { advanceDomain, reconcileDomains } from '@controller/lib/domains/verify-cron'

export const dynamic = 'force-dynamic'

// The dashboard "Verify" button: the same step the 10-minute cron runs, for this one domain.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const row = await getCustomDomain(id)
  if (!row || row.order_id) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.id === row.tenant_id)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const step = await advanceDomain(row)
  if (step.reconcile) await reconcileDomains(step.reconcile).catch(() => {}) // the cron retries
  const moved = step.status !== row.status || step.status === 'verified'
  if (moved) return NextResponse.json({ ok: true, status: step.status, message: step.message })
  return NextResponse.json({ error: step.message ?? 'Not ready yet', status: step.status }, { status: 400 })
}
