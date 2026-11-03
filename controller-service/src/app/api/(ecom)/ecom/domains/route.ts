import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, listCustomDomains, addCustomDomain } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
// What the owner points their domain at: a CNAME to the store's subdomain, or (apex) an A record.
const targets = (slug: string) => ({ cnameTarget: `${slug}.${ROOT}`, aRecord: process.env.CLUSTER_INGRESS_IP || null })

const AddSchema = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(4).max(255),
})

// GET ?tenantId=... → list custom domains for an owner's tenant
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const tenantId = request.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  // Ownership check
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.id === tenantId)) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const domains = await listCustomDomains(tenantId)
  return NextResponse.json({ domains, ...targets(tenants.find(t => t.id === tenantId)!.slug) })
}

// POST → add a custom domain (plan-quota enforced)
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  const parsed = AddSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const tenants = await getOwnerTenants(owner.id)
  const tenant = tenants.find(t => t.id === parsed.data.tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const result = await addCustomDomain(parsed.data.tenantId, parsed.data.domain)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const t = targets(tenant.slug)
  return NextResponse.json({
    ok: true,
    domain: result.domain,
    ...t,
    instructions: `Add a TXT record _jeffi.${result.domain.domain} = ${result.domain.verification_token}, and a CNAME ${result.domain.domain} → ${t.cnameTarget}${t.aRecord ? ` (or an A record to ${t.aRecord} for a root domain)` : ''}.`,
  })
}
