import { describe, it, expect, vi } from 'vitest'

const queryMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/shared/db', () => ({ queryMany }))

import { GET } from '@storefront/app/api/(public)/about/route'

describe('GET /api/about', () => {
  it('nests subcategories under their top-level parent', async () => {
    queryMany.mockResolvedValue([
      { id: 'c1', name: 'Tools', slug: 'tools', icon_name: 'hammer', parent_category_id: null },
      { id: 'c2', name: 'Saws', slug: 'saws', icon_name: null, parent_category_id: 'c1' },
      { id: 'c3', name: 'Paint', slug: null, icon_name: null, parent_category_id: null },
    ])
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      categories: [
        { id: 'c1', name: 'Tools', slug: 'tools', icon_name: 'hammer', subcategories: [{ id: 'c2', name: 'Saws', slug: 'saws' }] },
        { id: 'c3', name: 'Paint', slug: null, icon_name: null, subcategories: [] },
      ],
    })
    expect(queryMany.mock.calls[0][0]).toContain('is_active = true')
  })

  it('degrades to an empty list when the query fails', async () => {
    queryMany.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ categories: [] })
  })
})
