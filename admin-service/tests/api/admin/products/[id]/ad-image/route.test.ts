import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/social/card', () => ({ renderProductCard: vi.fn(), persistCardToBucket: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  currentBrandNameAsync: vi.fn(async () => 'Jeffi'),
  storeBaseUrlAsync: vi.fn(async () => 'https://shop.example.com'),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/products/[id]/ad-image/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { renderProductCard, persistCardToBucket } from '@/lib/social/card'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const get = () => GET(new NextRequest('http://localhost/x'), ctx)
const post = () => POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx)
const product = { id: 'p1', name: 'Shoe', slug: 'shoe', base_price: '1000', price_ex_gst: '800', primary_image: 'i.png' }

describe('/api/admin/products/[id]/ad-image', () => {
  const oldBucket = process.env.S3_BUCKET_NAME
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(queryOne).mockResolvedValue(product)
    vi.mocked(renderProductCard).mockResolvedValue(Buffer.from('png') as never)
    process.env.S3_BUCKET_NAME = 'bkt'
  })
  afterEach(() => {
    if (oldBucket === undefined) delete process.env.S3_BUCKET_NAME
    else process.env.S3_BUCKET_NAME = oldBucket
  })

  describe('GET', () => {
    it('returns 401 and 404', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await get()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(queryOne).mockResolvedValue(null)
      expect((await get()).status).toBe(404)
    })

    it('renders a card with the sale price and the original price struck', async () => {
      const res = await get()
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(res.headers.get('Content-Disposition')).toContain('jeffi-ad-shoe.png')
      expect(renderProductCard).toHaveBeenCalledWith({
        product: { name: 'Shoe', slug: 'shoe', displayPrice: 800, originalPrice: 1000, primaryImage: 'i.png' },
        brand: { name: 'Jeffi', url: 'shop.example.com' },
      })
    })

    it('falls back to the base price with no original price', async () => {
      vi.mocked(queryOne).mockResolvedValue({ ...product, price_ex_gst: null, primary_image: null })
      await get()
      expect(vi.mocked(renderProductCard).mock.calls[0][0].product).toMatchObject({ displayPrice: 1000, originalPrice: null, primaryImage: null })
    })

    it('propagates a render failure', async () => {
      vi.mocked(renderProductCard).mockRejectedValue(new Error('render'))
      await expect(get()).rejects.toThrow('render')
    })
  })

  describe('POST', () => {
    it('returns 401, 500 without a bucket, and 404', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await post()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      delete process.env.S3_BUCKET_NAME
      expect((await post()).status).toBe(500)
      process.env.S3_BUCKET_NAME = 'bkt'
      vi.mocked(queryOne).mockResolvedValue(null)
      expect((await post()).status).toBe(404)
    })

    it('stores the card under a timestamped key and returns its URL', async () => {
      vi.mocked(persistCardToBucket).mockResolvedValue('https://cdn/card.png' as never)
      const res = await post()
      expect(await res.json()).toEqual({ url: 'https://cdn/card.png' })
      const [, opts] = vi.mocked(persistCardToBucket).mock.calls[0]
      expect(opts.bucket).toBe('bkt')
      expect(opts.key).toMatch(/^social-cards\/shoe-\d+\.png$/)
    })
  })
})
