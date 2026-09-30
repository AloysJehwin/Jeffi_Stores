import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { logActivity } from '@/lib/shared/activity'
import { sendFreeTextWhatsApp, sendSupportAckWhatsApp } from '@/lib/shared/whatsapp'
import { currentBrandNameAsync } from '@/lib/catalog/brand'

export const dynamic = 'force-dynamic'

// Empty TwiML: acknowledges receipt without sending a reply. Returned in all
// paths (including errors) so Twilio does not retry the webhook.
const EMPTY_TWIML = '<Response></Response>'

function twiml(): NextResponse {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

const STOP_CMDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_CMDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE', 'YES'])

// Strip the whatsapp: prefix to get a bare E.164 number.
function stripChannelPrefix(addr: string): string {
  return addr.replace(/^whatsapp:/i, '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-twilio-signature')

    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!authToken) {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    // Inbound Twilio webhooks are application/x-www-form-urlencoded.
    const form = await request.formData()
    const params: Record<string, string> = {}
    for (const [key, value] of form.entries()) {
      params[key] = typeof value === 'string' ? value : String(value)
    }

    // Twilio signs against the exact configured public URL, NOT the internal
    // request URL (which differs behind CloudFront).
    const url = process.env.TWILIO_WEBHOOK_URL || 'https://jeffistores.in/api/webhooks/twilio'
    const valid = twilio.validateRequest(authToken, signature || '', url, params)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const fromRaw = params.From || ''
    const toRaw = params.To || ''
    const body = params.Body || ''
    const messageSid = params.MessageSid || null

    const isWhatsApp = /^whatsapp:/i.test(fromRaw)
    const channel: 'whatsapp' | 'sms' = isWhatsApp ? 'whatsapp' : 'sms'
    const customerNumber = stripChannelPrefix(fromRaw)
    const ourNumber = stripChannelPrefix(toRaw)

    // Match user by phone: stored phone may be 10-digit local or +91 E.164.
    // Compare on the last-10-digit form.
    const digits = customerNumber.replace(/\D/g, '')
    const last10 = digits.slice(-10)
    const matchedUser = last10
      ? await queryOne<{ id: string; marketing_opt_out: boolean }>(
          `SELECT id, marketing_opt_out FROM users
           WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
           LIMIT 1`,
          [last10]
        )
      : null
    const userId = matchedUser?.id ?? null

    // Log the inbound message.
    logMessage({
      channel,
      direction: 'inbound',
      to: ourNumber,
      from: customerNumber,
      body,
      kind: 'inbound',
      status: 'received',
      providerSid: messageSid,
      userId,
    })

    const cmd = (body || '').trim().toUpperCase()
    const brand = await currentBrandNameAsync()

    if (STOP_CMDS.has(cmd)) {
      if (userId) {
        await query('UPDATE users SET marketing_opt_out = TRUE, marketing_opt_out_at = NOW() WHERE id = $1', [userId])
      }
      if (channel === 'whatsapp') {
        // SMS STOP is auto-handled by Twilio; only reply on WhatsApp.
        await sendFreeTextWhatsApp({
          phone: customerNumber,
          body: `${brand}: You have been unsubscribed from promotional messages. Reply START to resubscribe.`,
        })
      }
      return twiml()
    }

    if (START_CMDS.has(cmd)) {
      if (userId) {
        await query('UPDATE users SET marketing_opt_out = FALSE, marketing_opt_out_at = NULL WHERE id = $1', [userId])
      }
      if (channel === 'whatsapp') {
        await sendFreeTextWhatsApp({
          phone: customerNumber,
          body: `${brand}: You are resubscribed. Reply STOP to opt out anytime.`,
        })
      }
      return twiml()
    }

    // Real support message: only when a user matched and channel is WhatsApp.
    if (userId && channel === 'whatsapp') {
      let session = await queryOne<{ id: string }>(
        `SELECT id FROM support_sessions
         WHERE user_id = $1 AND status = 'open'
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      )

      let isNewSession = false
      if (!session) {
        session = await queryOne<{ id: string }>(
          `INSERT INTO support_sessions (user_id, status)
           VALUES ($1, 'open') RETURNING id`,
          [userId]
        )
        isNewSession = true
      }

      if (session) {
        await query(
          `INSERT INTO support_messages (session_id, sender, message)
           VALUES ($1, 'customer', $2)`,
          [session.id, body]
        )

        logActivity({
          userId,
          kind: 'support_message',
          summary: 'Customer message via WhatsApp',
          metadata: { channel: 'whatsapp' },
        }).catch(() => {})

        // Auto-ack once per NEW session only.
        if (isNewSession) {
          await sendSupportAckWhatsApp({ phone: customerNumber })
        }
      }
    }

    return twiml()
  } catch {
    // Return 200 empty TwiML on any unexpected error to avoid Twilio retries.
    return twiml()
  }
}
