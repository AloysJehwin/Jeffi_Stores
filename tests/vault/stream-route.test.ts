import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockQuery = vi.fn(async (..._a: any[]) => ({ rows: [] }))
const mockQueryOne = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => (mockQuery as any)(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: vi.fn(),
}))

let session: any = { userId: 'u1', tenantId: 't1', principalType: 'customer' }
vi.mock('@/lib/vault/request-guard', () => ({ requireVaultSession: async () => session }))

let master = true
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: async () => ({ vaultDownloadsEnabled: master }),
}))

const signDownload = vi.fn(async (_k: string, o: any) => `/signed?d=${o.disposition}`)
vi.mock('@/lib/vault/storage', () => ({ getStorageDriver: () => ({ signDownload }) }))

import { GET } from '@/app/api/(public)/vault/stream/route'
import { safeContentType } from '@/lib/vault/entitled-files'

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const file = (over: any = {}) => ({
  id: FILE_ID, product_id: 'p1', kind: 'pdf', status: 'ready', downloadable: true,
  storage_key: 'vault/t1/p1/f.pdf', display_name: 'Book', original_name: 'book.pdf',
  mime_type: 'application/pdf', size_bytes: 10, page_count: 2, duration_seconds: null, display_order: 0,
  ...over,
})

function req(qs: string) {
  return new NextRequest(`http://vault.localhost/api/vault/stream?${qs}`)
}

// ownedFileById: file lookup, then entitlement lookup.
function owned(f: any, entitled = true) {
  mockQueryOne.mockResolvedValueOnce(f).mockResolvedValueOnce(entitled ? { ok: true } : null)
}

beforeEach(() => {
  session = { userId: 'u1', tenantId: 't1', principalType: 'customer' }
  master = true
})

describe('GET /api/vault/stream', () => {
  it('401 without a (tenant-matched) vault session', async () => {
    session = null
    expect((await GET(req(`file=${FILE_ID}`))).status).toBe(401)
  })

  it('400 on a non-uuid file id', async () => {
    expect((await GET(req('file=../etc'))).status).toBe(400)
  })

  it('404 when the user holds no active entitlement', async () => {
    owned(file(), false)
    expect((await GET(req(`file=${FILE_ID}`))).status).toBe(404)
    expect(signDownload).not.toHaveBeenCalled()
  })

  it('mints an inline URL, pins content type, and logs a stream', async () => {
    owned(file())
    const res = await GET(req(`file=${FILE_ID}`))
    expect(res.status).toBe(200)
    expect((await res.json()).disposition).toBe('inline')
    expect(signDownload).toHaveBeenCalledWith('vault/t1/p1/f.pdf', expect.objectContaining({
      disposition: 'inline', contentType: 'application/pdf',
    }))
    expect(mockQuery.mock.calls[0][1]).toContain('stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('download only when master && file.downloadable', async () => {
    owned(file())
    const ok = await GET(req(`file=${FILE_ID}&download=1`))
    expect((await ok.json()).disposition).toBe('attachment')
    expect(mockQuery.mock.calls[0][1]).toContain('download')
  })

  it('403 (not an inline fallback) when the master switch is off', async () => {
    master = false
    owned(file())
    expect((await GET(req(`file=${FILE_ID}&download=1`))).status).toBe(403)
    expect(signDownload).not.toHaveBeenCalled()
  })

  it('403 when the file is not downloadable', async () => {
    owned(file({ downloadable: false }))
    expect((await GET(req(`file=${FILE_ID}&download=1`))).status).toBe(403)
  })
})

describe('safeContentType', () => {
  it('never lets html/svg render inline', () => {
    expect(safeContentType('image', 'image/svg+xml')).toBe('application/octet-stream')
    expect(safeContentType('other', 'text/html')).toBe('application/octet-stream')
    expect(safeContentType('video', 'text/html')).toBe('application/octet-stream')
    expect(safeContentType('image', 'image/png')).toBe('image/png')
    expect(safeContentType('video', 'video/mp4')).toBe('video/mp4')
    expect(safeContentType('pdf', 'text/html')).toBe('application/pdf')
  })
})
