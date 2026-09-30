import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: true }),
}))
vi.mock('@/lib/product-cards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/product-cards')>()),
  getProductCardsByIds: vi.fn(),
}))

import { GET } from '@/app/api/account/buy-again/route'
import { authenticateAnyUser } from '@/lib/jwt'
import { queryMany } from '@/lib/db'
import { getProductCardsByIds } from '@/lib/product-cards'
import { getFeatureFlags } from '@/lib/site-controls'

const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
const P1 = '550e8400-e29b-41d4-a716-446655440010'
const P2 = '550e8400-e29b-41d4-a716-446655440011'

function card(id: string) {
  return {
    id,
    name: `Product ${id.slice(-2)}`,
    slug: `product-${id.slice(-2)}`,
    has_variants: false,
    base_price: '118.00',
    price_ex_gst: '100.00',
    mrp: '150.00',
    gst_percentage: '18',
    stock_status: 'In Stock',
    cost_price: '60.00',
    inventory_quantity: '42.000',
    product_images: [
      {
        id: 'img-1',
        s3_key: 'products/secret.jpg',
        image_url: 'https://cdn/x.jpg',
        thumbnail_url: 'https://cdn/x-t.jpg',
        blurhash: 'LEHV6n',
        is_primary: true,
      },
    ],
    brands: { id: 'b1', name: 'Taparia' },
    categories: { id: 'c1', name: 'Screws', slug: 'screws' },
  }
}

function get() {
  return GET(new Request('http://localhost/api/account/buy-again') as any)
}

beforeEach(() => {
  vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true } as any)
})

describe('GET /api/account/buy-again', () => {
  it('returns 401 for a signed-out visitor without touching the database', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
    expect(queryMany).not.toHaveBeenCalled()
  })

  it("reads only the signed-in customer's non-cancelled orders, newest first, active products only", async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockResolvedValue([])

    await get()

    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('o.user_id = $1')
    expect(sql).toContain("o.status NOT IN ('draft', 'cancelled', 'cancel_requested')")
    expect(sql).toContain('p.is_active = true')
    expect(sql).toContain('GROUP BY oi.product_id')
    expect(sql).toContain('ORDER BY MAX(o.created_at) DESC')
    expect(params).toEqual([USER_ID, 12])
  })

  it('returns an empty list, and skips the card lookup, when nothing was ordered', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockResolvedValue([])

    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ products: [] })
    expect(getProductCardsByIds).not.toHaveBeenCalled()
  })

  it('returns ProductCard props only, in order, with the image stripped to display fields', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockResolvedValue([{ product_id: P2 }, { product_id: P1 }])
    vi.mocked(getProductCardsByIds).mockResolvedValue([card(P2), card(P1)])

    const res = await get()
    const body = await res.json()

    expect(getProductCardsByIds).toHaveBeenCalledWith([P2, P1], true)
    expect(body.products.map((p: any) => p.id)).toEqual([P2, P1])
    expect(body.products[0]).toMatchObject({ displayPrice: 118, brandName: 'Taparia', categoryName: 'Screws' })
    expect(body.products[0].primaryImage).toEqual({
      image_url: 'https://cdn/x.jpg',
      thumbnail_url: 'https://cdn/x-t.jpg',
      blurhash: 'LEHV6n',
    })
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('cost_price')
    expect(raw).not.toContain('inventory_quantity')
    expect(raw).not.toContain('s3_key')
  })

  it('returns 500 when the query fails', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await get()
    expect(res.status).toBe(500)
  })
})
