import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryManyMock } = vi.hoisted(() => ({
  queryManyMock: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: queryManyMock,
  queryCount: vi.fn(),
}))

vi.mock('@/lib/shared/google-merchant-helpers', () => ({
  getGoogleProductCategory: vi.fn().mockReturnValue('Hardware > Fasteners'),
  buildProductType: vi.fn().mockReturnValue('Bolts > Hex Bolts'),
  buildProductHighlights: vi.fn().mockReturnValue(['Made of steel']),
  buildProductDetails: vi.fn().mockReturnValue([]),
  buildCustomLabels: vi.fn().mockReturnValue(['label0', '', '', '', '']),
}))

// ── import module AFTER mocks ────────────────────────────────────────────────
import * as feedModule from '@/app/api/(public)/feed/google/route'
const { GET } = feedModule

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(token?: string) {
  const url = new URL('http://localhost/api/feed/google')
  if (token) url.searchParams.set('token', token)
  return new Request(url.toString())
}

// Minimal product without variants
const simpleProduct = {
  id: 'prod-1',
  name: 'Hex Bolt M8',
  slug: 'hex-bolt-m8',
  sku: 'HB-M8',
  is_active: true,
  base_price: '50.00',
  mrp: '60.00',
  has_variants: false,
  stock_status: 'In Stock',
  description: 'A reliable hex bolt',
  material: 'Stainless Steel',
  weight: '0.1',
  categories: {
    id: 'cat-1',
    name: 'Hex Bolts',
    slug: 'hex-bolts',
    google_product_category: 'Hardware > Fasteners',
    parent_name: 'Bolts',
    parent_google_product_category: 'Hardware',
  },
  brands: { id: 'brand-1', name: 'Unbrako' },
  product_images: [
    {
      id: 'img-1',
      image_url: 'https://cdn.example.com/img.jpg',
      thumbnail_url: null,
      is_primary: true,
      display_order: 1,
    },
  ],
  product_variants: [],
}

// Product with variants
const variantProduct = {
  ...simpleProduct,
  id: 'prod-2',
  name: 'Socket Cap Screw',
  slug: 'socket-cap-screw',
  sku: 'SCS',
  base_price: null,
  mrp: null,
  has_variants: true,
  product_variants: [
    {
      id: 'var-1',
      sku: 'SCS-M6-10',
      variant_name: 'M6x10',
      price: '12.00',
      mrp: '15.00',
      stock_status: 'In Stock',
      is_active: true,
      mpn: null,
      gtin: null,
    },
    {
      id: 'var-2',
      sku: 'SCS-M8-20',
      variant_name: 'M8x20',
      price: '18.00',
      mrp: '22.00',
      stock_status: 'Out of Stock',
      is_active: true,
      mpn: null,
      gtin: null,
    },
  ],
}

describe('feed/google — module-level export', () => {
  it('exports dynamic = force-dynamic', () => {
    expect((feedModule as any).dynamic).toBe('force-dynamic')
  })
})

describe('GET /api/feed/google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.FEED_SECRET
  })

  it('returns 200 with XML content-type', async () => {
    queryManyMock.mockResolvedValue([simpleProduct])

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const ct = res.headers.get('Content-Type') || ''
    expect(ct.toLowerCase()).toMatch(/xml/)
  })

  it('sets Cache-Control: public, s-maxage=3600 header', async () => {
    queryManyMock.mockResolvedValue([simpleProduct])

    const res = await GET(makeReq() as any)

    const cc = res.headers.get('Cache-Control') || ''
    expect(cc).toMatch(/public/)
    expect(cc).toMatch(/s-maxage=3600/)
  })

  it('response body starts with XML declaration and contains <rss> root', async () => {
    queryManyMock.mockResolvedValue([simpleProduct])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toMatch(/^<\?xml/)
    expect(xml).toContain('<rss')
    expect(xml).toContain('</rss>')
  })

  it('includes required Google Merchant fields for a simple product', async () => {
    queryManyMock.mockResolvedValue([simpleProduct])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toContain('<g:id>HB-M8</g:id>')
    expect(xml).toContain('<title>Hex Bolt M8</title>')
    expect(xml).toContain('<g:price>')
    expect(xml).toContain('<g:availability>in_stock</g:availability>')
    expect(xml).toContain('<g:condition>new</g:condition>')
  })

  it('marks out-of-stock product correctly', async () => {
    queryManyMock.mockResolvedValue([{ ...simpleProduct, stock_status: 'Out of Stock' }])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toContain('<g:availability>out_of_stock</g:availability>')
  })

  it('includes each variant as a separate <item> for variant products', async () => {
    queryManyMock.mockResolvedValue([variantProduct])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    const itemCount = (xml.match(/<item>/g) || []).length
    expect(itemCount).toBe(2)
    expect(xml).toContain('<g:id>SCS-M6-10</g:id>')
    expect(xml).toContain('<g:id>SCS-M8-20</g:id>')
  })

  it('sets out_of_stock for the out-of-stock variant', async () => {
    queryManyMock.mockResolvedValue([variantProduct])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toContain('<g:availability>in_stock</g:availability>')
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>')
  })

  it('includes item_group_id for variant products', async () => {
    queryManyMock.mockResolvedValue([variantProduct])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toContain('<g:item_group_id>SCS</g:item_group_id>')
  })

  it('returns 401 when FEED_SECRET is set and no token provided', async () => {
    process.env.FEED_SECRET = 'secret-key-123'

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(401)
  })

  it('returns 200 when FEED_SECRET is set and correct token provided', async () => {
    process.env.FEED_SECRET = 'secret-key-123'
    queryManyMock.mockResolvedValue([simpleProduct])

    const res = await GET(makeReq('secret-key-123') as any)
    expect(res.status).toBe(200)
  })

  it('returns empty <channel> with no <item> entries when db has no products', async () => {
    queryManyMock.mockResolvedValue([])

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const xml = await res.text()
    expect(xml).toContain('<channel>')
    expect(xml).toContain('</channel>')
    expect(xml).not.toContain('<item>')
  })

  it('escapes XML special characters in product name', async () => {
    queryManyMock.mockResolvedValue([{ ...simpleProduct, name: 'Bolt & Nut <M8>', sku: 'BN-M8' }])

    const res = await GET(makeReq() as any)
    const xml = await res.text()

    expect(xml).toContain('&amp;')
    expect(xml).toContain('&lt;')
  })
})
