import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { promises as dns } from 'dns'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getOwnerTenants, getCustomDomain, setCustomDomainStatus } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// POST → verify a custom domain's CNAME points to the tenant's subdomain.
// On success, marks 'verified'. ACM cert issuance is a separate infra step.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { id } = await params
  const domain = await getCustomDomain(id)
  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })

  // Ownership check
  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find((t) => t.id === domain.tenant_id)
  if (!tenant) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const expectedTarget = `${tenant.slug}.jeffistores.in`

  // Check CNAME resolution
  try {
    await setCustomDomainStatus(id, 'verifying')
    let matched = false
    try {
      const cnames = await dns.resolveCname(domain.domain)
      matched = cnames.some((c) => c.replace(/\.$/, '').toLowerCase() === expectedTarget.toLowerCase())
    } catch {
      // Some setups use ALIAS/A records — check if it resolves to the same place as our subdomain
      try {
        const [domainAddrs, targetAddrs] = await Promise.all([
          dns.resolve4(domain.domain).catch((): string[] => []),
          dns.resolve4(expectedTarget).catch((): string[] => []),
        ])
        matched = domainAddrs.length > 0 && domainAddrs.some((a) => targetAddrs.includes(a))
      } catch { matched = false }
    }

    if (!matched) {
      await setCustomDomainStatus(id, 'pending')
      return NextResponse.json({
        ok: false,
        error: `CNAME not found. Add: ${domain.domain} → ${expectedTarget}, then retry (DNS can take a few minutes).`,
      }, { status: 400 })
    }

    // Verified. In production, trigger ACM cert issuance + CloudFront attach here.
    await setCustomDomainStatus(id, 'verified')
    return NextResponse.json({
      ok: true,
      status: 'verified',
      message: 'Domain verified! It will be live shortly once the SSL certificate is issued.',
    })
  } catch (err: any) {
    await setCustomDomainStatus(id, 'pending').catch(() => {})
    return NextResponse.json({ error: err?.message || 'Verification failed' }, { status: 500 })
  }
}
