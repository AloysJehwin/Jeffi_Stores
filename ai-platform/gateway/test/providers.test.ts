import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleProvider } from '../src/providers/google'
import { ReplicateProvider } from '../src/providers/replicate'
import { SdWebuiProvider } from '../src/providers/sd-webui'
import { imageDims, nearestAspect } from '../src/providers/types'
import { ollamaChat, ollamaEmbed } from '../src/providers/ollama'

const PNG_B64 = Buffer.from('89504e470d0a1a0a0000000d49484452000002000000030008060000', 'hex').toString('base64')

type Call = { url: string; init?: RequestInit }
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const out = handler(url, init)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
const body = (c: Call) => JSON.parse(String(c.init?.body))

afterEach(() => { vi.unstubAllGlobals() })

const req = { prompt: 'red shoe', width: 1024, height: 576, n: 2, quality: 'standard' as const }

describe('helpers', () => {
  it('reads PNG dims and picks the nearest aspect', () => {
    expect(imageDims(Buffer.from(PNG_B64, 'base64'))).toEqual({ width: 512, height: 768 })
    expect(nearestAspect(1024, 576, ['1:1', '16:9', '9:16'])).toBe('16:9')
    expect(nearestAspect(1000, 1010, ['1:1', '16:9'])).toBe('1:1')
  })
})

describe('google', () => {
  it('is unconfigured without a key', () => {
    expect(new GoogleProvider('').configured()).toBe(false)
  })

  it('generates images through generateContent, one call per image', async () => {
    const calls = mockFetch(() => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }))
    const g = new GoogleProvider('k', 'gemini-2.5-flash-image-preview', 'gemini-2.5-flash-image-preview', '')
    const out = await g.generateImage!({ ...req, seed: 3 })
    expect(out.model).toBe('gemini-2.5-flash-image-preview')
    expect(out.images).toHaveLength(2)
    expect(out.images[0]).toMatchObject({ width: 512, height: 768, mime: 'image/png' })
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent')
    expect((calls[0].init?.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(body(calls[0])).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'red shoe' }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '16:9' }, seed: 3 },
    })
  })

  it('uses the premium model for premium quality and the imagen fallback only when set', async () => {
    let n = 0
    const calls = mockFetch(url => {
      n++
      if (url.includes(':generateContent')) return new Response('nope', { status: 500 })
      return { predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }] }
    })
    const g = new GoogleProvider('k', 'gemini-2.5-flash-image-preview', 'gemini-3-pro-image', 'imagen-4.0-generate-001')
    const out = await g.generateImage!({ ...req, n: 1, quality: 'premium' })
    expect(calls[0].url).toContain('/models/gemini-3-pro-image:generateContent')
    expect(calls[1].url).toContain('/models/imagen-4.0-generate-001:predict')
    expect(body(calls[1])).toMatchObject({ instances: [{ prompt: 'red shoe' }], parameters: { sampleCount: 1, aspectRatio: '16:9' } })
    expect(out.model).toBe('imagen-4.0-generate-001')
    expect(n).toBe(2)

    mockFetch(() => new Response('nope', { status: 500 }))
    await expect(new GoogleProvider('k', 'm', 'p', '').generateImage!({ ...req, n: 1 })).rejects.toThrow(/HTTP 500/)
  })

  it('starts Veo with snapped duration and polls the operation to bytes', async () => {
    const calls = mockFetch((url) => {
      if (url.includes(':predictLongRunning')) return { name: 'models/veo/operations/abc' }
      if (url.endsWith('/operations/abc')) return { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.example/v.mp4' } }] } } }
      return new Response(Buffer.from('mp4'), { status: 200, headers: { 'content-type': 'video/mp4' } })
    })
    const g = new GoogleProvider('k', 'm', 'p', '', 'veo-3.1-fast-generate-preview', '')
    const s = await g.startVideo!({ prompt: 'reel', durationSec: 5, aspect: '1:1' })
    expect(s).toEqual({ opId: 'models/veo/operations/abc', model: 'veo-3.1-fast-generate-preview', durationSec: 4, aspect: '9:16' })
    expect(body(calls[0])).toEqual({ instances: [{ prompt: 'reel' }], parameters: { aspectRatio: '9:16', durationSeconds: '4', resolution: '720p', numberOfVideos: 1 } })
    const p = await g.pollVideo!(s.opId, s.model)
    expect(p.done).toBe(true)
    expect(p.result?.bytes.toString()).toBe('mp4')
    expect(calls[2].url).toBe('https://files.example/v.mp4')
    expect((calls[2].init?.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
  })

  it('reports pending and operation errors', async () => {
    mockFetch(() => ({ done: false }))
    const g = new GoogleProvider('k')
    expect(await g.pollVideo!('operations/x', 'm')).toEqual({ done: false })
    mockFetch(() => ({ done: true, error: { message: 'blocked' } }))
    expect(await g.pollVideo!('operations/x', 'm')).toEqual({ done: true, error: 'blocked' })
  })
})

describe('replicate', () => {
  it('picks flux by quality, polls to success and downloads outputs', async () => {
    let gets = 0
    const calls = mockFetch((url) => {
      if (url.endsWith('/predictions') ) return { id: 'p1', status: 'starting' }
      if (url.endsWith('/predictions/p1')) { gets++; return { id: 'p1', status: 'succeeded', output: ['https://r/1.png', 'https://r/2.png'] } }
      return new Response(Buffer.from(PNG_B64, 'base64'), { headers: { 'content-type': 'image/png' } })
    })
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const p = new ReplicateProvider('tok').generateImage!({ ...req, quality: 'draft' })
    await vi.runAllTimersAsync()
    const out = await p
    vi.useRealTimers()
    expect(out.model).toBe('black-forest-labs/flux-schnell')
    expect(out.images).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions')
    expect(body(calls[0]).input).toMatchObject({ prompt: 'red shoe', aspect_ratio: '16:9', num_outputs: 2 })
    expect(gets).toBe(1)
  })

  it('video uses wan t2v, i2v with an image, and maps statuses', async () => {
    const r = new ReplicateProvider('tok')
    expect(r.videoModel!({ prompt: 'x', durationSec: 5, aspect: '16:9' })).toBe('wan-video/wan-2.2-t2v-fast')
    expect(r.videoModel!({ prompt: 'x', durationSec: 5, aspect: '16:9', imageUrl: 'data:image/png;base64,AA==' })).toBe('wan-video/wan-2.2-i2v-fast')
    mockFetch(() => ({ id: 'v1', status: 'processing' }))
    expect(await r.pollVideo!('v1', 'm')).toEqual({ done: false })
    mockFetch(() => ({ id: 'v1', status: 'failed', error: 'nsfw' }))
    expect(await r.pollVideo!('v1', 'm')).toEqual({ done: true, error: 'nsfw' })
  })
})

describe('sd-webui (razer)', () => {
  it('posts txt2img, and img2img with a reference image; model from the API when not pinned', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/sdapi/v1/options')) return { sd_model_checkpoint: 'juggernautXL_v9 [abc123]' }
      return { images: [PNG_B64, PNG_B64] }
    })
    const sd = new SdWebuiProvider('http://razer:7860')
    const out = await sd.generateImage!({ ...req, seed: 9 })
    expect(out.model).toBe('juggernautXL_v9')
    expect(out.images).toHaveLength(2)
    expect(calls[0].url).toBe('http://razer:7860/sdapi/v1/txt2img')
    expect(body(calls[0])).toMatchObject({ prompt: 'red shoe', width: 1024, height: 576, batch_size: 2, seed: 9 })

    await new SdWebuiProvider('http://razer:7860', 'sdxl').generateImage!({ ...req, n: 1, referenceImageUrl: `data:image/png;base64,${PNG_B64}` })
    const last = calls[calls.length - 1]
    expect(last.url).toBe('http://razer:7860/sdapi/v1/img2img')
    expect(body(last).init_images).toEqual([PNG_B64])
  })

  it('is unconfigured without SD_WEBUI_URL', () => {
    expect(new SdWebuiProvider('').configured()).toBe(false)
  })
})

