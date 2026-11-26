import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/marketing/messaging/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/marketing/messaging/insights${qs}`)

describe('GET /api/admin/marketing/messaging/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the messaging overview gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'mailer:read')
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('reads WhatsApp receipts from message_logs by default: delivered, awaiting, failed', async () => {
    expect((await GET(req())).status).toBe(200)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'message_logs', params: ['whatsapp'], filter: 'whatsapp', weeks: 26 })
    expect(spec.series?.map(s => s.key)).toEqual(['delivered', 'pending', 'failed'])
  })

  it('reads SMS the same way', async () => {
    await GET(req('?filter=sms&weeks=13'))
    expect(vi.mocked(getInsightsSeries).mock.calls[0][0]).toMatchObject({ table: 'message_logs', params: ['sms'], weeks: 13 })
  })

  it('reads email from the broadcast log: sent and failed, settled rows only', async () => {
    await GET(req('?filter=email'))
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'email_campaign_logs', filter: 'email' })
    expect(spec.where).toContain("NOT IN ('queued', 'sending', 'deferred', 'skipped')")
    expect(spec.series?.map(s => s.key)).toEqual(['sent', 'failed'])
  })

  it('rejects an unknown channel or period', async () => {
    expect((await GET(req('?filter=push'))).status).toBe(400)
    expect((await GET(req('?weeks=1'))).status).toBe(400)
  })

  it('answers 500 when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
