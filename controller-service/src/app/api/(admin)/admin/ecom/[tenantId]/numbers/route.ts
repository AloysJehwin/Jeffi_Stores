import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant } from '@/lib/tenant-registry'
import { PLATFORM_TENANT_ID, audiencesFor, listTenantSenders, type SenderAudience } from '@/lib/messaging/tenant-senders'
import { invalidateMessagingEntitlement, messagingEntitlement } from '@/lib/billing/messaging-addon'
import { provisionTenantNumber, refreshTenantNumbers, releaseTenantNumber, retryWhatsApp } from '@controller/lib/messaging/tenant-numbers'

export const dynamic = 'force-dynamic'

// A store's platform-bought numbers, and the flagship's (PLATFORM_TENANT_ID, Settings → Numbers). POST buys one for an
// audience (bound to every channel it has, registered on WhatsApp); PATCH retries a failed WhatsApp registration; GET
// refreshes WhatsApp status; DELETE releases the number. Platform admins only.

type Params = { params: Promise<{ tenantId: string }> }

const Audience = z.enum(['customer', 'admin', 'ecom'])
const PostSchema = z.object({
  audience: Audience,
  number: z.string().trim().regex(/^\+\d{8,15}$/, 'Pick a number from the search'),
  displayName: z.string().trim().min(3).max(100),
})
const PatchSchema = z.object({ audience: Audience, displayName: z.string().trim().min(3).max(100) })

async function gate(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const { tenantId } = await params
  // The flagship has no tenants row.
  if (tenantId === PLATFORM_TENANT_ID) return { admin, tenantId, slug: 'jeffi' }
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  return { admin, tenantId, slug: tenant.slug ?? tenantId.slice(0, 8) }
}

function audienceError(tenantId: string, audience: SenderAudience) {
  if (!audiencesFor(tenantId).includes(audience)) return NextResponse.json({ error: 'Unknown audience' }, { status: 400 })
  // The flagship's customer-facing number is the platform default or assigned by hand: a bought one would take live
  // shopper messages before its WhatsApp registration is approved.
  if (tenantId === PLATFORM_TENANT_ID && audience === 'customer')
    return NextResponse.json({ error: "The flagship's customer-facing number is assigned in Settings → Numbers, not bought" }, { status: 400 })
  return null
}

async function state(tenantId: string) {
  // The flagship has no messaging add-on (messagingEntitlement is always ok for it).
  if (tenantId === PLATFORM_TENANT_ID) return { senders: await listTenantSenders(tenantId) }
  invalidateMessagingEntitlement(tenantId)
  const [senders, entitlement] = await Promise.all([listTenantSenders(tenantId), messagingEntitlement(tenantId, { maxAgeMs: 0 })])
  return { senders, entitlement }
}

export async function GET(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  await refreshTenantNumbers(g.tenantId)
  return NextResponse.json(await state(g.tenantId))
}

export async function POST(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  const parsed = parseBody(PostSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const bad = audienceError(g.tenantId, parsed.data.audience)
  if (bad) return bad
  try {
    const result = await provisionTenantNumber({
      tenantId: g.tenantId, audience: parsed.data.audience, number: parsed.data.number, displayName: parsed.data.displayName,
      storeSlug: g.slug, createdBy: g.admin.adminId,
    })
    return NextResponse.json({ result, ...(await state(g.tenantId)) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not get the number' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  const parsed = parseBody(PatchSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const bad = audienceError(g.tenantId, parsed.data.audience)
  if (bad) return bad
  try {
    await retryWhatsApp(g.tenantId, parsed.data.audience, parsed.data.displayName)
    return NextResponse.json(await state(g.tenantId))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not register on WhatsApp' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  const audience = Audience.safeParse(request.nextUrl.searchParams.get('audience'))
  if (!audience.success) return NextResponse.json({ error: 'Unknown audience' }, { status: 400 })
  const bad = audienceError(g.tenantId, audience.data)
  if (bad) return bad
  try {
    await releaseTenantNumber(g.tenantId, audience.data)
    return NextResponse.json(await state(g.tenantId))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not release the number' }, { status: 400 })
  }
}
