import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AzureProvider, AZURE_EMBED_DIMENSIONS, DEFAULT_VOICES, defaultVoice, speechContentType, toOpenAi, type AzureConfig,
} from '../src/providers/azure'
import { ProviderError } from '../src/providers/types'
import { loadPrices, unitPrice } from '../src/pricing'

const PNG_B64 = Buffer.from('89504e470d0a1a0a0000000d49484452000004000000040008060000', 'hex').toString('base64')

const CFG: AzureConfig = {
  endpoint: 'https://res.openai.azure.com', apiKey: 'test-key', apiVersion: '2025-04-01-preview',
  chatDeployment: 'gpt-4.1-mini', imageDeployment: 'gpt-image-1', embedDeployment: 'emb', transcribeDeployment: 'gpt-4o-transcribe',
  ttsDeployment: '', videoDeployment: '', speechKey: 'speech-key', speechRegion: 'centralindia', timeoutMs: 5_000, minMaxTokens: 4000,
}
const az = (over: Partial<AzureConfig> = {}) => new AzureProvider({ ...CFG, ...over })

type Call = { url: string; init?: RequestInit }
function mockFetch(handler: (url: string, init?: RequestInit, n?: number) => unknown) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const out = handler(url, init, calls.length)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
const body = (c: Call) => JSON.parse(String(c.init?.body))
const headers = (c: Call) => c.init?.headers as Record<string, string>
const sse = (chunks: unknown[]) => new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })

beforeEach(() => { loadPrices('') })
afterEach(() => { vi.unstubAllGlobals() })

describe('configured()', () => {
  it('needs endpoint, key and the capability deployment; speech needs its key', () => {
    const a = az()
    expect([a.chatConfigured(), a.imageConfigured(), a.embedConfigured(), a.videoConfigured()]).toEqual([true, true, true, false])
    expect([a.transcribeConfigured(), a.speakConfigured()]).toEqual([true, true])
    const none = az({ apiKey: '' })
    expect([none.chatConfigured(), none.imageConfigured(), none.embedConfigured()]).toEqual([false, false, false])
    const speechOnly = az({ endpoint: '', transcribeDeployment: '' })
    expect([speechOnly.transcribeConfigured(), speechOnly.speakConfigured()]).toEqual([true, true])
    const nothing = az({ endpoint: '', speechKey: '' })
    expect([nothing.transcribeConfigured(), nothing.speakConfigured()]).toEqual([false, false])
    expect(az({ videoDeployment: 'sora' }).videoConfigured()).toBe(true)
  })

  it('exposes per-capability views', () => {
    const a = az()
    expect(a.asImageProvider().configured()).toBe(true)
    expect(a.asVideoProvider().configured()).toBe(false)
    expect(a.asAudioProvider()).toMatchObject({ name: 'azure' })
    expect(a.asAudioProvider().speakConfigured()).toBe(true)
  })
})

describe('message mapping', () => {
  it('pairs tool calls with tool replies, generates ids and adds the JSON instruction', () => {
    const out = toOpenAi({
      jsonMode: true,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'f', arguments: { a: 1 } } }, { id: 'keep_1', function: { name: 'g', arguments: {} } }] },
        { role: 'tool', content: 'r1' },
        { role: 'user', content: 'next' },
        { role: 'tool', content: 'stray' },
      ],
    })
    expect(out[0]).toEqual({ role: 'system', content: 'sys' })
    expect(out[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'call_gen_0', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }, { id: 'keep_1' }] })
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'call_gen_0', content: 'r1' })
    expect(out[4]).toEqual({ role: 'tool', tool_call_id: 'keep_1', content: '(no result recorded)' })
    expect(out[5]).toEqual({ role: 'user', content: 'next' })
    expect(out[6]).toEqual({ role: 'user', content: 'Tool result:\nstray' })
    expect(out[7]).toMatchObject({ role: 'system', content: expect.stringContaining('JSON') })
  })
})

