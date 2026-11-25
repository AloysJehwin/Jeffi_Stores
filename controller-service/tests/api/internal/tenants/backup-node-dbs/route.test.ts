import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ backupNodeDbs: vi.fn() }))
vi.mock('@controller/lib/provisioning/node-db-backup', () => lib)

import { POST } from '@controller/app/api/(internal)/internal/tenants/backup-node-dbs/route'

const mock = lib.backupNodeDbs
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/internal/tenants/backup-node-dbs', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

describe('POST /api/internal/tenants/backup-node-dbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects a missing secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
  })

  it('rejects everything when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
  })

  it('runs the job with the right secret', async () => {
    mock.mockResolvedValue({ backedUp: ['a'], failed: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, backedUp: ['a'], failed: [] })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.mockResolvedValue({ backedUp: [], failed: ['b'] })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, backedUp: [], failed: ['b'] })
  })

})
