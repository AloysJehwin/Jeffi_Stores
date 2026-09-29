import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/brand', () => ({ storeDescriptorForPrompt: vi.fn() }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/ai-enrich-field/route'
import { authenticateAdmin } from '@/lib/jwt'
import { aiChat } from '@/lib/ai-client'
import { storeDescriptorForPrompt } from '@/lib/brand'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'administrator', scopes: [] }

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/admin/ai-enrich-field', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeBadJsonReq() {
  return new NextRequest('http://localhost/api/admin/ai-enrich-field', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockAiChat = vi.mocked(aiChat)

function aiReply(content: string) {
  mockAiChat.mockResolvedValue({ content, provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false } as any)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/ai-enrich-field', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    vi.mocked(storeDescriptorForPrompt).mockResolvedValue('Test Store, an online store')
  })

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ value: 'test value' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  // ── Scope and plan gating ────────────────────────────────────────────────

  it('returns 400 for a scope outside the AI allowlist', async () => {
    const res = await POST(makeReq({ value: 'some product', scope: 'orders:write' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid ai scope/i)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('does not accept the AI entitlement itself as a field scope', async () => {
    const res = await POST(makeReq({ value: 'some product', scope: 'catalog_enrichment:write' }))
    expect(res.status).toBe(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('returns 403 when the plan does not include admin AI', async () => {
    mockAuth.mockResolvedValue({ adminId: 't1', role: 'super_admin', scopes: ['products:write'] } as any)
    const res = await POST(makeReq({ value: 'some product', scope: 'products:write' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('AI tools are not available for your plan or role')
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('returns 403 when AI is included but the field scope is missing', async () => {
    mockAuth.mockResolvedValue({ adminId: 't1', role: 'super_admin', scopes: ['catalog_enrichment:write'] } as any)
    const res = await POST(makeReq({ value: 'some product', scope: 'brands:write' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('allows a tenant admin holding both the AI entitlement and the field scope', async () => {
    mockAuth.mockResolvedValue({ adminId: 't1', role: 'super_admin', scopes: ['catalog_enrichment:write', 'brands:write'] } as any)
    aiReply(JSON.stringify({ result: 'Better brand blurb' }))
    const res = await POST(makeReq({ value: 'brand blurb', scope: 'brands:write' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('Better brand blurb')
  })

  // ── Input validation ─────────────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const res = await POST(makeBadJsonReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid json/i)
  })

  it('returns 400 when value is missing', async () => {
    const res = await POST(makeReq({ fieldLabel: 'name' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too short/i)
  })

  it('returns 400 when value is too short (single char)', async () => {
    const res = await POST(makeReq({ value: 'x' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too short/i)
  })

  it('returns 400 when value is empty string', async () => {
    const res = await POST(makeReq({ value: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too short/i)
  })

  // ── AI service errors ────────────────────────────────────────────────────

  it('returns 503 with the gateway error when the AI call fails', async () => {
    mockAiChat.mockRejectedValue(new Error('AI gateway HTTP 500: upstream down'))
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/AI gateway HTTP 500/)
  })

  it('returns 502 when AI returns unparseable response', async () => {
    aiReply('not json at all !!!')
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unparseable/i)
  })

  it('returns 502 when AI returns empty result field', async () => {
    aiReply(JSON.stringify({ result: '' }))
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/empty result/i)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('returns enriched result on success, uncached, with the store in the prompt', async () => {
    aiReply(JSON.stringify({ result: 'M8 Hex Bolt, Grade 8.8' }))
    const res = await POST(makeReq({ fieldLabel: 'name', value: 'hex bolt m8', context: 'Product name' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('M8 Hex Bolt, Grade 8.8')
    const req = mockAiChat.mock.calls[0][0]
    expect(req).toMatchObject({ modelHint: 'enrich', jsonMode: true, noCache: true })
    expect(req.messages.find(m => m.role === 'system')!.content).toContain('Test Store, an online store')
    expect(req.messages.find(m => m.role === 'user')!.content).toContain('Current value: hex bolt m8')
  })

  it('parses result when AI returns JSON embedded in extra text', async () => {
    aiReply('Here you go: {"result":"Improved name"} thanks!')
    const res = await POST(makeReq({ value: 'some product' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('Improved name')
  })

  it('works without fieldLabel or context', async () => {
    aiReply(JSON.stringify({ result: 'Better description' }))
    const res = await POST(makeReq({ value: 'short desc here' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('Better description')
  })
})
