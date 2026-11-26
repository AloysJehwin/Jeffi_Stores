import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/qr-intents', async () => ({
  ...(await vi.importActual<object>('@/lib/payments/qr-intents/types')),
  getQrIntent: vi.fn(),
  cancelQrIntent: vi.fn(),
  qrIntentView: vi.fn(async (r: any) => ({ status: r.status, ...(r.error ? { error: r.error } : {}) })),
}))

import { POST } from '@admin/app/api/(admin)/admin/payments/qr-intents/[id]/cancel/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { cancelQrIntent, getQrIntent } from '@/lib/payments/qr-intents'

const ADMIN = { adminId: 'a1', role: 'manager', scopes: ['invoices:write'] }
const cancel = (id = 'i1') =>
  POST(new NextRequest(`http://localhost/api/admin/payments/qr-intents/${id}/cancel`, { method: 'POST' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(getQrIntent).mockResolvedValue({ id: 'i1', kind: 'cash_sale', status: 'pending' } as any)
})

describe('POST /api/admin/payments/qr-intents/[id]/cancel', () => {
  it('401, 404 and 403 before anything is closed', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await cancel()).status).toBe(401)
    vi.mocked(getQrIntent).mockResolvedValueOnce(null)
    expect((await cancel()).status).toBe(404)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await cancel()).status).toBe(403)
    expect(cancelQrIntent).not.toHaveBeenCalled()
  })

  it('closes the QR and cancels', async () => {
    vi.mocked(cancelQrIntent).mockResolvedValue({ id: 'i1', kind: 'cash_sale', status: 'cancelled' } as any)
    const res = await cancel()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'cancelled' })
    expect(cancelQrIntent).toHaveBeenCalledWith('i1')
  })

  it('an already expired intent is fine', async () => {
    vi.mocked(cancelQrIntent).mockResolvedValue({ id: 'i1', kind: 'cash_sale', status: 'expired' } as any)
    expect((await cancel()).status).toBe(200)
  })

  it('409 with the status when it was paid first', async () => {
    vi.mocked(cancelQrIntent).mockResolvedValue({ id: 'i1', kind: 'cash_sale', status: 'finalised' } as any)
    const res = await cancel()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ status: 'finalised', error: 'This payment is already finalised' })

    vi.mocked(cancelQrIntent).mockResolvedValue(null)
    vi.mocked(getQrIntent).mockResolvedValue({ id: 'i1', kind: 'cash_sale', status: 'failed', error: 'Not enough stock' } as any)
    expect(await (await cancel()).json()).toEqual({ status: 'failed', error: 'Not enough stock' })
  })

  it('500 on a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(cancelQrIntent).mockRejectedValue(new Error('razorpay'))
    expect((await cancel()).status).toBe(500)
  })
})
