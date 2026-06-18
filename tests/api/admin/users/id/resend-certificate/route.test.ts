import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendAdminCertificateEmail: vi.fn() }))

import { POST } from '@/app/api/admin/users/[id]/resend-certificate/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { sendAdminCertificateEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendAdminCertificateEmail)

const superAdmin = { adminId: 'a1', username: 'root', role: 'super_admin', scopes: [] }
const regularAdmin = { adminId: 'a2', username: 'user', role: 'admin', scopes: [] }
const params = { id: 'admin-abc' }

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/users/admin-abc/resend-certificate', { method: 'POST' })
}

const sampleRow = {
  username: 'targetadmin',
  email: 'admin@example.com',
  serial_number: 'SN-001',
  expires_at: '2026-01-01T00:00:00Z',
  p12_data: Buffer.from('fake-p12-data'),
  p12_password: 'secret',
  role: 'admin',
}

describe('POST /api/admin/users/[id]/resend-certificate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 403 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when authenticated but not super_admin', async () => {
    mockAuth.mockResolvedValue(regularAdmin)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 404 when admin row not found', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(null)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 422 when no certificate on file', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue({ ...sampleRow, p12_data: null })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/no certificate/i)
  })

  it('sends email and returns success when p12_data is a Buffer', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(sampleRow)
    mockSendEmail.mockResolvedValue({ success: true } as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledOnce()
  })

  it('converts non-Buffer p12_data via Buffer.from', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue({ ...sampleRow, p12_data: 'base64stringdata' })
    mockSendEmail.mockResolvedValue({ success: true } as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
  })

  it('returns 502 when sendAdminCertificateEmail reports failure', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(sampleRow)
    mockSendEmail.mockResolvedValue({ success: false } as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/failed to send/i)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockRejectedValue(new Error('DB crash'))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB crash')
  })
})
