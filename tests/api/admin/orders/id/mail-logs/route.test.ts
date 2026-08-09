import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET as getLogs } from '@/app/api/admin/orders/[id]/mail-logs/route'
import { GET as getBody } from '@/app/api/admin/orders/[id]/mail-logs/[logId]/body/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['orders'] }
const params = Promise.resolve({ id: 'order-1' })
const bodyParams = Promise.resolve({ id: 'order-1', logId: 'log-1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('GET /api/admin/orders/[id]/mail-logs', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(403)
  })

  it('returns logs on happy path', async () => {
    const logs = [{ id: 'log-1', subject: 'Order confirmed' }]
    vi.mocked(queryMany).mockResolvedValue(logs as any)
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).logs).toEqual(logs)
  })

  it('returns empty array when no logs', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).logs).toEqual([])
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db error'))
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/orders/[id]/mail-logs/[logId]/body', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getBody(new NextRequest('http://localhost'), { params: bodyParams })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getBody(new NextRequest('http://localhost'), { params: bodyParams })
    expect(res.status).toBe(403)
  })

  it('returns 404 when log not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await getBody(new NextRequest('http://localhost'), { params: bodyParams })
    expect(res.status).toBe(404)
  })

  it('returns html on happy path', async () => {
    vi.mocked(queryOne).mockResolvedValue({ body_html: '<p>hello</p>' } as any)
    const res = await getBody(new NextRequest('http://localhost'), { params: bodyParams })
    expect(res.status).toBe(200)
    expect((await res.json()).html).toBe('<p>hello</p>')
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('fail'))
    const res = await getBody(new NextRequest('http://localhost'), { params: bodyParams })
    expect(res.status).toBe(500)
  })
})

  it('returns 500 on queryMany error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db error'))
    const res = await getLogs(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(500)
  })
