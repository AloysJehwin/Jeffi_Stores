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
vi.mock('@/lib/email', () => ({
  sendAdminContactEmail: vi.fn(),
}))

import { POST } from '@/app/api/customers/[id]/contact/route'
import * as jwt from '@/lib/jwt'
import * as scopes from '@/lib/scopes'
import * as queries from '@/lib/queries'
import * as email from '@/lib/email'

const ADMIN = { adminId: 'admin-1', role: 'admin', scopes: [] }
const PARAMS = { params: Promise.resolve({ id: 'user-42' }) }
const CUSTOMER = { id: 'user-42', email: 'c@example.com', first_name: 'Jo', last_name: 'Doe' }

function makePost(body: object) {
  return new Request('http://localhost/api/customers/user-42/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/customers/[id]/contact', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await POST(makePost({ subject: 'Hi', message: 'Hello' }) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 401 when missing customers scope', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(false)

    const res = await POST(makePost({ subject: 'Hi', message: 'Hello' }) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 400 when subject is missing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)

    const res = await POST(makePost({ message: 'Hello' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/subject and message/i)
  })

  it('returns 400 when message is missing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)

    const res = await POST(makePost({ subject: 'Hi' }) as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('sends email and returns success', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomerById).mockResolvedValue(CUSTOMER as any)
    vi.mocked(email.sendAdminContactEmail).mockResolvedValue(undefined as any)

    const res = await POST(makePost({ subject: 'Order update', message: 'Your order is ready.' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(email.sendAdminContactEmail).toHaveBeenCalledWith(
      'c@example.com',
      'Jo Doe',
      'Order update',
      'Your order is ready.'
    )
  })

  it('uses "Customer" as name when first/last are blank', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomerById).mockResolvedValue({ ...CUSTOMER, first_name: '', last_name: '' } as any)
    vi.mocked(email.sendAdminContactEmail).mockResolvedValue(undefined as any)

    const res = await POST(makePost({ subject: 'Hi', message: 'Hello' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(email.sendAdminContactEmail).toHaveBeenCalledWith(
      'c@example.com',
      'Customer',
      'Hi',
      'Hello'
    )
  })

  it('returns 500 when email send throws', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(scopes.hasScope).mockReturnValue(true)
    vi.mocked(queries.getCustomerById).mockResolvedValue(CUSTOMER as any)
    vi.mocked(email.sendAdminContactEmail).mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makePost({ subject: 'Hi', message: 'Hello' }) as any, PARAMS)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('SMTP error')
  })
})
