import { beforeEach, describe, expect, it } from 'vitest'
import {
  handleImageGenerate, handleVideoStart, advanceVideoJob, readVideoJob,
  imageRoute, parseImageProviders, parseVideoProviders, parseImageRequest, parseVideoRequest,
  UpstreamError, ValidationError, NotConfiguredError, type ImageRouterDeps, type VideoRouterDeps,
} from '../src/media'
import { createFileStore } from '../src/files'
import { createVideoJobStore } from '../src/video-jobs'
import { loadPrices, unitPrice } from '../src/pricing'
import type { ImageGenInput, MediaProvider, VideoPoll } from '../src/providers/types'

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000040000000400806000000', 'hex')

function imgProvider(name: 'razer' | 'google' | 'replicate', opts: { configured?: boolean; fail?: string; model?: string } = {}) {
  const calls: ImageGenInput[] = []
  const p: MediaProvider & { calls: ImageGenInput[] } = {
    name,
    calls,
    configured: () => opts.configured ?? true,
    async generateImage(req) {
      calls.push(req)
      if (opts.fail) throw new Error(opts.fail)
      return { model: opts.model ?? `${name}-model`, images: Array.from({ length: req.n }, () => ({ bytes: PNG, mime: 'image/png', width: 64, height: 64 })) }
    },
  }
  return p
}

class FakeRedis {
  store = new Map<string, string>()
  async get(k: string) { return this.store.get(k) ?? null }
  async set(k: string, v: string) { this.store.set(k, v); return 'OK' }
}

beforeEach(() => { loadPrices('') })

describe('request validation and clamping', () => {
  it('requires a prompt', () => {
    expect(() => parseImageRequest({ prompt: '  ' })).toThrow(ValidationError)
    expect(() => parseVideoRequest({})).toThrow(ValidationError)
  })

  it('defaults and clamps image size, n and quality', () => {
    const d = parseImageRequest({ prompt: 'x' })
    expect([d.width, d.height, d.n, d.quality]).toEqual([1024, 1024, 1, 'standard'])
    const c = parseImageRequest({ prompt: 'x', width: 5000, height: 10, n: 9, quality: 'ultra' as never })
    expect([c.width, c.height, c.n, c.quality]).toEqual([1536, 256, 4, 'standard'])
    expect(parseImageRequest({ prompt: 'x', width: 1000, height: 700 }).width % 64).toBe(0)
    expect(parseImageRequest({ prompt: 'x', n: 0 }).n).toBe(1)
  })

  it('ignores unknown providers and clamps video duration 2..8', () => {
    expect(parseImageRequest({ prompt: 'x', provider: 'openai' as never }).provider).toBeUndefined()
    expect(parseVideoRequest({ prompt: 'x', durationSec: 30 }).durationSec).toBe(8)
    expect(parseVideoRequest({ prompt: 'x', durationSec: 0 }).durationSec).toBe(2)
    expect(parseVideoRequest({ prompt: 'x' })).toMatchObject({ durationSec: 5, aspect: '16:9' })
  })

  it('cache key ignores seed but separates namespaces', () => {
    const a = parseImageRequest({ prompt: 'x', namespace: 't1', seed: 1 })
    const b = parseImageRequest({ prompt: 'x', namespace: 't1', seed: 2 })
    const c = parseImageRequest({ prompt: 'x', namespace: 't2' })
    expect(a.cacheKey).toBe(b.cacheKey)
    expect(a.cacheKey).not.toBe(c.cacheKey)
  })
})