describe('chat', () => {
  it('posts to the chat deployment with the api key and maps usage, tool calls and stop reason', async () => {
    const calls = mockFetch(() => ({
      model: 'gpt-4.1-mini-2025-04-14',
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } },
    }))
    const r = await az().chat({ messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'lookup', description: 'd', parameters: {} } }], maxTokens: 9000 })
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-04-01-preview')
    expect(headers(calls[0])['api-key']).toBe('test-key')
    expect(body(calls[0])).toMatchObject({ max_completion_tokens: 9000, temperature: 0.2, tools: [{ type: 'function' }] })
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'lookup', arguments: { q: 'x' } }])
    expect(r.stopReason).toBe('tool_use')
    expect(r.model).toBe('gpt-4.1-mini-2025-04-14')
    expect(r.usage).toMatchObject({ promptTokens: 1000, completionTokens: 100, cacheReadTokens: 400 })
    expect(r.usage.billedPromptTokens).toBe(700)
    expect(r.usage.costInr).toBeGreaterThan(0)
  })

  it('retries without temperature when the deployment rejects it, and strips JSON fences', async () => {
    const calls = mockFetch((_u, _i, n) => n === 1
      ? new Response('{"error":{"message":"Unsupported value: temperature"}}', { status: 400 })
      : { choices: [{ message: { content: '```json\n{"a":1}\n```' }, finish_reason: 'stop' }] })
    const r = await az().chat({ messages: [{ role: 'user', content: 'x' }], jsonMode: true })
    expect(calls).toHaveLength(2)
    expect(body(calls[1]).temperature).toBeUndefined()
    expect(r).toMatchObject({ content: '{"a":1}', stopReason: 'end_turn', model: 'gpt-4.1-mini' })
  })

  it('throws on the content filter, a truncated tool call and HTTP errors', async () => {
    mockFetch(() => ({ choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }))
    await expect(az().chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/content filter/)
    mockFetch(() => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{' } }] }, finish_reason: 'length' }] }))
    await expect(az().chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/truncated/)
    mockFetch(() => new Response('boom', { status: 500 }))
    await expect(az().chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ status: 500 })
    await expect(az({ chatDeployment: '' }).chat({ messages: [] })).rejects.toThrow(/not configured/)
  })

  it('streams text deltas and tool-call starts, folding usage from the last chunk', async () => {
    const calls = mockFetch(() => sse([
      { choices: [], prompt_filter_results: [] },
      { model: 'gpt-4.1-mini', choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'look', arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"y"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]))
    const events: unknown[] = []
    const r = await az().chat({ messages: [{ role: 'user', content: 'x' }] }, e => events.push(e))
    expect(body(calls[0])).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(events).toEqual([{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }, { type: 'tool_call', id: 'c9', name: 'look' }])
    expect(r).toMatchObject({ content: 'Hello', toolCalls: [{ id: 'c9', name: 'look', arguments: { q: 'y' } }], stopReason: 'tool_use' })
    expect(r.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 })
  })
})

