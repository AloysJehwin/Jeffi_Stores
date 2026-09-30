import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))

import { abandonedCheckout } from '@/lib/campaigns/scenarios/abandoned-checkout'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockResolveCoupon = resolveCoupon as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'abandoned_checkout',
  enabled: true,
  name: 'Abandoned Checkout',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = abandonedCheckout.defaultParams

describe('abandonedCheckout scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct kind', () => {
    expect(abandonedCheckout.kind).toBe('abandoned_checkout')
  })

  it('has defaultParams with expected values', () => {
    expect(defaultParams.minMinutesAfterCancel).toBe(15)
    expect(defaultParams.autoCancelMaxMinutes).toBe(15)
    expect(defaultParams.sendCooldownDays).toBe(1)
    expect(defaultParams.maxRecipientsPerSweep).toBe(50)
  })

  it('has a paramSchema', () => {
    expect(abandonedCheckout.paramSchema).toBeDefined()
    expect(abandonedCheckout.paramSchema.minMinutesAfterCancel).toBeDefined()
    expect(abandonedCheckout.paramSchema.sendCooldownDays).toBeDefined()
  })

  describe('findEligible', () => {
    it('calls queryMany and returns rows', async () => {
      const row = { id: 'o1', user_id: 'u1', order_number: 'ORD-001', total_amount: '599.00' }
      mockQueryMany.mockResolvedValue([row])
      const rows = await abandonedCheckout.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual(row)
    })

    it('passes 6 parameters to queryMany', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCheckout.findEligible({ campaign, params: defaultParams })
      const [, params] = mockQueryMany.mock.calls[0]
      expect(params).toHaveLength(6)
      expect(params[0]).toBe('abandoned_checkout')
    })
  })

  describe('findSuppressed', () => {
    it('returns mapped suppressed rows', async () => {
      const row = {
        id: 'o1',
        user_id: 'u1',
        order_number: 'ORD-001',
        total_amount: '599.00',
        reason: 'cooldown',
        reason_detail: 'Sent 01 Jan 10:00',
        blocked_until: '2024-01-08T10:00:00Z',
      }
      mockQueryMany.mockResolvedValue([row])
      const suppressed = await abandonedCheckout.findSuppressed!({ campaign, params: defaultParams })
      expect(suppressed).toHaveLength(1)
      expect(suppressed[0].user_id).toBe('u1')
      expect(suppressed[0].reason).toBe('cooldown')
      expect(suppressed[0].raw).toHaveProperty('order_number', 'ORD-001')
    })

    it('returns empty array when no suppressed rows', async () => {
      mockQueryMany.mockResolvedValue([])
      const suppressed = await abandonedCheckout.findSuppressed!({ campaign, params: defaultParams })
      expect(suppressed).toEqual([])
    })
  })

  describe('send', () => {
    it('returns no_user when fetchUserContext returns null', async () => {
      mockFetchUser.mockResolvedValue(null)
      const result = await abandonedCheckout.send(
        { id: 'o1', user_id: 'u1', order_number: 'ORD-001', total_amount: '599.00' },
        { campaign, params: defaultParams }
      )
      expect(result).toEqual({ ok: false, reason: 'no_user' })
    })

    it('sends email and returns ok=true', async () => {
      mockFetchUser.mockResolvedValue({ id: 'u1', first_name: 'Alice', email: 'a@x.com' })
      mockQueryMany.mockResolvedValue([
        { name: 'Bolt M6', quantity: 2, unit_price: 50, product_slug: 'bolt-m6', image_url: 'img.jpg' },
      ])
      mockResolveCoupon.mockResolvedValue({ couponCode: 'SAVE5', discountPercent: 5 })
      mockSendEmail.mockResolvedValue({ ok: true })

      const result = await abandonedCheckout.send(
        { id: 'o1', user_id: 'u1', order_number: 'ORD-001', total_amount: '599.00' },
        { campaign, params: defaultParams }
      )
      expect(result.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
    })

    it('passes correct vars to sendCampaignEmail', async () => {
      mockFetchUser.mockResolvedValue({ id: 'u1', first_name: null, email: 'u@x.com' })
      mockQueryMany.mockResolvedValue([])
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockSendEmail.mockResolvedValue({ ok: true })

      await abandonedCheckout.send(
        { id: 'o1', user_id: 'u1', order_number: 'ORD-999', total_amount: '1200.00' },
        { campaign, params: defaultParams }
      )
      const call = mockSendEmail.mock.calls[0][0]
      expect(call.vars.firstName).toBe('there')
      expect(call.vars.orderNumber).toBe('ORD-999')
      expect(call.vars.total).toBe('1200.00')
      expect(call.vars.ctaUrl).toContain('/cart')
    })

    it('formats total with 2 decimal places', async () => {
      mockFetchUser.mockResolvedValue({ id: 'u1', first_name: 'X', email: 'x@x.com' })
      mockQueryMany.mockResolvedValue([])
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockSendEmail.mockResolvedValue({ ok: true })

      await abandonedCheckout.send(
        { id: 'o1', user_id: 'u1', order_number: 'ORD-1', total_amount: '500' },
        { campaign, params: defaultParams }
      )
      const call = mockSendEmail.mock.calls[0][0]
      expect(call.vars.total).toBe('500.00')
    })
  })
})
