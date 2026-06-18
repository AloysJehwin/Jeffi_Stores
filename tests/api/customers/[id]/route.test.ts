import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  getCustomerById: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))

import { GET, PATCH } from '@/app/api/customers/[id]/route'
import * as jwt from '@/lib/jwt'
import * as scopes from '@/lib/scopes'
import * as queries from '@/lib/queries'
import * as db from '@/lib/db'

const ADMIN = { adminId: 'admin-1', role: 'admin', scopes: [] }
const PARAMS = { params: Promise.resolve({ id: 'user-42' }) }
const CUSTOMER = { id: 'user-42', email: 'c@example.com', first_name: 'Jo', last_name: 'Doe' }

function makeGet() {
  return new Request('http://localhost/api/customers/user-42')
}
function makePatch(body: object) {
  return new Request('http://localhost/api/customers/user-42', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/customers/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await GET(makeGet() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 401 when missing customers scope', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await GET(makeGet() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns customer when authorised', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomerById).mockResolvedValue(CUSTOMER as any)

    const res = await GET(makeGet() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('user-42')
  })

  it('returns 404 when getCustomerById throws', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomerById).mockRejectedValue(new Error('not found'))

    const res = await GET(makeGet() as any, PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not found')
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/customers/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await PATCH(makePatch({ action: 'flag' }) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('flags a customer', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await PATCH(makePatch({ action: 'flag', reason: 'spam' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_flagged = true'),
      expect.arrayContaining(['spam', 'user-42'])
    )
  })

  it('flags without reason uses default message', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await PATCH(makePatch({ action: 'flag' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_flagged = true'),
      expect.arrayContaining(['Flagged by admin', 'user-42'])
    )
  })

  it('deactivates a customer', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await PATCH(makePatch({ action: 'deactivate' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_active = false'),
      expect.arrayContaining(['user-42'])
    )
  })

  it('activates a customer', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await PATCH(makePatch({ action: 'activate' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_active = true'),
      expect.arrayContaining(['user-42'])
    )
  })

  it('returns 400 for unknown action', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)

    const res = await PATCH(makePatch({ action: 'unknown' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid action/i)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(db.query).mockRejectedValue(new Error('db fail'))

    const res = await PATCH(makePatch({ action: 'flag' }) as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
