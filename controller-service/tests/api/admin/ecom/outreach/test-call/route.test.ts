import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/worker', () => {
  class TestCallError extends Error {
    constructor(message: string, public status: number, public callId?: string) {
      super(message)
    }
  }
  return { startTestCall: m.start, TestCallError }
})

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/test-call/route'
import { TestCallError } from '@controller/lib/outreach/worker'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/outreach/test-call', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.start.mockResolvedValue({ callId: '11111111-1111-4111-8111-111111111111' })
})

describe('POST /api/admin/ecom/outreach/test-call', () => {
  it('refuses a store admin: no outreach scope, or not the platform administrator', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await post({ phone: '9876543210' })).status).toBe(403)
    // a store admin holding the scope by some grant is still not the platform admin
    vi.mocked(requireAdminScope).mockResolvedValueOnce({ adminId: 's1', role: 'store_admin', scopes: ['ecom_outreach:write'] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValueOnce(false)
    expect((await post({ phone: '9876543210' })).status).toBe(403)
    expect(m.start).not.toHaveBeenCalled()
  })

  it('401 without a session', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post({ phone: '9876543210' })).status).toBe(401)
  })

  it('validates the phone and language', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ phone: '12345' })).status).toBe(400)
    expect((await post({ phone: '9876543210', language: 'fr' })).status).toBe(400)
    expect(m.start).not.toHaveBeenCalled()
  })

  it('starts the test call with the normalized number, under ecom_outreach:write', async () => {
    const r = await post({ phone: '098765 43210', language: 'ta' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ callId: '11111111-1111-4111-8111-111111111111' })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.start).toHaveBeenCalledWith(expect.objectContaining({ phone: '+919876543210', language: 'ta', program: 'showcase-offer' }), 'admin:a1')
  })

  it('maps lib refusals to their status', async () => {
    m.start.mockRejectedValueOnce(new TestCallError("Only the program's test numbers can get a test call", 403))
    const r = await post({ phone: '9876543210' })
    expect(r.status).toBe(403)
    expect((await r.json()).error).toContain('test numbers')
    m.start.mockRejectedValueOnce(new TestCallError('twilio refused', 502, 'c1'))
    const r2 = await post({ phone: '9876543210' })
    expect(r2.status).toBe(502)
    expect(await r2.json()).toEqual({ error: 'twilio refused', callId: 'c1' })
    m.start.mockRejectedValueOnce(new Error('db down'))
    expect((await post({ phone: '9876543210' })).status).toBe(500)
  })
})
