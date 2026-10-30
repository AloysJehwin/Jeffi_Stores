import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({ getScenario: vi.fn() }))
vi.mock('@/lib/campaigns/runner', () => ({ runScenario: vi.fn() }))
vi.mock('@/lib/campaigns/custom-runner', () => ({ runCustomScenario: vi.fn() }))
vi.mock('@/lib/shared/marketing', () => ({ getCampaign: vi.fn() }))

import { POST } from '@controller/app/api/(admin)/admin/campaigns/[kind]/run/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { runScenario } from '@/lib/campaigns/runner'
import { runCustomScenario } from '@/lib/campaigns/custom-runner'
import { getCampaign } from '@/lib/shared/marketing'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockGetScenario = vi.mocked(getScenario)
const mockRunScenario = vi.mocked(runScenario)
const mockRunCustom = vi.mocked(runCustomScenario)
const mockGetCampaign = vi.mocked(getCampaign)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }

function makeRequest(kind = 'welcome') {
  return new NextRequest(`http://localhost/api/admin/campaigns/${kind}/run`, { method: 'POST' })
}
function paramsFor(kind: string) {
  return { params: Promise.resolve({ kind }) }
}

describe('POST /api/admin/campaigns/[kind]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when the campaign does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when the campaign is disabled', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: null, enabled: false } as any)
    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/enable/i)
  })

  it('runs a builtin scenario in-process and returns totalSent', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: null, enabled: true } as any)
    mockGetScenario.mockReturnValue({ kind: 'welcome' } as any)
    mockRunScenario.mockResolvedValue({ campaign: 'welcome', attempted: 3, sent: 3, skipped: 0 } as any)

    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.totalSent).toBe(3)
    expect(mockRunScenario).toHaveBeenCalledWith(expect.anything(), 'welcome')
  })

  it('uses scenario_kind to resolve the scenario when set', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: 'abandoned_cart', enabled: true } as any)
    mockGetScenario.mockReturnValue({ kind: 'abandoned_cart' } as any)
    mockRunScenario.mockResolvedValue({ campaign: 'promo', attempted: 1, sent: 1, skipped: 0 } as any)

    await POST(makeRequest('promo'), paramsFor('promo'))
    expect(mockGetScenario).toHaveBeenCalledWith('abandoned_cart')
    // the campaign kind (not the scenario kind) is passed to runScenario
    expect(mockRunScenario).toHaveBeenCalledWith(expect.anything(), 'promo')
  })

  it('falls back to a custom scenario when no builtin matches', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ scenario_kind: 'my_custom', enabled: true } as any) // campaign row
      .mockResolvedValueOnce({ enabled: true } as any) // custom_scenarios row
    mockGetScenario.mockReturnValue(undefined as any)
    mockGetCampaign.mockResolvedValue({ kind: 'welcome' } as any)
    mockRunCustom.mockResolvedValue({ campaign: 'welcome', attempted: 2, sent: 2, skipped: 0 } as any)

    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(200)
    expect((await res.json()).totalSent).toBe(2)
    expect(mockRunCustom).toHaveBeenCalledWith('my_custom', expect.anything())
  })

  it('returns 400 when there is no runnable scenario', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: 'unknown', enabled: true } as any).mockResolvedValueOnce(null) // no custom scenario
    mockGetScenario.mockReturnValue(undefined as any)
    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(400)
  })

  it('returns 500 with the sweep error when the scenario reports one', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: null, enabled: true } as any)
    mockGetScenario.mockReturnValue({ kind: 'welcome' } as any)
    mockRunScenario.mockResolvedValue({ campaign: 'welcome', attempted: 0, sent: 0, skipped: 0, error: 'boom' } as any)

    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })

  it('returns 500 when the runner throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: null, enabled: true } as any)
    mockGetScenario.mockReturnValue({ kind: 'welcome' } as any)
    mockRunScenario.mockRejectedValue(new Error('db down'))

    const res = await POST(makeRequest(), paramsFor('welcome'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
