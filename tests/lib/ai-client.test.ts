import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/lib/tenant-context', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  resolveTenantId: vi.fn(async () => null),
}))

import { aiChat, aiEmbed, aiVision, AiClientError, getAiProvider } from '@/lib/ai-client'
import { resolveTenantId } from '@/lib/tenant-context'

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
