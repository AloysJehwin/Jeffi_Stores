import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockStudioOwner, mockOwned, mockUpload } = vi.hoisted(() => ({ mockStudioOwner: vi.fn(), mockOwned: vi.fn(), mockUpload: vi.fn() }))

vi.mock('@controller/lib/site-studio/http', () => ({
  studioOwner: mockStudioOwner,
  fail: (error: string, status = 400) => NextResponse.json({ error }, { status }),
}))
vi.mock('@controller/lib/showcase-builder/site', () => ({ ownedShowcase: mockOwned }))
vi.mock('@controller/lib/showcase-builder/uploads', () => ({
  SHOWCASE_IMAGE_MAX_BYTES: 4 * 1024 * 1024,
  SHOWCASE_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  uploadShowcaseImage: mockUpload,
}))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/showcase/upload/route'

function req(opts: { file?: File | null; kind?: string; siteId?: string } = {}) {
  const fd = new FormData()
  const file = opts.file === undefined ? new File([new Uint8Array(8)], 'a.png', { type: 'image/png' }) : opts.file
  if (file) fd.set('file', file)
  fd.set('kind', opts.kind ?? 'logo')
  if (opts.siteId) fd.set('siteId', opts.siteId)
  return new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/showcase/upload', { method: 'POST', body: fd })
}

describe('POST /api/ecom/onboard/showcase/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStudioOwner.mockResolvedValue({ id: 'o-1' })
    mockOwned.mockResolvedValue({ id: 's-1' })
    mockUpload.mockResolvedValue({ url: 'https://cdn.test/w.webp' })
  })

  it('returns the 401 for a signed-out caller', async () => {
    mockStudioOwner.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req())).status).toBe(401)
  })

  it('404s a site that is not the owner’s', async () => {
    mockOwned.mockResolvedValue(null)
    expect((await POST(req({ siteId: 'other' }))).status).toBe(404)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s a missing file, unknown kind, oversize file and wrong type', async () => {
    expect((await POST(req({ file: null }))).status).toBe(400)
    expect((await POST(req({ kind: 'banner' }))).status).toBe(400)
    expect((await POST(req({ file: new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }) }))).status).toBe(400)
    expect((await POST(req({ file: new File(['x'], 'a.gif', { type: 'image/gif' }) }))).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('stores the picture for the owner and returns its url', async () => {
    const res = await POST(req({ kind: 'work', siteId: 's-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, url: 'https://cdn.test/w.webp' })
    expect(mockOwned).toHaveBeenCalledWith('o-1', 's-1')
    const [buf, ownerId, kind] = mockUpload.mock.calls[0]
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect([ownerId, kind]).toEqual(['o-1', 'work'])
  })

  it('422s when storing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpload.mockRejectedValue(new Error('sharp failed'))
    expect((await POST(req())).status).toBe(422)
  })
})
