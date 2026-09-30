import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
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

import { PATCH, DELETE } from '@/app/api/user/addresses/[id]/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as validate from '@/lib/shared/validate'

const AUTH_USER = { userId: 'user-1' }
const PARAMS = { params: Promise.resolve({ id: 'addr-42' }) }

const VALID_PATCH_BODY = {
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

function makePatch(body: object) {
  return new Request('http://localhost/api/user/addresses/addr-42', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeDelete() {
  return new Request('http://localhost/api/user/addresses/addr-42', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/user/addresses/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await PATCH(makePatch(VALID_PATCH_BODY) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns parse error response when validation fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 }),
    } as any)

    const res = await PATCH(makePatch({}) as any, PARAMS)
    expect(res.status).toBe(422)
  })

  it('returns 400 when phone is missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_PATCH_BODY, phone: null },
    } as any)

    const res = await PATCH(makePatch({ ...VALID_PATCH_BODY, phone: '' }) as any, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/phone/i)
  })

  it('returns 400 for invalid phone', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_PATCH_BODY, phone: '123' },
    } as any)

    const res = await PATCH(makePatch({ ...VALID_PATCH_BODY, phone: '123' }) as any, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10-digit/i)
  })

  it('updates address and returns it', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_PATCH_BODY,
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'addr-42', city: 'Mumbai' } as any)

    const res = await PATCH(makePatch(VALID_PATCH_BODY) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address.id).toBe('addr-42')
  })

  it('unsets other defaults when is_default is true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_PATCH_BODY, is_default: true },
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'addr-42' } as any)

    await PATCH(makePatch({ ...VALID_PATCH_BODY, is_default: true }) as any, PARAMS)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_default = false'),
      expect.arrayContaining(['user-1', 'addr-42'])
    )
  })

  it('normalises +91 prefixed 12-digit phone', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { ...VALID_PATCH_BODY, phone: '919876543210' },
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'addr-42' } as any)

    const res = await PATCH(makePatch({ ...VALID_PATCH_BODY, phone: '919876543210' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['+919876543210']))
  })

  it('returns 404 when address not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_PATCH_BODY,
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await PATCH(makePatch(VALID_PATCH_BODY) as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: VALID_PATCH_BODY,
    } as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('db fail'))

    const res = await PATCH(makePatch(VALID_PATCH_BODY) as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/user/addresses/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await DELETE(makeDelete() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when address not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await DELETE(makeDelete() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to delete default address', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue({ is_default: true } as any)

    const res = await DELETE(makeDelete() as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/default address cannot be deleted/i)
  })

  it('deletes non-default address and returns success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue({ is_default: false } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await DELETE(makeDelete() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/deleted successfully/i)
    // null out FK references first (2 UPDATE calls), then DELETE
    expect(db.query).toHaveBeenCalledTimes(3)
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('shipping_address_id = NULL'), ['addr-42'])
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('billing_address_id = NULL'), ['addr-42'])
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM addresses'),
      expect.arrayContaining(['addr-42', 'user-1'])
    )
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('db fail'))

    const res = await DELETE(makeDelete() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
