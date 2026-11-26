import { describe, it, expect, vi, beforeEach } from 'vitest'

// An in-memory secrets store behind the shared interface (either backend looks like this to callers).
const store = vi.hoisted(() => {
  const err = (code: string, secret: string) => Object.assign(new Error(code), { name: 'SecretError', code, secret })
  const data = new Map<string, string>()
  const deleted = new Map<string, string>()
  const client = {
    backend: 'keyvault' as const,
    get: vi.fn(async (n: string) => {
      if (deleted.has(n)) throw err('Deleted', n)
      if (!data.has(n)) throw err('NotFound', n)
      return data.get(n)!
    }),
    put: vi.fn(async (n: string, v: string) => void data.set(n, v)),
    create: vi.fn(async (n: string, v: string) => {
      if (data.has(n)) throw err('Exists', n)
      data.set(n, v)
      return v
    }),
    remove: vi.fn(async (n: string) => {
      if (data.has(n)) deleted.set(n, data.get(n)!)
      data.delete(n)
    }),
    restore: vi.fn(async (n: string) => {
      data.set(n, deleted.get(n)!)
      deleted.delete(n)
    }),
  }
  return { data, deleted, client, regions: [] as (string | undefined)[], err }
})
vi.mock('@/lib/secrets/index.mjs', async (orig) => ({
  ...(await orig<typeof import('@/lib/secrets/index.mjs')>()),
  secrets: (region?: string) => {
    store.regions.push(region)
    return store.client
  },
}))

import { getOrCreateTenantDbPassword, deleteTenantDbSecret } from '@controller/lib/provisioning/tenant-db-secret'

const NAME = 'jeffi/tenant-db/acme'
const blob = (password: string, extra: Record<string, string> = {}) => JSON.stringify({ username: 'jeffi', password, database: 'jeffi_stores', ...extra })

beforeEach(() => {
  store.data.clear()
  store.deleted.clear()
  store.regions.length = 0
  vi.clearAllMocks()
})

describe('getOrCreateTenantDbPassword', () => {
  it('returns the stored password and never replaces it', async () => {
    store.data.set(NAME, blob('kept'))
    await expect(getOrCreateTenantDbPassword('acme')).resolves.toBe('kept')
    expect(store.client.put).not.toHaveBeenCalled()
    expect(store.client.create).not.toHaveBeenCalled()
    expect(store.regions[0]).toBe(process.env.AWS_REGION || 'us-east-1')
  })

  it('corrects an old label, keeping the password', async () => {
    store.data.set(NAME, JSON.stringify({ username: 'jeffi', password: 'kept', database: 'jeffi' }))
    await expect(getOrCreateTenantDbPassword('acme')).resolves.toBe('kept')
    expect(JSON.parse(store.data.get(NAME)!)).toEqual({ username: 'jeffi', password: 'kept', database: 'jeffi_stores' })
  })

  it('creates a new password when there is none', async () => {
    const pw = await getOrCreateTenantDbPassword('acme')
    expect(pw).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(store.client.create).toHaveBeenCalledWith(NAME, blob(pw))
  })

  it('fills a secret that exists without a password', async () => {
    store.data.set(NAME, '{}')
    const pw = await getOrCreateTenantDbPassword('acme')
    expect(store.client.put).toHaveBeenCalledWith(NAME, blob(pw))
    expect(store.client.create).not.toHaveBeenCalled()
  })

  it('restores one scheduled for deletion and returns its password', async () => {
    store.deleted.set(NAME, blob('old'))
    await expect(getOrCreateTenantDbPassword('acme')).resolves.toBe('old')
    expect(store.client.restore).toHaveBeenCalledWith(NAME)
  })

  it('reads the winner when another tick created it meanwhile', async () => {
    store.client.create.mockImplementationOnce(async (n: string) => {
      store.data.set(n, blob('theirs'))
      throw store.err('Exists', n)
    })
    await expect(getOrCreateTenantDbPassword('acme')).resolves.toBe('theirs')
  })

  it('surfaces other errors', async () => {
    store.client.get.mockRejectedValueOnce(store.err('Denied', NAME))
    await expect(getOrCreateTenantDbPassword('acme')).rejects.toMatchObject({ code: 'Denied' })
  })

  it('gives up after three attempts', async () => {
    for (let i = 0; i < 3; i++) {
      store.client.get.mockRejectedValueOnce(store.err('NotFound', NAME))
      store.client.create.mockRejectedValueOnce(store.err('Exists', NAME))
    }
    await expect(getOrCreateTenantDbPassword('acme')).rejects.toThrow(`could not read or create the database secret ${NAME}`)
  })
})

describe('deleteTenantDbSecret', () => {
  it('schedules deletion with a 7-day recovery window', async () => {
    await deleteTenantDbSecret('acme')
    expect(store.client.remove).toHaveBeenCalledWith(NAME, { recoveryDays: 7 })
  })
})
