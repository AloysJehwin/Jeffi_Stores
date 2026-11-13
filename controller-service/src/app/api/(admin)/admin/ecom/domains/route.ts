import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listAdminDomains } from '@controller/lib/domains/admin'
import { DEFAULT_DOMAIN_PRICING, getDomainPricing, saveDomainPricing } from '@controller/lib/domains/pricing'
import { domainsLive } from '@controller/lib/domains/providers'
import { getCatalog } from '@controller/lib/compute/catalog'

export const dynamic = 'force-dynamic'

// Bought domains (status, expiry, renewal, cost vs price) and the domain margin / renewal settings. Platform admin only.

function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

export async function GET(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:read'))
  if (admin instanceof NextResponse) return admin
  const [domains, settings, catalog] = await Promise.all([listAdminDomains(), getDomainPricing(), getCatalog()])
  return NextResponse.json({ domains, settings, defaults: DEFAULT_DOMAIN_PRICING, live: domainsLive(), usdInr: catalog.settings.usdInr })
}

const Body = z.object({
  marginPct: z.number().min(0).max(500),
  renewLeadDays: z.number().int().min(7).max(60),
  renewCutoffDays: z.number().int().min(1).max(30),
  tlds: z.array(z.string().trim().toLowerCase().regex(/^[a-z]{2,24}(\.[a-z]{2,24})?$/)).min(1).max(30),
})

export async function PUT(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Margin 0–500%, renewal window 7–60 days, cut-off 1–30 days, and at least one TLD.' }, { status: 400 })
  if (parsed.data.renewCutoffDays >= parsed.data.renewLeadDays) return NextResponse.json({ error: 'The cut-off must be inside the renewal window.' }, { status: 400 })
  await saveDomainPricing({ ...parsed.data, tlds: [...new Set(parsed.data.tlds)] })
  return NextResponse.json({ settings: await getDomainPricing() })
}
