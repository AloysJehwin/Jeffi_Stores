import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const s3Send = vi.hoisted(() => vi.fn())
const sharpPipeline = vi.hoisted(() => {
  const p: Record<string, any> = {}
  p.rotate = vi.fn(() => p)
  p.resize = vi.fn(() => p)
  p.jpeg = vi.fn(() => p)
  p.toBuffer = vi.fn()
  return p
})

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))
vi.mock('sharp', () => ({ default: vi.fn(() => sharpPipeline) }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Send
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { POST } from '@storefront/app/api/(public)/orders/[id]/return-images/route'

const post = (file?: File | null) => {
  const form = new FormData()
  if (file) form.append('file', file)
  return POST(new NextRequest('http://localhost/api/orders/o1/return-images', { method: 'POST', body: form }), {
    params: Promise.resolve({ id: 'o1' }),
  })
}
const img = (type = 'image/png', name = 'my photo.png', size = 10) =>
  new File([new Uint8Array(size)], name, { type })

describe('POST /api/orders/[id]/return-images', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    queryOne.mockResolvedValue({ id: 'o1' })
    sharpPipeline.toBuffer.mockResolvedValue(Buffer.from('resized'))
    s3Send.mockResolvedValue({})
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post(img())).status).toBe(401)
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('404s when the order is not the caller delivered order', async () => {
    queryOne.mockResolvedValue(null)
    expect((await post(img())).status).toBe(404)
    expect(queryOne.mock.calls[0][1]).toEqual(['o1', 'u1'])
  })

  it('400s without a file, with a bad type, or over 5MB', async () => {
    expect((await post(null)).status).toBe(400)
    const bad = await post(img('application/pdf', 'x.pdf'))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/JPEG, PNG, WebP/)
    const big = await post(img('image/jpeg', 'big.jpg', 5 * 1024 * 1024 + 1))
    expect(big.status).toBe(400)
    expect((await big.json()).error).toMatch(/5MB/)
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('resizes the image, uploads it to S3 under returns/<order>/ and returns the URL', async () => {
    const res = await post(img())
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toContain('returns/o1/')
    expect(url).toMatch(/my_photo\.png$/)
    expect(sharpPipeline.resize).toHaveBeenCalledWith(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    const cmd = s3Send.mock.calls[0][0] as { input: { Key: string; ContentType: string; Body: Buffer } }
    expect(cmd.input.Key).toContain('returns/o1/')
    expect(cmd.input.ContentType).toBe('image/jpeg')
    expect(cmd.input.Body.toString()).toBe('resized')
  })

  it('500s when the upload fails', async () => {
    s3Send.mockRejectedValue(new Error('s3'))
    const res = await post(img())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Upload failed')
  })
})
