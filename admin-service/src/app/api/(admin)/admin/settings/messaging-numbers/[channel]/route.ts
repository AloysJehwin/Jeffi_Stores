import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import {
  PLATFORM_TENANT_ID, audiencesFor, deleteTenantSender, invalidateTenantSenders, isSenderAudience, listTenantSenders, saveTenantSender,
} from '@/lib/messaging/tenant-senders'
import { FlagshipSenderPutSchema } from '@/lib/messaging/sender-schema'

export const dynamic = 'force-dynamic'

// The flagship's own numbers (Settings → Numbers): customer-facing (shoppers), admin-facing (staff) and the ecom
// portal's (store owners), per channel. Only the flagship's administrator, on the flagship. A store's numbers are
// set by the platform administrator in the ecom pages; the store sees them read-only. Credentials are stored
// encrypted and never returned.

const Channel = z.enum(['sms', 'whatsapp'])

type Params = { params: Promise<{ channel: string }> }

async function gate(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role) || !hasScope(admin.role, admin.scopes, 'settings:write'))
    return NextResponse.json({ error: 'Only the administrator can change the numbers' }, { status: 403 })
  const tenantId = (await resolveTenantId().catch(() => null)) ?? PLATFORM_TENANT_ID
  if (tenantId !== PLATFORM_TENANT_ID) return NextResponse.json({ error: "A store's numbers are assigned by the platform" }, { status: 403 })
  const channel = Channel.safeParse((await params).channel)
  if (!channel.success) return NextResponse.json({ error: 'Unknown channel' }, { status: 400 })
  const audience = request.nextUrl.searchParams.get('audience') || 'customer'
  if (!isSenderAudience(audience) || !audiencesFor(PLATFORM_TENANT_ID).includes(audience)) return NextResponse.json({ error: 'Unknown audience' }, { status: 400 })
  return { admin, channel: channel.data, audience }
}

async function state(channel: 'sms' | 'whatsapp', audience: string) {
  invalidateTenantSenders(PLATFORM_TENANT_ID)
  const senders = await listTenantSenders(PLATFORM_TENANT_ID)
  return { sender: senders.find(s => s.channel === channel && s.audience === audience) ?? null }
}

export async function GET(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  return NextResponse.json(await state(g.channel, g.audience))
}

export async function PUT(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  const parsed = parseBody(FlagshipSenderPutSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { provider, sender, config } = parsed.data
  if (provider === 'aws' && g.channel === 'whatsapp' && !(config as Record<string, string | undefined>).whatsapp_phone_number_id)
    return NextResponse.json({ error: 'AWS WhatsApp needs the phone number id.' }, { status: 400 })
  try {
    await saveTenantSender({ tenantId: PLATFORM_TENANT_ID, channel: g.channel, audience: g.audience, provider, sender, config, createdBy: g.admin.adminId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not save the number' }, { status: 400 })
  }
  return NextResponse.json(await state(g.channel, g.audience))
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const g = await gate(request, ctx)
  if (g instanceof NextResponse) return g
  await deleteTenantSender(PLATFORM_TENANT_ID, g.channel, g.audience)
  return NextResponse.json(await state(g.channel, g.audience))
}
