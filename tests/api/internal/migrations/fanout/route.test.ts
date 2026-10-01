/**
 * The deploy pipeline calls this to push a schema change out to every customer database.
 * It runs unattended with a shared secret, so the auth boundary and the failure signal both
 * matter: a silent 200 on partial failure would leave stores behind the code serving them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const runMigrationFanout = vi.fn()
vi.mock('@/lib/tenant-migrations', () => ({ runMigrationFanout: (s: string) => runMigrationFanout(s) }))

const REAL_ENV = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...REAL_ENV, CRON_SECRET: 's3cret' }
  runMigrationFanout.mockResolvedValue({ gitSha: 'abc', total: 2, applied: 2, skipped: 0, failed: 0, failures: [] })
})

const post = async (headers: Record<string, string>, body: unknown = {}) => {
  const { POST } = await import('@/app/api/internal/migrations/fanout/route')
  return POST(
    new NextRequest('http://localhost/api/internal/migrations/fanout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/internal/migrations/fanout', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await post({})
    expect(res.status).toBe(401)
    expect(runMigrationFanout).not.toHaveBeenCalled()
  })

  it('rejects a wrong token', async () => {
    const res = await post({ authorization: 'Bearer nope' })
    expect(res.status).toBe(401)
    expect(runMigrationFanout).not.toHaveBeenCalled()
  })

  // Otherwise an unset secret would leave the endpoint open to anyone who can reach it.
  it('rejects when CRON_SECRET is not configured, even with a token', async () => {
    delete process.env.CRON_SECRET
    const res = await post({ authorization: 'Bearer anything' })
    expect(res.status).toBe(401)
    expect(runMigrationFanout).not.toHaveBeenCalled()
  })

  it('fans out with the supplied gitSha', async () => {
    const res = await post({ authorization: 'Bearer s3cret' }, { gitSha: 'deadbeef' })
    expect(res.status).toBe(200)
    expect(runMigrationFanout).toHaveBeenCalledWith('deadbeef')
    await expect(res.json()).resolves.toMatchObject({ ok: true, result: { applied: 2 } })
  })

  it('falls back to GIT_SHA when the body omits one', async () => {
    process.env.GIT_SHA = 'from-env'
    await post({ authorization: 'Bearer s3cret' })
    expect(runMigrationFanout).toHaveBeenCalledWith('from-env')
  })

  // A partial failure must fail the deploy step — the named tenants are still on the old schema
  // while the new code is already serving them.
  it('returns 500 when any tenant failed, naming them', async () => {
    runMigrationFanout.mockResolvedValue({
      gitSha: 'abc',
      total: 3,
      applied: 2,
      skipped: 0,
      failed: 1,
      failures: [{ slug: 'acme', error: 'connection refused' }],
    })
    const res = await post({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result.failures[0]).toMatchObject({ slug: 'acme' })
  })

  // No tenants yet is a normal state, not an error.
  it('succeeds when there are no active tenants', async () => {
    runMigrationFanout.mockResolvedValue({ gitSha: 'abc', total: 0, applied: 0, skipped: 0, failed: 0, failures: [] })
    const res = await post({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(200)
  })
})
