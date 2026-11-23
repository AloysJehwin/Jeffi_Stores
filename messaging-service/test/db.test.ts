import { describe, it, expect, vi, afterEach } from 'vitest'

// db.ts throws at import if MESSAGING_DATABASE_URL is unset; mainPool is mocked so no real pool is built.
vi.mock('@jeffi/tenancy', () => ({ mainPool: vi.fn((url: string, max: number) => ({ url, max, query: vi.fn() })) }))

describe('db module', () => {
  afterEach(() => { vi.resetModules(); delete process.env.MESSAGING_DATABASE_URL })

  it('throws when MESSAGING_DATABASE_URL is not set', async () => {
    delete process.env.MESSAGING_DATABASE_URL
    await expect(import('../src/db.js?nourl')).rejects.toThrow(/MESSAGING_DATABASE_URL is not set/)
  })

  it('builds a pool of size 10 and q/one project the rows', async () => {
    process.env.MESSAGING_DATABASE_URL = 'postgres://x'
    const mod = await import('../src/db.js?withurl')
    expect((mod.db as any).max).toBe(10)
    vi.spyOn(mod.db as any, 'query').mockResolvedValue({ rows: [{ a: 1 }, { a: 2 }] })
    expect(await mod.q('SELECT 1')).toEqual([{ a: 1 }, { a: 2 }])
    expect(await mod.one('SELECT 1')).toEqual({ a: 1 })
    vi.spyOn(mod.db as any, 'query').mockResolvedValue({ rows: [] })
    expect(await mod.one('SELECT 1')).toBeUndefined()
  })
})
