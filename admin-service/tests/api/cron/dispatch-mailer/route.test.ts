import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/shared/email-campaigns', () => ({ sendCampaign: vi.fn() }))
vi.mock('@/lib/push/broadcast', () => ({ drainCampaignPush: vi.fn() }))
vi.mock('@/lib/campaigns/push-dispatch', () => ({ drainScenarioPushQueue: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/dispatch-mailer/route'
import { query, queryMany } from '@/lib/shared/db'
import { sendCampaign } from '@/lib/shared/email-campaigns'
import { drainCampaignPush } from '@/lib/push/broadcast'
import { drainScenarioPushQueue } from '@/lib/campaigns/push-dispatch'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/dispatch-mailer', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(queryMany).mockResolvedValue([])
  vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
  vi.mocked(sendCampaign).mockResolvedValue(undefined as any)
  vi.mocked(drainCampaignPush).mockResolvedValue({ sent: 0 } as any)
  vi.mocked(drainScenarioPushQueue).mockResolvedValue({ sent: 0 } as any)
})

const flush = () => new Promise(r => setTimeout(r, 0))

describe('GET /api/cron/dispatch-mailer', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('dispatches nothing and still drains the push queues when no campaign is due', async () => {
    vi.mocked(drainCampaignPush).mockResolvedValue({ sent: 3 } as any)
    vi.mocked(drainScenarioPushQueue).mockResolvedValue({ sent: 1 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dispatched: 0, ids: [], push: { sent: 3 }, scenarioPush: { sent: 1 } })
    expect(sendCampaign).not.toHaveBeenCalled()
    expect(drainCampaignPush).toHaveBeenCalledWith({ budgetMs: 30_000 })
    expect(drainScenarioPushQueue).toHaveBeenCalledWith(15_000)
  })

  it('claims each due campaign and starts its send, skipping one another run already claimed', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }, { id: 'c3', title: 'C' }])
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 1 } as any)
      .mockResolvedValueOnce({ rowCount: 0 } as any)
      .mockResolvedValueOnce({ rowCount: 1 } as any)
    const res = await run(OK)
    expect(await res.json()).toMatchObject({ dispatched: 2, ids: ['c1', 'c3'] })
    expect(vi.mocked(query).mock.calls.map(c => c[1])).toEqual([['c1'], ['c2'], ['c3']])
    expect(vi.mocked(query).mock.calls[0][0]).toContain("SET status = 'sending'")
    expect(vi.mocked(sendCampaign).mock.calls.map(c => c[0])).toEqual(['c1', 'c3'])
  })

  it('puts a campaign whose send fails back to draft', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'c1', title: 'A' }])
    vi.mocked(sendCampaign).mockRejectedValue(new Error('SES down'))
    expect((await run(OK)).status).toBe(200)
    await flush()
    const calls = vi.mocked(query).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toContain("SET status = 'draft'")
    expect(calls[1][1]).toEqual(['c1'])
  })

  it('reports a push-queue failure in the body instead of failing the run', async () => {
    vi.mocked(drainCampaignPush).mockRejectedValue(new Error('FCM down'))
    vi.mocked(drainScenarioPushQueue).mockRejectedValue(new Error('queue down'))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ push: { error: 'FCM down' }, scenarioPush: { error: 'queue down' } })
  })
})
