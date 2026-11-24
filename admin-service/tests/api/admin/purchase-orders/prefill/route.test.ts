import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/purchasing/prefill', () => ({
  duplicateLine: vi.fn((r: { id: string }) => ({ dup: r.id })),
  parsePrefillLines: vi.fn(),
  reorderLine: vi.fn((leaf: { name: string }, ps: unknown, qty: number) => ({ name: leaf.name, ps, qty })),
}))

import { GET } from '@admin/app/api/(admin)/admin/purchase-orders/prefill/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePrefillLines } from '@/lib/purchasing/prefill'

const PO = '11111111-1111-4111-8111-111111111111'
const SUP = '22222222-2222-4222-8222-222222222222'
const call = (qs: string) => GET(new NextRequest(`http://localhost/x${qs}`))

describe('GET /api/admin/purchase-orders/prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockReset()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the auth response without querying (needs inventory:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call(`?duplicate=${PO}`)).status).toBe(401)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'inventory:read')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid PO id or supplier', async () => {
    expect((await call('?duplicate=nope')).status).toBe(400)
    expect((await call('?supplier=nope&lines=a')).status).toBe(400)
  })

  it('returns 404 for an unknown PO to duplicate', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call(`?duplicate=${PO}`)).status).toBe(404)
  })

  it('seeds a new PO from an existing one with a copied-from note', async () => {
    vi.mocked(queryOne).mockResolvedValue({ supplier_id: 's1', notes: 'Rush', po_number: 'PO-7' })
    vi.mocked(queryMany).mockResolvedValue([{ id: 'i1' }, { id: 'i2' }])
    const body = await (await call(`?duplicate=${PO}`)).json()
    expect(body).toEqual({ supplier_id: 's1', notes: 'Rush\n(copied from PO-7)', lines: [{ dup: 'i1' }, { dup: 'i2' }] })
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual([PO])
  })

  it('uses a plain note when the source PO has none', async () => {
    vi.mocked(queryOne).mockResolvedValue({ supplier_id: 's1', notes: null, po_number: 'PO-7' })
    vi.mocked(queryMany).mockResolvedValue([])
    expect((await (await call(`?duplicate=${PO}`)).json()).notes).toBe('Copied from PO-7')
  })

  it('returns 400 when there is nothing to prefill', async () => {
    vi.mocked(parsePrefillLines).mockReturnValue([])
    expect((await call('?lines=')).status).toBe(400)
  })

  it('builds reorder lines, skipping unknown leaves and using the supplier price', async () => {
    vi.mocked(parsePrefillLines).mockReturnValue([
      { product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: 5 },
      { product_id: 'gone', variant_id: null, sub_variant_id: null, quantity: 1 },
    ] as never)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ name: 'Shoe' })
      .mockResolvedValueOnce({ unit_cost: '42' })
      .mockResolvedValueOnce(null)
    const body = await (await call(`?supplier=${SUP}&lines=x`)).json()
    expect(body).toEqual({ supplier_id: SUP, notes: null, lines: [{ name: 'Shoe', ps: { unit_cost: '42' }, qty: 5 }] })
    expect(vi.mocked(queryOne).mock.calls[1][1]).toEqual(['p1', 'v1', null, SUP])
  })

  it('skips the supplier price lookup without a supplier', async () => {
    vi.mocked(parsePrefillLines).mockReturnValue([{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: 2 }] as never)
    vi.mocked(queryOne).mockResolvedValueOnce({ name: 'Shoe' })
    const body = await (await call('?lines=x')).json()
    expect(body).toEqual({ supplier_id: null, notes: null, lines: [{ name: 'Shoe', ps: null, qty: 2 }] })
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when a query fails', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db'))
    expect((await call(`?duplicate=${PO}`)).status).toBe(500)
  })
})
