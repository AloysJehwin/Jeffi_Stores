import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAuditActor } from '@/lib/auth/audit-context'

const handleUpiWebhook = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiWebhook }))

import { POST } from '@storefront/app/api/(public)/webhooks/upi/route'

// The callback auth check (SHA-256 of the account credentials) and replay handling live in
// handlePhonePeCallback; this route only scopes the call to the platform account and attributes it.
describe('POST /api/webhooks/upi', () => {
  let actor: string | null
  beforeEach(() => {
    actor = null
    handleUpiWebhook.mockImplementation(async () => {
      actor = getCurrentAuditActor()
      return NextResponse.json({ ok: true })
    })
  })

  const post = () => POST(new NextRequest('http://localhost/api/webhooks/upi', { method: 'POST', body: '{}' }))

  it('hands the request to the platform-scope handler under the phonepe audit actor', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpiWebhook).toHaveBeenCalledTimes(1)
    expect(handleUpiWebhook.mock.calls[0]).toHaveLength(1)
    expect(actor).toBe('phonepe')
  })

  it('passes a rejected-signature response from the handler through', async () => {
    handleUpiWebhook.mockResolvedValue(NextResponse.json({ error: 'Invalid authorization' }, { status: 400 }))
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid authorization')
  })

  it('does not leak the audit actor outside the call', async () => {
    await post()
    expect(getCurrentAuditActor()).toBeNull()
  })
})
