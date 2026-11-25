import { describe, it, expect, vi } from 'vitest'

const core = vi.hoisted(() => {
  const remove = vi.fn(async () => {})
  return { remove, forgetDbSecret: vi.fn(), fetchDbSecret: vi.fn(), secrets: vi.fn(() => ({ remove })) }
})
vi.mock('@/lib/secrets/index.mjs', () => core)

import { fetchDbSecret, forceDeleteDbSecret } from '@/lib/shared/db-secret'

describe('db-secret', () => {
  it('reads through the shared secrets interface', () => {
    expect(fetchDbSecret).toBe(core.fetchDbSecret)
  })

  it('force-deletes in the given region and drops the cached copy first', async () => {
    await forceDeleteDbSecret('jeffi/tenant-db/acme', 'ap-south-1')
    expect(core.forgetDbSecret).toHaveBeenCalledWith('jeffi/tenant-db/acme')
    expect(core.secrets).toHaveBeenCalledWith('ap-south-1')
    expect(core.remove).toHaveBeenCalledWith('jeffi/tenant-db/acme', { force: true })
    expect(core.forgetDbSecret.mock.invocationCallOrder[0]).toBeLessThan(core.remove.mock.invocationCallOrder[0])
  })
})
