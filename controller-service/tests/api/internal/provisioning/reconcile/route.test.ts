import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const reg = vi.hoisted(() => ({ reconcileOrphanedTenants: vi.fn(), expireTenantArchives: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const alerts = vi.hoisted(() => ({ sweepProvisioningIncidents: vi.fn() }))
vi.mock('@controller/lib/provisioning/alerts', () => alerts)

import { POST } from '@controller/app/api/(internal)/internal/provisioning/reconcile/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/internal/provisioning/reconcile', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  reg.reconcileOrphanedTenants.mockResolvedValue(['t-1'])
  reg.expireTenantArchives.mockResolvedValue({ expired: 2, failed: 0 })
  alerts.sweepProvisioningIncidents.mockResolvedValue({ opened: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/provisioning/reconcile', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    expect(reg.reconcileOrphanedTenants).not.toHaveBeenCalled()
  })

  it('suspends orphans, sweeps incidents and expires archives', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, reconciled: ['t-1'], incidents: { opened: 0 }, archives: { expired: 2, failed: 0 } })
    expect(alerts.sweepProvisioningIncidents).toHaveBeenCalledTimes(1)
  })

  it('still answers when each step throws', async () => {
    reg.reconcileOrphanedTenants.mockRejectedValue(new Error('db'))
    alerts.sweepProvisioningIncidents.mockRejectedValue(new Error('mail'))
    reg.expireTenantArchives.mockRejectedValue(new Error('s3'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, reconciled: [], incidents: null, archives: { expired: 0, failed: 0 } })
  })
})
