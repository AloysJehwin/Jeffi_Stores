import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockSignedIn, mockRevoke } = vi.hoisted(() => ({ mockSignedIn: vi.fn(), mockRevoke: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ signedInAdmin: mockSignedIn }))
vi.mock('@/lib/auth/api-tokens', () => ({ revokeApiToken: mockRevoke }))

import { DELETE } from '@admin/app/api/(admin)/admin/cli/tokens/[id]/route'

const ID = '11111111-2222-3333-4444-555555555555'
const del = (id = ID) => DELETE(new NextRequest(`http://x/api/admin/cli/tokens/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockSignedIn.mockResolvedValue({ kind: 'session', adminId: 'a1', role: 'admin', scopes: [], tenantId: 't-acme' })
  mockRevoke.mockResolvedValue(true)
})

describe('DELETE /api/admin/cli/tokens/[id]', () => {
  it('revokes only your own token', async () => {
    expect((await del()).status).toBe(200)
    expect(mockRevoke).toHaveBeenCalledWith({ id: ID, tenantId: 't-acme', adminId: 'a1' })
  })

  it("lets the owner revoke anyone's", async () => {
    mockSignedIn.mockResolvedValue({ kind: 'session', adminId: 'a1', role: 'super_admin', scopes: [], tenantId: 't-acme' })
    await del()
    expect(mockRevoke).toHaveBeenCalledWith({ id: ID, tenantId: 't-acme', adminId: undefined })
  })

  it('404 for a token that is not yours, or not an id', async () => {
    mockRevoke.mockResolvedValue(false)
    expect((await del()).status).toBe(404)
    expect((await del('../x')).status).toBe(404)
  })

  it('needs a session', async () => {
    mockSignedIn.mockResolvedValue(null)
    expect((await del()).status).toBe(401)
  })
})
