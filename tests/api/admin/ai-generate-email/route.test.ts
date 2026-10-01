import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn(), AiClientError: Error }))
vi.mock('@/lib/catalog/brand', () => ({
  storeDescriptorForPrompt: vi.fn().mockResolvedValue('Test Store, an online store'),
  storeBaseUrlAsync: vi.fn().mockResolvedValue('https://store.test'),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/ai-generate-email/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { aiChat } from '@/lib/shared/ai-client'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['mailer:write', 'catalog_enrichment:write'] }
const SCENARIO = 'send a promotional email about a new product launch'

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ai-generate-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePostBadJson() {
  return new NextRequest('http://localhost/api/admin/ai-generate-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not-json{{',
  })
}

function aiReply(content: string) {
  return { content, provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false } as any
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/ai-generate-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ scenario: 'send a welcome email to a new customer' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when the plan or role has no AI entitlement', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost({ scenario: 'send a welcome email to a new customer' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'AI tools are not available for your plan or role' })
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('returns 403 when AI is available but the mailer scope is missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'mailer:write')
    const res = await POST(makePost({ scenario: 'send a welcome email to a new customer' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('always gates on mailer:write, ignoring a scope sent by the client', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'mailer:write')
    const res = await POST(makePost({ scenario: SCENARIO, scope: 'products:write' }))
    expect(res.status).toBe(403)
    expect(vi.mocked(hasScope).mock.calls.map(c => c[2])).not.toContain('products:write')
  })

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePostBadJson())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid JSON' })
  })

  it('returns 400 when scenario is too short', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ scenario: 'short' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Scenario too short' })
  })

  it('returns 400 when scenario is empty', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({}))
    expect(res.status).toBe(400)
  })

  it('returns 503 when the gateway call fails', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockRejectedValue(new Error('AI gateway HTTP 500: boom'))
    const res = await POST(makePost({ scenario: SCENARIO }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('AI error') })
  })

  it('returns html on a successful gateway response, uncached, with the store in the prompt', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockResolvedValue(aiReply(JSON.stringify({ html: '<p>Hello world</p>' })))
    const res = await POST(makePost({ scenario: SCENARIO, subject: 'New arrivals' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ html: '<p>Hello world</p>' })
    const req = vi.mocked(aiChat).mock.calls[0][0]
    expect(req).toMatchObject({ modelHint: 'email', jsonMode: true, noCache: true })
    const system = req.messages.find(m => m.role === 'system')!.content
    expect(system).toContain('Test Store, an online store')
    expect(system).toContain('https://store.test')
    expect(req.messages.find(m => m.role === 'user')!.content).toContain('Subject: New arrivals')
  })

  it('falls back to regex parse when content is not clean JSON', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockResolvedValue(aiReply('Here is the output:\n{"html":"<p>body</p>"}'))
    const res = await POST(makePost({ scenario: SCENARIO }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ html: '<p>body</p>' })
  })

  it('returns 502 when AI content cannot be parsed at all', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockResolvedValue(aiReply('no json here at all'))
    const res = await POST(makePost({ scenario: SCENARIO }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'AI returned empty result' })
  })

  it('returns 502 when AI returns empty html field', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockResolvedValue(aiReply('{"html":""}'))
    const res = await POST(makePost({ scenario: SCENARIO }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'AI returned empty result' })
  })
})
