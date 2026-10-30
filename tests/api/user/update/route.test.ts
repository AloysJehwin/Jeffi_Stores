import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
}))
vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { optional: () => ({}) },
  zPhone: { optional: () => ({}) },
  zDob: { optional: () => ({}) },
}))

import { PATCH } from '@controller/app/api/(public)/user/update/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as validate from '@/lib/shared/validate'

const AUTH_USER = { userId: 'user-1' }
const EXISTING_USER = { first_name: 'Jane', last_name: 'Doe', phone: '9876543210' }
const UPDATED_USER = {
  id: 'user-1',
  email: 'j@example.com',
  first_name: 'Jane',
  last_name: 'Smith',
  phone: '9876543210',
  created_at: '2024-01-01T00:00:00Z',
}

function makePatch(body: object) {
  return new Request('http://localhost/api/user/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/user/update', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await PATCH(makePatch({ firstName: 'Jane' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns parse error when validation fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'At least one field' }), { status: 422 }),
    } as any)

    const res = await PATCH(makePatch({}) as any)
    expect(res.status).toBe(422)
  })

  it('returns 404 when user not found in db', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { firstName: 'Jane' },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null as any)

    const res = await PATCH(makePatch({ firstName: 'Jane' }) as any)
    expect(res.status).toBe(404)
  })

  it('returns 400 when resolved first name is empty', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { firstName: '' },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ first_name: '', last_name: 'Doe', phone: '9876543210' } as any)

    const res = await PATCH(makePatch({ firstName: '' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/first name is required/i)
  })

  it('updates user and returns camelCase payload', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { lastName: 'Smith' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(EXISTING_USER as any)
      .mockResolvedValueOnce(UPDATED_USER as any)

    const res = await PATCH(makePatch({ lastName: 'Smith' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.lastName).toBe('Smith')
    expect(body.user.firstName).toBe('Jane')
  })

  it('validates and normalises phone when provided', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { phone: '9123456789' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(EXISTING_USER as any)
      .mockResolvedValueOnce({ ...UPDATED_USER, phone: '9123456789' } as any)

    const res = await PATCH(makePatch({ phone: '9123456789' }) as any)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenLastCalledWith(expect.any(String), expect.arrayContaining(['9123456789']))
  })

  it('strips 91 prefix from 12-digit phone', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { phone: '919876543210' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(EXISTING_USER as any)
      .mockResolvedValueOnce(UPDATED_USER as any)

    const res = await PATCH(makePatch({ phone: '919876543210' }) as any)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenLastCalledWith(expect.any(String), expect.arrayContaining(['9876543210']))
  })

  it('returns 400 for invalid phone length', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { phone: '12345' },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(EXISTING_USER as any)

    const res = await PATCH(makePatch({ phone: '12345' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10-digit/i)
  })

  it('saves a new date of birth and returns it as YYYY-MM-DD', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { dateOfBirth: '1990-05-15' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...EXISTING_USER, date_of_birth: null } as any)
      .mockResolvedValueOnce({ ...UPDATED_USER, date_of_birth: new Date(1990, 4, 15) } as any)

    const res = await PATCH(makePatch({ dateOfBirth: '1990-05-15' }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).user.dateOfBirth).toBe('1990-05-15')
    expect(db.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('date_of_birth'),
      expect.arrayContaining(['1990-05-15'])
    )
  })

  it('keeps the stored date of birth unchanged when another field is edited', async () => {
    const storedDob = new Date(1990, 4, 15)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { lastName: 'Smith' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...EXISTING_USER, date_of_birth: storedDob } as any)
      .mockResolvedValueOnce({ ...UPDATED_USER, date_of_birth: storedDob } as any)

    const res = await PATCH(makePatch({ lastName: 'Smith' }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).user.dateOfBirth).toBe('1990-05-15')
    const params = vi.mocked(db.queryOne).mock.calls.at(-1)?.[1] as unknown[]
    expect(params[4]).toBe('1990-05-15')
  })

  it('returns a null date of birth when none is stored', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { lastName: 'Smith' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(EXISTING_USER as any)
      .mockResolvedValueOnce(UPDATED_USER as any)

    const res = await PATCH(makePatch({ lastName: 'Smith' }) as any)
    expect((await res.json()).user.dateOfBirth).toBeNull()
    const params = vi.mocked(db.queryOne).mock.calls.at(-1)?.[1] as unknown[]
    expect(params[4]).toBeNull()
  })

  it('returns 500 when update queryOne returns null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { firstName: 'Jane' },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(EXISTING_USER as any)
      .mockResolvedValueOnce(null as any)

    const res = await PATCH(makePatch({ firstName: 'Jane' }) as any)
    expect(res.status).toBe(500)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(validate.parseBody).mockReturnValue({
      ok: true,
      data: { firstName: 'Jane' },
    } as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('db error'))

    const res = await PATCH(makePatch({ firstName: 'Jane' }) as any)
    expect(res.status).toBe(500)
  })
})
