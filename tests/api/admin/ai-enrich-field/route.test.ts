import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))

// fetch is global — we'll use vi.stubGlobal

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/ai-enrich-field/route'
import { authenticateAdmin } from '@/lib/jwt'

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

function mockFetch(responseBody: object, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(responseBody),
  }))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/ai-enrich-field', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
  })

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ value: 'test value' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
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

  it('returns 503 when Ollama returns non-ok status', async () => {
    mockFetch({}, false, 500)
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/AI service error/)
  })

  it('returns 502 when AI returns unparseable response', async () => {
    mockFetch({ message: { content: 'not json at all !!!' } })
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unparseable/i)
  })

  it('returns 502 when AI returns empty result field', async () => {
    mockFetch({ message: { content: JSON.stringify({ result: '' }) } })
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/empty result/i)
  })

  it('returns 503 on fetch timeout (TimeoutError)', async () => {
    const err = new Error('The operation was aborted')
    err.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/timed out/i)
  })

  it('returns 503 on general fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const res = await POST(makeReq({ value: 'hex bolt M8' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/AI service error/i)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('returns enriched result on success', async () => {
    mockFetch({ message: { content: JSON.stringify({ result: 'M8 Hex Bolt, Grade 8.8' }) } })
    const res = await POST(makeReq({ fieldLabel: 'name', value: 'hex bolt m8', context: 'Hardware store' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBe('M8 Hex Bolt, Grade 8.8')
  })

  it('parses result when AI returns JSON embedded in extra text', async () => {
    mockFetch({ message: { content: 'Here you go: {"result":"Improved name"} thanks!' } })
    const res = await POST(makeReq({ value: 'some product' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('Improved name')
  })

  it('works without fieldLabel or context', async () => {
    mockFetch({ message: { content: JSON.stringify({ result: 'Better description' }) } })
    const res = await POST(makeReq({ value: 'short desc here' }))
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('Better description')
  })
})