describe('routing order', () => {
  it('parses provider env with defaults and drops unknowns', () => {
    expect(parseImageProviders(undefined)).toEqual(['razer', 'google', 'replicate'])
    expect(parseImageProviders('replicate, bogus,razer,replicate')).toEqual(['replicate', 'razer'])
    expect(parseVideoProviders('')).toEqual(['google', 'replicate'])
  })

  it('premium prefers google, draft prefers razer, pinned goes first', () => {
    const order = ['razer', 'google', 'replicate'] as const
    expect(imageRoute({ prompt: 'x', quality: 'premium' }, [...order])[0]).toBe('google')
    expect(imageRoute({ prompt: 'x', quality: 'draft' }, ['replicate', 'google', 'razer'])[0]).toBe('razer')
    expect(imageRoute({ prompt: 'x', provider: 'replicate' }, [...order])).toEqual(['replicate', 'razer', 'google'])
  })
})

describe('image generation', () => {
  function deps(over: Partial<ImageRouterDeps> = {}): ImageRouterDeps {
    return {
      providers: { razer: imgProvider('razer'), google: imgProvider('google'), replicate: imgProvider('replicate') },
      order: ['razer', 'google', 'replicate'],
      files: createFileStore(null),
      ...over,
    }
  }

  it('falls through a failing provider and records which one answered', async () => {
    const razer = imgProvider('razer', { fail: 'gpu busy' })
    const google = imgProvider('google', { model: 'gemini-3.1-flash-image' })
    const d = deps({ providers: { razer, google, replicate: imgProvider('replicate') } })
    const r = await handleImageGenerate({ prompt: 'shoe', n: 2 }, d)
    expect(r.provider).toBe('google')
    expect(r.model).toBe('gemini-3.1-flash-image')
    expect(r.images).toHaveLength(2)
    expect(r.images[0]).toMatchObject({ mime: 'image/png', width: 64, height: 64 })
    expect(r.images[0].url).toMatch(/^\/v1\/files\/[0-9a-f-]{36}$/)
    expect(r.usage).toEqual({ units: 2, unitType: 'image', costInr: unitPrice('google', 'gemini-3.1-flash-image', 'image') * 2 })
    expect(razer.calls).toHaveLength(1)
  })

  it('skips providers that are not configured', async () => {
    const razer = imgProvider('razer', { configured: false })
    const r = await handleImageGenerate({ prompt: 'x' }, deps({ providers: { razer, google: imgProvider('google'), replicate: imgProvider('replicate') } }))
    expect(r.provider).toBe('google')
    expect(razer.calls).toHaveLength(0)
  })

  it('reports every provider tried when all fail, and 503 when none configured', async () => {
    const all = { razer: imgProvider('razer', { fail: 'a' }), google: imgProvider('google', { fail: 'b' }), replicate: imgProvider('replicate', { fail: 'c' }) }
    const err = await handleImageGenerate({ prompt: 'x' }, deps({ providers: all })).catch(e => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect(err.tried.map((t: { provider: string }) => t.provider)).toEqual(['razer', 'google', 'replicate'])
    const none = { razer: imgProvider('razer', { configured: false }), google: imgProvider('google', { configured: false }), replicate: imgProvider('replicate', { configured: false }) }
    await expect(handleImageGenerate({ prompt: 'x' }, deps({ providers: none }))).rejects.toBeInstanceOf(NotConfiguredError)
  })

  it('serves a repeated prompt from the KV cache and bypasses it when seed is set', async () => {
    const razer = imgProvider('razer')
    const redis = new FakeRedis()
    const d = deps({ providers: { razer, google: imgProvider('google'), replicate: imgProvider('replicate') }, redis: redis as never })
    const first = await handleImageGenerate({ prompt: 'same', namespace: 't1' }, d)
    const second = await handleImageGenerate({ prompt: 'same', namespace: 't1' }, d)
    expect(first.cache).toBeNull()
    expect(second.cache).toBe('kv')
    expect(second.images[0].url).toBe(first.images[0].url)
    expect(razer.calls).toHaveLength(1)
    await handleImageGenerate({ prompt: 'same', namespace: 't1', seed: 7 }, d)
    await handleImageGenerate({ prompt: 'same', namespace: 't2' }, d)
    expect(razer.calls).toHaveLength(3)
  })

  it('stores bytes retrievable through the file store', async () => {
    const files = createFileStore(null)
    const r = await handleImageGenerate({ prompt: 'x' }, deps({ files, fileBaseUrl: 'http://gw' }))
    const id = r.images[0].url.split('/').pop()!
    expect(r.images[0].url.startsWith('http://gw/v1/files/')).toBe(true)
    expect((await files.get(id))?.bytes.equals(PNG)).toBe(true)
  })
})

describe('video job state machine', () => {
  function videoProvider(name: 'google' | 'replicate', polls: (VideoPoll | Error)[], opts: { configured?: boolean; startFail?: string } = {}) {
    let i = 0
    const p: MediaProvider = {
      name,
      configured: () => opts.configured ?? true,
      async startVideo(req) {
        if (opts.startFail) throw new Error(opts.startFail)
        return { opId: `${name}-op-1`, model: name === 'google' ? 'veo-3.1-fast-generate-preview' : 'wan-video/wan-2.2-t2v-fast', durationSec: 6, aspect: req.aspect === '1:1' ? '9:16' : req.aspect }
      },
      async pollVideo() {
        const next = polls[Math.min(i++, polls.length - 1)]
        if (next instanceof Error) throw next
        return next
      },
    }
    return p
  }

  function deps(providers: VideoRouterDeps['providers']): VideoRouterDeps {
    return { providers, order: ['google', 'replicate'], jobs: createVideoJobStore(null), files: createFileStore(null) }
  }

  it('queued -> running -> done with usage priced per produced second', async () => {
    const mp4 = Buffer.from('fake-mp4')
    const d = deps({ google: videoProvider('google', [{ done: false }, { done: true, result: { bytes: mp4, mime: 'video/mp4', width: 0, height: 0, durationSec: 0 } }]) })
    const start = await handleVideoStart({ prompt: 'reel', durationSec: 5, aspect: '1:1' }, d)
    expect(start).toMatchObject({ provider: 'google', model: 'veo-3.1-fast-generate-preview' })
    expect(start.estimatedCostInr).toBeCloseTo(unitPrice('google', 'veo-3.1-fast-generate-preview', 'video_second') * 6, 4)
    expect((await readVideoJob(start.jobId, d)).status).toBe('queued')

    expect((await advanceVideoJob(start.jobId, d)).status).toBe('running')
    const done = await advanceVideoJob(start.jobId, d)
    expect(done.status).toBe('done')
    expect(done.result).toMatchObject({ mime: 'video/mp4', durationSec: 6, width: 720, height: 1280 })
    expect(done.usage).toEqual({ units: 6, unitType: 'video_second', costInr: start.estimatedCostInr })
    const id = done.result!.videoUrl.split('/').pop()!
    expect((await d.files.get(id))?.bytes.equals(mp4)).toBe(true)
    // Terminal state is sticky.
    expect((await advanceVideoJob(start.jobId, d)).status).toBe('done')
  })

  it('marks the job failed on a provider error result or a thrown poll', async () => {
    const a = deps({ google: videoProvider('google', [{ done: true, error: 'safety block' }]) })
    const ja = await handleVideoStart({ prompt: 'x' }, a)
    expect(await advanceVideoJob(ja.jobId, a)).toMatchObject({ status: 'failed', error: 'safety block' })

    const b = deps({ google: videoProvider('google', [new Error('network')]) })
    const jb = await handleVideoStart({ prompt: 'x' }, b)
    expect(await advanceVideoJob(jb.jobId, b)).toMatchObject({ status: 'failed', error: 'network' })
  })

  it('falls through to the next provider when start fails, and 400s on unknown jobs', async () => {
    const d = deps({ google: videoProvider('google', [], { startFail: 'quota' }), replicate: videoProvider('replicate', [{ done: false }]) })
    const r = await handleVideoStart({ prompt: 'x' }, d)
    expect(r.provider).toBe('replicate')
    await expect(readVideoJob('nope', d)).rejects.toBeInstanceOf(ValidationError)
  })
})