describe('ollama usage mapping', () => {
  it('returns prompt_eval_count / eval_count from chat', async () => {
    mockFetch(() => ({ message: { content: 'hi' }, prompt_eval_count: 120, eval_count: 30 }))
    const r = await ollamaChat({ messages: [{ role: 'user', content: 'hello' }] })
    expect(r).toMatchObject({ content: 'hi', promptTokens: 120, completionTokens: 30 })
  })

  it('defaults missing counts to 0, including on tool calls', async () => {
    mockFetch(() => ({ message: { content: '', tool_calls: [{ function: { name: 'f', arguments: '{"a":1}' } }] } }))
    const r = await ollamaChat({ messages: [{ role: 'user', content: 'x' }] })
    expect(r).toMatchObject({ promptTokens: 0, completionTokens: 0, toolCalls: [{ name: 'f', arguments: { a: 1 } }] })
  })

  it('embed sums counts and estimates when the endpoint omits them', async () => {
    mockFetch((_u, init) => {
      const prompt = JSON.parse(String(init?.body)).prompt
      return prompt === 'abcdefgh' ? { embedding: [1, 2] } : { embedding: [3], prompt_eval_count: 7 }
    })
    const r = await ollamaEmbed(['abcdefgh', 'other'])
    expect(r).toEqual({ embeddings: [[1, 2], [3]], promptTokens: 2 + 7 })
  })
})
