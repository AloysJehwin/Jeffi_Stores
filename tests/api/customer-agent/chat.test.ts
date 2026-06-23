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
        properties: { query: { type: 'string', description: 'search term' } },
        required: ['query'],
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
  beforeEach(() => { vi.clearAllMocks() })

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
    expect(json.error).toContain('message is required')
  })

  it('returns 400 when message exceeds 1000 chars', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makeRequest({ message: 'x'.repeat(1001) }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('message too long')
  })

  it('returns final text when AI responds without tool calls', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockAiChat.mockResolvedValueOnce({
      content: 'Here are some products for you!',
      provider: 'openai',
      model: 'gpt-4o',
    } as any)

    const res = await POST(makeRequest({ message: 'Show me hex bolts' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Here are some products for you!')
    expect(json.toolCalls).toEqual([])
    expect(json.provider).toBe('openai')
    expect(json.model).toBe('gpt-4o')
  })

  it('executes a tool call when AI emits tool_use XML', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    // First AI call returns a tool_use block
    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="search_products">\n{"query":"hex bolt"}\n</tool_use>',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)
      // Second AI call returns final text after tool result
      .mockResolvedValueOnce({
        content: 'I found some hex bolts for you.',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)

    const mockTool = { handler: vi.fn().mockResolvedValueOnce([{ id: 'p1', name: 'Hex Bolt' }]) }
    mockGetTool.mockReturnValueOnce(mockTool as any)

    const res = await POST(makeRequest({ message: 'Find hex bolts' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('I found some hex bolts for you.')
    expect(json.toolCalls).toHaveLength(1)
    expect(json.toolCalls[0].tool).toBe('search_products')
    expect(mockTool.handler).toHaveBeenCalledWith({ query: 'hex bolt' }, { authenticatedUserId: USER_ID })
  })

  it('records tool error when tool not allowed', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="forbidden_tool">\n{}\n</tool_use>',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)
      .mockResolvedValueOnce({
        content: 'Sorry, I cannot do that.',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)

    mockGetTool.mockReturnValueOnce(null) // tool not found

    const res = await POST(makeRequest({ message: 'Do something forbidden' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.toolCalls[0].isError).toBe(true)
  })

  it('records tool error when tool handler throws', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="search_products">\n{"query":"test"}\n</tool_use>',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)
      .mockResolvedValueOnce({
        content: 'Something went wrong.',
        provider: 'openai',
        model: 'gpt-4o',
      } as any)

    const mockTool = { handler: vi.fn().mockRejectedValueOnce(new Error('DB error')) }
    mockGetTool.mockReturnValueOnce(mockTool as any)

    const res = await POST(makeRequest({ message: 'Search for something' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.toolCalls[0].isError).toBe(true)
  })

  it('returns 502 when aiChat throws AiClientError', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockAiChat.mockRejectedValueOnce(new AiClientError('Model unavailable', 'anthropic'))

    const res = await POST(makeRequest({ message: 'Hello there' }) as any)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('Model unavailable')
  })

  it('returns 502 on generic AI error', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockAiChat.mockRejectedValueOnce(new Error('Connection reset'))

    const res = await POST(makeRequest({ message: 'Hello' }) as any)
    expect(res.status).toBe(502)
  })

  it('uses fallback message when max iterations exhausted with only tool calls', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)

    // AI keeps returning tool calls without ever giving a plain text response
    const toolCallContent = '<tool_use name="search_products">\n{"query":"test"}\n</tool_use>'
    mockAiChat.mockResolvedValue({
      content: toolCallContent,
      provider: 'openai',
      model: 'gpt-4o',
    } as any)

    const mockTool = { handler: vi.fn().mockResolvedValue([]) }
    mockGetTool.mockReturnValue(mockTool as any)

    const res = await POST(makeRequest({ message: 'Help me' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    // Should have fallback message
    expect(json.message).toContain('trouble answering')
  })

  it('handles malformed JSON body gracefully', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const req = new Request('http://localhost/api/customer-agent/chat', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req as any)
    // message will be empty string after trim
    expect(res.status).toBe(400)
  })
})
