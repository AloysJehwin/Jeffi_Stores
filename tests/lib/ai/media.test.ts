import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  class AiWalletError extends Error {
    status = 402 as const
    constructor(message: string, public balanceInr: number, public neededInr: number) {
      super(message)
    }
  }
  return {
    AiWalletError,
    preauthorize: vi.fn(),
    settle: vi.fn(),
    upload: vi.fn(),
    putObject: vi.fn(),
    query: vi.fn(),
    queryOne: vi.fn(),
  }
})

vi.mock('@/lib/ai/billing', () => ({ preauthorize: h.preauthorize, settle: h.settle, AiWalletError: h.AiWalletError }))
vi.mock('@/lib/shared/ai-client', () => ({ aiGatewayUrl: () => 'http://gw:8080' }))
vi.mock('@/lib/shared/s3', () => ({
  uploadGalleryImage: h.upload,
  putObjectBuffer: h.putObject,
  getS3Url: async (k: string) => `https://cdn.example.com/${k}`,
  currentBucket: async () => 'bucket',
}))
vi.mock('@/lib/shared/db', () => ({ query: h.query, queryOne: h.queryOne }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: async () => 'tenant-1' }))

import { generateImage, generateVideo, videoJob, AiMediaError, __resetAiMediaState } from '@/lib/ai/media'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const bytes = () => new Response(new Uint8Array([1, 2, 3]))

let fetchMock: ReturnType<typeof vi.fn>
let usageRow: { status: string; price_inr: number }

beforeEach(() => {
  vi.clearAllMocks()
  __resetAiMediaState()
  usageRow = { status: 'pending', price_inr: 4 }
  h.preauthorize.mockResolvedValue({ usageId: 'usage-1', priceInr: 4 })
  h.settle.mockImplementation(async (_id: string, input: { status: string }) => {
    usageRow.status = input.status
  })
  h.upload.mockImplementation(async (_b: Buffer, name: string) => ({
    url: `https://cdn.example.com/gallery/${name}`,
    thumbnailUrl: 'https://cdn.example.com/thumb.png',
    s3Key: `gallery/${name}`,
    s3ThumbnailKey: 'gallery/thumbnails/x.png',
    fileName: name,
    fileSize: 3,
    width: 1024,
    height: 1024,
    blurhash: 'LEHV',
  }))
  h.putObject.mockImplementation(async (key: string) => key)
  h.query.mockResolvedValue({ rows: [] })
  h.queryOne.mockImplementation(async (sql: string) => {
    if (/SELECT status FROM ai_usage/.test(sql)) return { status: usageRow.status }
    if (/SELECT price_inr FROM ai_usage/.test(sql)) return { price_inr: usageRow.price_inr }
    if (/INSERT INTO gallery_images/.test(sql)) return { id: 'gal-1' }
    return null
  })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const gatewayImage = {
  images: [
    { url: '/v1/files/a', width: 1024, height: 1024, mime: 'image/png' },
    { url: 'data:image/png;base64,AQID', width: 1024, height: 1024, mime: 'image/png' },
  ],
  provider: 'razer',
  model: 'sdxl',
  usage: { units: 2, unitType: 'image', costInr: 0.6 },
  latencyMs: 900,
  cache: null,
}

describe('generateImage', () => {
  it('pre-authorises, calls the gateway, persists each image to S3 once and settles with the gateway usage', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith('/v1/images/generate') ? json(gatewayImage) : bytes()))
    const r = await generateImage({ prompt: 'a red bolt', n: 2, feature: 'social_image', actor: 'a@b.c', saveToGallery: true })

    expect(h.preauthorize).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'social_image', capability: 'image', estimateUnits: [{ type: 'image', qty: 2 }], actor: 'a@b.c' })
    )
    const [gwUrl, init] = fetchMock.mock.calls[0]
    expect(gwUrl).toBe('http://gw:8080/v1/images/generate')
    expect(JSON.parse(init.body)).toMatchObject({ prompt: 'a red bolt', n: 2, quality: 'standard', namespace: 'tenant-1' })
    // Relative gateway file URL is resolved against the gateway; the data URL needs no fetch.
    expect(fetchMock).toHaveBeenCalledWith('http://gw:8080/v1/files/a', expect.anything())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.upload).toHaveBeenCalledTimes(2)
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ai_usage SET provider'), ['usage-1', 'razer', 'sdxl'])
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.settle).toHaveBeenCalledWith('usage-1', expect.objectContaining({ units: [{ type: 'image', qty: 2 }], costInr: 0.6, status: 'ok' }))
    expect(r.images).toHaveLength(2)
    expect(r.images[0].url).toMatch(/^https:\/\/cdn\.example\.com\/gallery\//)
    expect(r.images[0].galleryId).toBe('gal-1')
    expect(r).toMatchObject({ usageId: 'usage-1', priceInr: 4, provider: 'razer', model: 'sdxl' })
  })

  it('propagates AiWalletError before calling the gateway', async () => {
    h.preauthorize.mockRejectedValue(new h.AiWalletError('Insufficient wallet balance', 1, 3))
    await expect(generateImage({ prompt: 'a red bolt', feature: 'social_image' })).rejects.toMatchObject({ status: 402, balanceInr: 1, neededInr: 3 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('settles failed and maps the all-providers-failed 502 to a clear error', async () => {
    fetchMock.mockResolvedValue(json({ error: 'image generation failed on all providers', tried: [{ provider: 'razer', error: 'down' }] }, 502))
    const err = await generateImage({ prompt: 'a red bolt', feature: 'social_image' }).catch(e => e)
    expect(err).toBeInstanceOf(AiMediaError)
    expect(err.status).toBe(502)
    expect(err.message).toMatch(/Every AI provider failed.*razer: down/)
    expect(h.settle).toHaveBeenCalledWith('usage-1', expect.objectContaining({ status: 'failed' }))
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('maps a 503 (no provider configured) to a setup message', async () => {
    fetchMock.mockResolvedValue(json({ error: 'no image provider configured' }, 503))
    await expect(generateImage({ prompt: 'a red bolt', feature: 'social_image' })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/not set up/) })
  })

  it('does not charge when the image cannot be saved, but logs the provider cost', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith('/v1/images/generate') ? json({ ...gatewayImage, images: [gatewayImage.images[0]] }) : new Response('x', { status: 404 })))
    await expect(generateImage({ prompt: 'a red bolt', feature: 'social_image' })).rejects.toBeInstanceOf(AiMediaError)
    expect(h.settle).toHaveBeenCalledWith('usage-1', expect.objectContaining({ status: 'failed', costInr: 0.6 }))
  })
})

