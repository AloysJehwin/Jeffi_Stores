import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))

import { GET as getDownload } from '@/app/api/admin/service-accounts/[id]/download/route'
import { GET as getSA, DELETE as deleteSA } from '@/app/api/admin/service-accounts/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['service_accounts'] }
const params = Promise.resolve({ id: 'sa-1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

describe('GET /api/admin/service-accounts/[id]/download', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when service account not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(404)
  })

  it('returns 410 when already downloaded', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'test', p12_data: Buffer.from('x'), p12_downloaded: true } as any)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(410)
  })

  it('returns 410 when p12_data is null', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'test', p12_data: null, p12_downloaded: false } as any)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(410)
  })

  it('returns p12 binary on first download', async () => {
    const p12 = Buffer.from('fake-p12-data')
    vi.mocked(queryOne).mockResolvedValue({ name: 'myaccount', p12_data: p12, p12_downloaded: false } as any)
    const res = await getDownload(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-pkcs12')
    expect(res.headers.get('Content-Disposition')).toContain('myaccount.p12')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('p12_downloaded = true'), ['sa-1'])
  })
})

describe('GET /api/admin/service-accounts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await getSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(404)
  })

  it('returns service account on happy path', async () => {
    const sa = { id: 'sa-1', name: 'test', is_revoked: false }
    vi.mocked(queryOne).mockResolvedValue(sa as any)
    const res = await getSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(sa)
  })
})

describe('DELETE /api/admin/service-accounts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await deleteSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await deleteSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await deleteSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(404)
  })

  it('returns 409 when already revoked', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'sa-1', is_revoked: true } as any)
    const res = await deleteSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(409)
  })

  it('revokes service account', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'sa-1', is_revoked: false } as any)
    const res = await deleteSA(new NextRequest('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
