import { describe, it, expect } from 'vitest'

// Retired: store plan subscriptions are workspace billing subscriptions, handled by the platform webhook
// (/api/webhooks/razorpay → lib/billing/webhook.ts; tests/lib/billing/webhook.test.ts). The old endpoint only
// acknowledges, so Razorpay doesn't disable it before the dashboard stops sending there.
import { POST } from '@controller/app/api/(ecom)/ecom/webhook/razorpay/route'

describe('POST /api/ecom/webhook/razorpay', () => {
  it('acknowledges without doing anything', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
  })
})
