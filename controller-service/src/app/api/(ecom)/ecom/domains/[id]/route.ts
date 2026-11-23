import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, getCustomDomain, deleteCustomDomain } from '@/lib/tenant-registry'
import { reconcileDomains, reconcileShowcaseDomains } from '@controller/lib/domains/verify-cron'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { clearShowcaseCustomDomain } from '@/lib/showcase/domain'

export const dynamic = 'force-dynamic'

async function auth(request: NextRequest, id: string) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return { error: 'Not signed in', status: 401 as const }
  const row = await getCustomDomain(id)
  if (!row) return { error: 'Domain not found', status: 404 as const }
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.id === row.tenant_id)) {
    return { error: 'Not authorized', status: 403 as const }
  }
  if (row.showcase_site_id && !(await getOwnedShowcase(row.showcase_site_id, owner.id))) return { error: 'Domain not found', status: 404 as const }
  return { row }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await auth(request, id)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ domain: res.row })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await auth(request, id)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  if (res.row.order_id) return NextResponse.json({ error: 'This host belongs to a domain you bought; it is managed with that domain.' }, { status: 409 })
  await deleteCustomDomain(id, res.row.tenant_id)
  const routed = res.row.status === 'cert-pending' || res.row.status === 'verified'
  if (res.row.showcase_site_id) {
    // The site stops answering on it; its route and certificate beside showcase-service go.
    await clearShowcaseCustomDomain(res.row.showcase_site_id, res.row.domain)
    if (routed) await reconcileShowcaseDomains().catch(() => {})
    return NextResponse.json({ ok: true })
  }
  // Prune its route, certificate and TLS secret; a store not yet running has none to prune.
  if (routed) await reconcileDomains(res.row.tenant_id).catch(() => {})
  return NextResponse.json({ ok: true })
}
