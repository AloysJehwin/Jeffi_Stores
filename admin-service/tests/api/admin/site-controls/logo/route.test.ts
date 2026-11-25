import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ uploadStoreLogo: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ invalidateSiteControlsCache: vi.fn() }))
vi.mock('@/lib/meta-ads/creative', () => ({ fetchImageBytes: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-controls/logo/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { uploadStoreLogo } from '@/lib/shared/s3'
import { invalidateSiteControlsCache } from '@/lib/catalog/site-controls'
import { fetchImageBytes } from '@/lib/meta-ads/creative'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const json = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const form = (file?: { type: string; size?: number }) => {
  const fd = new FormData()
  if (file) fd.set('file', new File([new Uint8Array(file.size ?? 4)], 'l.png', { type: file.type }))
  return POST(new NextRequest('http://localhost/x', { method: 'POST', body: fd }))
}

describe('POST /api/admin/site-controls/logo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(uploadStoreLogo).mockResolvedValue({ url: 'https://cdn/logo.png' } as never)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await form({ type: 'image/png' })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await form({ type: 'image/png' })).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'settings:write')
    expect(uploadStoreLogo).not.toHaveBeenCalled()
  })

  it('returns 400 for no file, a bad type, or an oversized file', async () => {
    expect((await form()).status).toBe(400)
    expect((await form({ type: 'application/pdf' })).status).toBe(400)
    expect((await form({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).status).toBe(400)
    expect(uploadStoreLogo).not.toHaveBeenCalled()
  })

  it('uploads the file, saves the URL setting and clears the cache', async () => {
    const res = await form({ type: 'image/svg+xml' })
    expect(await res.json()).toEqual({ url: 'https://cdn/logo.png' })
    expect(vi.mocked(uploadStoreLogo).mock.calls[0][0]).toBeInstanceOf(Buffer)
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toMatch(/business_logo_url/)
    expect(params).toEqual(['https://cdn/logo.png'])
    expect(invalidateSiteControlsCache).toHaveBeenCalled()
  })

  it('takes a JSON imageUrl from our own storage', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(Buffer.from('img') as never)
    const res = await json({ imageUrl: 'https://cdn/g.png' })
    expect(res.status).toBe(200)
    expect(fetchImageBytes).toHaveBeenCalledWith('https://cdn/g.png')
  })

  it('returns 400 for a missing, foreign or oversized imageUrl', async () => {
    expect((await json({})).status).toBe(400)
    vi.mocked(fetchImageBytes).mockRejectedValueOnce(new Error('Not our storage'))
    const res = await json({ imageUrl: 'https://evil/x.png' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Not our storage')
    vi.mocked(fetchImageBytes).mockResolvedValueOnce(Buffer.alloc(5 * 1024 * 1024 + 1) as never)
    expect((await json({ imageUrl: 'https://cdn/big.png' })).status).toBe(400)
    expect(uploadStoreLogo).not.toHaveBeenCalled()
  })

  it('returns 500 when the upload fails', async () => {
    vi.mocked(uploadStoreLogo).mockRejectedValue(new Error('s3'))
    expect((await form({ type: 'image/png' })).status).toBe(500)
    expect(query).not.toHaveBeenCalled()
  })
})
