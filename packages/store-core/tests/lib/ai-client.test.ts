import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/lib/providers/policy', () => ({ getAiRouting: vi.fn(async () => ({})) }))
const recordUsage = vi.hoisted(() => vi.fn(async (_input: any) => ({ usageId: 'u1', priceInr: 0 })))
const billedTenantId = vi.hoisted(() => vi.fn((): string | null => null))
vi.mock('@/lib/ai/billing', () => ({
  recordUsage,
  billedTenantId,
  AiWalletError: class AiWalletError extends Error {},
}))
vi.mock('@/lib/tenancy/tenant-context', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/tenant-context')>()),
  resolveTenantId: vi.fn(async () => null),
}))

import { aiChat, aiChatStream, aiEmbed, aiEmbedWithModel, aiSpeak, aiTranscribe, aiVision, AiClientError, chatBillableTokens, __resetAiClientState } from '@/lib/shared/ai-client'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getAiRouting } from '@/lib/providers/policy'

const GATEWAY_REPLY = {
  content: 'Hello world',
  provider: 'ollama',
  model: 'gemma3:4b',
  latencyMs: 12,
  fallbackUsed: false,
  cache: null,
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

function sentBody(callIndex = 0) {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body)
}

beforeEach(() => {
  mockFetch.mockReset()
  recordUsage.mockClear()
  vi.mocked(getAiRouting).mockResolvedValue({})
  __resetAiClientState()
  vi.mocked(resolveTenantId).mockResolvedValue(null)
})

describe('AiClientError', () => {
  it('has name AiClientError', () => {
    const err = new AiClientError('test', 'gateway')
    expect(err.name).toBe('AiClientError')
    expect(err.provider).toBe('gateway')
    expect(err.message).toBe('test')
  })

  it('is instanceof Error', () => {
    expect(new AiClientError('x', 'gateway') instanceof Error).toBe(true)
  })
})

describe('aiChat (gateway client)', () => {
  it('posts the request to the gateway chat endpoint and returns its reply', async () => {
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    const result = await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toEqual(GATEWAY_REPLY)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/v1\/chat$/)
    expect(init.method).toBe('POST')
    expect(init.signal).toBeDefined()
  })

  it('sends the store text models for the providers it orders, and none when unset', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ text: ['anthropic', 'razer'], models: { text: { anthropic: 'claude-sonnet-5-5', razer: 'llama3.1:8b' } } })
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody()).toMatchObject({ providers: ['anthropic', 'razer'], models: { anthropic: 'claude-sonnet-5-5', razer: 'llama3.1:8b' } })
    vi.mocked(getAiRouting).mockResolvedValue({ text: ['anthropic'] })
    mockFetch.mockClear()
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody()).not.toHaveProperty('models')
  })

  it('forwards model hint, JSON mode, sampling, tools and noCache', async () => {
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    const tools = [{ type: 'function' as const, function: { name: 'fn', description: 'd', parameters: {} } }]
    await aiChat({
      messages: [{ role: 'user', content: 'hi' }],
      modelHint: 'sql',
      jsonMode: true,
      temperature: 0.9,
      maxTokens: 500,
      noCache: true,
      tools,
    })
    expect(sentBody()).toMatchObject({
      modelHint: 'sql',
      jsonMode: true,
      temperature: 0.9,
      maxTokens: 500,
      noCache: true,
      tools,
    })
  })

  it('partitions the cache under platform when no tenant is in scope', async () => {
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().cacheNamespace).toBe('platform')
  })

  it('partitions the cache under the request tenant', async () => {
    vi.mocked(resolveTenantId).mockResolvedValueOnce('tenant-42')
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().cacheNamespace).toBe('tenant-42')
  })

  it('uses an explicit cacheNamespace without resolving the tenant', async () => {
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }], cacheNamespace: 'tenant-7' })
    expect(sentBody().cacheNamespace).toBe('tenant-7')
    expect(resolveTenantId).not.toHaveBeenCalled()
  })

  it('falls back to platform when tenant resolution throws', async () => {
    vi.mocked(resolveTenantId).mockRejectedValueOnce(new Error('no request scope'))
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().cacheNamespace).toBe('platform')
  })

  it('throws AiClientError with the gateway status and body on a non-ok reply', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      json: async () => ({}),
    })
    const err = await aiChat({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toBe('AI gateway HTTP 429: rate limited')
    expect(err.provider).toBe('gateway')
  })

  it('wraps network failures in AiClientError', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'))
    const err = await aiChat({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toBe('connection refused')
  })

  it('returns tool calls from the gateway unchanged', async () => {
    const reply = {
      ...GATEWAY_REPLY,
      content: '',
      toolCalls: [{ name: 'search_products', arguments: { query: 'shelf' } }],
    }
    mockFetch.mockResolvedValueOnce(okJson(reply))
    const result = await aiChat({ messages: [{ role: 'user', content: 'find' }] })
    expect(result.toolCalls).toEqual([{ name: 'search_products', arguments: { query: 'shelf' } }])
  })
})

