import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/ai-client', () => ({
  aiChat: vi.fn(),
  AiClientError: class AiClientError extends Error {
    constructor(message: string, public readonly provider: string = 'unknown') { super(message) }
  },
}))
vi.mock('@/lib/customer-agent/tools', () => ({
  CUSTOMER_TOOLS: [
    {
      name: 'search_products',
      description: 'Search for products',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search term' } },
        required: ['query'],
      },
    },
    {
      name: 'get_my_order',
      description: 'Get details of a specific order',
      inputSchema: {
        type: 'object',
        properties: { orderNumber: { type: 'string' } },
        required: ['orderNumber'],
      },
    },
  ],
  getCustomerTool: vi.fn(),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/customer-agent/chat/route'
import { authenticateUser } from '@/lib/jwt'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { getCustomerTool } from '@/lib/customer-agent/tools'

const mockAuth = vi.mocked(authenticateUser)
const mockAiChat = vi.mocked(aiChat)
const mockGetTool = vi.mocked(getCustomerTool)

const USER_ID = 'user-uuid-1234-5678'

function makeRequest(body: object) {
  return new Request('http://localhost/api/customer-agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/customer-agent/chat', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ message: 'Hello' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when message is empty', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makeRequest({ message: '' }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
    expect(json.fields?.message).toBeTruthy()
  })

  it('returns 400 when message exceeds 2000 chars', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makeRequest({ message: 'x'.repeat(2001) }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns final text when AI responds without tool calls', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    // Native tools API: no toolCalls on response → prose answer returned directly
    mockAiChat.mockResolvedValueOnce({
      content: 'Here are some products for you!',
      toolCalls: undefined,
      provider: 'ollama',
      model: 'gemma4:12b',
      latencyMs: 1200,
      fallbackUsed: false,
    } as any)

    const res = await POST(makeRequest({ message: 'Show me hex bolts' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Here are some products for you!')
    expect(json.toolCalls).toEqual([])
    expect(json.provider).toBe('ollama')
  })

  it('executes a native tool call and returns server-formatted result for product tools', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    // Model returns native toolCalls array (not XML)
    mockAiChat.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ name: 'search_products', arguments: { query: 'hex bolt' } }],
      provider: 'ollama',
      model: 'gemma4:12b',
      latencyMs: 800,
      fallbackUsed: false,
    } as any)

    const mockTool = {
      handler: vi.fn().mockResolvedValueOnce({
        products: [{ id: 'p1', name: 'Hex Bolt M10', slug: 'hex-bolt-m10', price: '85.00' }],
      }),
    }
    mockGetTool.mockReturnValueOnce(mockTool as any)

    const res = await POST(makeRequest({ message: 'Find hex bolts' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    // search_products is in SELF_FORMATTING_TOOLS — response is formatted server-side
    expect(json.message).toContain('hex-bolt-m10')
    expect(json.toolCalls).toHaveLength(1)
    expect(json.toolCalls[0].tool).toBe('search_products')
    expect(mockTool.handler).toHaveBeenCalledWith({ query: 'hex bolt' }, { authenticatedUserId: USER_ID })
  })

  it('records tool error when tool not found and loops back for prose', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    // First call: unknown tool; second call: prose answer
    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'forbidden_tool', arguments: {} }],
        provider: 'ollama', model: 'gemma4:12b', latencyMs: 500, fallbackUsed: false,
      } as any)
      .mockResolvedValueOnce({
        content: 'Sorry, I cannot do that.',
        toolCalls: undefined,
        provider: 'ollama', model: 'gemma4:12b', latencyMs: 400, fallbackUsed: false,
      } as any)

    mockGetTool.mockReturnValueOnce(null) // tool not found

    const res = await POST(makeRequest({ message: 'Do something forbidden' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.toolCalls[0].isError).toBe(true)
    expect(json.toolCalls[0].tool).toBe('forbidden_tool')
  })

  it('records tool error when tool handler throws and loops back', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'get_my_order', arguments: { orderNumber: 'ORD-123' } }],
        provider: 'ollama', model: 'gemma4:12b', latencyMs: 600, fallbackUsed: false,
      } as any)
      .mockResolvedValueOnce({
        content: 'Something went wrong with that order.',
        toolCalls: undefined,
        provider: 'ollama', model: 'gemma4:12b', latencyMs: 400, fallbackUsed: false,
      } as any)

    const mockTool = { handler: vi.fn().mockRejectedValueOnce(new Error('DB error')) }
    mockGetTool.mockReturnValueOnce(mockTool as any)

    const res = await POST(makeRequest({ message: 'Look up invoice ORD-123' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.toolCalls[0].isError).toBe(true)
    // After tool error, loop returns to LLM which gives the final prose
    expect(json.message).toBe('Something went wrong with that order.')
  })

  it('degrades gracefully to a friendly message when aiChat throws', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockAiChat.mockRejectedValueOnce(new AiClientError('Model unavailable', 'ollama'))

    const res = await POST(makeRequest({ message: 'Hello there' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toMatch(/trouble responding|try again/i)
    expect(json.error).toBeUndefined()
  })

  it('degrades gracefully to a friendly message on generic AI error', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockAiChat.mockRejectedValueOnce(new Error('Connection reset'))

    const res = await POST(makeRequest({ message: 'Hello' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toMatch(/trouble responding|try again/i)
    expect(json.error).toBeUndefined()
  })

  it('returns fallback message when max iterations exhausted with only tool calls', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    // AI keeps returning tool calls for a non-self-formatting tool, never prose
    mockAiChat.mockResolvedValue({
      content: '',
      toolCalls: [{ name: 'get_my_order', arguments: { orderNumber: 'ORD-999' } }],
      provider: 'ollama', model: 'gemma4:12b', latencyMs: 300, fallbackUsed: false,
    } as any)

    const mockTool = { handler: vi.fn().mockResolvedValue({ order: null }) }
    mockGetTool.mockReturnValue(mockTool as any)

    const res = await POST(makeRequest({ message: 'Track shipment ORD-999' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    // Exhausted MAX_ITERATIONS with no prose — finalText stays empty → fallback message
    expect(json.message).toMatch(/trouble|try again/i)
  })

  it('handles malformed JSON body gracefully', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const req = new Request('http://localhost/api/customer-agent/chat', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })
})
