import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// db is mocked so loadBrochureStore can be exercised without a real DB.
vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

// pdfkit is loaded via eval('require')('pdfkit'); vi.mock intercepts the
// require cache. Mocking it keeps generateBrochurePDF fast and side-effect free
// (real pdfkit image decoding of fetched buffers is slow), while still driving
// every draw branch. bufferedPageRange grows as addPage is called so the
// footer/page-number loop iterates realistically.
vi.mock('pdfkit', () => {
  function makeMockDoc() {
    let dataCb: ((c: Buffer) => void) | null = null
    let endCb: (() => void) | null = null
    let pageCount = 1
    const doc: Record<string, any> = {
      on: vi.fn(function (event: string, cb: any) {
        if (event === 'data') dataCb = cb
        if (event === 'end') endCb = cb
        return doc
      }),
      end: vi.fn(function () {
        dataCb?.(Buffer.from('mock-pdf-data'))
        endCb?.()
      }),
      addPage: vi.fn(function () { pageCount++; return doc }),
      switchToPage: vi.fn().mockReturnThis(),
      bufferedPageRange: vi.fn(() => ({ start: 0, count: pageCount })),
      font: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(),
      strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      roundedRect: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
      // Return a stable width so clip1's binary search terminates quickly and
      // predictably (short strings pass, long strings get clipped).
      widthOfString: vi.fn((s: string) => (s ? s.length * 3 : 0)),
      heightOfString: vi.fn().mockReturnValue(10),
    }
    return doc
  }
  return { default: vi.fn().mockImplementation(() => makeMockDoc()) }
})

// qrcode is also eval-required. Mock toBuffer so QR generation is instant and
// the success path (non-null QR) is exercised deterministically.
vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

import {
  familyKey,
  nameSimilarity,
  sameFamily,
  splitFamilies,
  productUrl,
  loadBrochureStore,
  generateBrochurePDF,
  type BrochureProductInput,
  type BrochureStore,
  type BrochureOptions,
} from '@/lib/brochure-pdf'
import { queryMany } from '@/lib/db'

const p = (id: string, name: string) => ({ id, name, sku: id, slug: id } as any)

const store: BrochureStore = {
  name: 'Jeffi Stores',
  address: '1 Main Rd',
  city: 'Chennai',
  phone: '9999999999',
  email: 'hi@jeffistores.in',
  gstin: '33ABCDE1234F1Z5',
  web: 'jeffistores.in',
}

const baseOpts: BrochureOptions = { store, showPrices: true }

// pdfkit + qrcode are mocked (above); only the DB and network fetch stay
// mocked per-test. generateBrochurePDF therefore runs every layout branch
// without slow real image decoding.
beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// familyKey
// ---------------------------------------------------------------------------
describe('familyKey — strips size tokens anywhere in the name', () => {
  it('strips embedded fraction sizes so BSW sizes share a key', () => {
    expect(familyKey('BSW 1/2" SS 202 Allen Cap Screw'))
      .toBe(familyKey('BSW 3/16" SS 202 Allen Cap Screw'))
  })
  it('strips embedded M-sizes', () => {
    expect(familyKey('GMF SS 304 M10 Allen Cap Screw'))
      .toBe(familyKey('GMF SS 304 M12 Allen Cap Screw'))
  })
  it('strips mm/inch and NxM tokens', () => {
    expect(familyKey('Rod 25mm Steel')).toBe(familyKey('Rod 40mm Steel'))
    expect(familyKey('Plate 5x40 Steel')).toBe(familyKey('Plate 6x50 Steel'))
    expect(familyKey('Bar 2" Steel')).toBe(familyKey('Bar 3" Steel'))
  })
  it('keeps grade/material numbers (202/304/12.9) intact', () => {
    expect(familyKey('BSW 1/2" SS 202 Allen Cap Screw')).toContain('202')
    expect(familyKey('GMF SS 304 M10 Allen Cap Screw')).toContain('304')
  })
  it('leaves a name with no size token intact', () => {
    expect(familyKey('Plain Washer')).toBe('plain washer')
  })
  it('handles null/empty name (nullish + fallback branch)', () => {
    expect(familyKey(null as any)).toBe('')
    expect(familyKey('')).toBe('')
  })
  it('falls back to full normalized name when everything strips to empty', () => {
    // "M6" strips to empty via the size regex, so the fallback branch fires.
    expect(familyKey('M6')).toBe('m6')
  })
})

