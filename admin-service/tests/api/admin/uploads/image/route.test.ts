import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@jeffi/tenancy', () => ({ uploadTemplateAsset: vi.fn() }))
vi.mock('@/lib/shared/form-file', () => ({ readUpload: vi.fn() }))
vi.mock('@/lib/meta-ads/creative', () => ({ fetchImageBytes: vi.fn() }))
vi.mock('@/lib/shared/image-compat', () => ({ toPng: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/uploads/image/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'
import { fetchImageBytes } from '@/lib/meta-ads/creative'
import { toPng } from '@/lib/shared/image-compat'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const file = () => POST(new NextRequest('http://localhost/x', { method: 'POST', body: new FormData() }))
const json = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

describe('POST /api/admin/uploads/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockImplementation(((_r: string, _s: string[], scope: string) => scope === 'brands:write') as never)
    vi.mocked(uploadTemplateAsset).mockResolvedValue({ url: 'https://cdn/a.png', key: 'k1' } as never)
  })

  it('returns 401', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await file()).status).toBe(401)
  })

  it('returns 403 when the admin holds none of the editing scopes', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await file()).status).toBe(403)
    expect(readUpload).not.toHaveBeenCalled()
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('returns 400 when the upload cannot be read', async () => {
    vi.mocked(readUpload).mockResolvedValue({ error: 'No file' } as never)
    const res = await file()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No file')
  })

  it('returns 400 for a disallowed type and 413 for an oversized file', async () => {
    vi.mocked(readUpload).mockResolvedValueOnce({ mime: 'application/pdf', bytes: Buffer.from('x') } as never)
    expect((await file()).status).toBe(400)
    vi.mocked(readUpload).mockResolvedValueOnce({ mime: 'image/png', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) } as never)
    expect((await file()).status).toBe(413)
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('uploads a valid image and returns its CDN url and key', async () => {
    const bytes = Buffer.from('img')
    vi.mocked(readUpload).mockResolvedValue({ mime: 'image/webp', bytes } as never)
    const res = await file()
    expect(await res.json()).toEqual({ url: 'https://cdn/a.png', key: 'k1' })
    expect(uploadTemplateAsset).toHaveBeenCalledWith(bytes, null, 'image/webp')
  })

  it('copies a JSON imageUrl as PNG', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(Buffer.from('webp') as never)
    const png = Buffer.from('png')
    vi.mocked(toPng).mockResolvedValue(png as never)
    const res = await json({ imageUrl: 'https://cdn/g.webp' })
    expect(await res.json()).toEqual({ url: 'https://cdn/a.png', key: 'k1' })
    expect(uploadTemplateAsset).toHaveBeenCalledWith(png, null, 'image/png')
  })

  it('returns 400 for a missing imageUrl, an unreadable image, and 413 for an oversized PNG', async () => {
    expect((await json({})).status).toBe(400)
    vi.mocked(fetchImageBytes).mockRejectedValueOnce(new Error('Not our storage'))
    const bad = await json({ imageUrl: 'https://evil/x' })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('Not our storage')
    vi.mocked(fetchImageBytes).mockResolvedValueOnce(Buffer.from('x') as never)
    vi.mocked(toPng).mockResolvedValueOnce(Buffer.alloc(5 * 1024 * 1024 + 1) as never)
    expect((await json({ imageUrl: 'https://cdn/big' })).status).toBe(413)
    expect(uploadTemplateAsset).not.toHaveBeenCalled()
  })

  it('propagates a storage failure', async () => {
    vi.mocked(readUpload).mockResolvedValue({ mime: 'image/png', bytes: Buffer.from('x') } as never)
    vi.mocked(uploadTemplateAsset).mockRejectedValue(new Error('s3'))
    await expect(file()).rejects.toThrow('s3')
  })
})
