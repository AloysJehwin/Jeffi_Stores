import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPoll } = vi.hoisted(() => ({ mockPoll: vi.fn() }))
vi.mock('@/lib/auth/api-tokens', () => ({ pollDeviceAuth: mockPoll }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: () => null }))

import { POST } from '@admin/app/api/(admin)/admin/cli-auth/poll/route'

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const post = (body: unknown) => POST(new NextRequest('http://x/api/admin/cli-auth/poll', { method: 'POST', body: JSON.stringify(body), headers: { 'x-tenant-id': 't-acme' } }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/admin/cli-auth/poll', () => {
  it('relays a pending login as an RFC 8628 error', async () => {
    mockPoll.mockResolvedValue({ error: 'authorization_pending' })
    const res = await post({ grant_type: GRANT, device_code: 'dc', client_id: 'jeffi-cli' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'authorization_pending' })
    expect(mockPoll).toHaveBeenCalledWith('dc', 't-acme')
  })

  it('returns the token once approved', async () => {
    mockPoll.mockResolvedValue({ token: 'jfc_x', expiresAt: '2030-01-01T00:00:00.000Z', scopes: ['orders:read'] })
    const res = await post({ grant_type: GRANT, device_code: 'dc' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ access_token: 'jfc_x', token_type: 'Bearer', expires_at: '2030-01-01T00:00:00.000Z', scopes: ['orders:read'], scope: 'orders:read' })
  })

  it('refuses another grant type or a missing device code', async () => {
    expect((await post({ grant_type: 'password', device_code: 'dc' })).status).toBe(400)
    expect((await post({ grant_type: GRANT })).status).toBe(400)
    expect(mockPoll).not.toHaveBeenCalled()
  })
})
