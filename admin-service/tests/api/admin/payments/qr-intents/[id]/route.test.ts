import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/qr-intents', async () => ({
  ...(await vi.importActual<object>('@/lib/payments/qr-intents/types')),
  getQrIntent: vi.fn(),
  pollQrIntent: vi.fn(),
  qrIntentView: vi.fn(async (r: any) => ({ status: r.status, ...(r.result_ref ? { resultRef: r.result_ref } : {}) })),
}))

import { GET } from '@admin/app/api/(admin)/admin/payments/qr-intents/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getQrIntent, pollQrIntent } from '@/lib/payments/qr-intents'

const ADMIN = { adminId: 'a1', role: 'manager', scopes: ['quotations:write'] }
const get = (id = 'i1') => GET(new NextRequest(`http://localhost/api/admin/payments/qr-intents/${id}`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(getQrIntent).mockResolvedValue({ id: 'i1', kind: 'quotation_convert', status: 'pending' } as any)
})

describe('GET /api/admin/payments/qr-intents/[id]', () => {
  it('401 without a session, 404 for an unknown intent', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await get()).status).toBe(401)
    vi.mocked(getQrIntent).mockResolvedValueOnce(null)
    expect((await get()).status).toBe(404)
  })

  it('403 without the scope of the intent’s create call', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await get()).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', ['quotations:write'], 'quotations:write')
    expect(pollQrIntent).not.toHaveBeenCalled()
  })

  it('polls and answers the status, with the document once finalised', async () => {
    vi.mocked(pollQrIntent).mockResolvedValue({ id: 'i1', kind: 'quotation_convert', status: 'finalised', result_ref: 'o1' } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'finalised', resultRef: 'o1' })
    expect(pollQrIntent).toHaveBeenCalledWith('i1')
  })

  it('falls back to the stored row and 500s on a failure', async () => {
    vi.mocked(pollQrIntent).mockResolvedValueOnce(null)
    expect(await (await get()).json()).toEqual({ status: 'pending' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(pollQrIntent).mockRejectedValueOnce(new Error('db'))
    expect((await get()).status).toBe(500)
  })
})
