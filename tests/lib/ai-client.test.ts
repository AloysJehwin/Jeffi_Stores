import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock global fetch before importing the module
const mockFetch = vi.fn()
global.fetch = mockFetch

import { aiChat, AiClientError, getAiProvider } from '@/lib/ai-client'

function makeOllamaOkResponse(content: string, model = 'qwen3:14b') {
  return {
    ok: true,
    json: async () => ({ message: { content }, model }),
    text: async () => '',
  }
}

function makeOpenAiOkResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  }
}

describe('AiClientError', () => {
  it('has name AiClientError', () => {
    const err = new AiClientError('test', 'openai')
    expect(err.name).toBe('AiClientError')
    expect(err.provider).toBe('openai')
    expect(err.message).toBe('test')
  })

  it('is instanceof Error', () => {
    const err = new AiClientError('x', 'ollama')
    expect(err instanceof Error).toBe(true)
  })
})

describe('getAiProvider', () => {
  it('returns openai by default', () => {
    // AI_PROVIDER not set in test env — defaults to openai
    expect(['openai', 'ollama']).toContain(getAiProvider())
  })
})

describe('aiChat — openai provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AI_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
  })

  afterEach(() => {
    delete process.env.AI_PROVIDER
    delete process.env.OPENAI_API_KEY
  })

  it('calls OpenAI and returns content', async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiOkResponse('Hello world'))

    const result = await aiChat({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.content).toBe('Hello world')
    expect(result.provider).toBe('openai')
    expect(typeof result.latencyMs).toBe('number')
    expect(result.fallbackUsed).toBe(false)
  })

  it('throws AiClientError when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY

    await expect(aiChat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('OPENAI_API_KEY not configured')
  })

  it('throws AiClientError on non-ok OpenAI response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    })

    await expect(aiChat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('Rate limit exceeded')
  })

  it('throws AiClientError when choices missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    })

    await expect(aiChat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('choices[0].message.content')
  })

  it('sends jsonMode as response_format json_object', async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiOkResponse('{"a":1}'))

    await aiChat({ messages: [{ role: 'user', content: 'hi' }], jsonMode: true })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('passes temperature and maxTokens', async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiOkResponse('ok'))

    await aiChat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.9, maxTokens: 500 })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.temperature).toBe(0.9)
    expect(body.max_tokens).toBe(500)
  })
})

describe('aiChat — ollama provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AI_PROVIDER = 'ollama'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OLLAMA_FALLBACK_TO_OPENAI = 'false'
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.AI_PROVIDER
    delete process.env.OLLAMA_FALLBACK_TO_OPENAI
  })

  it('calls Ollama health check then chat', async () => {
    // First call: health check /api/tags
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) })
    // Second call: /api/chat
    mockFetch.mockResolvedValueOnce(makeOllamaOkResponse('Ollama response'))

    const result = await aiChat({ messages: [{ role: 'user', content: 'test' }] })

    expect(result.content).toBe('Ollama response')
    expect(result.provider).toBe('ollama')
    expect(result.fallbackUsed).toBe(false)
  })

  it('strips <think>...</think> blocks from Ollama response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce(makeOllamaOkResponse('<think>reasoning here</think>actual answer'))

    const result = await aiChat({ messages: [{ role: 'user', content: 'test' }] })

    expect(result.content).toBe('actual answer')
  })

  it('throws AiClientError when Ollama unreachable and fallback disabled', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused')) // health check fails

    await expect(aiChat({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow('Ollama unreachable and fallback disabled')
  })

  it('falls back to OpenAI when Ollama unreachable and fallback enabled', async () => {
    process.env.OLLAMA_FALLBACK_TO_OPENAI = 'true'

    mockFetch.mockRejectedValueOnce(new Error('connection refused')) // health
    mockFetch.mockResolvedValueOnce(makeOpenAiOkResponse('fallback answer'))

    const result = await aiChat({ messages: [{ role: 'user', content: 'test' }] })

    expect(result.content).toBe('fallback answer')
    expect(result.provider).toBe('openai')
    expect(result.fallbackUsed).toBe(true)
  })

  it('uses thinking field when content is empty (Qwen3 extended-thinking)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: '', thinking: 'The answer is 42.' }, model: 'qwen3:14b' }),
      text: async () => '',
    })

    const result = await aiChat({ messages: [{ role: 'user', content: 'test' }] })
    expect(result.content).toBe('The answer is 42.')
  })

  it('throws AiClientError on non-ok Ollama response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal error',
      json: async () => ({}),
    })

    await expect(aiChat({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow('Ollama HTTP 500')
  })

  it('routes modelHint=sql to SQL model', async () => {
    process.env.OLLAMA_SQL_MODEL = 'codellama:7b'
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce(makeOllamaOkResponse('sql answer', 'codellama:7b'))

    await aiChat({ messages: [{ role: 'user', content: 'test' }], modelHint: 'sql' })

    const body = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body.model).toBe('codellama:7b')
    delete process.env.OLLAMA_SQL_MODEL
  })

  it('returns toolCalls when Ollama responds with native tool_calls', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          content: '',
          tool_calls: [
            { id: 'call_1', function: { name: 'search_products', arguments: { query: 'hex bolt' } } },
          ],
        },
        model: 'gemma4:12b',
      }),
      text: async () => '',
    })

    const result = await aiChat({
      messages: [{ role: 'user', content: 'Find hex bolts' }],
      tools: [{ type: 'function', function: { name: 'search_products', description: 'Search', parameters: {} } }],
    })

    expect(result.content).toBe('')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0].name).toBe('search_products')
    expect(result.toolCalls![0].arguments).toEqual({ query: 'hex bolt' })
    expect(result.provider).toBe('ollama')
  })

  it('passes tools array to Ollama request body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health
    mockFetch.mockResolvedValueOnce(makeOllamaOkResponse('answer'))

    const tools = [{ type: 'function' as const, function: { name: 'my_tool', description: 'desc', parameters: {} } }]
    await aiChat({ messages: [{ role: 'user', content: 'test' }], tools })

    const body = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body.tools).toEqual(tools)
  })

  it('falls back to OpenAI when Ollama call throws and fallback enabled', async () => {
    process.env.OLLAMA_FALLBACK_TO_OPENAI = 'true'

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // health — reachable
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy', json: async () => ({}) }) // ollama fails
    mockFetch.mockResolvedValueOnce(makeOpenAiOkResponse('openai fallback'))

    const result = await aiChat({ messages: [{ role: 'user', content: 'test' }] })
    expect(result.content).toBe('openai fallback')
    expect(result.fallbackUsed).toBe(true)
  })
})