describe('vision', () => {
  it('sends the images as data URLs and returns an azure vision response', async () => {
    const calls = mockFetch(() => ({ model: 'gpt-4.1-mini', choices: [{ message: { content: ' Invoice 42 ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }))
    const r = await az().vision({ images: ['/9j/AAAA', PNG_B64], prompt: 'read it' })
    const content = body(calls[0]).messages[0].content
    expect(content[0]).toEqual({ type: 'text', text: 'read it' })
    expect(content[1].image_url.url).toBe('data:image/jpeg;base64,/9j/AAAA')
    expect(content[2].image_url.url.startsWith('data:image/png;base64,')).toBe(true)
    expect(r).toMatchObject({ ok: true, text: 'Invoice 42', provider: 'azure', pages: 2 })
  })
})

describe('embeddings', () => {
  const vec = (v: number) => Array.from({ length: AZURE_EMBED_DIMENSIONS }, () => v)

  it('always requests 768 dimensions, batches, and keeps input order', async () => {
    const calls = mockFetch((_u, init) => {
      const input = JSON.parse(String(init?.body)).input as string[]
      return { data: input.map((_, i) => ({ index: i, embedding: vec(i) })).reverse(), usage: { prompt_tokens: input.length } }
    })
    const input = Array.from({ length: 130 }, (_, i) => `t${i}`)
    const r = await az().embed(input)
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/deployments/emb/embeddings?api-version=2025-04-01-preview')
    expect(body(calls[0])).toMatchObject({ dimensions: 768 })
    expect(body(calls[0]).input).toHaveLength(128)
    expect(r.embeddings).toHaveLength(130)
    expect(r.embeddings[1][0]).toBe(1)
    expect(r.promptTokens).toBe(130)
    expect(r.usage.costInr).toBeGreaterThanOrEqual(0)
  })

  it('rejects vectors of the wrong size and a missing deployment', async () => {
    mockFetch(() => ({ data: [{ index: 0, embedding: [1, 2] }] }))
    await expect(az().embed(['x'])).rejects.toThrow(/expected 768/)
    mockFetch(() => ({ data: [] }))
    await expect(az().embed(['x'])).rejects.toThrow(/0 vectors for 1/)
    await expect(az({ embedDeployment: '' }).embed(['x'])).rejects.toThrow(/not configured/)
  })
})

describe('images', () => {
  it('maps size and quality, decodes b64_json and prices by quality and size', async () => {
    const calls = mockFetch(() => ({ data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }] }))
    const out = await az().generateImage({ prompt: 'shoe', negativePrompt: 'text', width: 1024, height: 576, n: 2, quality: 'premium' })
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/deployments/gpt-image-1/images/generations?api-version=2025-04-01-preview')
    expect(body(calls[0])).toEqual({ prompt: 'shoe\n\nAvoid: text', n: 2, size: '1536x1024', quality: 'high', output_format: 'png' })
    expect(out.model).toBe('gpt-image-1')
    expect(out.images).toHaveLength(2)
    expect(out.images[0]).toMatchObject({ mime: 'image/png', width: 1024, height: 1024 })
    expect(out.costInr).toBeCloseTo(unitPrice('azure', 'gpt-image-1:high', 'image') * 2 * 1.5, 6)

    mockFetch(() => ({ data: [{ b64_json: PNG_B64 }] }))
    const sq = await az().generateImage({ prompt: 'x', width: 512, height: 512, n: 1, quality: 'draft' })
    expect(sq.costInr).toBeCloseTo(unitPrice('azure', 'gpt-image-1:low', 'image'), 6)
  })

  it('edits with a reference image as multipart, and fails when nothing comes back', async () => {
    const calls = mockFetch(() => ({ data: [{ b64_json: PNG_B64 }] }))
    await az().generateImage({ prompt: 'x', width: 576, height: 1024, n: 1, quality: 'standard', referenceImageUrl: `data:image/png;base64,${PNG_B64}` })
    expect(calls[0].url).toContain('/images/edits?')
    const form = calls[0].init?.body as FormData
    expect(form.get('size')).toBe('1024x1536')
    expect(form.get('quality')).toBe('medium')
    expect(form.get('image')).toBeInstanceOf(Blob)
    mockFetch(() => ({ data: [] }))
    await expect(az().generateImage({ prompt: 'x', width: 1024, height: 1024, n: 1, quality: 'standard' })).rejects.toThrow(/no images/)
    await expect(az({ imageDeployment: '' }).generateImage({ prompt: 'x', width: 1024, height: 1024, n: 1, quality: 'standard' })).rejects.toThrow(/not configured/)
  })
})

describe('video (Sora 2)', () => {
  const v = () => az({ videoDeployment: 'sora-2' })

  it('starts a job on the v1 videos API with a snapped length and size', async () => {
    const calls = mockFetch(() => ({ id: 'video_1', status: 'queued' }))
    const s = await v().startVideo({ prompt: 'reel', durationSec: 7, aspect: '1:1' })
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/v1/videos')
    const form = calls[0].init?.body as FormData
    expect([form.get('model'), form.get('size'), form.get('seconds')]).toEqual(['sora-2', '720x1280', '8'])
    expect(s).toEqual({ opId: 'video_1', model: 'sora-2', durationSec: 8, aspect: '9:16' })
    expect(v().videoModel()).toBe('sora-2')
    await expect(v().startVideo({ prompt: 'x', durationSec: 4, aspect: '16:9', imageUrl: 'https://x/y.png' })).rejects.toThrow(/image-to-video/)
    await expect(az().startVideo({ prompt: 'x', durationSec: 4, aspect: '16:9' })).rejects.toThrow(/not configured/)
  })

  it('polls to completion and downloads the content', async () => {
    mockFetch(() => ({ status: 'in_progress' }))
    expect(await v().pollVideo('video_1')).toEqual({ done: false })
    mockFetch(() => ({ status: 'failed', error: { message: 'moderation' } }))
    expect(await v().pollVideo('video_1')).toEqual({ done: true, error: 'moderation' })
    const calls = mockFetch(url => url.endsWith('/content')
      ? new Response(Buffer.from('mp4'), { headers: { 'content-type': 'video/mp4' } })
      : { status: 'completed' })
    const p = await v().pollVideo('video_1')
    expect(p.done).toBe(true)
    expect(p.result?.bytes.toString()).toBe('mp4')
    expect(calls[1].url).toBe('https://res.openai.azure.com/openai/v1/videos/video_1/content')
  })
})

describe('speech to text', () => {
  const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(32)])
  wav.writeUInt32LE(16000, 24)

  it('uses the transcription deployment with the ISO language', async () => {
    const calls = mockFetch(() => ({ text: ' namaste ', usage: { type: 'duration', seconds: 3.2 } }))
    const r = await az().transcribe({ audio: Buffer.from('abc'), mimeType: 'audio/webm;codecs=opus', language: 'hi-IN' })
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-04-01-preview')
    const form = calls[0].init?.body as FormData
    expect(form.get('language')).toBe('hi')
    expect((form.get('file') as File).name).toBe('audio.webm')
    expect(r).toEqual({ text: 'namaste', language: 'hi-IN', durationSeconds: 3.2, model: 'gpt-4o-transcribe' })
  })

  it('falls back to Speech short audio after an outage, or uses it when it is the only path', async () => {
    const calls = mockFetch(url => new URL(url).hostname.endsWith('.openai.azure.com')
      ? new Response('down', { status: 503 })
      : { RecognitionStatus: 'Success', DisplayText: 'hello there' })
    const r = await az().transcribe({ audio: wav, mimeType: 'audio/wav' })
    expect(calls[1].url).toBe('https://centralindia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-IN&format=detailed')
    expect(headers(calls[1])['Content-Type']).toBe('audio/wav; codecs=audio/pcm; samplerate=16000')
    expect(headers(calls[1])['Ocp-Apim-Subscription-Key']).toBe('speech-key')
    expect(r).toEqual({ text: 'hello there', language: 'en-IN', model: 'azure-speech-stt' })

    mockFetch(() => ({ RecognitionStatus: 'NoMatch' }))
    expect((await az({ transcribeDeployment: '' }).transcribe({ audio: wav, mimeType: 'audio/wav', language: 'ta-IN' })).text).toBe('')
    mockFetch(() => ({ RecognitionStatus: 'Error' }))
    await expect(az({ transcribeDeployment: '' }).transcribe({ audio: wav, mimeType: 'audio/wav' })).rejects.toThrow(/Error/)
  })

  it('keeps a client error from the deployment, and refuses formats Speech cannot read', async () => {
    mockFetch(() => new Response('bad file', { status: 400 }))
    await expect(az().transcribe({ audio: wav, mimeType: 'audio/wav' })).rejects.toMatchObject({ status: 400 })
    await expect(az({ transcribeDeployment: '' }).transcribe({ audio: Buffer.from('x'), mimeType: 'audio/mpeg' })).rejects.toMatchObject({ status: 400 })
    await expect(az({ transcribeDeployment: '', speechKey: '' }).transcribe({ audio: wav, mimeType: 'audio/wav' })).rejects.toThrow(/not configured/)
  })

  it('maps content types for Speech', () => {
    expect(speechContentType('audio/ogg', Buffer.alloc(0))).toBe('audio/ogg; codecs=opus')
    expect(speechContentType('audio/webm', Buffer.alloc(0))).toBeNull()
  })
})

describe('text to speech', () => {
  it('sends SSML with the default neural voice for the language, escaping the text', async () => {
    const calls = mockFetch(() => new Response(Buffer.from('ID3mp3'), { headers: { 'content-type': 'audio/mpeg' } }))
    const r = await az().speak({ text: 'Tom & <Jerry>', language: 'hi-IN', format: 'mp3' })
    expect(calls[0].url).toBe('https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1')
    expect(headers(calls[0])).toMatchObject({ 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' })
    expect(String(calls[0].init?.body)).toContain('<voice name="hi-IN-SwaraNeural">Tom &amp; &lt;Jerry&gt;</voice>')
    expect(String(calls[0].init?.body)).toContain('xml:lang="hi-IN"')
    expect(r).toMatchObject({ mimeType: 'audio/mpeg', model: 'azure-speech-tts' })
    expect(r.audio.toString()).toBe('ID3mp3')
  })

  it('uses the OpenAI TTS deployment for an OpenAI voice, falling back to Speech on failure', async () => {
    const calls = mockFetch(url => url.includes('/audio/speech')
      ? new Response(Buffer.from('OggS'), { headers: { 'content-type': 'audio/ogg' } })
      : new Response(Buffer.from('x')))
    const r = await az({ ttsDeployment: 'gpt-4o-mini-tts' }).speak({ text: 'hi', language: 'en-IN', voice: 'Coral', format: 'ogg' })
    expect(calls[0].url).toBe('https://res.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-04-01-preview')
    expect(body(calls[0])).toEqual({ model: 'gpt-4o-mini-tts', input: 'hi', voice: 'coral', response_format: 'opus' })
    expect(r).toMatchObject({ mimeType: 'audio/ogg', model: 'gpt-4o-mini-tts' })

    const c2 = mockFetch(url => url.includes('/audio/speech') ? new Response('nope', { status: 500 }) : new Response(Buffer.from('RIFF')))
    const r2 = await az({ ttsDeployment: 'gpt-4o-mini-tts' }).speak({ text: 'hi', language: 'en-IN', voice: 'alloy', format: 'wav' })
    expect(c2).toHaveLength(2)
    expect(String(c2[1].init?.body)).toContain('en-IN-NeerjaNeural')
    expect(r2.mimeType).toBe('audio/wav')
  })

  it('fails clearly when nothing is configured or no audio comes back', async () => {
    await expect(az({ speechKey: '' }).speak({ text: 'x', language: 'hi-IN', format: 'mp3' })).rejects.toThrow(/not configured/)
    mockFetch(() => new Response(new Uint8Array(0)))
    await expect(az().speak({ text: 'x', language: 'hi-IN', format: 'mp3' })).rejects.toBeInstanceOf(ProviderError)
  })

  it('picks a voice per Indian language, then the language, then a multilingual voice', () => {
    for (const l of ['en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'bn-IN', 'gu-IN']) expect(DEFAULT_VOICES[l]).toMatch(new RegExp(`^${l}-`))
    expect(defaultVoice('HI')).toBe('hi-IN-SwaraNeural')
    expect(defaultVoice('ta-in')).toBe('ta-IN-PallaviNeural')
    expect(defaultVoice('fr-FR')).toBe('en-US-AvaMultilingualNeural')
  })
})

describe('transport', () => {
  it('reports a timeout as a ProviderError without a status', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    const err = await az({ timeoutMs: 10 }).embed(['x']).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.status).toBeUndefined()
    expect(err.message).toMatch(/timed out/)
  })
})

describe('chosen models', () => {
  const vec = Array.from({ length: AZURE_EMBED_DIMENSIONS }, () => 0)

  it('chat, vision and embeddings run on the requested deployment and report it', async () => {
    const calls = mockFetch(url => (url.includes('/embeddings')
      ? { data: [{ index: 0, embedding: vec }], usage: { prompt_tokens: 2 } }
      : { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }))
    const r = await az().chat({ messages: [{ role: 'user', content: 'x' }], models: { azure: 'gpt-5' } })
    expect(calls[0].url).toContain('/deployments/gpt-5/chat/completions')
    expect(r.model).toBe('gpt-5')
    expect(az().chatModel('gpt-5')).toBe('gpt-5')
    expect((await az().vision({ images: [PNG_B64], prompt: 'p', models: { azure: 'gpt-5' } })).model).toBe('gpt-5')
    expect(calls[1].url).toContain('/deployments/gpt-5/')
    const e = await az().embed(['x'], 'emb-large')
    expect(calls[2].url).toContain('/deployments/emb-large/embeddings')
    expect(e.model).toBe('emb-large@768')
    expect((await az().embed(['x'])).model).toBe('text-embedding-3-small@768')
  })

  it('images and video use the chosen deployment for the call and the price', async () => {
    const calls = mockFetch(url => (url.includes('/videos') ? { id: 'v' } : { data: [{ b64_json: PNG_B64 }] }))
    const img = await az().generateImage({ prompt: 'x', width: 1024, height: 1024, n: 1, quality: 'draft', model: 'gpt-image-1-mini' })
    expect(calls[0].url).toContain('/deployments/gpt-image-1-mini/images/generations')
    expect(img.model).toBe('gpt-image-1-mini')
    expect(img.costInr).toBeCloseTo(unitPrice('azure', 'gpt-image-1-mini:low', 'image'), 6)
    const s = await az({ videoDeployment: 'sora-2' }).startVideo({ prompt: 'x', durationSec: 4, aspect: '16:9', model: 'sora-2-pro' })
    expect((calls[1].init?.body as FormData).get('model')).toBe('sora-2-pro')
    expect(s.model).toBe('sora-2-pro')
  })

  it('speech to text: azure-speech-stt goes to Speech only, a deployment to Azure OpenAI only', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(32)])
    const calls = mockFetch(url => (url.includes('stt.speech') ? { RecognitionStatus: 'Success', DisplayText: 'hi' } : { text: 'hey' }))
    expect(await az().transcribe({ audio: wav, mimeType: 'audio/wav', model: 'azure-speech-stt' })).toMatchObject({ text: 'hi', model: 'azure-speech-stt' })
    expect(calls[0].url).toContain('stt.speech.microsoft.com')
    expect(await az().transcribe({ audio: wav, mimeType: 'audio/wav', model: 'whisper' })).toMatchObject({ text: 'hey', model: 'whisper' })
    expect(calls[1].url).toContain('/deployments/whisper/audio/transcriptions')
    await expect(az({ speechKey: '' }).transcribe({ audio: wav, mimeType: 'audio/wav', model: 'azure-speech-stt' })).rejects.toThrow(/Speech is not configured/)
    await expect(az({ apiKey: '' }).transcribe({ audio: wav, mimeType: 'audio/wav', model: 'whisper' })).rejects.toThrow(/not configured/)
  })

  it('text to speech: azure-speech-tts or a deployment alone; a voice that is not a Speech voice is dropped', async () => {
    const calls = mockFetch(() => new Response(Buffer.from('mp3')))
    expect((await az().speak({ text: 'x', language: 'hi-IN', format: 'mp3', model: 'azure-speech-tts', voice: 'ishita' })).model).toBe('azure-speech-tts')
    expect(String(calls[0].init?.body)).toContain('hi-IN-SwaraNeural')
    expect((await az().speak({ text: 'x', language: 'hi-IN', format: 'mp3', model: 'tts-1-hd', voice: 'nova' })).model).toBe('tts-1-hd')
    expect(calls[1].url).toContain('/deployments/tts-1-hd/audio/speech')
    expect(body(calls[1]).voice).toBe('nova')
    await az().speak({ text: 'x', language: 'hi-IN', format: 'mp3', voice: 'hi-IN-MadhurNeural' })
    expect(String(calls[2].init?.body)).toContain('hi-IN-MadhurNeural')
    await expect(az({ speechKey: '' }).speak({ text: 'x', language: 'hi-IN', format: 'mp3', model: 'azure-speech-tts' })).rejects.toThrow(/Speech is not configured/)
    await expect(az({ apiKey: '' }).speak({ text: 'x', language: 'hi-IN', format: 'mp3', model: 'tts-1' })).rejects.toThrow(/not configured/)
  })
})
