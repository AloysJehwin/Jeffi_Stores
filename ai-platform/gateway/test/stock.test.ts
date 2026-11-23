import { afterEach, describe, expect, it, vi } from 'vitest'
import { PixabayProvider, parsePixabay } from '../src/providers/pixabay'
import { PexelsProvider, parsePexels } from '../src/providers/pexels'
import { handleStockSearch, parseStockProviders, parseStockRequest, stockCacheKey, STOCK_CACHE_TTL_SEC, type StockDeps } from '../src/stock'
import { ValidationError } from '../src/media'
import type { StockImage, StockProvider, StockQuery } from '../src/providers/types'

type Call = { url: string; init?: RequestInit }
function mockFetch(handler: (url: string) => unknown) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const out = handler(url)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
afterEach(() => { vi.unstubAllGlobals() })

const pixabayHit = (over: Record<string, unknown> = {}) => ({
  id: 101, pageURL: 'https://pixabay.com/photos/sweets-101/', type: 'photo', tags: 'sweets, mithai, shop, india, festival',
  largeImageURL: 'https://pixabay.com/get/abc_1280.jpg', imageWidth: 6000, imageHeight: 4000, user_id: 77, user: 'rao', ...over,
})

describe('pixabay parsing', () => {
  it('normalises a hit to the 1280 px file and credits the user', () => {
    expect(parsePixabay({ hits: [pixabayHit()] })).toEqual([{
      provider: 'pixabay', id: '101', url: 'https://pixabay.com/get/abc_1280.jpg', width: 1280, height: 853,
      alt: 'sweets, mithai, shop, india', photographer: 'rao', photographerUrl: 'https://pixabay.com/users/rao-77/',
      pageUrl: 'https://pixabay.com/photos/sweets-101/',
    }])
  })

  it('keeps small originals as they are and portrait edges at 1280', () => {
    const [small, tall] = parsePixabay({ hits: [pixabayHit({ imageWidth: 900, imageHeight: 600 }), pixabayHit({ id: 2, imageWidth: 3000, imageHeight: 4500 })] })
    expect([small.width, small.height]).toEqual([900, 600])
    expect([tall.width, tall.height]).toEqual([853, 1280])
  })

  it('drops AI-tagged, non-photo and incomplete hits', () => {
    const hits = [
      pixabayHit({ id: 1, tags: 'shop, ai generated, india' }),
      pixabayHit({ id: 2, tags: 'AI-generated' }),
      pixabayHit({ id: 3, isAiGenerated: true }),
      pixabayHit({ id: 4, type: 'illustration' }),
      pixabayHit({ id: 5, largeImageURL: undefined }),
      pixabayHit({ id: 6, tags: 'chair, paint' }),
    ]
    expect(parsePixabay({ hits }).map(h => h.id)).toEqual(['6'])
    expect(parsePixabay(null)).toEqual([])
  })

  it('searches photos only with safe search, mapping orientation', async () => {
    const calls = mockFetch(() => ({ hits: [pixabayHit()] }))
    const r = await new PixabayProvider('test-fake-key').search({ query: 'indian sweet shop', orientation: 'square', perPage: 30 })
    expect(r).toHaveLength(1)
    const u = new URL(calls[0].url)
    expect(u.origin + u.pathname).toBe('https://pixabay.com/api/')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ key: 'test-fake-key', q: 'indian sweet shop', image_type: 'photo', safesearch: 'true', orientation: 'all', per_page: '30' })
  })

  it('is unconfigured without a key', () => {
    expect(new PixabayProvider('').configured()).toBe(false)
  })
})

describe('pexels parsing', () => {
  const photo = { id: 9, width: 4000, height: 6000, url: 'https://www.pexels.com/photo/9/', photographer: 'S. Iyer', photographer_url: 'https://www.pexels.com/@siyer', alt: 'A tea stall', src: { original: 'https://images.pexels.com/photos/9/pexels-photo-9.jpeg' } }

  it('serves the original resized to 1920 and credits the photographer', () => {
    expect(parsePexels({ photos: [photo] })).toEqual([{
      provider: 'pexels', id: '9', url: 'https://images.pexels.com/photos/9/pexels-photo-9.jpeg?auto=compress&cs=tinysrgb&w=1920',
      width: 1920, height: 2880, alt: 'A tea stall', photographer: 'S. Iyer', photographerUrl: 'https://www.pexels.com/@siyer', pageUrl: 'https://www.pexels.com/photo/9/',
    }])
    expect(parsePexels({ photos: [{ ...photo, src: {} }] })).toEqual([])
  })

  it('sends the key as the Authorization header', async () => {
    const calls = mockFetch(() => ({ photos: [photo] }))
    await new PexelsProvider('test-fake-key').search({ query: 'tea stall', orientation: 'portrait', perPage: 30 })
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('test-fake-key')
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toMatchObject({ query: 'tea stall', orientation: 'portrait', per_page: '30' })
  })
})

const hit = (provider: 'pexels' | 'pixabay', id: string, width = 1280): StockImage => ({
  provider, id, url: `https://cdn.example/${id}.jpg`, width, height: 800, alt: '', photographer: 'x', photographerUrl: null, pageUrl: `https://example.com/${id}`,
})

function fakeProvider(name: 'pexels' | 'pixabay', opts: { configured?: boolean; hits?: StockImage[]; fail?: string } = {}) {
  const calls: StockQuery[] = []
  const p: StockProvider & { calls: StockQuery[] } = {
    name, calls,
    configured: () => opts.configured ?? true,
    async search(q) { calls.push(q); if (opts.fail) throw new Error(opts.fail); return opts.hits ?? [] },
  }
  return p
}

