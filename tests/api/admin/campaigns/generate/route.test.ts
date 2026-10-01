import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({
  aiChat: vi.fn(),
  AiClientError: class AiClientError extends Error {
    constructor(
      message: string,
      public provider: string,
      public cause?: unknown
    ) {
      super(message)
      this.name = 'AiClientError'
    }
  },
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/campaigns/generate/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { aiChat, AiClientError } from '@/lib/shared/ai-client'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockAiChat = vi.mocked(aiChat)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['mailer'] }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/campaigns/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validAiResponse = {
  content: JSON.stringify({
    name: 'Cart Abandonment',
    kind: 'cart_abandonment',
    subject_template: 'You left something behind, {firstName}!',
    body_template: '<html>Hi {firstName}, you left {itemsHtml}</html>',
  }),
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  latencyMs: 500,
  fallbackUsed: false,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/campaigns/generate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ prompt: 'cart abandon' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when the plan or role has no AI entitlement', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ prompt: 'cart abandon' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('AI tools are not available for your plan or role')
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('returns 403 when AI is available but mailer:write is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockImplementation((_r, _s, scope) => scope !== 'mailer:write')
    const res = await POST(makeRequest({ prompt: 'cart abandon' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('returns 400 when prompt is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ prompt: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/prompt is required/i)
  })

  it('returns 400 when prompt is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/prompt is required/i)
  })

  it('returns 400 when prompt is whitespace only', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ prompt: '   ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/prompt is required/i)
  })

  it('returns 502 on AiClientError', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockRejectedValue(new AiClientError('quota exceeded', 'openai'))

    const res = await POST(makeRequest({ prompt: 'make a campaign' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/quota exceeded/i)
  })

  it('returns 502 on non-AiClientError AI failure', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockRejectedValue(new Error('network error'))

    const res = await POST(makeRequest({ prompt: 'make a campaign' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/ai request failed/i)
  })

  it('returns 502 when AI response is not valid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue({ ...validAiResponse, content: 'not valid json' })

    const res = await POST(makeRequest({ prompt: 'make a campaign' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/failed to parse/i)
  })

  it('returns 502 when AI response is missing subject_template', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue({
      ...validAiResponse,
      content: JSON.stringify({ name: 'Test', kind: 'test', body_template: '<p>Hi</p>' }),
    })

    const res = await POST(makeRequest({ prompt: 'make a campaign' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/missing required fields/i)
  })

  it('returns 502 when AI response is missing body_template', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue({
      ...validAiResponse,
      content: JSON.stringify({ name: 'Test', kind: 'test', subject_template: 'Hello' }),
    })

    const res = await POST(makeRequest({ prompt: 'make a campaign' }))
    expect(res.status).toBe(502)
  })

  it('returns generated campaign on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue(validAiResponse)

    const res = await POST(makeRequest({ prompt: 'cart abandonment email' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Cart Abandonment')
    expect(body.kind).toBe('cart_abandonment')
    expect(body.subject_template).toBe('You left something behind, {firstName}!')
    expect(body.body_template).toContain('{itemsHtml}')
  })

  it('sanitizes kind: lowercases and replaces non-[a-z0-9_] with underscore', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue({
      ...validAiResponse,
      content: JSON.stringify({
        name: 'Test',
        kind: '  Hello World!! ',
        subject_template: 'Hi',
        body_template: '<p>body</p>',
      }),
    })

    const res = await POST(makeRequest({ prompt: 'make something' }))
    const body = await res.json()
    expect(body.kind).toMatch(/^[a-z0-9_]+$/)
    expect(body.kind).toBe('hello_world')
  })

  it('passes scenarioKind/Name/Description/Trigger context to AI', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAiChat.mockResolvedValue(validAiResponse)

    await POST(
      makeRequest({
        prompt: 'cart email',
        scenarioKind: 'abandoned_cart',
        scenarioName: 'Cart Abandon',
        scenarioDescription: 'Fires when cart is abandoned',
        scenarioTrigger: '2 hours after add to cart',
        discountPercent: 10,
      })
    )

    const aiCallArgs = mockAiChat.mock.calls[0][0]
    const userMsg = aiCallArgs.messages.find((m: any) => m.role === 'user')?.content
    expect(userMsg).toContain('abandoned_cart')
    expect(userMsg).toContain('2 hours after add to cart')
    expect(userMsg).toContain('10%')
  })

  it('handles empty JSON body gracefully (no crash)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const req = new NextRequest('http://localhost/api/admin/campaigns/generate', {
      method: 'POST',
      // No body / bad content
    })
    const res = await POST(req)
    expect(res.status).toBe(400) // prompt missing
  })
})
