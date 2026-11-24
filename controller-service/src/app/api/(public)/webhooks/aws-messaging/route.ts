import { NextRequest, NextResponse } from 'next/server'
import { cloudInboundMedia, cloudInboundText, cloudWebhookValues } from '@jeffi/api-contracts'
import { confirmSnsSubscription, verifySns, type SnsEnvelope } from '@controller/lib/shared/messaging/sns'
import { applyDeliveryStatus } from '@controller/lib/shared/messaging/delivery-status'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { handleInboundWhatsApp } from '@controller/lib/support/inbound'
import { onCustomerMessage } from '@/lib/support/agent'
import { routeAdminWhatsApp } from '@controller/lib/admin-agent/whatsapp'
import { resolveInbound } from '@controller/lib/messaging/inbound-number'
import { routeOutreachWhatsApp } from '@controller/lib/outreach/inbound'
import type { TenantContext } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AWS End User Messaging events over SNS: WhatsApp messages from customers (→ support chat) and
// delivery statuses (→ ticks and message_logs), plus SMS delivery events. A store's own number
// subscribes with ?t=<tenant>.

const SMS_STATUS: Record<string, string> = {
  TEXT_SUCCESSFUL: 'sent',
  TEXT_DELIVERED: 'delivered',
  TEXT_BLOCKED: 'failed',
  TEXT_INVALID: 'failed',
  TEXT_UNREACHABLE: 'failed',
  TEXT_CARRIER_UNREACHABLE: 'failed',
  TEXT_TTL_EXPIRED: 'failed',
  TEXT_SPAM: 'failed',
  TEXT_UNKNOWN: 'failed',
}

export async function POST(request: NextRequest) {
  let env: SnsEnvelope
  try {
    env = JSON.parse(await request.text())
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!(await verifySns(env))) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })

  if (env.Type === 'SubscriptionConfirmation') {
    return (await confirmSnsSubscription(env)) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: 'confirm failed' }, { status: 502 })
  }
  if (env.Type !== 'Notification') return new NextResponse(null, { status: 204 })

  const tenantId = request.nextUrl.searchParams.get('t') || ''
  const ctx = tenantId ? await lookupTenantContextById(tenantId).catch(() => null) : null
  if (tenantId && !ctx) return new NextResponse(null, { status: 204 })
  try {
    await handle(env.Message, ctx, tenantId || null)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[aws-messaging] event failed', err instanceof Error ? err.message : err)
    // SNS retries on 5xx; message handling is idempotent on the provider message id.
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
}

const inCtx = <T>(ctx: TenantContext | null, fn: () => Promise<T>) => (ctx ? runWithTenantContext(ctx, fn) : fn())

/** Statuses run in the `?t=` store's context; each inbound message in the context of the store that owns the number
 *  it was sent to (tenant_messaging_senders), falling back to the hint. */
async function handle(raw: string, hintCtx: TenantContext | null, hint: string | null): Promise<void> {
  let event: any
  try {
    event = JSON.parse(raw)
  } catch {
    return
  }

  if (event?.eventType && SMS_STATUS[event.eventType] && event.messageId) {
    await inCtx(hintCtx, () => applyDeliveryStatus({ providerSid: event.messageId, status: SMS_STATUS[event.eventType], provider: 'aws', error: event.messageStatusDescription ?? null }))
    return
  }
  if (!event?.whatsAppWebhookEntry) return

  for (const value of cloudWebhookValues(event.whatsAppWebhookEntry)) {
    const ours = value.metadata?.display_phone_number ? `+${value.metadata.display_phone_number.replace(/\D/g, '')}` : ''
    for (const st of value.statuses ?? []) {
      const error = st.errors?.[0] ? st.errors[0].title || st.errors[0].message || `Error ${st.errors[0].code}` : null
      await inCtx(hintCtx, () => applyDeliveryStatus({ providerSid: st.id, status: st.status, provider: 'aws', error }))
    }
    if (!value.messages?.length) continue
    const target = await resolveInbound(ours, 'whatsapp', hint)
    const ctx = target.tenantId ? await lookupTenantContextById(target.tenantId).catch(() => null) : null
    if (target.tenantId && !ctx) continue
    for (const m of value.messages) {
      if (m.type === 'reaction' || m.type === 'system' || m.type === 'unsupported') continue
      const media = cloudInboundMedia(m)
      const profile = value.contacts?.find(c => c.wa_id === m.from)?.profile?.name ?? null
      const from = `+${m.from.replace(/\D/g, '')}`
      const repliedToSid = m.context?.id ?? null
      const inbound = {
        provider: 'aws' as const,
        providerSid: m.id,
        from,
        to: ours,
        text: cloudInboundText(m),
        profileName: profile,
        media: media ? [{ ref: media.id, mime: media.mime, filename: media.filename ?? null }] : [],
      }
      await inCtx(ctx, async () => {
        // Same rules as the Twilio webhook: the admin number serves staff only, the ecom number goes to the team.
        if (target.audience === 'admin') {
          await routeAdminWhatsApp({ providerSid: m.id, from, to: ours, text: inbound.text, hasMedia: !!media, repliedToSid, receivedOn: 'admin' })
          return
        }
        if (target.audience === 'ecom') {
          await handleInboundWhatsApp({ ...inbound, audience: 'ecom' })
          return
        }
        // An owner the outreach program is talking to (flagship customer number): handled there, never by the shopper bot.
        if (!target.tenantId && (await routeOutreachWhatsApp({ from, text: inbound.text, providerMessageId: m.id, hasMedia: !!media }))) return
        if (await routeAdminWhatsApp({ providerSid: m.id, from, to: ours, text: inbound.text, hasMedia: !!media, repliedToSid, receivedOn: 'customer', separateAdminNumber: target.separateAdminNumber })) return
        const r = await handleInboundWhatsApp(inbound)
        if (r) await onCustomerMessage(r.session, r.message, { repliedToSid, phone: m.from })
      })
    }
  }
}
