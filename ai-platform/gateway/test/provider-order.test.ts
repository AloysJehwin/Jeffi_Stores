import { beforeEach, describe, expect, it } from 'vitest'
import {
  handleImageGenerate, handleVideoStart, imageRoute, videoRoute, textRoute, parseImageRequest,
  providerStatus, ValidationError, NotConfiguredError, type ImageRouterDeps, type VideoRouterDeps,
} from '../src/media'
import { createFileStore } from '../src/files'
import { createVideoJobStore } from '../src/video-jobs'
import { loadPrices } from '../src/pricing'
import type { MediaProvider } from '../src/providers/types'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function img(name: 'razer' | 'google' | 'replicate', configured = true) {
  const calls: string[] = []
  const p: MediaProvider & { calls: string[] } = {
    name, calls,
    configured: () => configured,
    async generateImage(req) {
      calls.push(req.prompt)
      return { model: `${name}-m`, images: [{ bytes: PNG, mime: 'image/png', width: 64, height: 64 }] }
    },
  }
  return p
}

function vid(name: 'google' | 'replicate') {
  return {
    name, configured: () => true,
    async startVideo() { return { opId: `${name}-op`, model: `${name}-v`, durationSec: 5 } },
    async pollVideo() { return { done: false } },
  } as MediaProvider
}

beforeEach(() => { loadPrices('') })

describe('caller provider order', () => {
  const env = ['razer', 'google', 'replicate'] as const

  it('overrides the env order and restricts to the listed providers', () => {
    expect(imageRoute({ prompt: 'x', providers: ['replicate', 'google'] }, [...env])).toEqual(['replicate', 'google'])
    expect(videoRoute({ prompt: 'x', providers: ['replicate'] }, ['google', 'replicate'])).toEqual(['replicate'])
  })

  it('a forced provider still wins', () => {
    expect(imageRoute({ prompt: 'x', provider: 'razer', providers: ['google'] }, [...env])).toEqual(['razer', 'google'])
    expect(videoRoute({ prompt: 'x', provider: 'google', providers: ['replicate'] }, ['google', 'replicate'])).toEqual(['google', 'replicate'])
  })

  it('empty or missing order falls back to the env order; unknown names are a 400', () => {
    expect(imageRoute({ prompt: 'x', providers: [] }, [...env])).toEqual([...env])
    expect(() => imageRoute({ prompt: 'x', providers: ['openai' as never] }, [...env])).toThrow(ValidationError)
    expect(() => parseImageRequest({ prompt: 'x', providers: 'google' as never })).toThrow(ValidationError)
    expect(() => videoRoute({ prompt: 'x', providers: ['razer' as never] }, ['google'])).toThrow(ValidationError)
  })

  it('keeps quality bias inside the requested order', () => {
    expect(imageRoute({ prompt: 'x', quality: 'premium', providers: ['replicate', 'google'] }, [...env])).toEqual(['google', 'replicate'])
  })

  it('text: razer only; forceProvider ignores the order', () => {
    expect(textRoute({})).toEqual(['razer'])
    expect(textRoute({ providers: ['razer'] })).toEqual(['razer'])
    expect(() => textRoute({ providers: ['google'] })).toThrow(ValidationError)
    expect(textRoute({ forceProvider: 'ollama', providers: [] })).toEqual(['razer'])
  })

  it('partitions the image cache by requested order', () => {
    const a = parseImageRequest({ prompt: 'x', namespace: 't' })
    const b = parseImageRequest({ prompt: 'x', namespace: 't', providers: ['google'] })
    expect(a.cacheKey).not.toBe(b.cacheKey)
    expect(parseImageRequest({ prompt: 'x', namespace: 't', providers: [] }).cacheKey).toBe(a.cacheKey)
  })
})

describe('routing end to end', () => {
  it('generates on the first provider of the requested order', async () => {
    const providers = { razer: img('razer'), google: img('google'), replicate: img('replicate') }
    const deps: ImageRouterDeps = { providers, order: ['razer', 'google', 'replicate'], files: createFileStore(null) }
    const r = await handleImageGenerate({ prompt: 'shoe', providers: ['replicate', 'razer'] }, deps)
    expect(r.provider).toBe('replicate')
    expect(providers.razer.calls).toHaveLength(0)
  })

  it('503 when every requested provider is unconfigured', async () => {
    const deps: ImageRouterDeps = {
      providers: { razer: img('razer'), google: img('google', false), replicate: img('replicate') },
      order: ['razer', 'google', 'replicate'], files: createFileStore(null),
    }
    await expect(handleImageGenerate({ prompt: 'x', providers: ['google'] }, deps)).rejects.toBeInstanceOf(NotConfiguredError)
  })

  it('starts video on the requested provider', async () => {
    const deps: VideoRouterDeps = {
      providers: { google: vid('google'), replicate: vid('replicate') },
      order: ['google', 'replicate'], jobs: createVideoJobStore(null), files: createFileStore(null),
    }
    const r = await handleVideoStart({ prompt: 'x', providers: ['replicate'] }, deps)
    expect(r.provider).toBe('replicate')
  })

  it('reports configured state in default order', () => {
    expect(providerStatus(['google'], { razer: img('razer', false), google: img('google') }))
      .toEqual([{ name: 'google', configured: true }, { name: 'razer', configured: false }])
  })
})
