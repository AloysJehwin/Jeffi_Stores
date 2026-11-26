import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/campaigns/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/campaigns/insights${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

describe('GET /api/admin/campaigns/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the campaigns overview gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'mailer:read')
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('defaults to 26 weeks over every channel, split into no conversion and converted', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).series.weeks).toBe(26)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'email_campaigns_sent', dateColumn: 'sent_at', weeks: 26, filter: 'all', params: [] })
    expect(spec.where).toBe(`s.campaign_kind <> 'broadcast'`)
    expect(spec.series?.map(s => s.key)).toEqual(['unconverted', 'converted'])
  })

  it('narrows to one channel through a bound parameter', async () => {
    await GET(req('?weeks=52&filter=whatsapp'))
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ weeks: 52, filter: 'whatsapp', params: ['whatsapp'] })
    expect(spec.where).toContain('s.channel = $1')
  })

  it('rejects an unknown period or channel without querying', async () => {
    expect((await GET(req('?weeks=7'))).status).toBe(400)
    expect((await GET(req('?filter=fax'))).status).toBe(400)
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('answers 500 when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
