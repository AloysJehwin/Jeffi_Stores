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
    constructor(
      message: string,
      public readonly provider: string = 'unknown'
    ) {
      super(message)
      this.name = 'AiClientError'
    }
  },
}))
vi.mock('@/lib/rag', () => ({
  findSimilar: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/tenant-context', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  resolveTenantId: vi.fn(async () => null),
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

    // First call: model emits a native tool call
    // Second call: model gives final answer
    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'search_products', arguments: { query: 'bolt' } }],
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
        content: '',
        toolCalls: [{ name: 'nonexistent_tool', arguments: { x: 'y' } }],
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
        content: '',
        toolCalls: [{ name: 'search_products', arguments: { query: 'bolt' } }],
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
        content: '',
        toolCalls: [{ name: 'update_product_price', arguments: { product_id: 'p1', price: 200 } }],
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
        content: '',
        toolCalls: [{ name: 'update_product_price', arguments: { product_id: 'p1', price: 300 } }],
        provider: 'openai',
        model: 'gpt-4',
      } as any)
      .mockResolvedValueOnce({
        content: 'Proposed.',
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
        content: '',
        toolCalls: [{ name: 'search_products', arguments: { query: 'bolt' } }],
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

  it('returns fallback message when AI hits iteration limit', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    // Simulate model always emitting a native tool call — it will loop up to MAX_ITERATIONS
    let callCount = 0
    mockAiChat.mockImplementation(async () => {
      callCount++
      return {
        content: '',
        toolCalls: [{ name: 'search_products', arguments: { query: 'bolt' } }],
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

    mockAiChat.mockRejectedValue(new AiClientError('AI service unavailable', 'anthropic'))

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
    const systemFromHistory = historyMessages.find((m: any) => m.role === 'system' && m.content === 'System message')
    expect(systemFromHistory).toBeUndefined()
  })

  // ── __call_admin_api_immediate__ marker branch ───────────────────────────────

  it('invokes admin API internally for __call_admin_api_immediate__ marker (success)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'call_admin_api', arguments: { path: '/api/admin/orders' } }],
        provider: 'ollama',
        model: 'qwen2.5',
      } as any)
      .mockResolvedValueOnce({
        content: 'Done.',
        provider: 'ollama',
        model: 'qwen2.5',
      } as any)

    mockGetTool.mockReturnValue({
      name: 'call_admin_api',
      description: 'Call admin API',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        marker: '__call_admin_api_immediate__',
        method: 'GET',
        path: '/api/admin/orders',
      }),
    } as any)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ orders: [] }),
      text: async () => '',
    } as any)

    const res = await POST(makePost({ message: 'list orders via api endpoint route' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // The tool-call record is replaced by the API invocation result
    expect(data.toolCalls[0].tool).toBe('call_admin_api')
    expect(data.toolCalls[0].isError).toBe(false)
    expect(data.toolCalls[0].output.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockRestore()
  })

  it('marks isError when admin API invocation returns non-ok', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'call_admin_api', arguments: {} }],
        provider: 'ollama',
        model: 'qwen2.5',
      } as any)
      .mockResolvedValueOnce({ content: 'Failed.', provider: 'ollama', model: 'qwen2.5' } as any)

    mockGetTool.mockReturnValue({
      name: 'call_admin_api',
      description: 'Call admin API',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        marker: '__call_admin_api_immediate__',
        method: 'POST',
        path: '/api/admin/orders',
      }),
    } as any)

    // fetch throws → invokeAdminApiInternal returns { ok:false, status:0, ... }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await POST(makePost({ message: 'call the api endpoint route' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.toolCalls[0].isError).toBe(true)
    expect(data.toolCalls[0].output.ok).toBe(false)
    fetchSpy.mockRestore()
  })

  // ── uiBlocks hoisting + tool result branch ───────────────────────────────────

  it('hoists uiBlocks embedded in a non-mutating tool result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'search_products', arguments: { query: 'x' } }],
        provider: 'ollama',
        model: 'qwen2.5',
      } as any)
      .mockResolvedValueOnce({ content: 'Here.', provider: 'ollama', model: 'qwen2.5' } as any)

    mockGetTool.mockReturnValue({
      name: 'search_products',
      description: 'Search',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        uiBlocks: [{ type: 'callout', tone: 'warn', message: 'hi' }],
      }),
    } as any)

    const res = await POST(makePost({ message: 'find x' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.uiBlocks).toEqual([{ type: 'callout', tone: 'warn', message: 'hi' }])
  })

  // ── Deterministic quotation auto-advance inside LLM loop ──────────────────────

  it('auto-proposes quotation when match_quotation_items resolves all lines in the loop', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    // history must contain a user message carrying the email so it is extracted
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'prepare quote for buyer@example.com' }])
    mockQueryOne.mockResolvedValue({ id: 'q-action-1' } as any)

    // Model emits one tool call to match_quotation_items, then loop should end deterministically
    mockAiChat.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ name: 'match_quotation_items', arguments: { lines: '[]' } }],
      provider: 'ollama',
      model: 'qwen2.5',
    } as any)

    const matchTool = {
      name: 'match_quotation_items',
      description: 'Match',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          counts: { matched: 1, ambiguous: 0, unmatched: 0 },
          lines: [{ status: 'matched', qty: 2, candidates: [{ productId: 'p1' }] }],
        },
      }),
    }
    const proposeTool = {
      name: 'propose_create_quotation',
      description: 'Propose',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        proposed: true,
        kind: 'create_quotation',
        payload: { foo: 'bar' },
        confirmation: 'Confirm?',
        ui_blocks: [{ type: 'heading', value: 'Quote', level: 2 }],
      }),
    }
    mockGetTool.mockImplementation((name: string) =>
      name === 'match_quotation_items' ? (matchTool as any) : (proposeTool as any)
    )

    // message avoids the server-side numbered-list short-circuit (no numbered lines)
    const res = await POST(makePost({ message: 'match these items and quote buyer@example.com' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toMatch(/All items matched/i)
    expect(data.proposedActions).toHaveLength(1)
    expect(data.proposedActions[0].kind).toBe('create_quotation')
    expect(data.uiBlocks).toContainEqual({ type: 'heading', value: 'Quote', level: 2 })
    expect(proposeTool.handler).toHaveBeenCalledOnce()
  })

  it('handles error thrown by auto-propose in quotation advance', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'quote buyer@example.com' }])

    mockAiChat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ name: 'match_quotation_items', arguments: { lines: '[]' } }],
        provider: 'ollama',
        model: 'qwen2.5',
      } as any)
      .mockResolvedValueOnce({ content: 'Recovered.', provider: 'ollama', model: 'qwen2.5' } as any)

    const matchTool = {
      name: 'match_quotation_items',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          counts: { matched: 1, ambiguous: 0, unmatched: 0 },
          lines: [{ status: 'matched', qty: 1, candidates: [{ productId: 'p1' }] }],
        },
      }),
    }
    const proposeTool = {
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockRejectedValue(new Error('propose boom')),
    }
    mockGetTool.mockImplementation((name: string) =>
      name === 'match_quotation_items' ? (matchTool as any) : (proposeTool as any)
    )

    const res = await POST(makePost({ message: 'resolve items and quote buyer@example.com' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // auto-advance sets done=true even after error, finalText defaults to "All items matched"
    expect(data.message).toMatch(/All items matched/i)
  })

  // ── __quotation_confirm__ short-circuit ──────────────────────────────────────

  it('confirms quotation and inserts proposed action (__quotation_confirm__)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    // prior user messages hold the customer email
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'quote for buyer@example.com please' }])
    mockQueryOne.mockResolvedValue({ id: 'qc-action-1' } as any)

    const proposeTool = {
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        proposed: true,
        kind: 'create_quotation',
        payload: { total: 5000 },
        confirmation: 'Create quote?',
        ui_blocks: [{ type: 'heading', value: 'Quote', level: 2 }],
      }),
    }
    mockGetTool.mockReturnValue(proposeTool as any)

    const items = [
      { productId: 'p1', quantity: 2 },
      { skipped: true, requestedText: 'unknown widget', quantity: 1 },
    ]
    const res = await POST(makePost({ message: '__quotation_confirm__' + JSON.stringify(items) }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.proposedActions).toHaveLength(1)
    expect(data.proposedActions[0].kind).toBe('create_quotation')
    expect(data.message).toMatch(/Quotation ready/i)
    expect(data.message).toMatch(/1 item skipped/i)
    expect(data.uiBlocks).toContainEqual({ type: 'heading', value: 'Quote', level: 2 })
    // propose called with the non-skipped item only
    expect(proposeTool.handler).toHaveBeenCalledWith({
      customerEmail: 'buyer@example.com',
      items: JSON.stringify([{ productId: 'p1', quantity: 2 }]),
    })
  })

  it('surfaces address picker on needs_choice during __quotation_confirm__', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'buyer@example.com' }])

    mockGetTool.mockReturnValue({
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        needs_choice: true,
        choice_kind: 'address',
        options: [
          { id: 'a1', label: 'Home' },
          { id: 'a2', label: 'Office' },
        ],
        note: 'Pick address',
      }),
    } as any)

    const res = await POST(
      makePost({ message: '__quotation_confirm__' + JSON.stringify([{ productId: 'p1', quantity: 1 }]) })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.pickers).toHaveLength(1)
    expect(data.pickers[0].choice_kind).toBe('address')
    expect(data.message).toMatch(/pick one/i)
  })

  it('returns reason when __quotation_confirm__ has no customer email', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'no email here' }])

    mockGetTool.mockReturnValue({
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn(),
    } as any)

    const res = await POST(
      makePost({ message: '__quotation_confirm__' + JSON.stringify([{ productId: 'p1', quantity: 1 }]) })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toMatch(/customer email not found/i)
    expect(data.proposedActions).toEqual([])
  })

  it('returns reason when all items were skipped in __quotation_confirm__', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'buyer@example.com' }])

    mockGetTool.mockReturnValue({
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn(),
    } as any)

    const items = [
      { skipped: true, requestedText: 'a', quantity: 1 },
      { skipped: true, requestedText: 'b', quantity: 1 },
    ]
    const res = await POST(makePost({ message: '__quotation_confirm__' + JSON.stringify(items) }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toMatch(/were skipped/i)
  })

  it('returns 500 when __quotation_confirm__ JSON is malformed', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makePost({ message: '__quotation_confirm__not-json' }))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/Quotation confirm failed/i)
  })

  it('returns summary when __quotation_confirm__ propose is not proposed', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([{ role: 'user', content: 'buyer@example.com' }])

    mockGetTool.mockReturnValue({
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({ proposed: false, summary: 'No matching products.' }),
    } as any)

    const res = await POST(
      makePost({ message: '__quotation_confirm__' + JSON.stringify([{ productId: 'p1', quantity: 1 }]) })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toBe('No matching products.')
    expect(data.proposedActions).toEqual([])
  })

  // ── parseQuotationRequest server-side numbered-list short-circuit ─────────────

  it('short-circuits numbered-list quotation and auto-proposes when all matched', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryOne.mockResolvedValue({ id: 'nl-action-1' } as any)

    const matchTool = {
      name: 'match_quotation_items',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lines: [
            { status: 'matched', qty: 2, candidates: [{ productId: 'p1' }] },
            { status: 'matched', qty: 5, candidates: [{ productId: 'p2' }] },
          ],
        },
      }),
    }
    const proposeTool = {
      name: 'propose_create_quotation',
      mutating: true,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        proposed: true,
        kind: 'create_quotation',
        payload: { total: 1 },
        confirmation: 'ok?',
        ui_blocks: [{ type: 'callout', tone: 'info', message: 'ready' }],
      }),
    }
    mockGetTool.mockImplementation((name: string) =>
      name === 'match_quotation_items' ? (matchTool as any) : (proposeTool as any)
    )

    const message = 'Prepare a quotation for buyer@example.com\n1. Hex bolt M6 2 nos\n2. Washer 5 pcs'
    const res = await POST(makePost({ message }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toMatch(/All items matched/i)
    expect(data.uiBlocks[0].type).toBe('quotation_resolver')
    expect(data.proposedActions).toHaveLength(1)
    // aiChat must NOT be invoked — short-circuited before the LLM loop
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('short-circuits numbered-list quotation with ambiguous/unmatched counts', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const matchTool = {
      name: 'match_quotation_items',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lines: [
            { status: 'matched', qty: 2, candidates: [{ productId: 'p1' }] },
            { status: 'ambiguous', qty: 1, candidates: [{ productId: 'p2' }, { productId: 'p3' }] },
            { status: 'unmatched', qty: 3, candidates: [] },
          ],
        },
      }),
    }
    mockGetTool.mockImplementation((name: string) => (name === 'match_quotation_items' ? (matchTool as any) : null))

    const message =
      'Create a quote for buyer@example.com\n1. Hex bolt M6 2 nos\n2. Mystery item 1 no\n3. Ghost part 3 pcs'
    const res = await POST(makePost({ message }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.uiBlocks[0].type).toBe('quotation_resolver')
    expect(data.message).toMatch(/1 matched/)
    expect(data.message).toMatch(/1 need review/)
    expect(data.message).toMatch(/1 not found/)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('falls through to LLM when numbered-list match batch fails', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])

    const matchTool = {
      name: 'match_quotation_items',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockResolvedValue({ ok: false }),
    }
    mockGetTool.mockImplementation((name: string) => (name === 'match_quotation_items' ? (matchTool as any) : null))
    mockAiChat.mockResolvedValue({ content: 'LLM fallback.', provider: 'ollama', model: 'qwen2.5' } as any)

    const message = 'Generate a quotation for buyer@example.com\n1. Hex bolt M6 2 nos\n2. Washer 5 pcs'
    const res = await POST(makePost({ message }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // batch failed → allLines cleared → falls through to LLM
    expect(mockAiChat).toHaveBeenCalled()
    expect(data.message).toBe('LLM fallback.')
  })

  it('falls through to LLM when match_quotation_items handler throws', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])

    const matchTool = {
      name: 'match_quotation_items',
      mutating: false,
      inputSchema: { properties: {} },
      handler: vi.fn().mockRejectedValue(new Error('embedding down')),
    }
    mockGetTool.mockImplementation((name: string) => (name === 'match_quotation_items' ? (matchTool as any) : null))
    mockAiChat.mockResolvedValue({ content: 'LLM path.', provider: 'ollama', model: 'qwen2.5' } as any)

    const message = 'Draft a quote for buyer@example.com\n1. Hex bolt M6 2 nos\n2. Washer 5 pcs'
    const res = await POST(makePost({ message }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(mockAiChat).toHaveBeenCalled()
    expect(data.message).toBe('LLM path.')
  })

  it('does not short-circuit numbered-list quotation when match tool missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])
    mockGetTool.mockReturnValue(null)
    mockAiChat.mockResolvedValue({ content: 'No match tool.', provider: 'ollama', model: 'qwen2.5' } as any)

    const message = 'Make a quotation for buyer@example.com\n1. Hex bolt 2 nos\n2. Washer 5 pcs'
    const res = await POST(makePost({ message }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(mockAiChat).toHaveBeenCalled()
    expect(data.message).toBe('No match tool.')
  })

  // ── RAG context enrichment ───────────────────────────────────────────────────

  it('includes RAG context in system prompt when findSimilar returns rows', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    const { findSimilar } = await import('@/lib/rag')
    vi.mocked(findSimilar).mockResolvedValueOnce([
      { source_table: 'products', source_id: 'p1', content: 'Hex bolt M6' } as any,
    ])

    mockAiChat.mockResolvedValue({ content: 'ok', provider: 'ollama', model: 'qwen2.5' } as any)

    const res = await POST(makePost({ message: 'tell me about products' }))
    expect(res.status).toBe(200)
    const systemMsg = mockAiChat.mock.calls[0][0].messages.find((m: any) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).toMatch(/STORE DATA CONTEXT/)
    expect(systemMsg!.content).toMatch(/Hex bolt M6/)
  })

  it('tolerates findSimilar throwing (RAG unavailable)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    const { findSimilar } = await import('@/lib/rag')
    vi.mocked(findSimilar).mockRejectedValueOnce(new Error('pgvector down'))

    mockAiChat.mockResolvedValue({ content: 'still ok', provider: 'ollama', model: 'qwen2.5' } as any)

    const res = await POST(makePost({ message: 'anything' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toBe('still ok')
  })

  it('never puts the platform RAG index into a tenant admin prompt', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    const { resolveTenantId } = await import('@/lib/tenant-context')
    vi.mocked(resolveTenantId).mockResolvedValue('tenant-1')
    const { findSimilar } = await import('@/lib/rag')
    vi.mocked(findSimilar).mockResolvedValue([
      { source_table: 'users', source_id: 'u1', content: 'Flagship Customer | a@b.c' } as any,
    ])

    mockAiChat.mockResolvedValue({ content: 'ok', provider: 'ollama', model: 'qwen2.5' } as any)

    const res = await POST(makePost({ message: 'who are my customers' }))
    expect(res.status).toBe(200)
    expect(findSimilar).not.toHaveBeenCalled()
    const systemMsg = mockAiChat.mock.calls[0][0].messages.find((m: any) => m.role === 'system')
    expect(systemMsg!.content).not.toMatch(/STORE DATA CONTEXT/)
    expect(systemMsg!.content).not.toMatch(/Flagship Customer/)
  })

  // ── Sanitised 502 for provider/billing internals ─────────────────────────────

  it('maps provider/billing errors to a generic 502 message', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    setupDbMocks()

    mockAiChat.mockRejectedValue(new AiClientError('OpenAI: no credits remaining', 'openai'))

    const res = await POST(makePost({ message: 'hello' }))
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toMatch(/temporarily unavailable/i)
    expect(data.error).not.toMatch(/credits/i)
  })
})