describe('generateVideo and videoJob', () => {
  it('starts a job, then persists the finished video to S3 once and settles once', async () => {
    h.preauthorize.mockResolvedValue({ usageId: 'usage-v', priceInr: 12 })
    let polls = 0
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/v1/video/generate')) return json({ jobId: 'job-1', provider: 'google', model: 'veo-3', estimatedCostInr: 10 })
      if (u.endsWith('/v1/jobs/job-1')) {
        polls++
        return polls === 1
          ? json({ status: 'running' })
          : json({ status: 'done', result: { videoUrl: '/v1/files/v', durationSec: 6, width: 720, height: 1280, mime: 'video/mp4' }, usage: { units: 6, unitType: 'video_second', costInr: 9 } })
      }
      return bytes()
    })

    const start = await generateVideo({ prompt: 'a bolt spinning', durationSec: 5, aspect: '9:16', feature: 'social_video' })
    expect(start).toMatchObject({ jobId: 'job-1', usageId: 'usage-v', estimatedPriceInr: 12 })
    expect(h.preauthorize).toHaveBeenCalledWith(expect.objectContaining({ capability: 'video', estimateUnits: [{ type: 'video_second', qty: 4 }] }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ durationSec: 4, aspect: '9:16' })

    expect(await videoJob('job-1')).toEqual({ status: 'running' })
    const [a, b] = await Promise.all([videoJob('job-1'), videoJob('job-1')])
    const again = await videoJob('job-1')
    for (const r of [a, b, again]) expect(r).toMatchObject({ status: 'done', videoUrl: 'https://cdn.example.com/ai/video/job-1.mp4', durationSec: 6 })
    expect(h.putObject).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://gw:8080/v1/files/v', expect.anything())
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(h.settle).toHaveBeenCalledWith('usage-v', expect.objectContaining({ units: [{ type: 'video_second', qty: 6 }], costInr: 9, status: 'ok' }))
  })

  it('on another pod, rebuilds the URL without re-persisting once the usage row is settled', async () => {
    usageRow.status = 'ok'
    fetchMock.mockResolvedValue(json({ status: 'done', result: { videoUrl: '/v1/files/v', durationSec: 4, width: 720, height: 1280, mime: 'video/mp4' } }))
    const r = await videoJob('job-2', '11111111-1111-4111-8111-111111111111')
    expect(r).toMatchObject({ status: 'done', videoUrl: 'https://cdn.example.com/ai/video/job-2.mp4' })
    expect(h.putObject).not.toHaveBeenCalled()
    expect(h.settle).not.toHaveBeenCalled()
  })

  it('settles a failed job as failed', async () => {
    fetchMock.mockResolvedValue(json({ status: 'failed', error: 'policy' }))
    const r = await videoJob('job-3', '11111111-1111-4111-8111-111111111111')
    expect(r).toEqual({ status: 'failed', error: 'policy' })
    expect(h.settle).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', expect.objectContaining({ status: 'failed' }))
  })

  it('propagates AiWalletError on start without calling the gateway', async () => {
    h.preauthorize.mockRejectedValue(new h.AiWalletError('Insufficient wallet balance', 0, 12))
    await expect(generateVideo({ prompt: 'a bolt spinning', feature: 'social_video' })).rejects.toMatchObject({ status: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
