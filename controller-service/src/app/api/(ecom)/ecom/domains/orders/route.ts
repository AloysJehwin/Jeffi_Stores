import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerDomainsState, ownerOrderView, ownerSite, ownerStore } from '@controller/lib/domains/owner-api'
import { buyDomain } from '@controller/lib/domains/orders'
import { ContactSchema, firstIssue } from '@controller/lib/domains/contact'
import { showcaseDomainInUse } from '@/lib/showcase/domain'

export const dynamic = 'force-dynamic'

// GET ?tenantId → the store's bought domains, wallet balance and contact prefill; ?siteId → that Showcase site's.
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId')
  const auth = siteId ? await ownerSite(request, siteId) : await ownerStore(request, request.nextUrl.searchParams.get('tenantId'))
  if (auth instanceof NextResponse) return auth
  // ownerSite found this site for the owner, so its id is the one asked for.
  return NextResponse.json(await ownerDomainsState(auth.tenant, auth.owner, siteId))
}

const BuySchema = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(3).max(253),
  expectedPriceInr: z.number().int().positive(),
  contact: ContactSchema,
  /** A Showcase site's domain (apex and www. go to the site), paid from the workspace it bills to. */
  siteId: z.string().uuid().optional(),
})

// POST → buy: charge the first year to the wallet and submit the registration.
export async function POST(request: NextRequest) {
  const parsed = BuySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const { siteId } = parsed.data
  const auth = siteId ? await ownerSite(request, siteId) : await ownerStore(request, parsed.data.tenantId)
  if (auth instanceof NextResponse) return auth
  if (siteId) {
    if (auth.tenant.id !== parsed.data.tenantId) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    const inUse = await showcaseDomainInUse(siteId)
    if (inUse) return NextResponse.json({ error: `This site already has ${inUse}. Remove it first.` }, { status: 409 })
  } else if (!(auth.tenant.service_types ?? []).includes('store')) return NextResponse.json({ error: 'Domains are for stores.' }, { status: 400 })
  const res = await buyDomain({ tenantId: auth.tenant.id, domain: parsed.data.domain, contact: parsed.data.contact, expectedPriceInr: parsed.data.expectedPriceInr, showcaseSiteId: siteId ?? null })
  if (!res.ok) {
    const status = { disabled: 503, invalid: 400, unavailable: 409, price_changed: 409, wallet_short: 402, failed: 502 }[res.code]
    return NextResponse.json({ error: res.error, code: res.code, priceInr: res.priceInr, shortfallInr: res.shortfallInr, order: res.order ? await ownerOrderView(res.order) : undefined }, { status })
  }
  return NextResponse.json({ ok: true, order: await ownerOrderView(res.order) })
}
