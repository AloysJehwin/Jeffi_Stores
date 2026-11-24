import { describe, it, expect, vi } from 'vitest'

const getStorePolicies = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legals/store-policies', () => ({ getStorePolicies, getStorePolicyBySlug: vi.fn() }))

import { GET } from '@storefront/app/api/(public)/legal/route'

describe('GET /api/legal', () => {
  it('lists listed policies with summary fields only', async () => {
    getStorePolicies.mockResolvedValue([
      { slug: 'privacy', title: 'Privacy', description: 'd', lastUpdated: '2026-01-01', body: 'secret body' },
      { slug: 'hidden', title: 'Hidden', description: 'x', lastUpdated: '2026-01-01', unlisted: true },
    ])
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await res.json()).toEqual({
      policies: [{ slug: 'privacy', title: 'Privacy', description: 'd', lastUpdated: '2026-01-01' }],
    })
  })

  it('surfaces a loader failure', async () => {
    getStorePolicies.mockRejectedValue(new Error('db'))
    await expect(GET()).rejects.toThrow('db')
  })
})
