import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/lib/tenancy/tenant-context', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/tenant-context')>()),
  resolveTenantId: vi.fn(async () => null),
}))

import { aiChat, aiEmbed, aiVision, AiClientError, getAiProvider, __resetAiClientState } from '@/lib/shared/ai-client'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

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

describe('getAiProvider', () => {
  it('returns a known provider', () => {
    expect(['openai', 'ollama']).toContain(getAiProvider())
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

describe('aiVision (gateway client)', () => {
  it('returns the gateway OCR result', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true, text: 'line 1', model: 'PP-OCRv5' }))
    const result = await aiVision(['aGVsbG8='], 'extract')
    expect(result).toEqual({ ok: true, text: 'line 1', model: 'PP-OCRv5' })
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/v1\/vision$/)
    expect(sentBody()).toMatchObject({ images: ['aGVsbG8='], prompt: 'extract' })
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

describe('direct Ollama fallback (OLLAMA_BASE_URL set)', () => {
  const OLLAMA = 'http://ollama.test:11434'
  type Handler = (url: string, init?: any) => any
  let gateway: Handler
  let ollama: Handler
  let errSpy: ReturnType<typeof vi.spyOn>

  const status = (code: number, body = '') => ({ ok: code < 400, status: code, text: async () => body, json: async () => ({}) })
  const calls = (needle: string) => mockFetch.mock.calls.filter(([u]) => String(u).includes(needle))

  beforeEach(() => {
    vi.stubEnv('OLLAMA_BASE_URL', OLLAMA)
    vi.stubEnv('OLLAMA_FAST_MODEL', 'fast-model')
    vi.stubEnv('OLLAMA_SQL_MODEL', 'sql-model')
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    gateway = () => okJson(GATEWAY_REPLY)
    ollama = () => okJson({ message: { content: '<think>x</think>direct answer' } })
    mockFetch.mockImplementation(async (url: string, init?: any) => {
      if (String(url).startsWith(OLLAMA)) return ollama(url, init)
      if (String(url).endsWith('/healthz')) return okJson({ ok: true })
      return gateway(url, init)
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    errSpy.mockRestore()
  })

  it('uses the gateway when it answers', async () => {
    expect(await aiChat({ messages: [{ role: 'user', content: 'hi' }] })).toEqual(GATEWAY_REPLY)
    expect(calls(OLLAMA)).toHaveLength(0)
  })

  it('falls back on a gateway 5xx with the same shape and fallbackUsed', async () => {
    gateway = () => status(500, '{"error":"Ollama is not reachable"}')
    const r = await aiChat({ messages: [{ role: 'user', content: 'hi' }], modelHint: 'sql' })
    expect(r).toMatchObject({ content: 'direct answer', provider: 'ollama', model: 'sql-model', fallbackUsed: true, cache: null })
    expect(typeof r.latencyMs).toBe('number')
    const [url, init] = calls(OLLAMA)[0]
    expect(url).toBe(`${OLLAMA}/api/chat`)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'sql-model', stream: false, think: false })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to direct Ollama'))
  })

  it('falls back on a network error and passes tools/jsonMode through', async () => {
    gateway = () => { throw new TypeError('fetch failed') }
    ollama = () => okJson({ message: { content: '', tool_calls: [{ function: { name: 'search', arguments: '{"q":"x"}' } }] } })
    const tools = [{ type: 'function' as const, function: { name: 'search', description: 'd', parameters: {} } }]
    const r = await aiChat({ messages: [{ role: 'user', content: 'hi' }], tools, jsonMode: true, modelHint: 'fast' })
    expect(r.toolCalls).toEqual([{ name: 'search', arguments: { q: 'x' } }])
    expect(r.fallbackUsed).toBe(true)
    expect(JSON.parse(calls(OLLAMA)[0][1].body)).toMatchObject({ tools, format: 'json', model: 'fast-model' })
  })

  it('goes direct without waiting once the gateway health check fails', async () => {
    mockFetch.mockImplementation(async (url: string, init?: any) => {
      if (String(url).startsWith(OLLAMA)) return ollama(url, init)
      throw new TypeError('fetch failed')
    })
    const r = await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(r.fallbackUsed).toBe(true)
    expect(calls('/v1/chat')).toHaveLength(0)
    await aiChat({ messages: [{ role: 'user', content: 'again' }] })
    expect(calls('/healthz')).toHaveLength(1)
  })

  it('does NOT fall back on a 4xx', async () => {
    gateway = () => status(400, 'bad request')
    const err = await aiChat({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toBe('AI gateway HTTP 400: bad request')
    expect(calls(OLLAMA)).toHaveLength(0)
  })

  it('throws AiClientError when both the gateway and direct Ollama fail', async () => {
    gateway = () => status(503)
    ollama = () => { throw new TypeError('fetch failed') }
    const err = await aiChat({ messages: [{ role: 'user', content: 'hi' }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiClientError)
    expect(err.message).toMatch(/AI gateway failed .*direct Ollama fallback failed/)
  })

  it('falls back for embeddings', async () => {
    gateway = () => status(502)
    ollama = () => okJson({ embedding: [0.5, 0.6] })
    expect(await aiEmbed(['a', 'b'])).toEqual([[0.5, 0.6], [0.5, 0.6]])
    expect(JSON.parse(calls(OLLAMA)[0][1].body)).toEqual({ model: 'nomic-embed-text', prompt: 'a' })
  })

  it('does not fall back for embeddings on a 4xx', async () => {
    gateway = () => status(422)
    await expect(aiEmbed('a')).rejects.toThrow('AI gateway embed HTTP 422')
    expect(calls(OLLAMA)).toHaveLength(0)
  })

  it('falls back for vision and marks fallbackUsed', async () => {
    gateway = () => status(503)
    ollama = () => okJson({ message: { content: 'invoice text' } })
    vi.stubEnv('OLLAMA_VISION_MODEL', 'vision-model')
    expect(await aiVision(['aGk='], 'read')).toEqual({ ok: true, text: 'invoice text', model: 'vision-model', fallbackUsed: true })
    expect(JSON.parse(calls(OLLAMA)[0][1].body).messages[0].images).toEqual(['aGk='])
  })

  it('reports a vision 4xx without falling back', async () => {
    gateway = () => status(413)
    const r = await aiVision(['x'], 'read')
    expect(r).toMatchObject({ ok: false, error: 'AI gateway vision HTTP 413' })
    expect(calls(OLLAMA)).toHaveLength(0)
  })
})
