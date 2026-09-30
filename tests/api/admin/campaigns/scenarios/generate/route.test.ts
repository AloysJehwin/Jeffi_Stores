import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}))

vi.mock('@/lib/campaigns/sql-safety', () => ({
  validateScenarioSql: vi.fn(),
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

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/campaigns/scenarios/generate/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'
import { aiChat, AiClientError } from '@/lib/ai-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['mailer'] }

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/admin/campaigns/scenarios/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_AI_RESPONSE = {
  name: 'New Customer Welcome',
  kind: 'new_customer_welcome',
  description: 'First-time signups within 24h get a welcome email.',
  sql: "SELECT u.id FROM users u WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE AND u.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = $1 AND ecs.user_id = u.id AND ecs.sent_at > NOW() - ($2 || ' days')::interval) LIMIT $3",
  product_sql:
    'SELECT p.id::text AS product_id, p.name AS name, p.slug AS slug, (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url, p.base_price::float AS price FROM products p WHERE p.is_active = TRUE ORDER BY p.is_featured DESC LIMIT 6',
  explanation: 'Targets new signups in the last 24h.',
}

const VALID_VALIDATION = { ok: true, normalized: VALID_AI_RESPONSE.sql }
const VALID_PRODUCT_VALIDATION = { ok: true, normalized: VALID_AI_RESPONSE.product_sql }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/campaigns/scenarios/generate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify(VALID_AI_RESPONSE),
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 420,
      fallbackUsed: false,
    } as any)
    vi.mocked(validateScenarioSql)
      .mockReturnValueOnce(VALID_VALIDATION as any) // audience SQL
      .mockReturnValueOnce(VALID_PRODUCT_VALIDATION as any) // product SQL
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  })

  // --- Auth ---

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(postReq({ prompt: 'New customers' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when mailer scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(postReq({ prompt: 'New customers' }))
    expect(res.status).toBe(403)
  })

  // --- Input validation ---

  it('returns 400 when prompt is missing', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/prompt is required/)
  })

  it('returns 400 when prompt is empty string', async () => {
    const res = await POST(postReq({ prompt: '  ' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/prompt is required/)
  })

  it('returns 400 when prompt exceeds 2000 chars', async () => {
    const res = await POST(postReq({ prompt: 'x'.repeat(2001) }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/too long/)
  })

  // --- Happy path ---

  it('returns generated SQL scenario on success', async () => {
    const res = await POST(postReq({ prompt: 'Welcome new customers' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.name).toBe('New Customer Welcome')
    expect(json.kind).toBe('new_customer_welcome')
    expect(json.sql).toBe(VALID_AI_RESPONSE.sql)
    expect(json.provider).toBe('anthropic')
    expect(json.model).toBe('claude-3-5-haiku')
  })

  it('includes validation results in response', async () => {
    const res = await POST(postReq({ prompt: 'Welcome new customers' }))
    const json = await res.json()

    expect(json.validation).toEqual(VALID_VALIDATION)
    expect(json.productValidation).toEqual(VALID_PRODUCT_VALIDATION)
  })

  it('writes audit log on success', async () => {
    await POST(postReq({ prompt: 'Welcome new customers' }))

    const auditCall = vi
      .mocked(query)
      .mock.calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].includes('scenario_audit_log') && args[0].includes('ai_generate')
      )
    expect(auditCall).toBeDefined()
    expect(auditCall![1]![0]).toBe('admin-1')
  })

  // --- kind sanitization ---

  it('sanitizes kind to lowercase_snake_case and max 32 chars', async () => {
    const rawKind = 'My-Custom SCENARIO!! With Spaces & Symbols'
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify({ ...VALID_AI_RESPONSE, kind: rawKind }),
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 100,
      fallbackUsed: false,
    } as any)

    const res = await POST(postReq({ prompt: 'test' }))
    const json = await res.json()

    expect(json.kind).toMatch(/^[a-z0-9_]{1,32}$/)
    expect(json.kind).not.toMatch(/[^a-z0-9_]/)
    expect(json.kind.length).toBeLessThanOrEqual(32)
  })

  // --- AI failure ---

  it('returns 502 when aiChat throws AiClientError', async () => {
    vi.mocked(aiChat).mockRejectedValue(new AiClientError('Rate limit exceeded', 'anthropic'))

    const res = await POST(postReq({ prompt: 'test' }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('Rate limit exceeded')
  })

  it('returns 502 when aiChat throws generic error', async () => {
    vi.mocked(aiChat).mockRejectedValue(new Error('Network timeout'))

    const res = await POST(postReq({ prompt: 'test' }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('AI request failed')
  })

  it('writes ai_generate_failed audit log on aiChat failure', async () => {
    vi.mocked(aiChat).mockRejectedValue(new AiClientError('Quota exceeded', 'anthropic'))

    await POST(postReq({ prompt: 'test scenario' }))

    const auditCall = vi
      .mocked(query)
      .mock.calls.find((args: any[]) => typeof args[0] === 'string' && args[0].includes('ai_generate_failed'))
    expect(auditCall).toBeDefined()
  })

  // --- Unparseable JSON from AI ---

  it('returns 502 when AI returns invalid JSON', async () => {
    vi.mocked(aiChat).mockResolvedValue({
      content: 'This is not JSON at all',
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 100,
      fallbackUsed: false,
    } as any)

    const res = await POST(postReq({ prompt: 'test' }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/unparseable JSON/)
  })

  it('writes ai_generate_unparseable audit log on bad JSON', async () => {
    vi.mocked(aiChat).mockResolvedValue({
      content: 'not json',
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 100,
      fallbackUsed: false,
    } as any)

    await POST(postReq({ prompt: 'test' }))

    const auditCall = vi
      .mocked(query)
      .mock.calls.find((args: any[]) => typeof args[0] === 'string' && args[0].includes('ai_generate_unparseable'))
    expect(auditCall).toBeDefined()
  })

  // --- Missing sql field ---

  it('returns 502 when AI response has no sql field', async () => {
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify({ name: 'Test', kind: 'test', description: 'desc' }),
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 100,
      fallbackUsed: false,
    } as any)

    const res = await POST(postReq({ prompt: 'test' }))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/missing sql/)
  })

  // --- No product_sql ---

  it('returns null product_sql when AI omits it', async () => {
    const noProductSql = { ...VALID_AI_RESPONSE, product_sql: '' }
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify(noProductSql),
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      latencyMs: 100,
      fallbackUsed: false,
    } as any)
    vi.mocked(validateScenarioSql).mockReturnValueOnce(VALID_VALIDATION as any)
    // no second call expected since product_sql is empty

    const res = await POST(postReq({ prompt: 'test' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.product_sql).toBeNull()
    expect(json.productValidation).toBeNull()
  })

  // --- fallbackUsed flag propagated ---

  it('propagates fallbackUsed from AI response', async () => {
    vi.mocked(aiChat).mockResolvedValue({
      content: JSON.stringify(VALID_AI_RESPONSE),
      provider: 'openai',
      model: 'gpt-4o',
      latencyMs: 800,
      fallbackUsed: true,
    } as any)

    const res = await POST(postReq({ prompt: 'test' }))
    const json = await res.json()

    expect(json.fallbackUsed).toBe(true)
    expect(json.provider).toBe('openai')
  })

  // --- Body parse edge cases ---

  it('handles non-JSON body gracefully (uses empty object)', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/admin/campaigns/scenarios/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
    )

    const res = await POST(req)
    // prompt will be empty → 400
    expect(res.status).toBe(400)
  })
})
