import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const mig = vi.hoisted(() => ({ runMigrationFanout: vi.fn(), getMigrationRuns: vi.fn() }))
vi.mock('@controller/lib/tenant-migrations', () => mig)

import { GET, POST } from '@controller/app/api/(admin)/admin/ecom/migrations/run/route'

const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/migrations/run'))
const post = (body: unknown = {}) => POST(new NextRequest('http://localhost/api/admin/ecom/migrations/run', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: ['ecom_instances:write'] })
  mig.getMigrationRuns.mockResolvedValue([{ id: 1 }])
  mig.runMigrationFanout.mockResolvedValue({ failed: 0, applied: 2 })
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/admin/ecom/migrations/run', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect((await post()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: [] })
    expect((await get()).status).toBe(403)
    expect((await post()).status).toBe(403)
    expect(mig.runMigrationFanout).not.toHaveBeenCalled()
  })

  it('a read scope lists runs but cannot trigger one', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: ['ecom_instances:read'] })
    expect(await (await get()).json()).toEqual({ runs: [{ id: 1 }] })
    expect(mig.getMigrationRuns).toHaveBeenCalledWith(100)
    expect((await post()).status).toBe(403)
  })

  it('POST fans out for the given sha', async () => {
    const res = await post({ gitSha: 'abc' })
    expect(await res.json()).toEqual({ ok: true, result: { failed: 0, applied: 2 } })
    expect(mig.runMigrationFanout).toHaveBeenCalledWith('abc')
  })

  it('POST falls back to GIT_SHA, then a manual label, and tolerates no body', async () => {
    vi.stubEnv('GIT_SHA', 'envsha')
    await post()
    expect(mig.runMigrationFanout).toHaveBeenLastCalledWith('envsha')
    vi.stubEnv('GIT_SHA', '')
    await post('not json')
    expect(mig.runMigrationFanout.mock.calls[1][0]).toMatch(/^manual-\d+$/)
  })

  it('POST reports ok false when a tenant failed', async () => {
    mig.runMigrationFanout.mockResolvedValue({ failed: 1 })
    expect((await (await post()).json()).ok).toBe(false)
  })
})
