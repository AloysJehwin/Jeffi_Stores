import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAuditActor } from '@/lib/auth/audit-context'

const handleUpiWebhook = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiWebhook }))

import { POST } from '@storefront/app/api/(public)/webhooks/upi/[tenant]/route'

// Per-store credential verification is inside handleUpiWebhook(request, slug); this route passes the slug.
describe('POST /api/webhooks/upi/[tenant]', () => {
  let actor: string | null
  beforeEach(() => {
    actor = null
    handleUpiWebhook.mockImplementation(async () => {
      actor = getCurrentAuditActor()
      return NextResponse.json({ ok: true })
    })
  })

  const post = (tenant = 'acme') =>
    POST(new NextRequest(`http://localhost/api/webhooks/upi/${tenant}`, { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ tenant }),
    })

  it('passes the store slug to the handler under the phonepe audit actor', async () => {
    const res = await post('acme')
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpiWebhook).toHaveBeenCalledWith(expect.any(NextRequest), 'acme')
    expect(actor).toBe('phonepe')
  })

  it('passes an unknown-store response through', async () => {
    handleUpiWebhook.mockResolvedValue(NextResponse.json({ error: 'Unknown store' }, { status: 404 }))
    expect((await post('ghost')).status).toBe(404)
  })

  it('passes a bad-credentials response through', async () => {
    handleUpiWebhook.mockResolvedValue(NextResponse.json({ error: 'Invalid authorization' }, { status: 400 }))
    expect((await post()).status).toBe(400)
  })
})
