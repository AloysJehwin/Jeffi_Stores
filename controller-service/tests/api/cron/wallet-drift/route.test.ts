import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@controller/app/api/(internal)/cron/wallet-drift/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/wallet-drift', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/cron/wallet-drift', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('reports no drift', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await (await call()).json()).toEqual({ checked: true, driftedCount: 0, drifted: [] })
  })

  it('reports drifted wallets read-only, as numbers', async () => {
    query.mockResolvedValue({ rows: [{ tenant_id: 't-1', balance: '100.00', ledger_total: '90.00', drift: '10.00' }] })
    const body = await (await call()).json()
    expect(body).toEqual({ checked: true, driftedCount: 1, drifted: [{ tenantId: 't-1', balance: 100, ledgerTotal: 90, drift: 10 }] })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toMatch(/^\s*SELECT/)
  })

  it('500s when the check fails', async () => {
    query.mockRejectedValue(new Error('db'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'drift check failed' })
  })
})
