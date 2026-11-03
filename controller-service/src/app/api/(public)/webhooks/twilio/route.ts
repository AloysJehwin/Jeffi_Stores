import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { handleInboundWhatsApp } from '@controller/lib/support/inbound'
import { onCustomerMessage } from '@/lib/support/agent'
import { routeAdminWhatsApp } from '@controller/lib/admin-agent/whatsapp'

export const dynamic = 'force-dynamic'

// Inbound Twilio messages. WhatsApp from an admin's verified number goes to the admin assistant, the rest
// to the customer's support chat (the assistant answers; media lands in the Drive); SMS only carries
// STOP/START. A store's own number posts with ?t=<tenant>. Always answers with empty TwiML so Twilio doesn't retry.

const EMPTY_TWIML = '<Response></Response>'
const twiml = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } })

const STOP_CMDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_CMDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE'])

export async function POST(request: NextRequest) {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!authToken) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })

    const form = await request.formData()
    const params: Record<string, string> = {}
    for (const [key, value] of form.entries()) params[key] = typeof value === 'string' ? value : String(value)

    // Twilio signs the public URL it was configured with, not the internal one behind CloudFront.
    const tenantId = new URL(request.url).searchParams.get('t') || ''
    const base = process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL || 'https://jeffistores.in'
    const url = tenantId
      ? `${base.replace(/\/$/, '')}/api/webhooks/twilio?t=${encodeURIComponent(tenantId)}`
      : process.env.TWILIO_WEBHOOK_URL || 'https://jeffistores.in/api/webhooks/twilio'
    if (!twilio.validateRequest(authToken, request.headers.get('x-twilio-signature') || '', url, params)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const ctx = tenantId ? await lookupTenantContextById(tenantId).catch(() => null) : null
    if (tenantId && !ctx) return twiml()
    const run = () => handle(params)
    await (ctx ? runWithTenantContext(ctx, run) : run())
    return twiml()
  } catch (err) {
    console.error('[twilio] inbound failed', err instanceof Error ? err.message : err)
    return twiml()
  }
}

async function handle(params: Record<string, string>): Promise<void> {
  const from = params.From || ''
  const to = params.To || ''
  const body = params.Body || ''
  const sid = params.MessageSid || null

  if (/^whatsapp:/i.test(from)) {
    const n = Math.min(Number(params.NumMedia) || 0, 10)
    const media = Array.from({ length: n }, (_, i) => ({ ref: params[`MediaUrl${i}`], mime: params[`MediaContentType${i}`] || '' })).filter(m => m.ref)
    // An admin's verified number reaches the admin assistant instead, where the store has it on.
    if (await routeAdminWhatsApp({ providerSid: sid, from, to, text: body, hasMedia: media.length > 0, repliedToSid: params.OriginalRepliedMessageSid || null })) return
    const r = await handleInboundWhatsApp({ provider: 'twilio', providerSid: sid, from, to, text: body, profileName: params.ProfileName || null, media })
    // A swipe-reply quotes the message it answers, which ties it to that order or quotation.
    if (r) await onCustomerMessage(r.session, r.message, { repliedToSid: params.OriginalRepliedMessageSid || null, phone: from })
    return
  }

  // SMS: Twilio answers STOP itself; we only record the preference.
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
