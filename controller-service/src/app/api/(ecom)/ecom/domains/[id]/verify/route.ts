import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, getCustomDomain } from '@/lib/tenant-registry'
import { verifyDomain } from '@controller/lib/domains/dns-verify'

export const dynamic = 'force-dynamic'

// Manual-verify from the dashboard "Verify" button. Runs the DNS TXT check for this one domain.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const row = await getCustomDomain(id)
  if (!row) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.id === row.tenant_id)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const out = await verifyDomain(id)
  if (out.ok) return NextResponse.json({ ok: true, message: 'DNS verified. Issuing certificate...' })
  return NextResponse.json({ error: out.error, status: out.status }, { status: 400 })
}
