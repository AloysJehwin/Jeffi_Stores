import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/catalog/site-controls', () => ({
  getStoreIdentity: vi.fn(),
}))
vi.mock('@/app-shell/site-origin', () => ({
  siteOrigin: vi.fn(),
}))

import { listingMetadata, breadcrumbJsonLd, ldJson } from '@/lib/catalog/listing-seo'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { siteOrigin } from '@/app-shell/site-origin'

beforeEach(() => {
  vi.mocked(getStoreIdentity).mockResolvedValue({ name: 'My Store' } as any)
  vi.mocked(siteOrigin).mockResolvedValue('https://shop.test')
})

describe('listingMetadata', () => {
  it('builds title, clipped description and canonical/openGraph', async () => {
    const md: any = await listingMetadata({
      title: 'Bolts',
      description: '  A   great   range  ',
      fallbackDescription: 'fallback',
      path: '/products',
      image: 'https://img/x.jpg',
    })
    expect(md.title).toBe('Bolts | My Store')
    expect(md.description).toBe('A great range')
    expect(md.alternates.canonical).toBe('https://shop.test/products')
    expect(md.openGraph.url).toBe('https://shop.test/products')
    expect(md.openGraph.type).toBe('website')
    expect(md.openGraph.images).toEqual([{ url: 'https://img/x.jpg', alt: 'Bolts' }])
    expect(md.robots).toBeUndefined()
  })

  it('falls back to fallbackDescription and clips to 160 chars with ellipsis', async () => {
    const longFallback = 'x'.repeat(200)
    const md: any = await listingMetadata({ title: 'T', description: '', fallbackDescription: longFallback, path: '/p' })
    expect(md.description.length).toBe(160)
    expect(md.description.endsWith('…')).toBe(true)
    expect(md.openGraph.images).toBeUndefined()
  })

  it('adds noindex robots when requested', async () => {
    const md: any = await listingMetadata({ title: 'T', fallbackDescription: 'f', path: '/p', noindex: true })
    expect(md.robots).toEqual({ index: false, follow: true })
  })
})

describe('breadcrumbJsonLd', () => {
  it('numbers positions and adds item url only when path is set', async () => {
    const out: any = await breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Bolts' }])
    expect(out['@type']).toBe('BreadcrumbList')
    expect(out.itemListElement[0]).toEqual({ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://shop.test/' })
    expect(out.itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Bolts' })
  })
})

describe('ldJson', () => {
  it('serializes and escapes < to prevent script breakout', () => {
    expect(ldJson({ a: '<script>' })).toBe('{"a":"\\u003cscript>"}')
  })
})
