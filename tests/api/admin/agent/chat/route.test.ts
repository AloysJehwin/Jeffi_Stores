import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/ai-client', () => ({
  aiChat: vi.fn(),
  AiClientError: class AiClientError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AiClientError'
    }
  },
}))
vi.mock('@/lib/admin-agent/tools', () => ({
  TOOLS: [
    {
      name: 'search_products',
      description: 'Search products by name or SKU. Returns matching products.',
      mutating: false,
      inputSchema: {
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'update_product_price',
      description: 'Update product price. Mutating tool.',
      mutating: true,
      inputSchema: {
        required: ['product_id', 'price'],
        properties: {
          product_id: { type: 'string' },
          price: { type: 'number' },
        },
      },
    },
  ],
  getTool: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/agent/chat/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { getTool } from '@/lib/admin-agent/tools'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockAiChat = vi.mocked(aiChat)
const mockGetTool = vi.mocked(getTool)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['agent'],
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=abc' },
    body: JSON.stringify(body),
  })
}

const conversationId = 'conv-uuid-123'

function setupDbMocks() {
  // query() for INSERT user message + INSERT assistant message
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
  // queryMany for history
  mockQueryMany.mockResolvedValue([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
  ])
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/chat', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns 400 when message is empty', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePost({ message: '' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/message is required/i)
  })

  it('returns 400 when message is too long (> 2000 chars)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePost({ message: 'x'.repeat(2001) }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/too long/i)
  })

  it('returns 400 when body is not JSON', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest('http://localhost/api/admin/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    // catches json parse error, message is empty string
    expect(res.status).toBe(400)
  })

  it('returns a direct text response from AI (no tool calls)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockResolvedValue({
      content: 'Here is your answer.',
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    const res = await POST(makePost({ message: 'What is the weather?' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toBe('Here is your answer.')
    expect(data.provider).toBe('openai')
    expect(data.model).toBe('gpt-4')
    expect(data.toolCalls).toEqual([])
    expect(data.proposedActions).toEqual([])
    expect(data.pickers).toEqual([])
  })

  it('generates a conversationId when none provided', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockResolvedValue({
      content: 'Response.',
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.conversationId).toBeTruthy()
    expect(typeof data.conversationId).toBe('string')
  })

  it('uses provided conversationId', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockResolvedValue({
      content: 'Response.',
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    const res = await POST(makePost({ message: 'hello', conversationId }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.conversationId).toBe(conversationId)
  })

  it('handles a tool call and returns tool call records', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    // First call: model emits a tool_use block
    // Second call: model gives final answer
    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="search_products">{"query":"bolt"}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: 'I found 2 bolts.',
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'search_products',
      description: 'Search products',
      mutating: false,
      inputSchema: { required: ['query'], properties: { query: { type: 'string' } } },
      handler: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Hex Bolt' }]),
    } as any)

    const res = await POST(makePost({ message: 'find bolts' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toBe('I found 2 bolts.')
    expect(data.toolCalls).toHaveLength(1)
    expect(data.toolCalls[0].tool).toBe('search_products')
    expect(data.toolCalls[0].input).toEqual({ query: 'bolt' })
  })

  it('handles unknown tool gracefully', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="nonexistent_tool">{"x":"y"}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: 'Tool not found response.',
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue(null)

    const res = await POST(makePost({ message: 'use bad tool' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.toolCalls[0].isError).toBe(true)
    expect(data.toolCalls[0].output).toMatch(/Unknown tool/i)
  })

  it('handles tool handler throwing an error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="search_products">{"query":"bolt"}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: 'Error occurred.',
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'search_products',
      description: 'Search products',
      mutating: false,
      inputSchema: { required: ['query'], properties: { query: { type: 'string' } } },
      handler: vi.fn().mockRejectedValue(new Error('DB timeout')),
    } as any)

    const res = await POST(makePost({ message: 'search products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.toolCalls[0].isError).toBe(true)
    expect(data.toolCalls[0].output).toMatch(/DB timeout/)
  })

  it('handles mutating tool with proposed action', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="update_product_price">{"product_id":"p1","price":200}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: "I've proposed this — review the action card.",
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'update_product_price',
      description: 'Update product price',
      mutating: true,
      inputSchema: {
        required: ['product_id', 'price'],
        properties: { product_id: { type: 'string' }, price: { type: 'number' } },
      },
      handler: vi.fn().mockResolvedValue({
        proposed: true,
        kind: 'update_price',
        payload: { product_id: 'p1', price: 200 },
        confirmation: 'Update price of product p1 to ₹200?',
      }),
    } as any)

    mockQueryOne.mockResolvedValue({ id: 'action-uuid-1' } as any)

    const res = await POST(makePost({ message: 'update price' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.proposedActions).toHaveLength(1)
    expect(data.proposedActions[0].kind).toBe('update_price')
    expect(data.proposedActions[0].id).toBe('action-uuid-1')
  })

  it('handles mutating tool with ok+action pattern', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="update_product_price">{"product_id":"p1","price":300}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: "Proposed.",
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'update_product_price',
      description: 'Update product price',
      mutating: true,
      inputSchema: {
        required: ['product_id', 'price'],
        properties: { product_id: { type: 'string' }, price: { type: 'number' } },
      },
      handler: vi.fn().mockResolvedValue({
        ok: true,
        action: {
          kind: 'update_price',
          payload: { product_id: 'p1', price: 300 },
          confirmation: 'Confirm price update?',
        },
      }),
    } as any)

    mockQueryOne.mockResolvedValue({ id: 'action-uuid-2' } as any)

    const res = await POST(makePost({ message: 'set price to 300' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.proposedActions).toHaveLength(1)
    expect(data.proposedActions[0].kind).toBe('update_price')
  })

  it('handles needs_choice response from tool', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '<tool_use name="search_products">{"query":"bolt"}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: 'Multiple matches — pick one above.',
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'search_products',
      description: 'Search products',
      mutating: false,
      inputSchema: { required: ['query'], properties: { query: { type: 'string' } } },
      handler: vi.fn().mockResolvedValue({
        needs_choice: true,
        choice_kind: 'product',
        options: [
          { id: 'p1', label: 'Hex Bolt M6' },
          { id: 'p2', label: 'Hex Bolt M8' },
        ],
        note: 'Pick one',
      }),
    } as any)

    const res = await POST(makePost({ message: 'find bolt' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.pickers).toHaveLength(1)
    expect(data.pickers[0].choice_kind).toBe('product')
    expect(data.pickers[0].options).toHaveLength(2)
  })

  it('retries when AI responds with stall text (no tool call)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    // First response: stall text
    // Second response: actual answer
    mockAiChat
      .mockResolvedValueOnce({
        content: "Let me fetch that for you.",
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: "Here is the data.",
        provider: 'openai',
        model: 'gpt-4',
      } as any)

    const res = await POST(makePost({ message: 'show me products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(mockAiChat).toHaveBeenCalledTimes(2)
    expect(data.message).toBe('Here is the data.')
  })

  it('returns fallback message when AI hits iteration limit', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    // Simulate model always calling a tool — it will loop up to MAX_ITERATIONS
    let callCount = 0
    mockAiChat.mockImplementation(async () => {
      callCount++
      return {
        content: '<tool_use name="search_products">{"query":"bolt"}</tool_use>',
        provider: 'openai',
        model: 'gpt-4',
      } as any
    })

    mockGetTool.mockReturnValue({
      name: 'search_products',
      description: 'Search products',
      mutating: false,
      inputSchema: { required: ['query'], properties: { query: { type: 'string' } } },
      handler: vi.fn().mockResolvedValue([]),
    } as any)

    const res = await POST(makePost({ message: 'find something' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toMatch(/iteration limit/i)
  })

  it('returns 502 when AI client throws AiClientError', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockRejectedValue(new AiClientError('AI service unavailable'))

    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toMatch(/AI service unavailable/i)
  })

  it('returns 502 on generic AI error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockRejectedValue(new Error('Network error'))

    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toMatch(/Network error/i)
  })

  it('parses ui_blocks from AI response', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    const blocks = [{ type: 'heading', value: 'Products', level: 2 }]
    mockAiChat.mockResolvedValue({
      content: `Here are the products:\n<ui_blocks>${JSON.stringify(blocks)}</ui_blocks>`,
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    const res = await POST(makePost({ message: 'show products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.uiBlocks).toHaveLength(1)
    expect(data.uiBlocks[0].type).toBe('heading')
    expect(data.message).toBe('Here are the products:')
  })

  it('stores user message and assistant response in DB', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockResolvedValue({
      content: 'My response.',
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    await POST(makePost({ message: 'test message', conversationId }))

    // First query call stores user message
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO admin_agent_messages'),
      expect.arrayContaining(['a1', conversationId, 'test message'])
    )
    // Second query call stores assistant message
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO admin_agent_messages'),
      expect.arrayContaining(['a1', conversationId, 'My response.'])
    )
  })

  it('filters history to only user and assistant roles', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    // History contains a 'system' role entry that should be filtered
    mockQueryMany.mockResolvedValue([
      { role: 'user', content: 'Hello' },
      { role: 'system', content: 'System message' }, // should be filtered
      { role: 'assistant', content: 'Hi' },
    ])

    mockAiChat.mockResolvedValue({
      content: 'Response.',
      provider: 'openai',
      model: 'gpt-4',
    } as any)

    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(200)
    // Verify aiChat was called with messages not including 'system' from history
    const chatCall = mockAiChat.mock.calls[0][0]
    const historyMessages = chatCall.messages.filter((m: any) => m.content !== expect.stringContaining('/no_think'))
    const systemFromHistory = historyMessages.find(
      (m: any) => m.role === 'system' && m.content === 'System message'
    )
    expect(systemFromHistory).toBeUndefined()
  })
})
