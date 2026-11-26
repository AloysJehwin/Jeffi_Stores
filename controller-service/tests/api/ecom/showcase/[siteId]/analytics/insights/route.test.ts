// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// A Showcase's insights series: only the site's owner reads it; views and enquiries are the site's own rows.

const { getOwnedShowcase, query } = vi.hoisted(() => ({ getOwnedShowcase: vi.fn(), query: vi.fn() }))

const TENANT = { id: 't-1', slug: 'latte', service_types: ['showcase'] }
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: async () => ({ owner: { id: 'o-1' }, tenant: TENANT, tenants: [TENANT] }) }))
vi.mock('@/lib/showcase/store', () => ({ getOwnedShowcase }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@controller/app/api/(ecom)/ecom/showcase/[siteId]/analytics/insights/route'

const SITE_ID = '6f1e2d3c-4b5a-4968-8776-655443322110'
const get = (siteId: string, q = '') => GET(new NextRequest(`https://ecom.jeffistores.in/api/ecom/showcase/${siteId}/analytics/insights${q}`), { params: Promise.resolve({ siteId }) })

describe('GET /api/ecom/showcase/[siteId]/analytics/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedShowcase.mockResolvedValue({ id: SITE_ID, slug: 'latte', ownerId: 'o-1' })
    query.mockImplementation(async (sql: string, params: unknown[]) => ({
      rows: sql.includes('AS today') ? [{ today: '2026-11-26' }] : [{ day: '2026-11-26', s0: sql.includes('showcase_events') ? '10' : '2' }].filter(() => params[0] === SITE_ID),
    }))
  })

  it('404s a site the owner does not own and a malformed id, without querying', async () => {
    getOwnedShowcase.mockResolvedValueOnce(null)
    expect((await get(SITE_ID)).status).toBe(404)
    expect((await get('not-a-uuid')).status).toBe(404)
    expect(query).not.toHaveBeenCalled()
  })

  it('merges the site’s page views and enquiries, both bound to its id', async () => {
    const res = await get(SITE_ID, '?weeks=13')
    expect(res.status).toBe(200)
    const { series } = await res.json()
    expect(series.series.map((s: any) => s.key)).toEqual(['views', 'leads'])
    expect(series.days.find((d: any) => d.date === '2026-11-26').values).toEqual([10, 2])
    const sqls = query.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('FROM showcase_events') && s.includes(`x.type = 'pageview'`))).toBe(true)
    expect(sqls.some(s => s.includes('FROM showcase_leads'))).toBe(true)
  })

  it('rejects an unknown period and answers 500 when the query fails', async () => {
    expect((await get(SITE_ID, '?weeks=7')).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValue(new Error('db'))
    expect((await get(SITE_ID)).status).toBe(500)
  })
})
