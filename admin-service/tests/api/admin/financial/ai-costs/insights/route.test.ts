import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ FLAGSHIP_TENANT_ID: 'flagship-id' }))

import { GET } from '@admin/app/api/(admin)/admin/financial/ai-costs/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '', tenant?: string) =>
  new NextRequest(`http://localhost/api/admin/financial/ai-costs/insights${qs}`, tenant ? { headers: { 'x-tenant-id': tenant } } : undefined)

describe('GET /api/admin/financial/ai-costs/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the finance gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
  })

  it('stacks the platform cost by capability on the flagship', async () => {
    expect((await GET(req())).status).toBe(200)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'ai_usage', dateColumn: 'created_at', weeks: 26 })
    expect(spec.series?.map(s => s.key)).toEqual(['text', 'vision', 'embed', 'image', 'video', 'audio'])
    expect(spec.series?.[0]).toMatchObject({ label: 'Text', value: 'SUM(u.cost_inr)', where: `u.capability = 'text'` })
    await GET(req('', 'flagship-id'))
    expect(vi.mocked(getInsightsSeries).mock.calls[1][0].series?.[0].value).toBe('SUM(u.cost_inr)')
  })

  it('sums what was charged to the wallet on a store, not the platform cost', async () => {
    await GET(req('?weeks=13', 'store-1'))
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec.weeks).toBe(13)
    expect(spec.series?.[0].value).toContain('u.price_inr')
    expect(spec.series?.[0].value).toContain(`NOT LIKE 'platform:%'`)
  })

  it('rejects an unknown period and answers 500 on a failed query', async () => {
    expect((await GET(req('?weeks=5'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
