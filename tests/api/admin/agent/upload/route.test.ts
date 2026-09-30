import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/agent/upload/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['agent'],
}

function makeRequestWithFile(file: File | null, extraFields: Record<string, string> = {}) {
  const form = new FormData()
  if (file) form.append('file', file)
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v)

  return new NextRequest('http://localhost/api/admin/agent/upload', {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid-token' },
    body: form,
  })
}

function makeJsonRequest() {
  // Simulates a request that is NOT multipart (will fail formData())
  return new NextRequest('http://localhost/api/admin/agent/upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'admin_sid=valid-token',
    },
    body: JSON.stringify({ file: 'not-a-file' }),
  })
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes).fill(65) // fill with 'A'
  return new File([content], name, { type })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/upload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequestWithFile(makeFile('test.jpg', 'image/jpeg', 100)))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when agent scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequestWithFile(makeFile('test.jpg', 'image/jpeg', 100)))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 400 when no file field is provided', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const form = new FormData()
    form.append('other', 'value')
    const req = new NextRequest('http://localhost/api/admin/agent/upload', {
      method: 'POST',
      headers: { cookie: 'admin_sid=valid-token' },
      body: form,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/file field is required/i)
  })

  it('returns 400 for empty file', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    // In happy-dom, a 0-byte File appended to FormData may not be retrieved as
    // a File instance; the route returns 400 either way (empty file or missing field).
    const res = await POST(makeRequestWithFile(makeFile('empty.jpg', 'image/jpeg', 0)))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/empty file|file field is required/i)
  })

  it('returns 413 when file exceeds 5MB', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const bigFile = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024)
    const res = await POST(makeRequestWithFile(bigFile))
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toMatch(/too large/i)
  })

  it('returns 415 for unsupported MIME type', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const txtFile = makeFile('doc.txt', 'text/plain', 100)
    const res = await POST(makeRequestWithFile(txtFile))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toMatch(/unsupported file type/i)
  })

  it('returns 500 when DB insert fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const validFile = makeFile('photo.jpg', 'image/jpeg', 1024)
    const res = await POST(makeRequestWithFile(validFile))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/failed to persist/i)
  })

  it('returns attachment details on successful upload (jpeg)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({
      id: 'attach-1',
      created_at: '2026-06-18T00:00:00Z',
      expires_at: '2026-06-25T00:00:00Z',
    })
    const validFile = makeFile('photo.jpg', 'image/jpeg', 1024)
    const res = await POST(makeRequestWithFile(validFile))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attachment_id).toBe('attach-1')
    expect(body.mime_type).toBe('image/jpeg')
    expect(body.expires_at).toBe('2026-06-25T00:00:00Z')
  })

  it('returns attachment details on successful upload (pdf)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({
      id: 'attach-2',
      created_at: '2026-06-18T00:00:00Z',
      expires_at: '2026-06-25T00:00:00Z',
    })
    const pdfFile = makeFile('doc.pdf', 'application/pdf', 2048)
    const res = await POST(makeRequestWithFile(pdfFile))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mime_type).toBe('application/pdf')
  })

  it('accepts image/png and image/webp', async () => {
    for (const mime of ['image/png', 'image/webp']) {
      mockAuth.mockResolvedValue(adminPayload)
      mockHasScope.mockReturnValue(true)
      mockQueryOne.mockResolvedValue({
        id: 'attach-3',
        created_at: '2026-06-18T00:00:00Z',
        expires_at: '2026-06-25T00:00:00Z',
      })
      const f = makeFile(`img.${mime.split('/')[1]}`, mime, 512)
      const res = await POST(makeRequestWithFile(f))
      expect(res.status).toBe(200)
    }
  })
})
