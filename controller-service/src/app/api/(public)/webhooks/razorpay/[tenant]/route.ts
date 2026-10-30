import { NextRequest, NextResponse } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { dispatchRazorpayEvent, TransientWebhookError, verifyRazorpaySignature } from '@/lib/payments/razorpay-events/dispatch'

/**
 * Own-key stores' Razorpay webhook. Events are signed with the store's OWN webhook secret; the store is
 * the URL slug and its DB is the only one written. Route events (transfer.*) never come from here.
 */
async function handle(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let ctx
  try {
    ctx = await lookupTenantContextBySlug(slug)
  } catch {
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
  if (!ctx) return NextResponse.json({ error: 'Unknown store' }, { status: 404 })
  const store = ctx

  return runWithTenantContext(store, async () => {
    let secret: string | undefined
    try {
      const creds = await resolveRazorpayCreds(store.tenantId)
      // Never accept the platform secret here: that would let platform-signed events bypass the index.
      secret = creds.isOwn ? creds.webhook_secret : undefined
    } catch {
      return NextResponse.json({ error: 'retry' }, { status: 503 })
    }
    if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 404 })
    if (!verifyRazorpaySignature(rawBody, signature, secret)) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    try {
      await dispatchRazorpayEvent(event, {
        source: 'own',
        store: { tenantId: store.tenantId, slug: store.slug, ctx: store },
        eventId: request.headers.get('x-razorpay-event-id'),
        accountId: event?.account_id ?? null,
      })
    } catch (err) {
      if (err instanceof TransientWebhookError) {
        console.error('[webhook:razorpay/tenant] retryable failure', { slug, event: event?.event, err })
        return NextResponse.json({ error: 'retry' }, { status: 503 })
      }
      console.error('[webhook:razorpay/tenant] handler failed', { slug, event: event?.event, err })
    }
    return NextResponse.json({ status: 'ok' })
  })
}

export const POST = (request: NextRequest, ctx: { params: Promise<{ tenant: string }> }) =>
  runWithAuditActor('razorpay', () => handle(request, ctx))
