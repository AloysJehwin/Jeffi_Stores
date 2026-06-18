import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateBusiness: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}))
vi.mock('@/app/legal/policies', () => ({
  POLICY_VERSION: '2026-06-14',
}))

import { POST } from '@/app/api/user/accept-policies/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

const AUTH_USER = { userId: 'user-1' }

function makePost(body: object = {}, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/user/accept-policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/user/accept-policies', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateBusiness).mockResolvedValue(null)

    const res = await POST(makePost() as any)
    expect(res.status).toBe(401)
  })

  it('accepts current policy version via visitor auth', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ version: '2026-06-14' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.version).toBe('2026-06-14')
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET policies_accepted_version'),
      expect.arrayContaining(['2026-06-14', 'user-1'])
    )
  })

  it('accepts via business auth when x-auth-portal is business', async () => {
    vi.mocked(jwt.authenticateBusiness).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ version: '2026-06-14' }, { 'x-auth-portal': 'business' }) as any)
    expect(res.status).toBe(200)
  })

  it('falls back to POLICY_VERSION when no version in body', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe('2026-06-14')
  })

  it('returns 400 when stale version is submitted', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makePost({ version: '2025-01-01' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/stale policy version/i)
  })

  it('falls back to business auth when visitor auth returns null and portal is not set', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateBusiness).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ version: '2026-06-14' }) as any)
    expect(res.status).toBe(200)
  })
})