describe('aiEmbed (gateway client)', () => {
  it('returns the gateway embeddings', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ embeddings: [[0.1, 0.2]] }))
    const result = await aiEmbed('hello')
    expect(result).toEqual([[0.1, 0.2]])
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/v1\/embed$/)
    expect(sentBody()).toMatchObject({ input: 'hello' })
  })

  it('throws AiClientError on a non-ok reply', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
    await expect(aiEmbed('hello')).rejects.toThrow('AI gateway embed HTTP 502')
  })
})

describe('aiEmbedWithModel and the embeddings provider', () => {
  it('returns the vectors with the model and provider the gateway reports', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ embeddings: [[1, 2]], model: 'nomic-embed-text', provider: 'razer', usage: { promptTokens: 2000 } }))
    const r = await aiEmbedWithModel(['a'], undefined, { feature: 'embed_sync' })
    expect(r).toEqual({ vectors: [[1, 2]], model: 'nomic-embed-text', provider: 'razer' })
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled())
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ feature: 'embed_sync', capability: 'embed', provider: 'ollama', units: [{ type: 'token_1k_in', qty: 2 }] })
  })

  it('sends the policy embed provider and meters Azure under azure', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ embed: 'azure' })
    mockFetch.mockResolvedValueOnce(okJson({ embeddings: [[3]], model: 'text-embedding-3-small@768', provider: 'azure' }))
    const r = await aiEmbedWithModel('x')
    expect(sentBody()).toMatchObject({ input: 'x', provider: 'azure' })
    expect(r).toMatchObject({ model: 'text-embedding-3-small@768', provider: 'azure' })
    expect(await aiEmbed('y').catch(() => null)).toBeNull()
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled())
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ provider: 'azure' })
  })

  it('sends the embed model chosen for the provider', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ embed: 'azure', models: { embed: { azure: 'text-embedding-3-large' } } })
    mockFetch.mockResolvedValueOnce(okJson({ embeddings: [[3]], model: 'text-embedding-3-large@768', provider: 'azure' }))
    await aiEmbedWithModel('x')
    expect(sentBody()).toMatchObject({ provider: 'azure', model: 'text-embedding-3-large' })
  })

  it('throws on a gateway failure and never calls anything but the gateway', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama.test')
    vi.mocked(getAiRouting).mockResolvedValue({ embed: 'razer' })
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}), text: async () => '' })
    await expect(aiEmbedWithModel('x')).rejects.toThrow('AI gateway embed HTTP 502')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toMatch(/\/v1\/embed$/)
    vi.unstubAllEnvs()
  })
})

