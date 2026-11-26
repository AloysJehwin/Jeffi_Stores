import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/qr-intents', async () => ({
  ...(await vi.importActual<object>('@/lib/payments/qr-intents/types')),
  createQrIntent: vi.fn(),
}))

import { POST } from '@admin/app/api/(admin)/admin/payments/qr-intents/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { createQrIntent, QrIntentError } from '@/lib/payments/qr-intents'

const ADMIN = { adminId: 'a1', role: 'manager', scopes: ['invoices:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/payments/qr-intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('POST /api/admin/payments/qr-intents', () => {
  it('401 without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await post({ kind: 'invoice', payload: {} })).status).toBe(401)
  })

  it('400 for an unknown kind', async () => {
    const res = await post({ kind: 'refund', payload: {} })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invoice, quotation_convert, invoice_draft_finalise, cash_sale/)
    expect(createQrIntent).not.toHaveBeenCalled()
  })

  it('checks the scope of the create call the kind stands in for', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await post({ kind: 'quotation_convert', payload: {} })).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', ['invoices:write'], 'quotations:write')
    await post({ kind: 'cash_sale', payload: {} })
    expect(hasScope).toHaveBeenLastCalledWith('manager', ['invoices:write'], 'invoices:write')
  })

  it('makes the intent as the admin and returns the QR, amount in rupees', async () => {
    const out = { intentId: 'i1', qrImageUrl: 'data:qr', amount: 118, expiresAt: '2026-11-27T10:15:00.000Z' }
    vi.mocked(createQrIntent).mockResolvedValue(out)
    const res = await post({ kind: 'invoice', payload: { customerName: 'Ravi' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(out)
    expect(createQrIntent).toHaveBeenCalledWith({ kind: 'invoice', payload: { customerName: 'Ravi' }, actor: ADMIN })
  })

  it('answers a refused payload with the create call’s status and message', async () => {
    vi.mocked(createQrIntent).mockRejectedValue(new QrIntentError('Not enough stock: Widget', 409, { insufficientItems: ['Widget'] }))
    const res = await post({ kind: 'invoice', payload: {} })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Not enough stock: Widget', insufficientItems: ['Widget'] })
  })

  it('500 on anything else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createQrIntent).mockRejectedValue(new Error('boom'))
    const res = await post({ kind: 'invoice', payload: {} })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
