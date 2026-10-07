import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { isSubscriptionEvent, processSubscriptionEvent } from '@/lib/subscriptions/cycle'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

/**
 * Own-key tenants' Razorpay webhook. Events are signed with the tenant's OWN webhook secret and
 * never touch the platform index; the tenant is the URL slug and its DB is the only one written.
 * Only subscription events are handled here; anything else is acked.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
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

  return runWithTenantContext(ctx, async () => {
    let secret: string | undefined
    try {
      const creds = await resolveRazorpayCreds(ctx.tenantId)
      // Never accept the platform secret here: that would let platform-signed events bypass the index.
      secret = creds.isOwn ? creds.webhook_secret : undefined
    } catch {
      return NextResponse.json({ error: 'retry' }, { status: 503 })
    }
    if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 404 })

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (!safeEqual(expected, signature)) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    const eventType = String(event?.event ?? '')
    if (!isSubscriptionEvent(eventType)) return NextResponse.json({ status: 'ok' })

    try {
      await processSubscriptionEvent(eventType, event, { tenantId: ctx.tenantId, slug: ctx.slug })
    } catch (err) {
      console.error('[webhook:razorpay/tenant] subscription handler failed', { slug, eventType, err })
      return NextResponse.json({ error: 'retry' }, { status: 503 })
    }
    return NextResponse.json({ status: 'ok' })
  })
}
