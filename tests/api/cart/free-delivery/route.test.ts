import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shipping/delivery-settings', () => ({
  getDeliverySettings: vi.fn(),
}))

import { GET } from '@/app/api/(public)/cart/free-delivery/route'
import { getDeliverySettings } from '@/lib/shipping/delivery-settings'

const mockSettings = vi.mocked(getDeliverySettings)

function settings(
  overrides: Partial<{ enabled: boolean; freeThreshold: number; ratePerKg: number; freeWeightCeilingKg: number }> = {}
) {
  return { enabled: true, freeThreshold: 999, ratePerKg: 0, freeWeightCeilingKg: 5, ...overrides }
}

describe('GET /api/cart/free-delivery', () => {
  beforeEach(() => {
    mockSettings.mockResolvedValue(settings())
  })

  it('returns the checkout free-delivery threshold and weight ceiling', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ freeThreshold: 999, weightLimitKg: 5 })
  })

  it('returns 0 when delivery charges are switched off, since every order already ships free', async () => {
    mockSettings.mockResolvedValue(settings({ enabled: false }))
    const body = await (await GET()).json()
    expect(body.freeThreshold).toBe(0)
  })

  it('returns 0 when no threshold is configured', async () => {
    mockSettings.mockResolvedValue(settings({ freeThreshold: 0 }))
    const body = await (await GET()).json()
    expect(body.freeThreshold).toBe(0)
  })

  it('falls back to the 3 kg ceiling checkout uses when none is set', async () => {
    mockSettings.mockResolvedValue(settings({ freeWeightCeilingKg: 0 }))
    const body = await (await GET()).json()
    expect(body.weightLimitKg).toBe(3)
  })

  it('exposes only the two fields the progress bar needs and is not cached', async () => {
    const res = await GET()
    expect(Object.keys(await res.json()).sort()).toEqual(['freeThreshold', 'weightLimitKg'])
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
