import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockStart } = vi.hoisted(() => ({ mockStart: vi.fn() }))
vi.mock('@/lib/auth/api-tokens', () => ({ startDeviceAuth: mockStart, TOKEN_TTLS: { '1h': 3600, '12h': 43200, '24h': 86400, '7d': 604800 }, clientInfoFrom: (req: NextRequest, clientName: string | null) => ({ host: req.headers.get('x-forwarded-host') || req.headers.get('host'), clientName }) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: () => null }))

import { POST } from '@admin/app/api/(admin)/admin/cli-auth/start/route'

const post = (body: unknown, host = 'admin-acme.jeffistores.in') =>
  POST(new NextRequest('http://x/api/admin/cli-auth/start', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-host': host, 'x-tenant-id': 't-acme', 'x-forwarded-proto': 'https' } }))

beforeEach(() => {
  vi.clearAllMocks()
  mockStart.mockResolvedValue({ deviceCode: 'dev-code', userCode: 'BCDF-GHJK', expiresIn: 600, interval: 5 })
})

describe('POST /api/admin/cli-auth/start', () => {
  it("starts a login on the request's store with an absolute verification link", async () => {
    const res = await post({ client_id: 'jeffi-cli', client_name: 'jeffi CLI 0.1.0', scope: 'read', ttl: '1h' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const d = await res.json()
    expect(d).toMatchObject({ device_code: 'dev-code', user_code: 'BCDF-GHJK', interval: 5, expires_in: 600 })
    expect(d.verification_uri).toBe('https://admin-acme.jeffistores.in/cli/authorize')
    expect(d.verification_uri_complete).toBe('https://admin-acme.jeffistores.in/cli/authorize?code=BCDF-GHJK&scope=read&ttl=1h')
    expect(mockStart).toHaveBeenCalledWith('t-acme', expect.objectContaining({ host: 'admin-acme.jeffistores.in', clientName: 'jeffi CLI 0.1.0' }))
  })

  it('ignores hints it does not understand', async () => {
    const d = await (await post({ client_id: 'jeffi-cli', scope: '<script>', ttl: '99y' })).json()
    expect(d.verification_uri_complete).toBe('https://admin-acme.jeffistores.in/cli/authorize?code=BCDF-GHJK')
  })

  it('refuses a malformed client_id', async () => {
    const res = await post({ client_id: 'x'.repeat(65) })
    expect(res.status).toBe(400)
    expect(mockStart).not.toHaveBeenCalled()
  })
})
