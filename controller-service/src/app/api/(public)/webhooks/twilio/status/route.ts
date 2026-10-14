import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { query } from '@/lib/shared/db'
import { debitMessageCost } from '@/lib/shared/messaging/billing'
import { usdToInr } from '@/lib/shared/messaging/pricing'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'

// Twilio delivery/price status callback. Debits the EXACT provider price (USD→INR) to the tenant
// wallet and records it on the message_logs row. Tenant id travels on ?t= (webhook has no Host).
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : String(v)

  const tenantId = new URL(request.url).searchParams.get('t') || ''
  const base = process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL || 'https://jeffistores.in'
  const url = `${base.replace(/\/$/, '')}/api/webhooks/twilio/status?t=${encodeURIComponent(tenantId)}`
  const sig = request.headers.get('x-twilio-signature') || ''
  if (!twilio.validateRequest(authToken, sig, url, params)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }

  const sid = params.MessageSid || params.SmsSid
  const status = params.MessageStatus || params.SmsStatus || ''
  const price = params.Price ? Number(params.Price) : 0
  const channel = (params.From || params.To || '').startsWith('whatsapp:') ? 'whatsapp' : 'sms'
  if (!sid || !tenantId) return new NextResponse(null, { status: 204 })

  const priceInr = price ? usdToInr(price) : 0

  try {
    if (priceInr > 0) {
      await debitMessageCost({ tenantId, channel, providerSid: sid, priceInr })
    }
    const ctx = await lookupTenantContextById(tenantId)
    if (ctx) {
      await runWithTenantContext(ctx, () =>
        query(
          `UPDATE message_logs SET delivery_status = $2, price = $3, currency = 'INR', priced_at = now(), provider = 'twilio'
           WHERE provider_sid = $1`,
          [sid, status, priceInr || null]
        )
      )
    }
    return new NextResponse(null, { status: 204 })
  } catch {
    // Let Twilio retry; the debit is idempotent on msg:<sid>.
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
}
