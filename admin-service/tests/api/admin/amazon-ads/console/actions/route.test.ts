import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))

vi.mock('@/lib/amazon-ads/console', async orig => ({ ...(await orig<Record<string, unknown>>()), runAadsAction: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/amazon-ads/console/actions/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { runAadsAction } from '@/lib/amazon-ads/console'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/amazon-ads/console/actions', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const PAUSE = { action: 'campaign.state', campaignId: '123', state: 'PAUSED' }
const BUDGET = { action: 'campaign.budget', campaignId: '123', budget: 500 }

describe('POST /api/admin/amazon-ads/console/actions', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post(PAUSE)).status).toBe(401)
    expect(runAadsAction).not.toHaveBeenCalled()
  })

  it('403 without the amazon_ads:write scope', async () => {
    deny(403)
    expect((await post(PAUSE)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_ads:write')
    expect(runAadsAction).not.toHaveBeenCalled()
  })

  it('403 when the plan gate refuses', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
    const res = await post(PAUSE)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro' })
    expect(runAadsAction).not.toHaveBeenCalled()
  })

  it('400 for an unreadable body or an unknown action', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({ action: 'campaign.delete', campaignId: '1' })).status).toBe(400)
    expect(runAadsAction).not.toHaveBeenCalled()
  })

  it('400 for a bad budget value', async () => {
    expect((await post({ ...BUDGET, budget: -5 })).status).toBe(400)
    expect(runAadsAction).not.toHaveBeenCalled()
  })

  it('pauses the campaign as the admin and returns the outcome', async () => {
    vi.mocked(runAadsAction).mockResolvedValue({ ok: true, preview: false } as any)
    const res = await post(PAUSE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, preview: false })
    expect(runAadsAction).toHaveBeenCalledWith(expect.objectContaining(PAUSE), { adminId: 'a1', email: 'a@x.in' }, false)
  })

  it('changes the budget and passes the preview flag through', async () => {
    vi.mocked(runAadsAction).mockResolvedValue({ ok: false, preview: true, problems: [] } as any)
    const res = await post({ ...BUDGET, preview: true })
    expect(res.status).toBe(200)
    expect(runAadsAction).toHaveBeenCalledWith(expect.objectContaining(BUDGET), expect.anything(), true)
  })

  it('400 when the change is refused (not ok, not a preview)', async () => {
    vi.mocked(runAadsAction).mockResolvedValue({ ok: false, preview: false, problems: ['too high'] } as any)
    const res = await post(BUDGET)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ problems: ['too high'] })
  })

  it('409 when the account is not connected', async () => {
    vi.mocked(runAadsAction).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    const res = await post(PAUSE)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Connect Amazon Ads first.' })
  })

  it('400 when the provider rejects the call with a 4xx and 502 on a 5xx', async () => {
    vi.mocked(runAadsAction).mockRejectedValueOnce(Object.assign(new Error('bad request'), { httpStatus: 400 }))
    expect((await post(PAUSE)).status).toBe(400)
    vi.mocked(runAadsAction).mockRejectedValueOnce(Object.assign(new Error('upstream'), { httpStatus: 500 }))
    expect((await post(PAUSE)).status).toBe(502)
  })
})
