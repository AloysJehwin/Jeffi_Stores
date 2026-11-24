import { describe, it, expect, vi } from 'vitest'

const getStorePolicyBySlug = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legals/store-policies', () => ({ getStorePolicies: vi.fn(), getStorePolicyBySlug }))

import { GET } from '@storefront/app/api/(public)/legal/[slug]/route'

const call = (slug: string) => GET(new Request(`http://localhost/api/legal/${slug}`), { params: Promise.resolve({ slug }) })

describe('GET /api/legal/[slug]', () => {
  it('returns the policy', async () => {
    getStorePolicyBySlug.mockResolvedValue({ slug: 'terms', title: 'Terms' })
    const res = await call('terms')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await res.json()).toEqual({ policy: { slug: 'terms', title: 'Terms' } })
    expect(getStorePolicyBySlug).toHaveBeenCalledWith('terms')
  })

  it('404s for an unknown slug', async () => {
    getStorePolicyBySlug.mockResolvedValue(null)
    const res = await call('nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})
