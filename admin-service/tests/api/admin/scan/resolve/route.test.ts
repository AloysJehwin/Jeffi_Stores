import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/scan/resolve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }))
const mockQ = vi.mocked(queryOne)

describe('POST /api/admin/scan/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQ.mockReset()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ code: 'A' })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ code: 'A' })).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'quick_scan:write')
    expect(mockQ).not.toHaveBeenCalled()
  })

  it('returns 400 for a blank code', async () => {
    expect((await call({ code: '   ' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })

  it('resolves a product by SKU first', async () => {
    mockQ.mockResolvedValueOnce({ id: 'p1' })
    const body = await (await call({ code: ' sku-1 ' })).json()
    expect(body).toEqual({ kind: 'product', code: 'sku-1', item: { id: 'p1' } })
    expect(mockQ.mock.calls[0][1]).toEqual(['sku-1'])
  })

  it('resolves a variant by SKU when no product SKU matches', async () => {
    mockQ.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'v1' })
    expect((await (await call({ code: 'X' })).json()).kind).toBe('variant')
  })

  it('falls through barcode, variant GTIN and product GTIN in order', async () => {
    mockQ.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p2' })
    expect(await (await call({ code: 'B' })).json()).toMatchObject({ kind: 'product', item: { id: 'p2' } })
    mockQ.mockReset()
    mockQ.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'v3' })
    expect(await (await call({ code: 'G' })).json()).toMatchObject({ kind: 'variant', item: { id: 'v3' } })
    mockQ.mockReset()
    for (let i = 0; i < 4; i++) mockQ.mockResolvedValueOnce(null)
    mockQ.mockResolvedValueOnce({ id: 'p4' })
    expect((await (await call({ code: 'G2' })).json()).item).toEqual({ id: 'p4' })
  })

  it('resolves a serial number to the unit plus its priced product', async () => {
    for (let i = 0; i < 5; i++) mockQ.mockResolvedValueOnce(null)
    mockQ.mockResolvedValueOnce({ serial_id: 's1', product_id: 'p1', variant_id: null, sub_variant_id: 'sv1', status: 'in_stock' })
    mockQ.mockResolvedValueOnce({ id: 'p1', name: 'Shoe' })
    const body = await (await call({ code: 'SN1' })).json()
    expect(body.kind).toBe('serial')
    expect(body.serial.status).toBe('in_stock')
    expect(body.item).toEqual({ id: 'p1', name: 'Shoe', sub_variant_id: 'sv1' })
  })

  it('resolves a lot number to the batch grain with lot info', async () => {
    for (let i = 0; i < 6; i++) mockQ.mockResolvedValueOnce(null)
    mockQ.mockResolvedValueOnce({ batch_id: 'b1', lot_number: 'L9', variant_id: 'v1', product_id: 'p1', sub_variant_id: null, quantity_remaining: '12' })
    mockQ.mockResolvedValueOnce({ id: 'v1' })
    const body = await (await call({ code: 'L9' })).json()
    expect(body.kind).toBe('batch')
    expect(body.item).toMatchObject({ id: 'v1', lot_number: 'L9', batch_id: 'b1', batch_quantity_remaining: '12', sub_variant_id: null })
  })

  it('reports not_found when nothing matches', async () => {
    mockQ.mockResolvedValue(null)
    expect(await (await call({ code: 'ZZZ' })).json()).toEqual({ kind: 'not_found', code: 'ZZZ' })
  })

  it('returns 500 when a lookup fails', async () => {
    mockQ.mockRejectedValue(new Error('db'))
    expect((await call({ code: 'A' })).status).toBe(500)
  })
})
