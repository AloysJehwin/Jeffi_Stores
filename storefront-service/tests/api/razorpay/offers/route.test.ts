import { describe, it, expect, vi } from 'vitest'

const getPublicOffers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/razorpay-offers', () => ({ getPublicOffers }))

import { GET } from '@storefront/app/api/(public)/razorpay/offers/route'

describe('GET /api/razorpay/offers', () => {
  it('returns the account offers', async () => {
    getPublicOffers.mockResolvedValue([{ id: 'offer_1', name: '10% off' }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ offers: [{ id: 'offer_1', name: '10% off' }] })
  })

  it('returns an empty list when there are none', async () => {
    getPublicOffers.mockResolvedValue([])
    expect(await (await GET()).json()).toEqual({ offers: [] })
  })

  it('surfaces an unexpected failure', async () => {
    getPublicOffers.mockRejectedValue(new Error('rzp down'))
    await expect(GET()).rejects.toThrow('rzp down')
  })
})
