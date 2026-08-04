import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/template-vars', () => ({
  TEMPLATE_VARS: [
    { key: 'customer_first_name', description: 'First name' },
    { key: 'store_name', description: 'Store name' },
  ],
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/ai-generate-email/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['mailer'] }

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/ai-generate-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ scenario: 'send a welcome email to a new customer' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when missing mailer scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost({ scenario: 'send a welcome email to a new customer' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
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

  it('returns 503 when Ollama returns non-ok response', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('AI service error') })
  })

  it('returns html on successful Ollama response', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: JSON.stringify({ html: '<p>Hello world</p>' }) }),
    }))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch', subject: 'New arrivals' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ html: '<p>Hello world</p>' })
  })

  it('falls back to regex parse when content is not clean JSON', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'Here is the output:\n{"html":"<p>body</p>"}' }),
    }))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ html: '<p>body</p>' })
  })

  it('returns 502 when AI content cannot be parsed at all', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'no json here at all' }),
    }))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'AI returned empty result' })
  })

  it('returns 502 when AI returns empty html field', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"html":""}' }),
    }))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'AI returned empty result' })
  })

  it('returns 503 on fetch network error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('AI error') })
  })

  it('returns 504 with timeout message on AbortError', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const timeoutErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr))
    const res = await POST(makePost({ scenario: 'send a promotional email about a new product launch' }))
    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ error: 'AI request timed out' })
  })
})