describe('aiTranscribe', () => {
  it('posts base64 audio with the audio order and meters minutes', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ stt: ['azure'], tts: ['sarvam'], models: { stt: { azure: 'gpt-4o-transcribe' }, tts: { sarvam: 'bulbul:v3' } } })
    mockFetch.mockResolvedValueOnce(okJson({ text: 'namaste', language: 'hi-IN', durationSeconds: 90, provider: 'azure', model: 'gpt-4o-transcribe' }))
    const r = await aiTranscribe({ audio: Buffer.from('abc'), mimeType: 'audio/ogg', language: 'hi-IN', feature: 'staff_voice_memo' })
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/v1\/audio\/transcribe$/)
    expect(sentBody()).toEqual({ audioBase64: Buffer.from('abc').toString('base64'), mimeType: 'audio/ogg', language: 'hi-IN', providers: ['azure'], models: { azure: 'gpt-4o-transcribe' } })
    expect(r).toEqual({ text: 'namaste', language: 'hi-IN', durationSeconds: 90, provider: 'azure', model: 'gpt-4o-transcribe' })
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled())
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ feature: 'staff_voice_memo', capability: 'audio', provider: 'azure', model: 'gpt-4o-transcribe', units: [{ type: 'audio_minute', qty: 1.5 }] })
  })

  it('omits language and providers when unset, skips billing when asked, and throws on a gateway error', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ text: 't', durationSeconds: 6, provider: 'azure', model: 'm' }))
    const r = await aiTranscribe({ audio: Buffer.from('a'), mimeType: 'audio/mpeg', feature: 'f', billing: false })
    expect(sentBody()).toEqual({ audioBase64: 'YQ==', mimeType: 'audio/mpeg' })
    expect(r.language).toBe('')
    expect(recordUsage).not.toHaveBeenCalled()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => 'all providers failed' })
    await expect(aiTranscribe({ audio: Buffer.from('a'), mimeType: 'audio/mpeg', feature: 'f' })).rejects.toThrow('AI gateway transcribe HTTP 502: all providers failed')
  })
})

describe('aiSpeak', () => {
  it('returns the decoded audio and meters 1k characters', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ stt: ['azure'], tts: ['sarvam'], models: { stt: { azure: 'gpt-4o-transcribe' }, tts: { sarvam: 'bulbul:v3' } } })
    mockFetch.mockResolvedValueOnce(okJson({ audioBase64: Buffer.from('mp3bytes').toString('base64'), mimeType: 'audio/mpeg', characters: 500, provider: 'azure', model: 'hi-IN-SwaraNeural' }))
    const r = await aiSpeak({ text: 'namaste', language: 'hi-IN', voice: 'hi-IN-SwaraNeural', format: 'mp3', feature: 'voice_reply' })
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/v1\/audio\/speak$/)
    expect(sentBody()).toEqual({ text: 'namaste', language: 'hi-IN', voice: 'hi-IN-SwaraNeural', format: 'mp3', providers: ['sarvam'], models: { sarvam: 'bulbul:v3' } })
    expect(r.audio.toString()).toBe('mp3bytes')
    expect(r).toMatchObject({ mimeType: 'audio/mpeg', provider: 'azure', model: 'hi-IN-SwaraNeural' })
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled())
    expect(recordUsage.mock.calls[0][0]).toMatchObject({ capability: 'audio', units: [{ type: 'tts_1k_chars', qty: 0.5 }] })
  })

  it('falls back to the text length for metering and rejects a reply without audio', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ audioBase64: 'YQ==', provider: 'azure', model: 'm' }))
    const r = await aiSpeak({ text: 'x'.repeat(2000), language: 'en-IN', feature: 'f' })
    expect(r.mimeType).toBe('audio/mpeg')
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled())
    expect(recordUsage.mock.calls[0][0].units).toEqual([{ type: 'tts_1k_chars', qty: 2 }])
    mockFetch.mockResolvedValueOnce(okJson({ provider: 'azure' }))
    await expect(aiSpeak({ text: 'hi', language: 'en-IN', feature: 'f' })).rejects.toThrow('returned no audio')
  })
})

describe('aiVision (gateway client)', () => {
  it('returns the gateway OCR result', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true, text: 'line 1', model: 'PP-OCRv5' }))
    const result = await aiVision(['aGVsbG8='], 'extract')
    expect(result).toEqual({ ok: true, text: 'line 1', model: 'PP-OCRv5' })
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/v1\/vision$/)
    expect(sentBody()).toMatchObject({ images: ['aGVsbG8='], prompt: 'extract' })
  })

  it('sends the text models with the vision call', async () => {
    vi.mocked(getAiRouting).mockResolvedValue({ text: ['anthropic'], models: { text: { anthropic: 'claude-haiku-5-5' } } })
    mockFetch.mockResolvedValueOnce(okJson({ ok: true, text: 't', model: 'm' }))
    await aiVision(['x'], 'extract')
    expect(sentBody()).toMatchObject({ providers: ['anthropic'], models: { anthropic: 'claude-haiku-5-5' } })
  })

  it('reports a non-ok reply without throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    const result = await aiVision(['x'], 'extract')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('AI gateway vision HTTP 503')
  })

  it('reports a network failure without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await aiVision(['x'], 'extract')
    expect(result).toMatchObject({ ok: false, error: 'ECONNRESET' })
  })
})

