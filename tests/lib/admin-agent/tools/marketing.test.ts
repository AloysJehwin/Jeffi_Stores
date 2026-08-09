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

    it('throws when customer has no email', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u2', email: null, first_name: 'Bob', last_name: null, marketing_opt_out: false })
      await expect(
        getTool('propose_generate_personalized_coupon').handler({
          userId: 'u2',
          discountType: 'percentage',
          discountValue: 10,
        })
      ).rejects.toThrow(/no email/i)
    })

    it('shows warn callout when customer is opted out of marketing', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u3', email: 'optout@test.com', first_name: 'Eve', last_name: null, marketing_opt_out: true })
      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u3',
        discountType: 'fixed',
        discountValue: 200,
        daysValid: 7,
      }) as any
      expect(result.proposed).toBe(true)
      const warnBlock = result.ui_blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toMatch(/opted out/i)
    })

    it('falls back to email as customer name when first/last name are absent', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u4', email: 'noname@test.com', first_name: null, last_name: null, marketing_opt_out: false })
      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u4',
        discountType: 'percentage',
        discountValue: 5,
      }) as any
      expect(result.payload.customerName).toBe('noname@test.com')
    })

    it('clamps daysValid to 1 when given 0', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u5', email: 'e@t.com', first_name: 'A', last_name: 'B', marketing_opt_out: false })
      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u5',
        discountType: 'percentage',
        discountValue: 10,
        daysValid: 0,
      }) as any
      expect(result.payload.daysValid).toBe(1)
    })

    it('formats fixed discount as rupee amount in confirmation', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u6', email: 'g@t.com', first_name: 'G', last_name: 'H', marketing_opt_out: false })
      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u6',
        discountType: 'fixed',
        discountValue: 500,
      }) as any
      expect(result.confirmation).toContain('₹500')
    })

    it('sanitises campaign string replacing special chars with underscores', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u7', email: 'h@t.com', first_name: 'H', last_name: null, marketing_opt_out: false })
      const result = await getTool('propose_generate_personalized_coupon').handler({
        userId: 'u7',
        discountType: 'percentage',
        discountValue: 20,
        campaign: 'winback-90!',
      }) as any
      expect(result.payload.campaign).toMatch(/^[a-z0-9_]+$/)
    })
  })

  // --- list_campaigns: filter branches ---
  describe('list_campaigns — filter branches', () => {
    it('applies enabledOnly filter when set to string "true"', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_campaigns').handler({ enabledOnly: 'true' }) as any
      expect(result.campaigns).toEqual([])
    })

    it('applies kind filter when kind is provided', async () => {
      mockQueryMany.mockResolvedValueOnce([{ kind: 'winback', name: 'Winback' }])
      const result = await getTool('list_campaigns').handler({ kind: 'winback' }) as any
      expect(result.count).toBe(1)
    })

    it('applies both enabledOnly and kind filters together', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_campaigns').handler({ enabledOnly: true, kind: 'cart' }) as any
      expect(result.campaigns).toEqual([])
    })

    it('returns empty list when no campaigns match', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_campaigns').handler({ enabledOnly: true }) as any
      expect(result.count).toBe(0)
    })
  })

  // --- get_campaign: validation ---
  describe('get_campaign — validation', () => {
    it('throws when kind is empty string', async () => {
      await expect(getTool('get_campaign').handler({ kind: '' })).rejects.toThrow(/kind is required/i)
    })

    it('throws when kind is missing', async () => {
      await expect(getTool('get_campaign').handler({})).rejects.toThrow(/kind is required/i)
    })
  })

  // --- list_coupons: filter branches ---
  describe('list_coupons — filter branches', () => {
    it('applies activeOnly=false to show all coupons', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
      const result = await getTool('list_coupons').handler({ activeOnly: false }) as any
      expect(result.count).toBe(2)
    })

    it('applies autoGeneratedOnly=true', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'c3', auto_generated: true }])
      const result = await getTool('list_coupons').handler({ autoGeneratedOnly: true }) as any
      expect(result.coupons[0].auto_generated).toBe(true)
    })

    it('sets truncated=true when result length equals limit', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_coupons').handler({ limit: 5 }) as any
      expect(result.truncated).toBe(true)
    })
  })

  // --- get_coupon: UUID vs code lookup ---
  describe('get_coupon — UUID vs code lookup', () => {
    it('looks up by UUID when codeOrId is a valid UUID', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'c1', code: 'AUTO123' })
      const result = await getTool('get_coupon').handler({ codeOrId: '550e8400-e29b-41d4-a716-446655440001' }) as any
      expect(result.code).toBe('AUTO123')
    })

    it('throws when codeOrId is empty', async () => {
      await expect(getTool('get_coupon').handler({ codeOrId: '' })).rejects.toThrow(/codeOrId is required/i)
    })
  })

  // --- list_mailer_templates: limit clamping ---
  describe('list_mailer_templates — limit', () => {
    it('clamps limit to max 50', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_mailer_templates').handler({ limit: 999 }) as any
      expect(result.count).toBe(0)
    })
  })

  // --- propose_create_coupon: additional branches ---
  describe('propose_create_coupon — additional branches', () => {
    it('throws when coupon code already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing' })
      await expect(
        getTool('propose_create_coupon').handler({ code: 'SAVE20', discountType: 'percentage', discountValue: 20 })
      ).rejects.toThrow(/already exists/i)
    })

    it('throws on invalid discountType', async () => {
      await expect(
        getTool('propose_create_coupon').handler({ code: 'CODE1', discountType: 'bogus', discountValue: 10 })
      ).rejects.toThrow(/discountType/i)
    })

    it('throws when validUntil is not a valid date', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_create_coupon').handler({ code: 'GOOD1', discountType: 'percentage', discountValue: 10, validUntil: 'not-a-date' })
      ).rejects.toThrow()
    })

    it('omits expiry in confirmation when validUntil is not provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'NOEXP1', discountType: 'fixed', discountValue: 50,
      }) as any
      expect(result.confirmation).not.toContain('expires')
    })

    it('sets minPurchaseAmount and usageLimit in payload when provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_coupon').handler({
        code: 'FULL10', discountType: 'percentage', discountValue: 10,
        minPurchaseAmount: 500, usageLimit: 100, description: 'Test coupon',
      }) as any
      expect(result.payload.minPurchaseAmount).toBe(500)
      expect(result.payload.usageLimit).toBe(100)
      expect(result.payload.description).toBe('Test coupon')
    })

    it('rejects coupon code with leading dash', async () => {
      await expect(
        getTool('propose_create_coupon').handler({ code: '-INVALID', discountType: 'fixed', discountValue: 10 })
      ).rejects.toThrow()
    })
  })

  // --- propose_update_campaign_template: body-length branches ---
  describe('propose_update_campaign_template — body change branches', () => {
    it('throws when kind is empty', async () => {
      await expect(getTool('propose_update_campaign_template').handler({ kind: '' })).rejects.toThrow(/kind is required/i)
    })

    it('throws when neither newSubject nor newBody is provided', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: 'B' })
      await expect(
        getTool('propose_update_campaign_template').handler({ kind: 'cart' })
      ).rejects.toThrow(/newSubject.*newBody/i)
    })

    it('throws when newSubject is empty string', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: 'B' })
      await expect(
        getTool('propose_update_campaign_template').handler({ kind: 'cart', newSubject: '' })
      ).rejects.toThrow(/newSubject/i)
    })

    it('throws when newSubject exceeds 500 chars', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: 'B' })
      await expect(
        getTool('propose_update_campaign_template').handler({ kind: 'cart', newSubject: 'A'.repeat(501) })
      ).rejects.toThrow(/newSubject/i)
    })

    it('throws when newBody exceeds 50000 chars', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: 'B' })
      await expect(
        getTool('propose_update_campaign_template').handler({ kind: 'cart', newBody: 'X'.repeat(50001) })
      ).rejects.toThrow(/newBody/i)
    })

    it('adds large-body-change warning callout when diff > 50%', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: 'A'.repeat(10) })
      const result = await getTool('propose_update_campaign_template').handler({
        kind: 'cart', newBody: 'B'.repeat(100),
      }) as any
      expect(result.proposed).toBe(true)
      const warnBlock = result.ui_blocks.find((b: any) => b.tone === 'warn')
      expect(warnBlock).toBeDefined()
      expect(warnBlock.title).toMatch(/large body rewrite/i)
    })

    it('adds subject table rows when newSubject is provided', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'Old', body_template: 'Body' })
      const result = await getTool('propose_update_campaign_template').handler({
        kind: 'cart', newSubject: 'New Subject',
      }) as any
      expect(result.proposed).toBe(true)
      const tableBlock = result.ui_blocks.find((b: any) => b.type === 'table')
      expect(tableBlock).toBeDefined()
      expect(tableBlock.rows.some((r: any) => r[1] === 'New Subject')).toBe(true)
    })

    it('handles empty original body_template (oldLen treated as 0)', async () => {
      mockQueryOne.mockResolvedValueOnce({ kind: 'cart', name: 'Cart', subject_template: 'S', body_template: null })
      const result = await getTool('propose_update_campaign_template').handler({
        kind: 'cart', newBody: 'Some new body',
      }) as any
      expect(result.proposed).toBe(true)
    })
  })

  // --- propose_send_mailer_broadcast: additional branches ---
  describe('propose_send_mailer_broadcast — additional branches', () => {
    it('proposes broadcast to recent_buyers audience', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 15 })
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'recent_buyers', subject: 'Flash Sale', body: '<p>Sale!</p>',
      }) as any
      expect(result.proposed).toBe(true)
      expect(result.payload.audience).toBe('recent_buyers')
      expect(result.payload.audienceCount).toBe(15)
    })

    it('proposes test_only broadcast using testEmail param', async () => {
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'test_only', testEmail: 'admin@example.com', subject: 'Test', body: '<p>Test</p>',
      }) as any
      expect(result.proposed).toBe(true)
      expect(result.payload.testEmail).toBe('admin@example.com')
      expect(result.payload.audienceCount).toBe(1)
    })

    it('throws when audience=test_only and testEmail has no @', async () => {
      await expect(
        getTool('propose_send_mailer_broadcast').handler({ audience: 'test_only', testEmail: 'notanemail', subject: 'T', body: '<p>T</p>' })
      ).rejects.toThrow(/testEmail/i)
    })

    it('throws when audience=test_only: colon form has no valid email', async () => {
      await expect(
        getTool('propose_send_mailer_broadcast').handler({ audience: 'test_only:bademail', subject: 'T', body: '<p>T</p>' })
      ).rejects.toThrow(/test_only audience needs a valid email/i)
    })

    it('throws when subject is empty', async () => {
      await expect(
        getTool('propose_send_mailer_broadcast').handler({ audience: 'all_opted_in', subject: '', body: '<p>body</p>' })
      ).rejects.toThrow(/subject/i)
    })

    it('throws when body is empty', async () => {
      await expect(
        getTool('propose_send_mailer_broadcast').handler({ audience: 'all_opted_in', subject: 'Hi', body: '' })
      ).rejects.toThrow(/body/i)
    })

    it('uses "Jeffi Stores" as default from name', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 5 })
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in', subject: 'Sale', body: '<p>Go</p>',
      }) as any
      expect(result.payload.fromName).toBe('Jeffi Stores')
    })

    it('uses custom from name when provided', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 5 })
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in', subject: 'Sale', body: '<p>Go</p>', fromName: 'Jeffi Team',
      }) as any
      expect(result.payload.fromName).toBe('Jeffi Team')
    })

    it('truncates body preview in code_block when body > 500 chars', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 1 })
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in', subject: 'Hi', body: '<p>' + 'X'.repeat(600) + '</p>',
      }) as any
      const codeBlock = result.ui_blocks.find((b: any) => b.type === 'code_block')
      expect(codeBlock.content).toContain('(truncated)')
    })

    it('returns audienceCount=0 when all_opted_in query returns null', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in', subject: 'Hi', body: '<p>body</p>',
      }) as any
      expect(result.payload.audienceCount).toBe(0)
    })

    it('uses singular "recipient" in confirmation when count=1', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 1 })
      const result = await getTool('propose_send_mailer_broadcast').handler({
        audience: 'all_opted_in', subject: 'Hi', body: '<p>body</p>',
      }) as any
      expect(result.confirmation).toContain('1 recipient (all_opted_in)')
    })
  })
})
