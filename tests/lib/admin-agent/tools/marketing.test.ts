import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { MARKETING_TOOLS } from '@/lib/admin-agent/tools/marketing'
import * as db from '@/lib/db'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)

function getTool(name: string) {
  return MARKETING_TOOLS.find(t => t.name === name)!
}

describe('admin-agent/tools/marketing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('MARKETING_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(MARKETING_TOOLS)).toBe(true)
      expect(MARKETING_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of MARKETING_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  describe('list_campaigns', () => {
    it('returns campaigns list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'cam1', name: 'Summer Sale', status: 'active' }])
      const result = await getTool('list_campaigns').handler({}) as any
      expect(Array.isArray(result.campaigns)).toBe(true)
      expect(result.count).toBe(1)
    })
  })

  describe('get_campaign', () => {
    it('returns campaign by kind', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'abandoned_cart', name: 'Summer Sale' })
      const result = await getTool('get_campaign').handler({ kind: 'abandoned_cart' }) as any
      expect(result.kind).toBe('abandoned_cart')
    })

    it('returns error object when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_campaign').handler({ kind: 'bad_kind' }) as any
      expect(result.error).toMatch(/not found/i)
    })
  })

  describe('list_coupons', () => {
    it('returns coupons list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'coup1', code: 'SAVE10', discount_type: 'percentage' }])
      const result = await getTool('list_coupons').handler({}) as any
      expect(Array.isArray(result.coupons)).toBe(true)
      expect(result.count).toBe(1)
    })
  })

  describe('get_coupon', () => {
    it('returns coupon by code', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'coup1', code: 'SAVE10' })
      const result = await getTool('get_coupon').handler({ codeOrId: 'SAVE10' }) as any
      expect(result.code).toBe('SAVE10')
    })

    it('returns error object when coupon not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_coupon').handler({ codeOrId: 'INVALID' }) as any
      expect(result.error).toMatch(/not found/i)
    })
  })

  describe('list_mailer_templates', () => {
    it('returns mailer templates', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'tpl1', name: 'Welcome Email' }])
      const result = await getTool('list_mailer_templates').handler({}) as any
      expect(Array.isArray(result.templates)).toBe(true)
      expect(result.count).toBe(1)
    })
  })

  describe('propose_create_coupon', () => {
    it('proposes percentage discount coupon with valid code', async () => {
      // first queryOne call is the duplicate check — return null (no duplicate)
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'SAVE20',
        discountType: 'percentage',
        discountValue: 20,
        validUntil: '2025-12-31',
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('proposes fixed discount coupon', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'FLAT100',
        discountType: 'fixed',
        discountValue: 100,
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('normalises lowercase coupon code to uppercase and accepts it', async () => {
      // validateCouponCode calls .toUpperCase() before validation, so 'save20' → 'SAVE20'
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'save20',
        discountType: 'percentage',
        discountValue: 20,
      }) as any
      expect(result.proposed).toBe(true)
      expect(result.payload.code).toBe('SAVE20')
    })

    it('rejects coupon code that is too short', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'AB',
          discountType: 'fixed',
          discountValue: 10,
        })
      ).rejects.toThrow()
    })

    it('rejects coupon code that is too long (>30)', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'A'.repeat(31),
          discountType: 'fixed',
          discountValue: 10,
        })
      ).rejects.toThrow()
    })

    it('rejects percentage > 100', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'OVER100',
          discountType: 'percentage',
          discountValue: 150,
        })
      ).rejects.toThrow()
    })

    it('rejects percentage < 1', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'ZERO',
          discountType: 'percentage',
          discountValue: 0,
        })
      ).rejects.toThrow()
    })

    it('rejects fixed discount > 1000000', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'HUGE',
          discountType: 'fixed',
          discountValue: 2000000,
        })
      ).rejects.toThrow()
    })

    it('rejects fixed discount < 1', async () => {
      await expect(
        getTool('propose_create_coupon').handler({
          code: 'ZERO',
          discountType: 'fixed',
          discountValue: 0,
        })
      ).rejects.toThrow()
    })

    it('accepts coupon code with hyphens', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'SAVE-20-NOW',
        discountType: 'percentage',
        discountValue: 20,
      }) as any
      expect(result.proposed).toBe(true)
    })
  })

  describe('propose_update_campaign_template', () => {
    it('proposes template update', async () => {
      mockQueryOne.mockResolvedValueOnce({
        kind: 'abandoned_cart',
        name: 'Summer Sale',
        subject_template: 'Old Subject',
        body_template: 'Old Body',
      })
      const result = await getTool('propose_update_campaign_template').handler({
        kind: 'abandoned_cart',
        newSubject: 'New Subject',
        newBody: 'New Body',
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('returns error when campaign not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_update_campaign_template').handler({
          kind: 'bad_kind',
          newSubject: 'New Subject',
        })
      ).rejects.toThrow(/unknown campaign/i)
    })
  })

  describe('propose_send_mailer_broadcast', () => {
    it('proposes broadcast to all_opted_in subscribers', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 2 })

      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in',
        subject: 'Big Sale',
        body: '<p>Details</p>',
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('handles test_only:email audience syntax', async () => {
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'test_only:admin@example.com',
        subject: 'Test Subject',
        body: '<p>Test body</p>',
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('throws when audience is invalid', async () => {
      await expect(
        getTool('propose_send_mailer_broadcast').handler({
          audience: 'all',
          subject: 'Big Sale',
          body: '<p>Details</p>',
        })
      ).rejects.toThrow(/audience/i)
    })
  })

  describe('propose_generate_personalized_coupon', () => {
    it('proposes personalized coupon for customer', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith', marketing_opt_out: false })

      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u1',
        discountType: 'percentage',
        discountValue: 15,
        daysValid: 30,
      }) as any
      expect(result.proposed).toBe(true)
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_generate_personalized_coupon').handler({
          userId: 'bad-uuid-000',
          discountType: 'fixed',
          discountValue: 50,
        })
      ).rejects.toThrow(/not found/i)
    })
  })
})
