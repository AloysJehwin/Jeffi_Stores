import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant } from '@/lib/tenant-registry'
import { audiencesFor, deleteTenantSender, invalidateTenantSenders, isSenderAudience, listTenantSenders, saveTenantSender, type SenderAudience } from '@/lib/messaging/tenant-senders'
import { getMessagingAddon, invalidateMessagingEntitlement, messagingEntitlement } from '@/lib/billing/messaging-addon'
import { SenderPutSchema as PutSchema } from '@/lib/messaging/sender-schema'

export const dynamic = 'force-dynamic'

// The senders Jeffi assigns a store for SMS or WhatsApp, per audience (?audience=customer|admin; default customer).
// Platform admins only; credentials are stored encrypted and never returned (masked meta only).

const Channel = z.enum(['sms', 'whatsapp'])
type Params = { params: Promise<{ tenantId: string; channel: string }> }

async function gate(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const { tenantId, channel: raw } = await params
  const channel = Channel.safeParse(raw)
  if (!channel.success) return NextResponse.json({ error: 'Unknown channel' }, { status: 400 })
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  const audience = request.nextUrl.searchParams.get('audience') || 'customer'
  if (!isSenderAudience(audience) || !audiencesFor(tenantId).includes(audience)) return NextResponse.json({ error: 'Unknown audience' }, { status: 400 })
  return { admin, tenantId, channel: channel.data, audience }
}

async function state(tenantId: string, channel: 'sms' | 'whatsapp', audience: SenderAudience) {
  invalidateTenantSenders(tenantId)
  invalidateMessagingEntitlement(tenantId)
  const [senders, addon, entitlement] = await Promise.all([listTenantSenders(tenantId), getMessagingAddon(tenantId), messagingEntitlement(tenantId)])
  return { sender: senders.find(s => s.channel === channel && s.audience === audience) ?? null, addon, entitlement: entitlement[channel] }
}

export async function GET(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  return NextResponse.json(await state(g.tenantId, g.channel, g.audience))
}

export async function PUT(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  const parsed = parseBody(PutSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { provider, sender, config } = parsed.data
  if (provider === 'aws' && g.channel === 'whatsapp' && !config.whatsapp_phone_number_id)
    return NextResponse.json({ error: 'AWS WhatsApp needs the phone number id.' }, { status: 400 })
  try {
    await saveTenantSender({ tenantId: g.tenantId, channel: g.channel, audience: g.audience, provider, sender, config, createdBy: g.admin.adminId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the sender' }, { status: 400 })
  }
  return NextResponse.json(await state(g.tenantId, g.channel, g.audience))
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  await deleteTenantSender(g.tenantId, g.channel, g.audience)
  return NextResponse.json(await state(g.tenantId, g.channel, g.audience))
}
