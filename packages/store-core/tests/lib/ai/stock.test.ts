import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  inspect: vi.fn(),
  fetchRemote: vi.fn(),
  queryOne: vi.fn(),
  generateImage: vi.fn(),
  redis: { sets: new Map<string, Set<string>>(), expire: vi.fn() },
}))

vi.mock('@/lib/shared/ai-client', () => ({ aiGatewayUrl: () => 'http://gw:8080', aiGatewayHeaders: () => ({ Authorization: 'Bearer test-fake' }) }))
vi.mock('@/lib/shared/s3', () => ({
  uploadGalleryImage: h.upload,
  inspectObject: h.inspect,
  fetchRemoteImage: h.fetchRemote,
  getS3Url: async (k: string) => `https://cdn.example.com/${k}`,
  currentBucket: async () => 'bucket',
  stableThumbnailKey: (k: string, ext: string) => `${k.replace(/\/([^/]+)$/, '/thumbnails/$1')}.${ext}`,
}))
vi.mock('@/lib/shared/db', () => ({ queryOne: h.queryOne }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/ai/media', () => ({ generateImage: h.generateImage }))
vi.mock('@/lib/shared/redis', () => ({
  getRedisClient: () => ({
    smembers: async (k: string) => [...(h.redis.sets.get(k) ?? [])],
    sadd: async (k: string, v: string) => void h.redis.sets.set(k, (h.redis.sets.get(k) ?? new Set()).add(v)),
    expire: h.redis.expire,
  }),
}))

import { pickStock, pictureFor, searchTerms, stockPicture, stockQueries, type StockHit } from '@/lib/ai/stock'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const hit = (id: string, over: Partial<StockHit> = {}): StockHit => ({
  provider: 'pixabay', id, url: `https://pixabay.com/get/${id}.jpg`, width: 1280, height: 853, alt: 'sweets, shop',
  photographer: 'rao', photographerUrl: 'https://pixabay.com/users/rao-1/', pageUrl: `https://pixabay.com/photos/${id}/`, ...over,
})

let fetchMock: ReturnType<typeof vi.fn>
let searches: { query: string; orientation: string; minWidth: number }[]

function gatewayAnswers(byQuery: Record<string, StockHit[]>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://gw:8080/v1/images/stock')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-fake')
    const body = JSON.parse(String(init.body))
    searches.push(body)
    return json({ results: byQuery[body.query] ?? [], provider: byQuery[body.query]?.length ? 'pixabay' : null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.redis.sets.clear()
  searches = []
  h.inspect.mockResolvedValue(null)
  h.fetchRemote.mockResolvedValue(Buffer.from([1, 2, 3]))
  h.upload.mockImplementation(async (_b: Buffer, name: string, o: { key: string }) => ({
    url: `https://cdn.example.com/${o.key}.webp`, thumbnailUrl: 'https://cdn.example.com/t.webp', s3Key: `${o.key}.webp`, s3ThumbnailKey: 't.webp',
    fileName: `${name}.webp`, fileSize: 3, mimeType: 'image/webp', width: 1280, height: 853, blurhash: 'L',
  }))
  h.queryOne.mockResolvedValue({ id: 'gal-1' })
  h.generateImage.mockResolvedValue({ images: [{ url: 'https://cdn.example.com/gallery/ai.webp', width: 1024, height: 1024, galleryId: 'gal-ai' }] })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('queries', () => {
  it('keeps searches short and plain', () => {
    expect(searchTerms('Hand-woven Silk Sarees & Dupattas!!')).toBe('hand-woven silk sarees dupattas')
    expect(searchTerms('a b c d e f', 3)).toBe('a b c')
  })

  it('tries "indian" first, then without it, once each', () => {
    expect(stockQueries(['Sweet shop', 'sweet shop', 'india gate', ''])).toEqual(['indian sweet shop', 'sweet shop', 'india gate'])
  })
})

describe('picking', () => {
  const hits = Array.from({ length: 20 }, (_, i) => hit(String(i)))

  it('picks from the top 15 the site has not used, stable per seed', () => {
    const o = { minWidth: 1000, used: new Set<string>(), recent: new Set<string>(), seed: 7, salt: 'q' }
    const a = pickStock(hits, o)!
    expect(pickStock(hits, o)).toBe(a)
    expect(Number(a.id)).toBeLessThan(15)
    const seen = new Set(Array.from({ length: 20 }, (_, s) => pickStock(hits, { ...o, seed: s })!.id))
    expect(seen.size).toBeGreaterThan(3)
  })

  it('leaves out used, narrow and (when it can) recently used hits', () => {
    const used = new Set(hits.slice(0, 14).map(x => `pixabay:${x.id}`))
    expect(pickStock(hits, { minWidth: 1000, used, recent: new Set(), seed: 1, salt: 'q' })!.id).toMatch(/^(14|15|16|17|18|19)$/)
    expect(pickStock([hit('n', { width: 640 })], { minWidth: 1000, used: new Set(), recent: new Set(), seed: 1, salt: 'q' })).toBeNull()
    const recent = new Set(hits.slice(1, 15).map(x => `pixabay:${x.id}`))
    expect(pickStock(hits, { minWidth: 1000, used: new Set(), recent, seed: 3, salt: 'q' })!.id).toBe('0')
    const allRecent = new Set(hits.map(x => `pixabay:${x.id}`))
    expect(pickStock(hits, { minWidth: 1000, used: new Set(), recent: allRecent, seed: 3, salt: 'q' })).not.toBeNull()
  })
})

describe('stockPicture', () => {
  it('searches "indian …" first with the shape, copies the pick under a stable key and records it in the gallery', async () => {
    gatewayAnswers({ 'indian sweet shop': [hit('41', { width: 1280 }), hit('42', { width: 1920, height: 1280 })] })
    const used = new Set<string>()
    const p = await stockPicture({ queries: ['sweet shop'], shape: 'hero', seed: 1, used })
    expect(searches[0]).toMatchObject({ query: 'indian sweet shop', orientation: 'landscape', minWidth: 1600 })
    expect(h.fetchRemote).toHaveBeenCalledWith('https://pixabay.com/get/42.jpg')
    expect(h.upload).toHaveBeenCalledWith(expect.any(Buffer), 'stock/pixabay-42', { key: 'stock/pixabay-42' })
    expect(p).toMatchObject({ url: 'https://cdn.example.com/stock/pixabay-42.webp', galleryId: 'gal-1', credit: { name: 'rao', url: 'https://pixabay.com/users/rao-1/', source: 'pixabay', pageUrl: 'https://pixabay.com/photos/42/' } })
    expect(used.has('pixabay:42')).toBe(true)
    const [sql, params] = h.queryOne.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO gallery_images[\s\S]*'stock'/)
    expect(params).toContain('https://pixabay.com/photos/42/')
    expect(params).toContain('tenant-1')
    expect(JSON.parse(params[14])).toMatchObject({ source: 'pixabay', name: 'rao' })
    expect(h.redis.sets.get('stock:recent:indian sweet shop')).toEqual(new Set(['pixabay:42']))
  })

  it('falls back to the search without "indian", and skips the gallery for preview pictures', async () => {
    gatewayAnswers({ 'sweet shop': [hit('7')] })
    const p = await stockPicture({ queries: ['sweet shop'], shape: 'square', seed: 1, used: new Set(), skipGallery: true })
    expect(searches.map(s => s.query)).toEqual(['indian sweet shop', 'sweet shop'])
    expect(p?.url).toBe('https://cdn.example.com/stock/pixabay-7.webp')
    expect(p?.galleryId).toBeUndefined()
    expect(h.queryOne).not.toHaveBeenCalled()
  })

  it('reuses a file already in the bucket without downloading it', async () => {
    gatewayAnswers({ 'indian tea': [hit('9', { width: 4000, height: 3000 })] })
    h.inspect.mockResolvedValue({ size: 1234, contentType: 'image/webp', head: Buffer.alloc(1) })
    const p = await stockPicture({ queries: ['tea'], shape: 'square', seed: 1, used: new Set(), skipGallery: true })
    expect(h.fetchRemote).not.toHaveBeenCalled()
    expect(h.upload).not.toHaveBeenCalled()
    expect(p).toMatchObject({ url: 'https://cdn.example.com/stock/pixabay-9.webp', width: 1600, height: 1200 })
  })

  it('tries another hit when a copy fails, and gives null when nothing is found', async () => {
    gatewayAnswers({ 'indian tea': [hit('1'), hit('2')] })
    h.fetchRemote.mockRejectedValueOnce(new Error('403'))
    const used = new Set<string>()
    const p = await stockPicture({ queries: ['tea'], shape: 'square', seed: 1, used, skipGallery: true })
    expect(p).not.toBeNull()
    expect(used.size).toBe(2)
    gatewayAnswers({})
    expect(await stockPicture({ queries: ['nothing'], shape: 'square', seed: 1, used: new Set() })).toBeNull()
  })

  it('treats a gateway failure as no hit', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await stockPicture({ queries: ['tea'], shape: 'square', seed: 1, used: new Set() })).toBeNull()
    fetchMock.mockResolvedValue(json({ error: 'unauthorized' }, 401))
    expect(await stockPicture({ queries: ['tea'], shape: 'square', seed: 1, used: new Set() })).toBeNull()
  })
})

describe('pictureFor: stock first, AI as the fallback', () => {
  const ai = { prompt: 'a mood photo', feature: 'homepage_image', quality: 'draft' as const }

  it('uses a stock photo and never calls the AI (no billing)', async () => {
    gatewayAnswers({ 'indian tea': [hit('5')] })
    const p = await pictureFor({ stock: { queries: ['tea'], shape: 'square', seed: 1, used: new Set() }, ai })
    expect(p).toMatchObject({ source: 'stock', credit: { source: 'pixabay' } })
    expect(h.generateImage).not.toHaveBeenCalled()
  })

  it('generates when stock finds nothing', async () => {
    gatewayAnswers({})
    const p = await pictureFor({ stock: { queries: ['tea'], shape: 'square', seed: 1, used: new Set() }, ai, aiAllowed: () => true })
    expect(h.generateImage).toHaveBeenCalledWith(ai)
    expect(p).toEqual({ url: 'https://cdn.example.com/gallery/ai.webp', width: 1024, height: 1024, galleryId: 'gal-ai', credit: null, source: 'ai' })
  })

  it('makes nothing when the budget forbids the AI or there is no AI fallback', async () => {
    gatewayAnswers({})
    expect(await pictureFor({ stock: { queries: ['tea'], shape: 'square', seed: 1, used: new Set() }, ai, aiAllowed: () => false })).toBeNull()
    expect(await pictureFor({ stock: { queries: ['tea'], shape: 'square', seed: 1, used: new Set() }, ai: null })).toBeNull()
    expect(h.generateImage).not.toHaveBeenCalled()
  })

  it('lets an AI failure through, as generateImage did', async () => {
    gatewayAnswers({})
    h.generateImage.mockRejectedValue(new Error('provider down'))
    await expect(pictureFor({ stock: { queries: ['tea'], shape: 'square', seed: 1, used: new Set() }, ai })).rejects.toThrow('provider down')
  })
})