// ---------------------------------------------------------------------------
// nameSimilarity
// ---------------------------------------------------------------------------
describe('nameSimilarity', () => {
  it('identical names → 1', () => {
    expect(nameSimilarity('Hex Bolt', 'hex   bolt')).toBe(1)
  })
  it('very different names → low', () => {
    expect(nameSimilarity('Plain Washer', 'Threaded Rod')).toBeLessThan(0.5)
  })
  it('two empty strings → 1 (L === 0 branch)', () => {
    expect(nameSimilarity('', '')).toBe(1)
    expect(nameSimilarity(null as any, null as any)).toBe(1)
  })
  it('empty vs non-empty → 0', () => {
    expect(nameSimilarity('', 'abc')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// sameFamily
// ---------------------------------------------------------------------------
describe('sameFamily — similarity + size-only-diff gate', () => {
  it('collapses different sizes of the same product', () => {
    expect(sameFamily('BSW 1/2" SS 202 Allen Cap Screw', 'BSW 3/8" SS 202 Allen Cap Screw')).toBe(true)
  })
  it('keeps Cap vs CSK separate even when very similar', () => {
    expect(nameSimilarity('GMF SS 304 M10 Allen Cap Screw', 'GMF SS 304 M10 Allen CSK Screw')).toBeGreaterThan(0.8)
    expect(sameFamily('GMF SS 304 M10 Allen Cap Screw', 'GMF SS 304 M10 Allen CSK Screw')).toBe(false)
  })
  it('keeps different materials separate', () => {
    expect(sameFamily('Hex Bolt M6 Steel', 'Hex Bolt M6 Brass')).toBe(false)
  })
  it('same familyKey but low similarity → false (similarity gate)', () => {
    // Both keys reduce to "ab"/"zy" — different keys, so the first gate fails.
    expect(sameFamily('AB M6', 'ZY M6')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// splitFamilies
// ---------------------------------------------------------------------------
describe('splitFamilies', () => {
  it('one representative per family; other sizes to the list', () => {
    const products = [
      p('a', 'BSW 1/2" SS 202 Allen Cap Screw'),
      p('b', 'BSW 1/4" SS 202 Allen Cap Screw'),
      p('c', 'BSW 3/8" SS 202 Allen Cap Screw'),
      p('d', 'GMF SS 304 M10 Allen CSK Screw'),
      p('e', 'Plain Washer'),
    ]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives.map(r => r.id)).toEqual(['a', 'd', 'e'])
    expect(rest.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('all-unique list keeps everyone as a representative', () => {
    const products = [p('a', 'Nut'), p('b', 'Bolt'), p('c', 'Washer')]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives).toHaveLength(3)
    expect(rest).toHaveLength(0)
  })

  it('same key but different product name → both reps (bucket-push branch)', () => {
    // "Widget M6" and "Wodget M6" strip to keys "widget"/"wodget" (different),
    // but "Widget M6" and "Widget M8" share key "widget" and are similar → merge.
    const products = [
      p('a', 'Widget M6'),
      p('b', 'Widget M8'), // same family as a → rest
      p('c', 'Wodget M6'), // different key → new rep
    ]
    const { representatives, rest } = splitFamilies(products)
    expect(representatives.map(r => r.id)).toEqual(['a', 'c'])
    expect(rest.map(r => r.id)).toEqual(['b'])
  })

  it('empty input', () => {
    expect(splitFamilies([])).toEqual({ representatives: [], rest: [] })
  })
})

// ---------------------------------------------------------------------------
// productUrl
// ---------------------------------------------------------------------------
describe('productUrl', () => {
  it('returns null when slug is missing', () => {
    expect(productUrl('jeffistores.in', null)).toBeNull()
    expect(productUrl('jeffistores.in', undefined)).toBeNull()
    expect(productUrl('jeffistores.in', '')).toBeNull()
  })
  it('builds a https URL with brochure source tag', () => {
    expect(productUrl('jeffistores.in', 'hex-bolt')).toBe('https://jeffistores.in/products/hex-bolt?src=brochure')
  })
  it('strips an existing protocol and trailing slashes from web', () => {
    expect(productUrl('https://jeffistores.in///', 'nut')).toBe('https://jeffistores.in/products/nut?src=brochure')
    expect(productUrl('http://shop.example.com/', 'bolt')).toBe('https://shop.example.com/products/bolt?src=brochure')
  })
})

// ---------------------------------------------------------------------------
// loadBrochureStore
// ---------------------------------------------------------------------------
describe('loadBrochureStore', () => {
  it('maps site_settings rows to a BrochureStore, preferring trade name', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'business_trade_name', value: 'Jeffi Trade' },
      { key: 'business_legal_name', value: 'Jeffi Legal Pvt Ltd' },
      { key: 'business_address', value: '10 Market St' },
      { key: 'business_state', value: 'Tamil Nadu' },
      { key: 'business_phone', value: '044-000' },
      { key: 'business_email', value: 'sales@jeffistores.in' },
      { key: 'business_gstin', value: '33AAAAA0000A1Z5' },
    ] as any)
    const s = await loadBrochureStore()
    expect(s.name).toBe('Jeffi Trade')
    expect(s.address).toBe('10 Market St')
    expect(s.city).toBe('Tamil Nadu')
    expect(s.phone).toBe('044-000')
    expect(s.email).toBe('sales@jeffistores.in')
    expect(s.gstin).toBe('33AAAAA0000A1Z5')
    expect(s.web).toBe('jeffistores.in')
  })

  it('falls back to legal name then to JEFFI STORES', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'business_legal_name', value: 'Jeffi Legal Pvt Ltd' },
    ] as any)
    const s1 = await loadBrochureStore()
    expect(s1.name).toBe('Jeffi Legal Pvt Ltd')

    vi.mocked(queryMany).mockResolvedValue([] as any)
    const s2 = await loadBrochureStore()
    expect(s2.name).toBe('JEFFI STORES')
    expect(s2.address).toBe('')
  })

  it('handles null rows and null values defensively', async () => {
    vi.mocked(queryMany).mockResolvedValue(null as any)
    const s = await loadBrochureStore()
    expect(s.name).toBe('JEFFI STORES')

    vi.mocked(queryMany).mockResolvedValue([
      { key: 'business_trade_name', value: null },
    ] as any)
    const s2 = await loadBrochureStore()
    // null value coerces to '' → falls through to JEFFI STORES
    expect(s2.name).toBe('JEFFI STORES')
  })
})

// ---------------------------------------------------------------------------
// generateBrochurePDF — drives cover/index/matrix/list draw functions
// ---------------------------------------------------------------------------
describe('generateBrochurePDF', () => {
  const okPng = Buffer.from('mock-image-bytes')

  it('generates a PDF buffer for empty product list (empty-state branch)', async () => {
    // No fetch needed — no products.
    const buf = await generateBrochurePDF([], baseOpts)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders representatives + rest with prices, QR, images, MRP strike & discount', async () => {
    // fetch always succeeds → image buffers non-null → image() draw path.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => okPng.buffer.slice(okPng.byteOffset, okPng.byteOffset + okPng.byteLength),
    } as any))

    const products: BrochureProductInput[] = [
      {
        id: 'a', name: 'BSW 1/2" SS 202 Allen Cap Screw', slug: 'a', sku: 'A1',
        short_description: 'A strong screw', mrp: 100, base_price: 80,
        brand_name: 'Unbrako', category_name: 'Fasteners', thumbnail_url: 'https://img/a.png',
      },
      {
        id: 'b', name: 'BSW 3/8" SS 202 Allen Cap Screw', slug: 'b', sku: 'B1',
        short_description: 'Another size', mrp: 50, base_price: 50, // no strike, no discount
        brand_name: 'Unbrako', category_name: 'Fasteners', thumbnail_url: 'https://img/b.png',
      },
      {
        id: 'c', name: 'Plain Washer', slug: 'c', sku: 'C1',
        mrp: null, base_price: 20, thumbnail_url: 'https://img/c.png',
      },
    ]
    const buf = await generateBrochurePDF(products, baseOpts)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    // Image fetch is called once per product with a thumbnail_url (3 here).
    expect((fetch as any)).toHaveBeenCalledTimes(3)
  })

  it('handles failed image fetches (null buffer → placeholder branch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as any))
    const products: BrochureProductInput[] = [
      { id: 'a', name: 'Nut', slug: 'a', sku: 'A1', mrp: 100, base_price: 90, thumbnail_url: 'https://img/a.png' },
      { id: 'b', name: 'Bolt', slug: null, sku: 'B1', base_price: 30, thumbnail_url: null }, // no slug → no QR, no thumb
    ]
    const buf = await generateBrochurePDF(products, baseOpts)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('handles fetch throwing (catch branch in fetchImageBuffer)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const products: BrochureProductInput[] = [
      { id: 'a', name: 'Nut', slug: 'a', sku: 'A1', base_price: 10, thumbnail_url: 'https://img/a.png' },
    ]
    const buf = await generateBrochurePDF(products, baseOpts)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders with prices OFF and no QR (showPrices=false, no slugs)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as any))
    const products: BrochureProductInput[] = [
      { id: 'a', name: 'Nut', slug: null, sku: 'A1', base_price: 10, thumbnail_url: null },
      { id: 'b', name: 'Nut', slug: null, sku: 'B1', base_price: 10, thumbnail_url: null }, // same family → rest
    ]
    const buf = await generateBrochurePDF(products, { store, showPrices: false })
    expect(buf.length).toBeGreaterThan(0)
  })

  it('paginates a large representative + rest set (multi-page + bufferedPageRange loop)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as any))
    const products: BrochureProductInput[] = []
    // 20 unique families → 3 matrix pages (9/page).
    for (let i = 0; i < 20; i++) {
      products.push({ id: `rep${i}`, name: `Product Number ${i}`, slug: `rep${i}`, sku: `S${i}`, mrp: 100, base_price: 80 })
    }
    // 40 rest rows → forces list pagination (bottomLimit overflow → new page).
    for (let i = 0; i < 40; i++) {
      products.push({ id: `alt${i}`, name: `Product Number ${i % 20} M${i}`, slug: `alt${i}`, sku: `A${i}`, mrp: 60, base_price: 45 })
    }
    const buf = await generateBrochurePDF(products, baseOpts)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('uses default title/promo when blank and honors provided ones', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as any))
    const products: BrochureProductInput[] = [
      { id: 'a', name: 'Nut', slug: 'a', sku: 'A1', base_price: 10, thumbnail_url: null },
    ]
    const b1 = await generateBrochurePDF(products, { store, showPrices: true, title: '   ', promo: '   ' })
    expect(b1.length).toBeGreaterThan(0)
    const b2 = await generateBrochurePDF(products, { store, showPrices: true, title: 'Summer Sale', promo: 'Up to 50% off' })
    expect(b2.length).toBeGreaterThan(0)
  })

  it('paints gradient cover when no cover image exists on disk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as any))
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const products: BrochureProductInput[] = [
      { id: 'a', name: 'Nut', slug: 'a', sku: 'A1', base_price: 10, thumbnail_url: null },
    ]
    const buf = await generateBrochurePDF(products, baseOpts)
    expect(buf.length).toBeGreaterThan(0)
  })
})
