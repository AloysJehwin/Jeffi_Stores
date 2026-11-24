import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@jeffi/list-filters', () => ({ normalizeQuery: vi.fn(() => ({ normalised: true })) }))
vi.mock('@/lib/admin/wallet-ledger', () => ({ listWalletLedger: vi.fn() }))
vi.mock('@/lib/filters/entities/wallet', () => ({ WALLET_ENTITY: { id: 'wallet' } }))

import { GET } from '@admin/app/api/(admin)/admin/financial/wallet/topup/ledger/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listWalletLedger } from '@/lib/admin/wallet-ledger'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/financial/wallet/topup/ledger${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('GET /api/admin/financial/wallet/topup/ledger', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'delhivery:read')
    expect(listWalletLedger).not.toHaveBeenCalled()
  })

  it('lists page 1 with 50 rows by default', async () => {
    vi.mocked(listWalletLedger).mockResolvedValue({ rows: [{ id: 'l1' }], total: 1 } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ page: 1, rows: [{ id: 'l1' }], total: 1 })
    expect(listWalletLedger).toHaveBeenCalledWith({ normalised: true }, 1, 50, expect.any(URLSearchParams))
  })

  it('clamps a bad page to 1 and honours a valid one', async () => {
    vi.mocked(listWalletLedger).mockResolvedValue({ rows: [] } as any)
    await GET(req('?page=-4'))
    expect(vi.mocked(listWalletLedger).mock.calls[0][1]).toBe(1)
    const res = await GET(req('?page=3'))
    expect((await res.json()).page).toBe(3)
    expect(vi.mocked(listWalletLedger).mock.calls[1][1]).toBe(3)
  })

  it('returns 500 when the ledger fails to load', async () => {
    vi.mocked(listWalletLedger).mockRejectedValue(new Error('db'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load the ledger' })
  })
})
