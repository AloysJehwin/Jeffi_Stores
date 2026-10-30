import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/cron-auth', () => ({ verifyCronRequest: vi.fn(() => true) }))
const reg = vi.hoisted(() => ({ listTenants: vi.fn(), getTenantPlan: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ listTenants: reg.listTenants }))
vi.mock('@/lib/auth/plan-gate', () => ({ getTenantPlan: reg.getTenantPlan }))
const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/shared/internal-http', () => ({ internalRequest: requestMock }))

import { POST } from '@controller/app/api/(internal)/cron/fanout/route'

const BASE = 'http://127.0.0.1:3000'
function post(jobId: string) {
  return new NextRequest('http://localhost/api/cron/fanout', {
    method: 'POST',
    headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'x'
  process.env.PLATFORM_ROOT_DOMAIN = 'jeffistores.in'
  process.env.CRON_SELF_BASE = BASE
  process.env.CRON_FLAGSHIP_BASE = 'http://flagship-admin:3000'
  process.env.CRON_STORE_BASE = 'http://{slug}-admin:3000'
  requestMock.mockResolvedValue({ ok: true, status: 200 })
})

const hostsCalled = () => requestMock.mock.calls.map(c => c[1]?.host)
const urlsCalled = () => requestMock.mock.calls.map(c => c[0] as string)

describe('cron fan-out', () => {
  it('rejects an unknown jobId', async () => {
    const res = await POST(post('not_a_job'))
    expect(res.status).toBe(400)
  })

  it('platform-only job runs once against the flagship, no tenant loop', async () => {
    const res = await POST(post('provisioning_worker'))
    const json = await res.json()
    expect(json.mode).toBe('platform')
    expect(reg.listTenants).not.toHaveBeenCalled()
    expect(hostsCalled()).toEqual(['jeffistores.in'])
    expect(urlsCalled()).toEqual([`${BASE}/api/internal/provisioning/worker`])
  })

  it('tenant-scoped job runs flagship + only tenants whose plan grants the scope', async () => {
    // cancel_stale_orders → tenantScope orders:read
    reg.listTenants.mockResolvedValue([
      { id: 't1', slug: 'alpha' },
      { id: 't2', slug: 'bravo' },
    ])
    reg.getTenantPlan.mockImplementation(async (id: string) => ({
      plan: 'x',
      scopes: new Set(id === 't1' ? ['orders:read'] : []), // only alpha is eligible
    }))
    const res = await POST(post('cancel_stale_orders'))
    const json = await res.json()
    expect(json.mode).toBe('tenant')
    expect(json.skippedByPlan).toBe(1)
    expect(hostsCalled().sort()).toEqual(['alpha.jeffistores.in', 'jeffistores.in'])
    // Store jobs run on each store's admin service, not this app.
    expect(urlsCalled().sort()).toEqual(['http://alpha-admin:3000/api/cron/cancel-stale-orders', 'http://flagship-admin:3000/api/cron/cancel-stale-orders'])
  })

  it('isolates a failing tenant — one 500 does not abort the rest', async () => {
    reg.listTenants.mockResolvedValue([{ id: 't1', slug: 'alpha' }])
    reg.getTenantPlan.mockResolvedValue({ plan: 'x', scopes: new Set(['orders:read']) })
    requestMock.mockImplementation(async (url: string, init: any) =>
      (init?.host as string).startsWith('alpha') ? { ok: false, status: 500 } : { ok: true, status: 200 }
    )
    const res = await POST(post('cancel_stale_orders'))
    const json = await res.json()
    expect(json.ran).toBe(2) // flagship + alpha both attempted
    expect(json.failed).toBe(1) // only alpha failed
  })
})
