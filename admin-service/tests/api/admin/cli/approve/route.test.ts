import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockSignedIn, mockApprove } = vi.hoisted(() => ({ mockSignedIn: vi.fn(), mockApprove: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ signedInAdmin: mockSignedIn }))
vi.mock('@/lib/auth/api-tokens', async importOriginal => ({ ...(await importOriginal<object>()), approveDeviceAuth: mockApprove }))

import { POST } from '@admin/app/api/(admin)/admin/cli/approve/route'

const ADMIN = { kind: 'session', adminId: 'a1', role: 'admin', scopes: ['orders:write', 'products:read'], tenantId: 't-acme' }
const post = (body: unknown) => POST(new NextRequest('http://x/api/admin/cli/approve', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  mockSignedIn.mockResolvedValue(ADMIN)
  mockApprove.mockResolvedValue('approved')
})

describe('POST /api/admin/cli/approve', () => {
  it('needs a signed-in browser session', async () => {
    mockSignedIn.mockResolvedValue(null)
    expect((await post({ user_code: 'BCDF-GHJK', decision: 'approve' })).status).toBe(401)
  })

  it('approves with scopes the admin holds and the chosen lifetime', async () => {
    const res = await post({ user_code: 'BCDF-GHJK', decision: 'approve', scopes: ['orders:write'], ttl: '7d' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'approved', scopes: ['orders:write'] })
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'BCDF-GHJK', tenantId: 't-acme', adminId: 'a1', scopes: ['orders:write'], ttlSeconds: 604800 }))
  })

  it("caps an administrator's token at a day", async () => {
    mockSignedIn.mockResolvedValue({ ...ADMIN, role: 'administrator', tenantId: null })
    await post({ user_code: 'BCDF-GHJK', decision: 'approve', scopes: 'all', ttl: '7d' })
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['*'], ttlSeconds: 86400 }))
  })

  it('refuses scopes beyond the grant, an unknown lifetime, and an unknown code', async () => {
    expect((await post({ user_code: 'BCDF-GHJK', decision: 'approve', scopes: ['settings:write'], ttl: '1h' })).status).toBe(400)
    expect((await post({ user_code: 'BCDF-GHJK', decision: 'approve', scopes: 'read', ttl: '30d' })).status).toBe(400)
    mockApprove.mockResolvedValue('not_found')
    expect((await post({ user_code: 'BCDF-GHJK', decision: 'approve', scopes: 'read', ttl: '1h' })).status).toBe(404)
  })

  it('denies without scopes', async () => {
    mockApprove.mockResolvedValue('denied')
    const res = await post({ user_code: 'BCDF-GHJK', decision: 'deny' })
    expect(await res.json()).toEqual({ status: 'denied' })
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny', scopes: [] }))
  })
})
