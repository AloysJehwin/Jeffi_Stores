import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { optional: () => ({}) },
  zPhone: { optional: () => ({}) },
  zIndianPin: { optional: () => ({}) },
}))

import { GET, POST } from '@/app/api/user/addresses/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as validate from '@/lib/shared/validate'

const AUTH_USER = { userId: 'user-1' }
const ADDRESS_ROW = { id: 'addr-1', city: 'Mumbai', state: 'MH' }

const VALID_ADDRESS_BODY = {
  address_type: 'shipping',
  full_name: 'Test User',
  phone: '9876543210',
  address_line1: '123 Main St',
  city: 'Mumbai',
  state: 'Maharashtra',
  postal_code: '400001',
  country: 'India',
  is_default: false,
}

function makeGet() {
  return new Request('http://localhost/api/user/addresses')
}
function makePost(body: object) {
  return new Request('http://localhost/api/user/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/user/addresses', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(401)
  })

  it('returns addresses array', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue([ADDRESS_ROW] as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.addresses).toHaveLength(1)
    expect(body.addresses[0].id).toBe('addr-1')
  })

  it('returns empty array when queryMany returns null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue(null as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.addresses).toEqual([])
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockRejectedValue(new Error('db fail'))

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(500)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/user/addresses', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makePost(VALID_ADDRESS_BODY) as any)
    expect(res.status).toBe(401)
  })

  it('returns parse error response when validation fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 }),
    } as any)

    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(422)
  })

  it('returns 400 when phone is missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_ADDRESS_BODY, phone: null },
    } as any)

    const res = await POST(makePost({ ...VALID_ADDRESS_BODY, phone: '' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/phone/i)
  })

  it('returns 400 for invalid phone length', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_ADDRESS_BODY, phone: '12345' },
    } as any)

    const res = await POST(makePost({ ...VALID_ADDRESS_BODY, phone: '12345' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/10-digit/i)
  })

  it('creates address and returns it', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_ADDRESS_BODY,
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue({ ...ADDRESS_ROW, id: 'addr-new' } as any)

    const res = await POST(makePost(VALID_ADDRESS_BODY) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address.id).toBe('addr-new')
  })

  it('unsets other defaults when is_default is true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_ADDRESS_BODY, is_default: true },
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue(ADDRESS_ROW as any)

    await POST(makePost({ ...VALID_ADDRESS_BODY, is_default: true }) as any)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_default = false'),
      expect.arrayContaining(['user-1'])
    )
  })

  it('normalises +91 prefixed phone', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_ADDRESS_BODY, phone: '919876543210' },
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue(ADDRESS_ROW as any)

    const res = await POST(makePost({ ...VALID_ADDRESS_BODY, phone: '919876543210' }) as any)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['+919876543210']))
  })

  it('returns 500 when queryOne returns null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_ADDRESS_BODY,
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await POST(makePost(VALID_ADDRESS_BODY) as any)
    expect(res.status).toBe(500)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_ADDRESS_BODY,
    } as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('db error'))

    const res = await POST(makePost(VALID_ADDRESS_BODY) as any)
    expect(res.status).toBe(500)
  })
})
