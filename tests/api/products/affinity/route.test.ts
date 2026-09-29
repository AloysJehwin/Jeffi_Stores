import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/product-affinity', () => ({ frequentlyBoughtWith: vi.fn(), alsoViewedWith: vi.fn() }))
vi.mock('@/lib/product-cards', async () => {
  const props = await vi.importActual<typeof import('@/lib/product-card-props')>('@/lib/product-card-props')
  return { getProductCardsByIds: vi.fn(), cardPropsFor: props.cardPropsFor }
})
vi.mock('@/lib/site-controls', () => ({ getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: true }) }))

import { GET } from '@/app/api/products/affinity/route'
import { frequentlyBoughtWith, alsoViewedWith } from '@/lib/product-affinity'
import { getProductCardsByIds } from '@/lib/product-cards'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'
const req = (qs: string) => new NextRequest(`http://localhost/api/products/affinity?${qs}`)

const row = (id: string) => ({
  id, name: `P ${id.slice(0, 2)}`, slug: id, has_variants: false, base_price: 100, mrp: 150, stock_status: 'In Stock',
  cost_price: 40, supplier_id: 'secret',
  product_images: [{ image_url: 'https://cdn/x.png', thumbnail_url: 'https://cdn/t.png', s3_key: 'k', is_primary: true }],
})

beforeEach(() => vi.clearAllMocks())

describe('GET /api/products/affinity', () => {
  it('400s on a missing kind, missing ids or a malformed id', async () => {
    expect((await GET(req(`ids=${A}`))).status).toBe(400)
    expect((await GET(req('kind=bought'))).status).toBe(400)
    expect((await GET(req('kind=bought&ids=nope'))).status).toBe(400)
  })

  it('returns card fields only, never raw product columns or storage keys', async () => {
    vi.mocked(frequentlyBoughtWith).mockResolvedValue([B])
    vi.mocked(getProductCardsByIds).mockResolvedValue([row(B)])
    const body = await (await GET(req(`kind=bought&ids=${A}&limit=4`))).json()
    expect(body.products).toHaveLength(1)
    const card = body.products[0]
    expect(card).toMatchObject({ id: B, displayPrice: 100, mrp: 150 })
    expect(card).not.toHaveProperty('cost_price')
    expect(card).not.toHaveProperty('supplier_id')
    expect(card.primaryImage).toEqual({ image_url: 'https://cdn/x.png', thumbnail_url: 'https://cdn/t.png', blurhash: null })
  })

  it('drops excluded products and still fills the limit', async () => {
    vi.mocked(frequentlyBoughtWith).mockResolvedValue([B, C])
    vi.mocked(getProductCardsByIds).mockResolvedValue([row(C)])
    await GET(req(`kind=bought&ids=${A}&exclude=${B}&limit=1`))
    expect(frequentlyBoughtWith).toHaveBeenCalledWith([A], 2)
    expect(getProductCardsByIds).toHaveBeenCalledWith([C], true)
  })

  it('uses co-views for kind=viewed', async () => {
    vi.mocked(alsoViewedWith).mockResolvedValue([])
    vi.mocked(getProductCardsByIds).mockResolvedValue([])
    await GET(req(`kind=viewed&ids=${A},${B}`))
    expect(alsoViewedWith).toHaveBeenCalledWith(A, 8)
  })

  it('answers with an empty list when the lookup fails', async () => {
    vi.mocked(frequentlyBoughtWith).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req(`kind=bought&ids=${A}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ products: [] })
    err.mockRestore()
  })
})
