import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const h = vi.hoisted(() => ({ queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: h.queryMany }))

import PhotoCredits from '@/components/visitor/site/PhotoCredits'
import { cleanStockCredit, creditGroups, isStockImageUrl, pictureCredits, type StockCredit } from '@/lib/ai/stock-credits'
import { cleanContent } from '@/lib/showcase/clean'
import { storePhotoCredits, __resetPhotoCredits } from '@/lib/site/photo-credits'

const rao: StockCredit = { name: 'A. Rao', url: 'https://www.pexels.com/@arao', source: 'pexels', pageUrl: 'https://www.pexels.com/photo/1/' }
const iyer: StockCredit = { name: 'S. Iyer', url: null, source: 'pexels', pageUrl: 'https://www.pexels.com/photo/2/' }
const das: StockCredit = { name: 'K. Das', url: 'https://pixabay.com/users/kdas-3/', source: 'pixabay', pageUrl: 'https://pixabay.com/photos/3/' }
const STOCK = 'https://cdn.example.com/stock/pixabay-3.webp'

describe('credits data', () => {
  it('accepts only a known library, a name and https links', () => {
    expect(cleanStockCredit({ ...rao, name: '  A.   Rao ' })).toEqual(rao)
    expect(cleanStockCredit({ ...rao, source: 'unsplash' })).toBeNull()
    expect(cleanStockCredit({ ...rao, pageUrl: 'javascript:alert(1)' })).toBeNull()
    expect(cleanStockCredit({ ...rao, url: 'http://x.example' })).toEqual({ ...rao, url: null })
    expect(cleanStockCredit('A. Rao')).toBeNull()
  })

  it('groups by library, Pexels first, each photographer once', () => {
    const g = creditGroups([das, rao, null, { ...rao, pageUrl: 'https://www.pexels.com/photo/9/' }, iyer])
    expect(g.map(x => [x.label, x.people.map(p => p.name)])).toEqual([['Pexels', ['A. Rao', 'S. Iyer']], ['Pixabay', ['K. Das']]])
    // No profile: the name links to the photo.
    expect(g[0].people[1].url).toBe(iyer.pageUrl)
  })

  it('knows a stock file by its key', () => {
    expect(isStockImageUrl(STOCK)).toBe(true)
    expect(isStockImageUrl('https://cdn.example.com/prefix/stock/pexels-12.webp?v=1')).toBe(true)
    expect(isStockImageUrl('https://cdn.example.com/stock/thumbnails/pexels-12.webp')).toBe(false)
    expect(isStockImageUrl('https://cdn.example.com/gallery/123-mine.webp')).toBe(false)
  })

  it('credits only pictures that are still the stock file', () => {
    expect(pictureCredits([{ image: STOCK, credit: das }, { image: 'https://cdn.example.com/gallery/mine.webp', credit: rao }, { image: STOCK }])).toEqual([das])
    expect(pictureCredits(undefined)).toEqual([])
  })

  it('keeps a Showcase picture credit through cleanContent only while the picture is the stock file', () => {
    const c = cleanContent({ pictures: [{ image: STOCK, alt: 'Sweets', credit: das }, { image: 'https://cdn.example.com/gallery/mine.webp', credit: rao }, { image: 'https://cdn.example.com/a.webp', ai: true }] })
    expect(c.pictures).toEqual([{ image: STOCK, alt: 'Sweets', credit: das }, { image: 'https://cdn.example.com/gallery/mine.webp' }, { image: 'https://cdn.example.com/a.webp', ai: true }])
  })
})

describe('PhotoCredits', () => {
  it('draws the linked credits line', () => {
    const html = renderToStaticMarkup(<PhotoCredits credits={[rao, iyer, das]} className="credits" />)
    expect(html).toContain('<p class="credits" data-photo-credits="">Photos: ')
    expect(html.replace(/<[^>]+>/g, '')).toBe('Photos: A. Rao, S. Iyer on Pexels · K. Das on Pixabay')
    expect(html).toContain('href="https://www.pexels.com/@arao"')
    expect(html).toContain('href="https://www.pexels.com"')
    expect(html).toContain('href="https://pixabay.com/users/kdas-3/"')
    expect(html).toContain('href="https://pixabay.com"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('draws nothing without a stock photo', () => {
    expect(renderToStaticMarkup(<PhotoCredits credits={[]} />)).toBe('')
    expect(renderToStaticMarkup(<PhotoCredits credits={[{ name: 'x' } as never]} />)).toBe('')
  })
})

describe('storePhotoCredits', () => {
  beforeEach(() => __resetPhotoCredits())

  it('reads stock gallery rows and seeded credits still in use, cached per store', async () => {
    h.queryMany.mockResolvedValue([{ credit: rao }, { credit: { name: 'bad' } }, { credit: das }])
    expect(await storePhotoCredits('s1')).toEqual([rao, das])
    expect(await storePhotoCredits('s1')).toEqual([rao, das])
    expect(h.queryMany).toHaveBeenCalledTimes(1)
    const [sql, params] = h.queryMany.mock.calls[0]
    expect(sql).toMatch(/source = 'stock'/)
    expect(sql).toMatch(/site_pages/)
    expect(sql).toMatch(/product_images/)
    expect(params).toEqual(['stock_photo_credits'])
  })

  it('is empty, and not asked again at once, when the query fails', async () => {
    h.queryMany.mockRejectedValue(new Error('column "credit" does not exist'))
    expect(await storePhotoCredits('s2')).toEqual([])
    expect(await storePhotoCredits('s2')).toEqual([])
    expect(h.queryMany).toHaveBeenCalledTimes(1)
  })
})
