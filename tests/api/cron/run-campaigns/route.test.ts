import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/campaigns/runner', () => ({ runScenario: vi.fn() }))
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({ getScenario: vi.fn() }))
vi.mock('@/lib/campaigns/custom-runner', () => ({ runCustomScenario: vi.fn() }))
vi.mock('@/lib/shared/marketing', () => ({ getCampaign: vi.fn() }))

import { GET } from '@/app/api/cron/run-campaigns/route'
import { queryMany, queryOne } from '@/lib/shared/db'
import { runScenario } from '@/lib/campaigns/runner'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { runCustomScenario } from '@/lib/campaigns/custom-runner'
import { getCampaign } from '@/lib/shared/marketing'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockRunScenario = vi.mocked(runScenario)
const mockGetScenario = vi.mocked(getScenario)
const mockRunCustom = vi.mocked(runCustomScenario)
const mockGetCampaign = vi.mocked(getCampaign)

function makeRequest(auth?: string, kind?: string) {
  const url = `http://localhost/api/cron/run-campaigns${kind ? `?kind=${kind}` : ''}`
  return new NextRequest(url, {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/run-campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 401 without auth', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeRequest('Bearer wrong') as any)
    expect(res.status).toBe(401)
  })

  it('returns success with no campaigns', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.totalSent).toBe(0)
  })

  it('runs builtin scenario', async () => {
    mockQueryMany.mockResolvedValueOnce([{ kind: 'welcome', scenario_kind: 'welcome_email', enabled: true }])
    const fakeScenario = { kind: 'welcome_email' }
    mockGetScenario.mockReturnValueOnce(fakeScenario as any)
    mockRunScenario.mockResolvedValueOnce({ sent: 5, errors: [] } as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.totalSent).toBe(5)
    expect(mockRunScenario).toHaveBeenCalledWith(fakeScenario, 'welcome')
  })

  it('runs custom scenario when builtin not found', async () => {
    mockQueryMany.mockResolvedValueOnce([{ kind: 'promo', scenario_kind: 'custom_promo', enabled: true }])
    mockGetScenario.mockReturnValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ enabled: true })
    mockGetCampaign.mockResolvedValueOnce({ id: 'camp1' } as any)
    mockRunCustom.mockResolvedValueOnce({ sent: 3, errors: [] } as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.totalSent).toBe(3)
    expect(mockRunCustom).toHaveBeenCalledWith('custom_promo', { id: 'camp1' })
  })

  it('skips custom scenario when not enabled', async () => {
    mockQueryMany.mockResolvedValueOnce([{ kind: 'promo', scenario_kind: 'custom_promo', enabled: true }])
    mockGetScenario.mockReturnValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ enabled: false })

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.totalSent).toBe(0)
    expect(mockRunCustom).not.toHaveBeenCalled()
  })

  it('filters by kind param', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { kind: 'welcome', scenario_kind: null, enabled: true },
      { kind: 'promo', scenario_kind: null, enabled: true },
    ])
    mockGetScenario.mockReturnValueOnce({ kind: 'welcome' } as any)
    mockRunScenario.mockResolvedValueOnce({ sent: 2, errors: [] } as any)

    const res = await GET(makeRequest('Bearer test-cron-secret', 'welcome') as any)
    const json = await res.json()
    expect(json.totalSent).toBe(2)
    expect(mockRunScenario).toHaveBeenCalledTimes(1)
  })

  it('returns 500 on thrown error', async () => {
    mockQueryMany.mockResolvedValueOnce([{ kind: 'x', scenario_kind: null, enabled: true }])
    mockGetScenario.mockReturnValueOnce({ kind: 'x' } as any)
    mockRunScenario.mockRejectedValueOnce(new Error('scenario error'))

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('scenario error')
  })
})
