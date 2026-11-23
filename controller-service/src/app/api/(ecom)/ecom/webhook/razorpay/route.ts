import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Retired: store plan subscriptions are workspace billing subscriptions now, handled by the platform webhook
// (/api/webhooks/razorpay → lib/billing/webhook.ts) through razorpay_subscription_index. Acknowledged so Razorpay
// doesn't disable the endpoint until the dashboard stops sending here.
export async function POST() {
  return NextResponse.json({ ok: true, ignored: true })
}
