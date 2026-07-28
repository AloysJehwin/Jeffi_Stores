import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

import { resolveEdd, invalidateEddCache } from '@/lib/edd-cache'

describe('edd-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateEddCache()
  })

  it('invalidateEddCache clears the cache without throwing', () => {
    expect(() => invalidateEddCache()).not.toThrow()
  })

  it('resolveEdd returns null when not logged in and fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    const result = await resolveEdd(false, 1, 0)
    expect(result).toBeNull()
  })

  it('resolveEdd fetches address then EDD when logged in', async () => {
    // First fetch: addresses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ addresses: [{ is_default: true, postal_code: '492001' }] }),
    })
    // Second fetch: EDD
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ edd: '2026-07-25' }),
    })
    const result = await resolveEdd(true, 1, 0)
    expect(result).toBe('2026-07-25')
  })
})
