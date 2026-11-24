import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { handleInboundWhatsApp } from '@controller/lib/support/inbound'
import { onCustomerMessage } from '@/lib/support/agent'
import { routeAdminWhatsApp } from '@controller/lib/admin-agent/whatsapp'
import { resolveInbound, type InboundTarget } from '@controller/lib/messaging/inbound-number'
import { routeOutreachWhatsApp } from '@controller/lib/outreach/inbound'

export const dynamic = 'force-dynamic'

// Inbound Twilio messages. The number messaged (To) says which store and audience: a store's admin number goes
// to the admin assistant (staff only, signed-in sessions), the flagship's ecom number to the team's support inbox,
// a customer number to the customer's support chat (the assistant answers; media lands in the Drive). A store still
// on one shared number keeps admins-to-the-assistant by their verified mobile. SMS only carries STOP/START. The
// legacy ?t=<tenant> hint still works. Always answers with empty TwiML so Twilio doesn't retry.

const EMPTY_TWIML = '<Response></Response>'
const twiml = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } })

const STOP_CMDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_CMDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE'])

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const params: Record<string, string> = {}
    for (const [key, value] of form.entries()) params[key] = typeof value === 'string' ? value : String(value)

    const hint = new URL(request.url).searchParams.get('t') || ''
    const channel = /^whatsapp:/i.test(params.From || '') ? 'whatsapp' : 'sms'
    const target = await resolveInbound(params.To || '', channel, hint || null)
    // Signed with the platform's token, or the store's own token when its number lives in its own Twilio account.
    const tokens = [process.env.TWILIO_AUTH_TOKEN, target.authToken].filter((t): t is string => !!t)
    if (!tokens.length) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    // Twilio signs the public URL it was configured with, not the internal one behind CloudFront.
    const base = process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL || 'https://jeffistores.in'
    const url = hint
      ? `${base.replace(/\/$/, '')}/api/webhooks/twilio?t=${encodeURIComponent(hint)}`
      : process.env.TWILIO_WEBHOOK_URL || 'https://jeffistores.in/api/webhooks/twilio'
    const signature = request.headers.get('x-twilio-signature') || ''
    if (!tokens.some(t => twilio.validateRequest(t, signature, url, params))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const ctx = target.tenantId ? await lookupTenantContextById(target.tenantId).catch(() => null) : null
    if (target.tenantId && !ctx) return twiml()
    const run = () => handle(params, target)
    await (ctx ? runWithTenantContext(ctx, run) : run())
    return twiml()
  } catch (err) {
    console.error('[twilio] inbound failed', err instanceof Error ? err.message : err)
    return twiml()
  }
}

async function handle(params: Record<string, string>, target: InboundTarget): Promise<void> {
  const from = params.From || ''
  const to = params.To || ''
  const body = params.Body || ''
  const sid = params.MessageSid || null

  if (/^whatsapp:/i.test(from)) {
    const n = Math.min(Number(params.NumMedia) || 0, 10)
    const media = Array.from({ length: n }, (_, i) => ({ ref: params[`MediaUrl${i}`], mime: params[`MediaContentType${i}`] || '' })).filter(m => m.ref)
    const repliedToSid = params.OriginalRepliedMessageSid || null
    // The admin number serves staff only; it never falls through to the customer chat.
    if (target.audience === 'admin') {
      await routeAdminWhatsApp({ providerSid: sid, from, to, text: body, hasMedia: media.length > 0, repliedToSid, receivedOn: 'admin' })
      return
    }
    // Store owners on the flagship's ecom number: the team answers from the support inbox, no shopper assistant.
    if (target.audience === 'ecom') {
      await handleInboundWhatsApp({ provider: 'twilio', providerSid: sid, from, to, text: body, profileName: params.ProfileName || null, media, audience: 'ecom' })
      return
    }
    // An owner the outreach program is talking to (flagship customer number): handled there, never by the shopper bot.
    if (!target.tenantId && (await routeOutreachWhatsApp({ from, text: body, providerMessageId: sid, hasMedia: media.length > 0 }))) return
    // On a shared number an admin's verified mobile still reaches the assistant, where the store has it on.
    if (await routeAdminWhatsApp({ providerSid: sid, from, to, text: body, hasMedia: media.length > 0, repliedToSid, receivedOn: 'customer', separateAdminNumber: target.separateAdminNumber })) return
    const r = await handleInboundWhatsApp({ provider: 'twilio', providerSid: sid, from, to, text: body, profileName: params.ProfileName || null, media })
    // A swipe-reply quotes the message it answers, which ties it to that order or quotation.
    if (r) await onCustomerMessage(r.session, r.message, { repliedToSid, phone: from })
    return
  }

  // SMS: Twilio answers STOP itself; we only record the preference, for the customer number.
  if (target.audience !== 'customer') return
  const number = from.trim()
  const last10 = number.replace(/\D/g, '').slice(-10)
  const user = last10
    ? await queryOne<{ id: string }>(`SELECT id FROM users WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1 LIMIT 1`, [last10])
    : null
  logMessage({ channel: 'sms', direction: 'inbound', to: to.trim(), from: number, body, kind: 'inbound', status: 'received', providerSid: sid, userId: user?.id ?? null })
  const cmd = body.trim().toUpperCase()
  if (user && (STOP_CMDS.has(cmd) || START_CMDS.has(cmd))) {
    await query(
      STOP_CMDS.has(cmd)
        ? 'UPDATE users SET marketing_opt_out = TRUE, marketing_opt_out_at = NOW() WHERE id = $1'
        : 'UPDATE users SET marketing_opt_out = FALSE, marketing_opt_out_at = NULL WHERE id = $1',
      [user.id]
    )
  }
}
