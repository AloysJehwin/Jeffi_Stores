import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
}))
vi.mock('@/lib/shared/s3', () => ({
  uploadAvatarImage: vi.fn(),
}))

import { POST } from '@/app/api/(public)/user/avatar/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as s3 from '@/lib/shared/s3'

const AUTH_USER = { userId: 'user-1' }

function makeFormDataRequest(file: File | null) {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return new Request('http://localhost/api/user/avatar', {
    method: 'POST',
    body: formData,
  })
}

function makeJpegFile(size = 100, type = 'image/jpeg') {
  const content = new Uint8Array(size).fill(0xff)
  return new File([content], 'avatar.jpg', { type })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/user/avatar', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makeFormDataRequest(makeJpegFile()) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when no file provided', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makeFormDataRequest(null) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no file/i)
  })

  it('returns 400 for disallowed mime type', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    const gif = new File([new Uint8Array(10)], 'img.gif', { type: 'image/gif' })

    const res = await POST(makeFormDataRequest(gif) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/jpeg.*png.*webp/i)
  })

  it('returns 400 when file exceeds 2 MB', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    const bigFile = makeJpegFile(3 * 1024 * 1024)

    const res = await POST(makeFormDataRequest(bigFile) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/2 mb/i)
  })

  it('uploads and returns avatarUrl on success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(s3.uploadAvatarImage).mockResolvedValue({
      url: 'https://cdn.example.com/avatar.jpg',
      s3Key: 'avatars/user-1.jpg',
    } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makeFormDataRequest(makeJpegFile()) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.avatarUrl).toBe('https://cdn.example.com/avatar.jpg')
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET avatar_url'),
      expect.arrayContaining(['https://cdn.example.com/avatar.jpg', 'avatars/user-1.jpg', 'user-1'])
    )
  })

  it('accepts image/png', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(s3.uploadAvatarImage).mockResolvedValue({ url: 'https://cdn.example.com/avatar.png', s3Key: 'k' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const png = new File([new Uint8Array(100)], 'img.png', { type: 'image/png' })

    const res = await POST(makeFormDataRequest(png) as any)
    expect(res.status).toBe(200)
  })

  it('returns 500 when upload throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(s3.uploadAvatarImage).mockRejectedValue(new Error('S3 error'))

    const res = await POST(makeFormDataRequest(makeJpegFile()) as any)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('S3 error')
  })
})
