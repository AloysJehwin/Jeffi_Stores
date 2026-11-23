// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// A Showcase's analytics API: only the site's owner reads it, by tab or as the enquiries CSV.

const { getOwnedShowcase, showcaseReport, showcaseLeadRows } = vi.hoisted(() => ({ getOwnedShowcase: vi.fn(), showcaseReport: vi.fn(), showcaseLeadRows: vi.fn() }))

const TENANT = { id: 't-1', slug: 'latte', service_types: ['showcase'] }
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: async () => ({ owner: { id: 'o-1' }, tenant: TENANT, tenants: [TENANT] }) }))
vi.mock('@/lib/showcase/store', () => ({ getOwnedShowcase }))
vi.mock('@/lib/traffic/showcase-report', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/traffic/showcase-report')>()),
  showcaseReport,
  showcaseLeadRows,
}))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: vi.fn() }), RESERVED_LABELS: new Set<string>() }))

import { GET } from '@controller/app/api/(ecom)/ecom/showcase/[siteId]/analytics/route'

const SITE_ID = '6f1e2d3c-4b5a-4968-8776-655443322110'
const SITE = { id: SITE_ID, slug: 'latte', ownerId: 'o-1', customDomain: 'latte.in' }
const get = (siteId: string, q = '') => GET(new NextRequest(`https://ecom.jeffistores.in/api/ecom/showcase/${siteId}/analytics${q}`), { params: Promise.resolve({ siteId }) })

describe('GET /api/ecom/showcase/[siteId]/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedShowcase.mockResolvedValue(SITE)
    showcaseReport.mockResolvedValue({ current: { sessions: 3 } })
  })

  it("404s a site the owner does not own, and a malformed id without asking the database", async () => {
    getOwnedShowcase.mockResolvedValueOnce(null)
    expect((await get(SITE_ID)).status).toBe(404)
    expect(getOwnedShowcase).toHaveBeenCalledWith(SITE_ID, 'o-1')
    expect((await get('not-a-uuid')).status).toBe(404)
    expect(getOwnedShowcase).toHaveBeenCalledOnce()
    expect(showcaseReport).not.toHaveBeenCalled()
  })

  it("answers a tab for the site's own hosts and links back to its own page", async () => {
    const res = await get(SITE_ID, '?tab=acquisition&from=2026-11-01&to=2026-11-07')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tab: 'acquisition', current: { sessions: 3 } })
    const [tab, period, ctx] = showcaseReport.mock.calls[0]
    expect(tab).toBe('acquisition')
    expect(period).toEqual({ from: '2026-11-01', to: '2026-11-07' })
    expect(ctx.siteId).toBe(SITE_ID)
    expect(ctx.selfHosts).toEqual([expect.stringMatching(/^site-latte\./), 'latte.in'])
    expect(ctx.tabHref('leads')).toBe(`/dashboard/showcase/${SITE_ID}/analytics?tab=leads`)
    expect((await get(SITE_ID, '?tab=products')).status).toBe(400)
  })

  it('exports the period’s enquiries as a CSV download', async () => {
    showcaseLeadRows.mockResolvedValue([
      { id: 'l1', name: 'Priya', phone: null, email: 'p@x.in', message: null, createdAt: '2026-11-05T04:30:00.000Z', readAt: null, channel: null, source: null, campaign: null, landing: null, device: null, country: null },
    ])
    const res = await get(SITE_ID, '?format=csv&from=2026-11-01&to=2026-11-07')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="enquiries-latte-2026-11-01-to-2026-11-07.csv"')
    expect(await res.text()).toContain('2026-11-05 10:00,Priya,,p@x.in,,New,Not linked to a visit')
    expect(showcaseLeadRows.mock.calls[0][0]).toBe(SITE_ID)
  })
})
