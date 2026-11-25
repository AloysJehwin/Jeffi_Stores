import { beforeEach, describe, expect, it } from 'vitest'
import {
  handleImageGenerate, handleVideoStart, imageRoute, videoRoute, textRoute, parseImageRequest,
  providerStatus, ValidationError, NotConfiguredError, type ImageRouterDeps, type VideoRouterDeps,
  chatRoute, visionRoute, orderedStatus, defaultTextOrder, parseImageProviders, parseVideoProviders,
  parseTextOrder, parseImageOrder, parseVideoOrder, IMAGE_PROVIDER_ORDER, VIDEO_PROVIDER_ORDER,
} from '../src/media'
import { parseSttOrder, parseTtsOrder } from '../src/audio'
import { createFileStore } from '../src/files'
import { modelSource, options } from '../src/models'
import { createVideoJobStore } from '../src/video-jobs'
import { loadPrices } from '../src/pricing'
import type { MediaProvider } from '../src/providers/types'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function img(name: 'razer' | 'google' | 'replicate' | 'azure', configured = true) {
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

  it('text: razer then azure without Claude; forceProvider ignores the order', () => {
    expect(textRoute({})).toEqual(['razer', 'azure'])
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

  it('skips razer while its breaker is open and says why when nothing is left', async () => {
    const providers = { razer: img('razer'), google: img('google', false), replicate: img('replicate', false), azure: img('azure') }
    const up: ImageRouterDeps = { providers, order: IMAGE_PROVIDER_ORDER, files: createFileStore(null), available: n => n !== 'razer' }
    expect((await handleImageGenerate({ prompt: 'x' }, up)).provider).toBe('azure')
    expect(providers.razer.calls).toHaveLength(0)
    const onlyRazer: ImageRouterDeps = { ...up, providers: { razer: img('razer') } }
    await expect(handleImageGenerate({ prompt: 'x' }, onlyRazer)).rejects.toThrow('no image provider available (razer down)')
  })
})

describe('models per provider', () => {
  const source = modelSource({
    replicate: cap => (cap === 'image' ? { models: options(['flux-dev', 'flux-pro'], 'flux-dev') } : cap === 'video' ? { models: options(['wan']) } : null),
    google: cap => (cap === 'image' || cap === 'video' ? { models: options(['gemini-x', 'veo-x']) } : null),
    razer: cap => (cap === 'image' ? { models: options(['sdxl-turbo']) } : null),
  })

  it('hands each image provider its own model and reports the model used', async () => {
    const seen: (string | undefined)[] = []
    const rep: MediaProvider = {
      name: 'replicate', configured: () => true,
      async generateImage(r) { seen.push(r.model); return { model: r.model ?? 'flux-dev', images: [{ bytes: PNG, mime: 'image/png', width: 1, height: 1 }] } },
    }
    const deps: ImageRouterDeps = { providers: { replicate: rep }, order: ['replicate'], files: createFileStore(null), models: source }
    const r = await handleImageGenerate({ prompt: 'x', models: { replicate: 'flux-pro', google: 'gemini-x' } }, deps)
    expect(r.model).toBe('flux-pro')
    expect(seen).toEqual(['flux-pro'])
    await expect(handleImageGenerate({ prompt: 'x', models: { replicate: 'sdxl-turbo' } }, deps)).rejects.toThrow(/replicate has no image model "sdxl-turbo"/)
    await expect(handleImageGenerate({ prompt: 'x', models: { azure: 'gpt-image-1' } }, deps)).rejects.toThrow('azure is not a image provider')
  })

  it('partitions the image cache by models, whatever their order', () => {
    const a = parseImageRequest({ prompt: 'x', namespace: 't' })
    const b = parseImageRequest({ prompt: 'x', namespace: 't', models: { replicate: 'flux-pro', google: 'gemini-x' } }, source)
    const c = parseImageRequest({ prompt: 'x', namespace: 't', models: { google: 'gemini-x', replicate: 'flux-pro' } }, source)
    expect(b.cacheKey).not.toBe(a.cacheKey)
    expect(b.cacheKey).toBe(c.cacheKey)
  })

  it('starts video with the chosen model and validates it', async () => {
    const starts: (string | undefined)[] = []
    const g: MediaProvider = {
      name: 'google', configured: () => true,
      async startVideo(r) { starts.push(r.model); return { opId: 'op', model: r.model ?? 'veo-default', durationSec: 4 } },
    }
    const deps: VideoRouterDeps = { providers: { google: g }, order: ['google'], jobs: createVideoJobStore(null), files: createFileStore(null), models: source }
    expect((await handleVideoStart({ prompt: 'x', models: { google: 'veo-x' } }, deps)).model).toBe('veo-x')
    expect(starts).toEqual(['veo-x'])
    await expect(handleVideoStart({ prompt: 'x', models: { replicate: 'nope' } }, deps)).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('azure in every order', () => {
  it('is appended to the existing defaults, which keep their order', () => {
    expect(defaultTextOrder(undefined, true)).toEqual(['anthropic', 'razer', 'azure'])
    expect(defaultTextOrder(undefined, false)).toEqual(['razer', 'azure'])
    expect(defaultTextOrder('azure,anthropic', true)).toEqual(['azure', 'anthropic'])
    expect(parseImageProviders(undefined)).toEqual(['razer', 'google', 'replicate', 'azure'])
    expect(parseVideoProviders(undefined)).toEqual(['google', 'replicate', 'azure'])
  })

  it('is an allowed caller provider everywhere', () => {
    expect(parseTextOrder(['azure'])).toEqual(['azure'])
    expect(parseImageOrder(['azure', 'razer'])).toEqual(['azure', 'razer'])
    expect(parseVideoOrder(['azure'])).toEqual(['azure'])
    expect(parseSttOrder(['azure'])).toEqual(['azure'])
    expect(parseTtsOrder(['azure'])).toEqual(['azure'])
    expect(() => parseSttOrder(['razer'])).toThrow(ValidationError)
    expect(textRoute({ forceProvider: 'anthropic', providers: ['azure', 'anthropic'] })).toEqual(['anthropic'])
  })

  it('leaves the quality bias to the existing providers', () => {
    const order = [...IMAGE_PROVIDER_ORDER]
    expect(imageRoute({ prompt: 'x', quality: 'premium' }, order)).toEqual(['google', 'razer', 'replicate', 'azure'])
    expect(imageRoute({ prompt: 'x', quality: 'draft' }, ['azure', 'google', 'razer'])).toEqual(['razer', 'azure', 'google'])
    expect(imageRoute({ prompt: 'x', provider: 'azure' }, order)).toEqual(['azure', 'razer', 'google', 'replicate'])
    expect(videoRoute({ prompt: 'x' }, [...VIDEO_PROVIDER_ORDER])).toEqual(['google', 'replicate', 'azure'])
  })
})

describe('chat and vision routes', () => {
  const all = () => true
  const noClaude = (p: string) => p !== 'anthropic'

  it('chat drops providers without credentials and skips razer while it is down', () => {
    expect(chatRoute(['anthropic', 'razer', 'azure'], all, true)).toEqual(['anthropic', 'razer', 'azure'])
    expect(chatRoute(['anthropic', 'razer', 'azure'], noClaude, true)).toEqual(['razer', 'azure'])
    expect(chatRoute(['anthropic', 'razer', 'azure'], all, false)).toEqual(['anthropic', 'azure'])
    // razer alone stays, so a cached answer is still served and a miss fails fast.
    expect(chatRoute(['razer', 'azure'], () => false, false)).toEqual(['razer'])
    expect(chatRoute(['anthropic'], () => false, true)).toEqual([])
  })

  it('vision tries cloud providers up to razer, which ends the route unless it is down', () => {
    expect(visionRoute(['anthropic', 'razer', 'azure'], all, true)).toEqual(['anthropic', 'razer'])
    expect(visionRoute(['razer', 'anthropic'], all, true)).toEqual(['razer'])
    expect(visionRoute(['anthropic', 'razer', 'azure'], all, false)).toEqual(['anthropic', 'azure'])
    expect(visionRoute(['azure', 'razer'], noClaude, true)).toEqual(['azure', 'razer'])
    expect(visionRoute(['razer'], all, false)).toEqual(['razer'])
    expect(visionRoute(['anthropic'], () => false, true)).toEqual([])
  })

  it('orders status entries by the default order, then the rest', () => {
    const entries = { anthropic: { name: 'anthropic' as const, configured: true }, razer: { name: 'razer' as const, configured: false }, azure: { name: 'azure' as const, configured: true } }
    expect(orderedStatus(['razer', 'azure'], entries).map(e => e.name)).toEqual(['razer', 'azure', 'anthropic'])
  })
})
