import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/campaigns/template-validation', () => ({
  validateCampaignBodyTemplate: vi.fn(),
}))

vi.mock('@/lib/shared/validate', () => {
  const { z } = require('zod')
  const zNonEmpty = z.string().min(1)
  return {
    zNonEmpty,
    parseBody: vi.fn((schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: Response.json({ error: result.error.issues[0]?.message ?? 'Validation error' }, { status: 400 }),
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, POST } from '@/app/api/admin/campaigns/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, query } from '@/lib/shared/db'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['mailer'] }

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

function jsonReq(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

// ---------------------------------------------------------------------------
// GET /api/admin/campaigns
// ---------------------------------------------------------------------------

describe('GET /api/admin/campaigns', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ kind: 'welcome', name: 'Welcome', total_sent: 100 }] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '1' } as any)
  })

  it('returns campaigns list with total', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/campaigns'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      campaigns: expect.any(Array),
      total: 1,
      limit: expect.any(Number),
      offset: 0,
    })
    expect(json.campaigns).toHaveLength(1)
  })

  it('respects limit and offset params', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await GET(makeReq('http://localhost/api/admin/campaigns?limit=10&offset=20'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.offset).toBe(20)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await GET(makeReq('http://localhost/api/admin/campaigns'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when mailer scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await GET(makeReq('http://localhost/api/admin/campaigns'))
    expect(res.status).toBe(403)
  })

  it('caps limit at 50', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await GET(makeReq('http://localhost/api/admin/campaigns?limit=200'))
    const json = await res.json()

    expect(json.limit).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/campaigns
// ---------------------------------------------------------------------------

describe('POST /api/admin/campaigns', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any) // no existing campaign with same kind
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(validateCampaignBodyTemplate).mockReturnValue({ ok: true } as any)
  })

  it('creates a campaign with valid name and kind', async () => {
    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'Black Friday Sale',
        kind: 'black_friday',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true, kind: 'black_friday' })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO campaigns'), expect.any(Array))
  })

  it('sanitises kind to lowercase alphanumeric underscores', async () => {
    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'My Campaign',
        kind: 'My Campaign Kind!',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.kind).toMatch(/^[a-z0-9_]+$/)
  })

  it('returns 409 when a campaign with same kind already exists', async () => {
    vi.mocked(queryOne).mockResolvedValue({ kind: 'welcome' } as any)

    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'Welcome',
        kind: 'welcome',
      })
    )
    expect(res.status).toBe(409)
  })

  it('returns 400 when template validation fails', async () => {
    vi.mocked(validateCampaignBodyTemplate).mockReturnValue({
      ok: false,
      reason: 'Missing required placeholder',
      hint: 'Add {unsubscribeLink}',
    } as any)

    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'Test',
        kind: 'test',
        body_template: '<p>Hi</p>',
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  it('returns 400 when name is empty', async () => {
    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: '',
        kind: 'some_kind',
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'Test',
        kind: 'test',
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for unknown scenario_kind', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any) // no existing campaign
      .mockResolvedValueOnce(null as any) // scenario lookup returns null

    const res = await POST(
      jsonReq('http://localhost/api/admin/campaigns', {
        name: 'Test',
        kind: 'test_scenario',
        scenario_kind: 'non_existent_scenario',
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('scenario')
  })
})
