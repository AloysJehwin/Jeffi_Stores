import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant } from '@/lib/tenant-registry'
import { deleteTenantSender, invalidateTenantSenders, listTenantSenders, saveTenantSender } from '@/lib/messaging/tenant-senders'
import { getMessagingAddon, invalidateMessagingEntitlement, messagingEntitlement } from '@/lib/billing/messaging-addon'

export const dynamic = 'force-dynamic'

// The sender Jeffi assigns a store for SMS or WhatsApp. Platform admins only; credentials are stored
// encrypted and never returned (masked meta only).

const Channel = z.enum(['sms', 'whatsapp'])
const opt = z.string().trim().max(400).optional()
const req = z.string().trim().min(1).max(400)

const PutSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('twilio'),
    sender: z.string().trim().min(1).max(120),
    // auth_token is required: Twilio signs the store account's status callbacks with it.
    config: z.object({ account_sid: req, auth_token: req, api_key_sid: opt, api_key_secret: opt, messaging_service_sid: opt }).strict(),
  }),
  z.object({
    provider: z.literal('aws'),
    sender: z.string().trim().min(1).max(120),
    config: z
      .object({
        region: req,
        access_key_id: req,
        secret_access_key: req,
        whatsapp_phone_number_id: opt,
        waba_id: opt,
        sms_origination: opt,
        dlt_entity_id: opt,
        configuration_set: opt,
      })
      .strict(),
  }),
])

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
  return { admin, tenantId, channel: channel.data }
}

async function state(tenantId: string, channel: 'sms' | 'whatsapp') {
  invalidateTenantSenders(tenantId)
  invalidateMessagingEntitlement(tenantId)
  const [senders, addon, entitlement] = await Promise.all([listTenantSenders(tenantId), getMessagingAddon(tenantId), messagingEntitlement(tenantId)])
  return { sender: senders.find(s => s.channel === channel) ?? null, addon, entitlement: entitlement[channel] }
}

export async function GET(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  return NextResponse.json(await state(g.tenantId, g.channel))
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
    await saveTenantSender({ tenantId: g.tenantId, channel: g.channel, provider, sender, config, createdBy: g.admin.adminId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the sender' }, { status: 400 })
  }
  return NextResponse.json(await state(g.tenantId, g.channel))
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  await deleteTenantSender(g.tenantId, g.channel)
  return NextResponse.json(await state(g.tenantId, g.channel))
}
