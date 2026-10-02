import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendCertInviteEmail: vi.fn() }))

import { POST } from '@/app/api/(admin)/admin/users/[id]/resend-certificate/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { sendCertInviteEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const mockSendInvite = vi.mocked(sendCertInviteEmail)

const superAdmin = { adminId: 'a1', username: 'root', role: 'super_admin', scopes: [] }
const regularAdmin = { adminId: 'a2', username: 'user', role: 'admin', scopes: [] }
const params = Promise.resolve({ id: 'admin-abc' })

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  // #487 portal-only: resend sends the invite link; it needs NO stored .p12 (no 422 path),
  // and never re-attaches a cert.
  it('sends the portal invite (no stored p12 required) and returns success', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue({ ...sampleRow, p12_data: null })
    mockSendInvite.mockResolvedValue({ success: true } as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockSendInvite).toHaveBeenCalledOnce()
    // The invite takes no p12/password — only identity + role.
    expect(mockSendInvite).toHaveBeenCalledWith('admin@example.com', 'targetadmin', 'admin')
  })

  it('returns 502 when the invite email reports failure', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(sampleRow)
    mockSendInvite.mockResolvedValue({ success: false } as any)

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
