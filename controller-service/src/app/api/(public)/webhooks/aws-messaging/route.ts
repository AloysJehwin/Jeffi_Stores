import { NextRequest, NextResponse } from 'next/server'
import { cloudInboundMedia, cloudInboundText, cloudWebhookValues } from '@jeffi/api-contracts'
import { confirmSnsSubscription, verifySns, type SnsEnvelope } from '@/lib/shared/messaging/sns'
import { applyDeliveryStatus } from '@/lib/shared/messaging/delivery-status'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { handleInboundWhatsApp } from '@/lib/support/inbound'
import { onCustomerMessage } from '@/lib/support/agent'
import { routeAdminWhatsApp } from '@/lib/admin-agent/whatsapp'

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
    const run = () => handle(env.Message)
    await (ctx ? runWithTenantContext(ctx, run) : run())
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[aws-messaging] event failed', err instanceof Error ? err.message : err)
    // SNS retries on 5xx; message handling is idempotent on the provider message id.
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
}

async function handle(raw: string): Promise<void> {
  let event: any
  try {
    event = JSON.parse(raw)
  } catch {
    return
  }

  if (event?.eventType && SMS_STATUS[event.eventType] && event.messageId) {
    await applyDeliveryStatus({ providerSid: event.messageId, status: SMS_STATUS[event.eventType], provider: 'aws', error: event.messageStatusDescription ?? null })
    return
  }
  if (!event?.whatsAppWebhookEntry) return

  for (const value of cloudWebhookValues(event.whatsAppWebhookEntry)) {
    const ours = value.metadata?.display_phone_number ? `+${value.metadata.display_phone_number.replace(/\D/g, '')}` : ''
    for (const st of value.statuses ?? []) {
      const error = st.errors?.[0] ? st.errors[0].title || st.errors[0].message || `Error ${st.errors[0].code}` : null
      await applyDeliveryStatus({ providerSid: st.id, status: st.status, provider: 'aws', error })
    }
    for (const m of value.messages ?? []) {
      if (m.type === 'reaction' || m.type === 'system' || m.type === 'unsupported') continue
      const media = cloudInboundMedia(m)
      const profile = value.contacts?.find(c => c.wa_id === m.from)?.profile?.name ?? null
      const from = `+${m.from.replace(/\D/g, '')}`
      if (await routeAdminWhatsApp({ providerSid: m.id, from, to: ours, text: cloudInboundText(m), hasMedia: !!media, repliedToSid: m.context?.id ?? null })) continue
      const r = await handleInboundWhatsApp({
        provider: 'aws',
        providerSid: m.id,
        from,
        to: ours,
        text: cloudInboundText(m),
        profileName: profile,
        media: media ? [{ ref: media.id, mime: media.mime, filename: media.filename ?? null }] : [],
      })
      if (r) await onCustomerMessage(r.session, r.message, { repliedToSid: m.context?.id ?? null, phone: m.from })
    }
  }
}
