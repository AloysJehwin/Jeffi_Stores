import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ uploadGalleryMedia: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({ actorOf: vi.fn(() => 'actor'), lockedByOther: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/product-offers/[id]/image/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { uploadGalleryMedia } from '@/lib/shared/s3'
import { lockedByOther } from '@/lib/admin/draft-locks'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
function call(file?: { type: string; size?: number }, field?: string) {
  const fd = new FormData()
  if (file) {
    const f = new File([new Uint8Array(file.size ?? 4)], 'pic.png', { type: file.type })
    fd.set('file', f)
  }
  if (field) fd.set('field', field)
  return POST(new NextRequest('http://localhost/x', { method: 'POST', body: fd }), {
    params: Promise.resolve({ id: 'of1' }),
  })
}

describe('POST /api/admin/product-offers/[id]/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ id: 'of1' })
    vi.mocked(lockedByOther).mockResolvedValue(null as never)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ type: 'image/png' })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ type: 'image/png' })).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'coupons:write')
  })

  it('returns 404 for an unknown offer and relays a lock', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call({ type: 'image/png' })).status).toBe(404)
    vi.mocked(queryOne).mockResolvedValue({ id: 'of1' })
    vi.mocked(lockedByOther).mockResolvedValue(NextResponse.json({ error: 'locked' }, { status: 423 }) as never)
    expect((await call({ type: 'image/png' })).status).toBe(423)
  })

  it('returns 400 for no file, a bad type, or an oversized file', async () => {
    expect((await call()).status).toBe(400)
    expect((await call({ type: 'application/pdf' })).status).toBe(400)
    expect((await call({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).status).toBe(400)
    expect(uploadGalleryMedia).not.toHaveBeenCalled()
  })

  it('uploads and saves the url and blurhash on the default column', async () => {
    vi.mocked(uploadGalleryMedia).mockResolvedValue({ url: 'https://cdn/a.png', blurhash: 'bh' } as never)
    const res = await call({ type: 'image/png' })
    expect(await res.json()).toEqual({ url: 'https://cdn/a.png', field: 'image_url', blurhash: 'bh' })
    expect(vi.mocked(uploadGalleryMedia).mock.calls[0][1]).toBe('pic.png')
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/SET image_url = \$1, blurhash = \$2/)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['https://cdn/a.png', 'bh', 'of1'])
  })

  it('targets the mobile columns for field=image_url_mobile', async () => {
    vi.mocked(uploadGalleryMedia).mockResolvedValue({ url: 'u', blurhash: null } as never)
    await call({ type: 'image/webp' }, 'image_url_mobile')
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/image_url_mobile = \$1, blurhash_mobile = \$2/)
  })

  it('returns 500 when the upload fails', async () => {
    vi.mocked(uploadGalleryMedia).mockRejectedValue(new Error('s3 down'))
    const res = await call({ type: 'image/png' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('s3 down')
    expect(query).not.toHaveBeenCalled()
  })
})
