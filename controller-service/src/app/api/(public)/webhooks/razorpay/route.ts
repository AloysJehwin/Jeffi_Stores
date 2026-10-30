import { NextRequest, NextResponse } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { dispatchRazorpayEvent, TransientWebhookError, verifyRazorpaySignature } from '@/lib/payments/razorpay-events/dispatch'

/**
 * The platform Razorpay account's webhook. It hits one fixed URL with no store host, so each handler
 * finds the store from the event and writes inside it. Own-key stores use /webhooks/razorpay/[tenant].
 */
async function handle(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  if (!verifyRazorpaySignature(rawBody, signature, secret)) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })

  try {
    const event = JSON.parse(rawBody)
    await dispatchRazorpayEvent(event, {
      source: 'platform',
      store: null,
      eventId: request.headers.get('x-razorpay-event-id'),
      accountId: event?.account_id ?? null,
    })
  } catch (err) {
    // Razorpay disables a webhook that keeps failing, so only a retryable failure gets a 5xx.
    if (err instanceof TransientWebhookError) return NextResponse.json({ error: 'retry' }, { status: 503 })
    console.error('[webhook:razorpay] handler failed', err)
  }
  return NextResponse.json({ status: 'ok' })
}

export const POST = (request: NextRequest) => runWithAuditActor('razorpay', () => handle(request))
