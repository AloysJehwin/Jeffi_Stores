import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerDomainsState, ownerOrderView, ownerStore } from '@controller/lib/domains/owner-api'
import { buyDomain } from '@controller/lib/domains/orders'
import { ContactSchema, firstIssue } from '@controller/lib/domains/contact'

export const dynamic = 'force-dynamic'

// GET ?tenantId → the store's bought domains, wallet balance and contact prefill.
export async function GET(request: NextRequest) {
  const auth = await ownerStore(request, request.nextUrl.searchParams.get('tenantId'))
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(await ownerDomainsState(auth.tenant, auth.owner))
}

const BuySchema = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(3).max(253),
  expectedPriceInr: z.number().int().positive(),
  contact: ContactSchema,
})

// POST → buy: charge the first year to the wallet and submit the registration.
export async function POST(request: NextRequest) {
  const parsed = BuySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const auth = await ownerStore(request, parsed.data.tenantId)
  if (auth instanceof NextResponse) return auth
  if (!(auth.tenant.service_types ?? []).includes('store')) return NextResponse.json({ error: 'Domains are for stores.' }, { status: 400 })
  const res = await buyDomain({ tenantId: auth.tenant.id, domain: parsed.data.domain, contact: parsed.data.contact, expectedPriceInr: parsed.data.expectedPriceInr })
  if (!res.ok) {
    const status = { disabled: 503, invalid: 400, unavailable: 409, price_changed: 409, wallet_short: 402, failed: 502 }[res.code]
    return NextResponse.json({ error: res.error, code: res.code, priceInr: res.priceInr, shortfallInr: res.shortfallInr, order: res.order ? await ownerOrderView(res.order) : undefined }, { status })
  }
  return NextResponse.json({ ok: true, order: await ownerOrderView(res.order) })
}