class FakeRedis {
  store = new Map<string, string>()
  ttl = new Map<string, number>()
  async get(k: string) { return this.store.get(k) ?? null }
  async set(k: string, v: string, _ex?: string, ttl?: number) { this.store.set(k, v); if (ttl) this.ttl.set(k, ttl); return 'OK' as const }
}

describe('stock request parsing', () => {
  it('needs a query and normalises it', () => {
    expect(() => parseStockRequest({ query: ' !! ' })).toThrow(ValidationError)
    expect(parseStockRequest({ query: '  Indian   SWEET shop!! ' })).toMatchObject({ query: 'indian sweet shop', orientation: 'landscape', minWidth: 0, perPage: 15 })
    expect(parseStockRequest({ query: 'x', orientation: 'square', minWidth: 99999, perPage: 99 })).toMatchObject({ orientation: 'square', minWidth: 4000, perPage: 30 })
    expect(() => parseStockRequest({ query: 'x', providers: ['unsplash'] })).toThrow(ValidationError)
  })

  it('reads AI_STOCK_PROVIDERS with the pexels, pixabay default', () => {
    expect(parseStockProviders(undefined)).toEqual(['pexels', 'pixabay'])
    expect(parseStockProviders('pixabay, unsplash,pixabay')).toEqual(['pixabay'])
  })
})

describe('stock search order', () => {
  it('skips a provider without a key and answers from the next', async () => {
    const pexels = fakeProvider('pexels', { configured: false, hits: [hit('pexels', '1')] })
    const pixabay = fakeProvider('pixabay', { hits: [hit('pixabay', '2')] })
    const r = await handleStockSearch({ query: 'tea' }, { providers: { pexels, pixabay }, order: ['pexels', 'pixabay'] })
    expect(pexels.calls).toHaveLength(0)
    expect(r).toMatchObject({ provider: 'pixabay', results: [{ id: '2' }], cache: null })
    expect(r.tried).toBeUndefined()
  })

  it('prefers pexels when keyed', async () => {
    const r = await handleStockSearch({ query: 'tea' }, { providers: { pexels: fakeProvider('pexels', { hits: [hit('pexels', '1')] }), pixabay: fakeProvider('pixabay', { hits: [hit('pixabay', '2')] }) }, order: ['pexels', 'pixabay'] })
    expect(r.provider).toBe('pexels')
  })

  it('falls through on a failure or on no hit wide enough, and reports failures', async () => {
    const deps: StockDeps = { providers: { pexels: fakeProvider('pexels', { fail: 'HTTP 429' }), pixabay: fakeProvider('pixabay', { hits: [hit('pixabay', 'small', 800), hit('pixabay', 'big', 1280)] }) }, order: ['pexels', 'pixabay'] }
    const r = await handleStockSearch({ query: 'tea', minWidth: 1000 }, deps)
    expect(r.results.map(h => h.id)).toEqual(['big'])
    expect(r.tried).toEqual([{ provider: 'pexels', error: 'HTTP 429' }])
    const none = await handleStockSearch({ query: 'tea', minWidth: 1600 }, deps)
    expect(none).toMatchObject({ results: [], provider: null })
  })

  it('answers no results, not an error, when nothing is keyed', async () => {
    const r = await handleStockSearch({ query: 'tea' }, { providers: { pexels: fakeProvider('pexels', { configured: false }), pixabay: fakeProvider('pixabay', { configured: false }) }, order: ['pexels', 'pixabay'] })
    expect(r).toEqual({ results: [], provider: null, cache: null })
  })

  it('trims to perPage', async () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit('pixabay', String(i)))
    const r = await handleStockSearch({ query: 'tea', perPage: 5 }, { providers: { pixabay: fakeProvider('pixabay', { hits }) }, order: ['pixabay'] })
    expect(r.results).toHaveLength(5)
  })
})

describe('stock cache', () => {
  it('caches each provider 24 h by query and orientation, empty answers included', async () => {
    const redis = new FakeRedis()
    const pixabay = fakeProvider('pixabay', { hits: [hit('pixabay', '2')] })
    const deps: StockDeps = { providers: { pixabay }, order: ['pixabay'], redis: redis as never }
    const first = await handleStockSearch({ query: 'Tea Stall' }, deps)
    const second = await handleStockSearch({ query: 'tea stall' }, deps)
    expect(pixabay.calls).toHaveLength(1)
    expect([first.cache, second.cache]).toEqual([null, 'kv'])
    expect(second.results).toEqual(first.results)
    expect(redis.ttl.get(stockCacheKey('pixabay', 'tea stall', 'landscape'))).toBe(STOCK_CACHE_TTL_SEC)

    await handleStockSearch({ query: 'tea stall', orientation: 'portrait' }, deps)
    expect(pixabay.calls).toHaveLength(2)

    const empty = fakeProvider('pixabay', { hits: [] })
    await handleStockSearch({ query: 'nothing here' }, { ...deps, providers: { pixabay: empty } })
    await handleStockSearch({ query: 'nothing here' }, { ...deps, providers: { pixabay: empty } })
    expect(empty.calls).toHaveLength(1)
  })

  it('never caches a failure', async () => {
    const redis = new FakeRedis()
    const pixabay = fakeProvider('pixabay', { fail: 'down' })
    await handleStockSearch({ query: 'tea' }, { providers: { pixabay }, order: ['pixabay'], redis: redis as never })
    expect(redis.store.size).toBe(0)
  })

  it('separates providers in the key', () => {
    expect(stockCacheKey('pexels', 'tea', 'square')).not.toBe(stockCacheKey('pixabay', 'tea', 'square'))
    expect(stockCacheKey('pexels', 'tea', 'square')).toMatch(/^ai:stock:pexels:[0-9a-f]{64}$/)
  })
})
