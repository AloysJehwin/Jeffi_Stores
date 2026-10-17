import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenant-registry/shared', () => ({ ROOT_DOMAIN: 'example.test' }))

import { GET } from '@/app/api/(admin)/admin/ecom/store-status/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/ecom/store-status/overview${qs}`)

function rows(sql: string) {
  if (sql.includes('AS domain_failed'))
    return [
      {
        id: 'a',
        name: 'Alpha',
        slug: 'alpha',
        status: 'active',
        instance_state: 'running',
        last_release: 'success',
        domain_failed: false,
      },
      {
        id: 'b',
        name: 'Bravo',
        slug: 'bravo',
        status: 'active',
        instance_state: 'stopped',
        last_release: null,
        domain_failed: false,
      },
      {
        id: 'c',
        name: 'Charlie',
        slug: 'charlie',
        status: 'active',
        instance_state: 'running',
        last_release: 'failed',
        domain_failed: false,
      },
      {
        id: 'd',
        name: 'Delta',
        slug: 'delta',
        status: 'suspended',
        instance_state: 'running',
        last_release: null,
        domain_failed: false,
      },
    ]
  if (sql.includes('AS provisioning_prev'))
    return [{ provisioning: 2, provisioning_prev: 0, release: 1, release_prev: 1, suspended: 1, suspended_prev: 1 }]
  if (sql.includes('AS next_ca_expiry'))
    return [{ next_ca_expiry: null, ca_expiring_30d: 0, admin_certs: 2, admin_certs_expiring_30d: 1 }]
  if (sql.includes("'store_down'")) return [{ kind: 'store_down', id: 'b', name: 'Bravo' }]
  return []
}

describe('GET /api/admin/ecom/store-status/overview', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockImplementation(async (sql: string) => ({ rows: rows(sql) }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is gated on ecom_customers:read, like the page', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_customers:read')
  })

  it('returns health, incidents and attention without probing', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.health).toEqual({ up: 1, degraded: 1, down: 1, suspended: 1, setting_up: 0 })
    expect(j.live).toBe(2)
    expect(j.current.incidents).toBe(4)
    expect(j.deltas.incidents).toBe(1)
    expect(j.not_up.map((s: any) => s.id)).toEqual(['b', 'c', 'd'])
    expect(j.attention[0]).toMatchObject({ key: 'store_down', severity: 'critical' })
    expect(j.probe).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes live stores on ?probe=1', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('alpha') ? { status: 200 } : Promise.reject(new Error('down'))
    )
    const j = await (await GET(req('?probe=1'))).json()
    expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual([
      'https://alpha.example.test/api/ready',
      'https://charlie.example.test/api/ready',
    ])
    expect(j.probe).toMatchObject({ up: 1, down: 1 })
  })
})
