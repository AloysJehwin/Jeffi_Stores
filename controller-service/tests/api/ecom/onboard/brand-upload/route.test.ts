import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockUpload } = vi.hoisted(() => ({ mockOwner: vi.fn(), mockUpload: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/shared/s3', () => ({ uploadBrandingImage: mockUpload }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/brand-upload/route'

function req(file: File | null, kind?: string) {
  const fd = new FormData()
  if (file) fd.set('file', file)
  if (kind) fd.set('kind', kind)
  return new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/brand-upload', { method: 'POST', body: fd })
}
const png = (size = 10) => new File([new Uint8Array(size)], 'logo.png', { type: 'image/png' })

describe('POST /api/ecom/onboard/brand-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockUpload.mockResolvedValue({ s3Key: 'branding/o-1/logo.png', url: 'https://cdn.test/logo.png' })
  })

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await POST(req(png(), 'logo'))).status).toBe(401)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s a missing file, a bad kind, an oversize file and a wrong type', async () => {
    expect((await POST(req(null, 'logo'))).status).toBe(400)
    expect((await POST(req(png(), 'banner'))).status).toBe(400)
    expect((await POST(req(png(3 * 1024 * 1024 + 1), 'logo'))).status).toBe(400)
    const gif = new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' })
    expect((await POST(req(gif, 'seal'))).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('stores the image under the owner and returns its key and url', async () => {
    const res = await POST(req(png(), 'seal'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, s3Key: 'branding/o-1/logo.png', url: 'https://cdn.test/logo.png' })
    const [buf, ownerId, kind] = mockUpload.mock.calls[0]
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect([ownerId, kind]).toEqual(['o-1', 'seal'])
  })

  it('surfaces a storage failure', async () => {
    mockUpload.mockRejectedValue(new Error('s3 down'))
    await expect(POST(req(png(), 'logo'))).rejects.toThrow('s3 down')
  })
})