describe('gateway only: no direct provider path', () => {
  const status = (code: number, body = '') => ({ ok: code < 400, status: code, text: async () => body, json: async () => ({}) })
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // A leftover OLLAMA_BASE_URL and Razer in the order must change nothing: the gateway owns fallback.
    vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama.test:11434')
    vi.mocked(getAiRouting).mockResolvedValue({ text: ['anthropic', 'razer'] })
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    errSpy.mockRestore()
  })

  const onlyGateway = () => expect(mockFetch.mock.calls.every(([u]) => !String(u).includes('ollama.test'))).toBe(true)

  it('surfaces a gateway 5xx as AiClientError without retrying elsewhere', async () => {
    mockFetch.mockResolvedValue(status(503, '{"error":"all text providers failed"}'))
    const err = await aiChat({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toBe('AI gateway HTTP 503: {"error":"all text providers failed"}')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    onlyGateway()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('surfaces a network failure as AiClientError', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(aiChat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(AiClientError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    onlyGateway()
  })

  it('reports a vision failure as ok: false, gateway only', async () => {
    mockFetch.mockResolvedValue(status(503))
    expect(await aiVision(['aGk='], 'read')).toMatchObject({ ok: false, error: 'AI gateway vision HTTP 503' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    onlyGateway()
  })

  it('streams fail fast with AiClientError while the gateway is unreachable', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const err = await aiChatStream({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toMatch(/unreachable/)
    expect(mockFetch.mock.calls.map(([u]) => String(u))).toEqual([expect.stringMatching(/\/healthz$/)])
  })

  it('retries a failed stream once as a plain gateway chat', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/healthz')) return okJson({ ok: true })
      if (String(url).endsWith('/v1/chat/stream')) return status(502, 'boom')
      return okJson(GATEWAY_REPLY)
    })
    const events: unknown[] = []
    const r = await aiChatStream({ messages: [{ role: 'user', content: 'hi' }] }, { onEvent: e => events.push(e) })
    expect(r.content).toBe('Hello world')
    expect(events).toEqual([{ type: 'text', text: 'Hello world' }])
    onlyGateway()
  })
})

describe('store billing context', () => {
  it('routes with the billed store when one is set (ecom console)', async () => {
    billedTenantId.mockReturnValue('11111111-1111-4111-8111-111111111111')
    vi.mocked(resolveTenantId).mockClear()
    mockFetch.mockResolvedValueOnce(okJson(GATEWAY_REPLY))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().cacheNamespace).toBe('11111111-1111-4111-8111-111111111111')
    expect(getAiRouting).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(resolveTenantId).not.toHaveBeenCalled()
    billedTenantId.mockReturnValue(null)
  })
})

describe('chatBillableTokens', () => {
  const req = { messages: [{ role: 'system' as const, content: 'x'.repeat(400) }, { role: 'user' as const, content: 'y'.repeat(400) }] }

  it('bills the reported usage, cache-weighted input first', () => {
    expect(chatBillableTokens(req, { content: 'a', cache: null, usage: { promptTokens: 900, completionTokens: 50, billedPromptTokens: 300 } })).toEqual({ billedIn: 300, ct: 50 })
    expect(chatBillableTokens(req, { content: 'a', cache: null, usage: { promptTokens: 900, completionTokens: 50 } })).toEqual({ billedIn: 900, ct: 50 })
  })

  it('bills a cache hit (zero reported usage) for the tokens the answer would have cost', () => {
    expect(chatBillableTokens(req, { content: 'z'.repeat(81), cache: 'kv', usage: { promptTokens: 0, completionTokens: 0, costInr: 0 } })).toEqual({ billedIn: 201, ct: 21 })
    expect(chatBillableTokens(req, { content: 'z', cache: 'semantic' })).toEqual({ billedIn: 201, ct: 1 })
  })

  it('leaves a non-cached call with no usage at zero', () => {
    expect(chatBillableTokens(req, { content: 'z', cache: null })).toEqual({ billedIn: 0, ct: 0 })
  })
})
