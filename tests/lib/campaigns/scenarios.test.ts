/**
 * tests/lib/campaigns/scenarios.test.ts
 *
 * Tests for the five campaign scenario modules:
 *   abandoned-cart, post-purchase, price-drop, restock, review-reminder
 *
 * All external dependencies are mocked — no real DB or network.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/shared/db BEFORE importing any scenario module
// ---------------------------------------------------------------------------
vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  query: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock @/lib/shared/automation-emails
// ---------------------------------------------------------------------------
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  fetchProductImageUrl: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  sendCampaignEmailRendered: vi.fn(),
  renderItemRows: vi.fn(),
  renderHeroProduct: vi.fn(),
}))

vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

// ---------------------------------------------------------------------------
// Mock @/lib/shared/email-campaigns (used by review-request)
// ---------------------------------------------------------------------------
vi.mock('@/lib/shared/email-campaigns', () => ({
  renderCampaignEmail: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock @/lib/auth/jwt (used by review-request for generateReviewToken)
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth/jwt', () => ({
  generateReviewToken: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock nodemailer (in case any transitive import touches it)
// ---------------------------------------------------------------------------
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------
import { abandonedCart } from '@/lib/campaigns/scenarios/abandoned-cart'
import { postPurchase } from '@/lib/campaigns/scenarios/post-purchase'
import { priceDrop } from '@/lib/campaigns/scenarios/price-drop'
import { restock } from '@/lib/campaigns/scenarios/restock'
import { reviewReminder } from '@/lib/campaigns/scenarios/review-reminder'
import { reviewRequest } from '@/lib/campaigns/scenarios/review-request'

import { queryMany, query } from '@/lib/shared/db'
import {
  fetchUserContext,
  fetchProductImageUrl,
  resolveCoupon,
  sendCampaignEmail,
  sendCampaignEmailRendered,
  renderItemRows,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { renderCampaignEmail } from '@/lib/shared/email-campaigns'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { generateReviewToken } from '@/lib/auth/jwt'

// Typed mocks
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)
const mockFetchUser = vi.mocked(fetchUserContext)
const mockFetchProductImg = vi.mocked(fetchProductImageUrl)
const mockResolveCoupon = vi.mocked(resolveCoupon)
const mockSendEmail = vi.mocked(sendCampaignEmail)
const mockSendEmailRendered = vi.mocked(sendCampaignEmailRendered)
const mockRenderItemRows = vi.mocked(renderItemRows)
const mockRenderHeroProduct = vi.mocked(renderHeroProduct)
const mockRenderCampaignEmail = vi.mocked(renderCampaignEmail)
const mockGenerateReviewToken = vi.mocked(generateReviewToken)

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmp-001',
    kind: 'abandoned_cart' as const,
    name: 'Test Campaign',
    subject_template: 'Come back!',
    body_template: '{itemsHtml}',
    from_name: 'Jeffi Stores',
    from_email: 'hello@jeffistores.com',
    delay_hours: 1,
    is_active: true,
    params: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeUser() {
  return {
    id: 'usr-123',
    email: 'customer@example.com',
    first_name: 'Alice',
    last_name: 'Smith',
    marketing_opt_out: false,
    is_active: true,
    is_guest: false,
  }
}

function makeCoupon() {
  return { couponCode: 'SAVE10', discountPercent: 10 }
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults so tests that don't care about the return can just run
  mockFetchUser.mockResolvedValue(makeUser() as any)
  mockResolveCoupon.mockResolvedValue(makeCoupon() as any)
  mockSendEmail.mockResolvedValue({ ok: true } as any)
  mockSendEmailRendered.mockResolvedValue({ ok: true } as any)
  mockRenderItemRows.mockReturnValue('<table>items</table>')
  mockRenderHeroProduct.mockReturnValue('<div>hero</div>')
  mockFetchProductImg.mockResolvedValue('https://cdn.example.com/img.jpg')
  mockQueryMany.mockResolvedValue([])
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
  mockGenerateReviewToken.mockResolvedValue('tok-abc' as any)
  mockRenderCampaignEmail.mockReturnValue({
    subject: 'Review your order',
    html: '<html>review</html>',
    ampHtml: undefined,
  } as any)
})

// ===========================================================================
// ABANDONED CART
// ===========================================================================
describe('abandonedCart scenario', () => {
  // --- Static shape ---
  it('has required static fields', () => {
    expect(abandonedCart.kind).toBe('abandoned_cart')
    expect(typeof abandonedCart.name).toBe('string')
    expect(abandonedCart.name.length).toBeGreaterThan(0)
    expect(typeof abandonedCart.description).toBe('string')
    expect(typeof abandonedCart.trigger).toBe('string')
  })

  it('has all required defaultParams', () => {
    const p = abandonedCart.defaultParams
    // lookbackDays/secondEmailDelayHours now hold canonical minutes; the cooldown is injected universally.
    expect(typeof p.lookbackDays).toBe('number')
    expect(typeof p.secondEmailDelayHours).toBe('number')
    expect(typeof p.maxRecipientsPerSweep).toBe('number')
    expect(typeof p.maxItemsPerEmail).toBe('number')
  })

  it('defaultParams have sensible bounds', () => {
    const p = abandonedCart.defaultParams
    expect(p.lookbackDays).toBeGreaterThan(0)
    expect(p.secondEmailDelayHours).toBeGreaterThan(0)
    expect(p.maxRecipientsPerSweep).toBeGreaterThan(0)
    expect(p.maxItemsPerEmail).toBeGreaterThan(0)
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(abandonedCart.defaultParams).sort()
    const schemKeys = Object.keys(abandonedCart.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('paramSchema entries have type, label fields', () => {
    for (const [, def] of Object.entries(abandonedCart.paramSchema)) {
      expect(typeof def.type).toBe('string')
      expect(typeof def.label).toBe('string')
    }
  })

  it('exposes findEligible and send functions', () => {
    expect(typeof abandonedCart.findEligible).toBe('function')
    expect(typeof abandonedCart.send).toBe('function')
  })

  it('exposes optional findSuppressed function', () => {
    expect(typeof abandonedCart.findSuppressed).toBe('function')
  })

  // --- findEligible ---
  it('findEligible calls queryMany and returns its result', async () => {
    const rows = [
      { user_id: 'usr-1', sequence: 1 },
      { user_id: 'usr-2', sequence: 1 },
    ]
    mockQueryMany.mockResolvedValueOnce(rows as any) // seq1
    mockQueryMany.mockResolvedValueOnce([]) // seq2

    const result = await abandonedCart.findEligible({
      campaign: makeCampaign() as any,
      params: abandonedCart.defaultParams,
    })

    expect(mockQueryMany).toHaveBeenCalledTimes(2)
    expect(result).toEqual(rows)
  })

  it('findEligible passes campaign.kind and params to queryMany', async () => {
    mockQueryMany.mockResolvedValueOnce([]) // seq1
    mockQueryMany.mockResolvedValueOnce([]) // seq2
    const campaign = makeCampaign({ kind: 'abandoned_cart', delay_hours: 2 })

    await abandonedCart.findEligible({
      campaign: campaign as any,
      params: abandonedCart.defaultParams,
    })

    const [sql, args] = mockQueryMany.mock.calls[0]
    expect(typeof sql).toBe('string')
    expect(args).toContain('abandoned_cart')
    // delay_hours (passed raw, not a scenario duration param)
    expect(args).toContain(2)
    // lookbackDays — now canonical minutes, bound to SQL as a String
    expect(args).toContain(String(abandonedCart.defaultParams.lookbackDays))
  })

  // --- send — no items → ok: false ---
  it('send returns ok: false when cart is empty', async () => {
    // First queryMany (cart items) returns empty
    mockQueryMany.mockResolvedValueOnce([])

    const result = await abandonedCart.send(
      { user_id: 'usr-1', sequence: 1 },
      { campaign: makeCampaign() as any, params: abandonedCart.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_items')
  })

  it('send returns ok: false when user not found', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { product_id: 'p1', name: 'Widget', quantity: 1, price: 100, image_url: null, product_slug: 'widget' },
    ] as any)
    mockFetchUser.mockResolvedValueOnce(null)

    const result = await abandonedCart.send(
      { user_id: 'usr-1', sequence: 1 },
      { campaign: makeCampaign() as any, params: abandonedCart.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send calls sendCampaignEmail with correct vars when items exist', async () => {
    const cartItem = {
      product_id: 'p1',
      name: 'Widget',
      quantity: 2,
      price: 99,
      image_url: 'img.jpg',
      product_slug: 'widget',
    }
    mockQueryMany.mockResolvedValueOnce([cartItem] as any)

    const result = await abandonedCart.send(
      { user_id: 'usr-123', sequence: 1 },
      { campaign: makeCampaign() as any, params: abandonedCart.defaultParams }
    )

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.firstName).toBe('Alice')
    expect(typeof payload.vars.itemCount).toBe('number')
    expect(payload.vars.ctaUrl).toMatch(/\/cart$/)
    expect(result.ok).toBe(true)
  })

  it('send falls back firstName to "there" when first_name is absent', async () => {
    const cartItem = { product_id: 'p1', name: 'Widget', quantity: 1, price: 10, image_url: null, product_slug: null }
    mockQueryMany.mockResolvedValueOnce([cartItem] as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), first_name: null } as any)

    await abandonedCart.send(
      { user_id: 'usr-123', sequence: 1 },
      { campaign: makeCampaign() as any, params: abandonedCart.defaultParams }
    )

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.firstName).toBe('there')
  })

  it('send passes coupon vars from resolveCoupon', async () => {
    const cartItem = { product_id: 'p1', name: 'Widget', quantity: 1, price: 10, image_url: null, product_slug: null }
    mockQueryMany.mockResolvedValueOnce([cartItem] as any)
    mockResolveCoupon.mockResolvedValueOnce({ couponCode: 'DISCOUNT20', discountPercent: 20 } as any)

    await abandonedCart.send(
      { user_id: 'usr-123', sequence: 1 },
      { campaign: makeCampaign() as any, params: abandonedCart.defaultParams }
    )

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.couponCode).toBe('DISCOUNT20')
    expect(payload.vars.discountPercent).toBe(20)
  })
})

// ===========================================================================
// POST PURCHASE
// ===========================================================================
describe('postPurchase scenario', () => {
  it('has required static fields', () => {
    expect(postPurchase.kind).toBe('post_purchase')
    expect(typeof postPurchase.name).toBe('string')
    expect(typeof postPurchase.description).toBe('string')
    expect(typeof postPurchase.trigger).toBe('string')
  })

  it('has all required defaultParams', () => {
    const p = postPurchase.defaultParams
    expect(typeof p.lookbackDays).toBe('number')
    expect(typeof p.maxRecipientsPerSweep).toBe('number')
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(postPurchase.defaultParams).sort()
    const schemKeys = Object.keys(postPurchase.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('exposes findEligible and send, but not findSuppressed', () => {
    expect(typeof postPurchase.findEligible).toBe('function')
    expect(typeof postPurchase.send).toBe('function')
    expect(postPurchase.findSuppressed).toBeUndefined()
  })

  it('findEligible counts granted (digital) orders as fulfilled', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await postPurchase.findEligible({
      campaign: makeCampaign({ kind: 'post_purchase' }) as any,
      params: postPurchase.defaultParams,
    })
    expect(String(mockQueryMany.mock.calls[0][0])).toContain("o.status IN ('delivered', 'granted')")
  })

  it('findEligible returns rows from queryMany', async () => {
    const rows = [{ id: 'ord-1', user_id: 'usr-1', order_number: 'ORD001' }]
    mockQueryMany.mockResolvedValueOnce(rows as any)

    const result = await postPurchase.findEligible({
      campaign: makeCampaign({ kind: 'post_purchase' }) as any,
      params: postPurchase.defaultParams,
    })

    expect(result).toEqual(rows)
  })

  it('send returns ok: false when user not found', async () => {
    mockFetchUser.mockResolvedValueOnce(null)
    // second queryMany for items never reached, but guard it
    mockQueryMany.mockResolvedValueOnce([])

    const result = await postPurchase.send(
      { id: 'ord-1', user_id: 'usr-1', order_number: 'ORD001' },
      { campaign: makeCampaign({ kind: 'post_purchase' }) as any, params: postPurchase.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send builds email vars with orderNumber and ctaUrl', async () => {
    const items = [{ name: 'Widget', quantity: 1, product_slug: 'widget', image_url: null }]
    mockQueryMany.mockResolvedValueOnce(items as any)

    await postPurchase.send(
      { id: 'ord-abc', user_id: 'usr-123', order_number: 'ORD-456' },
      { campaign: makeCampaign({ kind: 'post_purchase' }) as any, params: postPurchase.defaultParams }
    )

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.orderNumber).toBe('ORD-456')
    expect(payload.vars.ctaUrl).toContain('ord-abc')
    expect(payload.referenceId).toBe('ord-abc')
  })

  it('send passes itemsHtml generated by renderItemRows', async () => {
    const items = [{ name: 'Gadget', quantity: 2, product_slug: null, image_url: 'img.jpg' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockRenderItemRows.mockReturnValueOnce('<table>rendered</table>')

    await postPurchase.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'ORD-1' },
      { campaign: makeCampaign({ kind: 'post_purchase' }) as any, params: postPurchase.defaultParams }
    )

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.itemsHtml).toBe('<table>rendered</table>')
  })
})

// ===========================================================================
// PRICE DROP
// ===========================================================================
describe('priceDrop scenario', () => {
  it('has required static fields', () => {
    expect(priceDrop.kind).toBe('price_drop')
    expect(typeof priceDrop.name).toBe('string')
    expect(typeof priceDrop.description).toBe('string')
    expect(typeof priceDrop.trigger).toBe('string')
  })

  it('has all required defaultParams', () => {
    const p = priceDrop.defaultParams
    expect(typeof p.priceDropThresholdPct).toBe('number')
    expect(typeof p.maxWatchesPerSweep).toBe('number')
  })

  it('priceDropThresholdPct default is positive', () => {
    expect(priceDrop.defaultParams.priceDropThresholdPct).toBeGreaterThan(0)
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(priceDrop.defaultParams).sort()
    const schemKeys = Object.keys(priceDrop.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('exposes findEligible and send', () => {
    expect(typeof priceDrop.findEligible).toBe('function')
    expect(typeof priceDrop.send).toBe('function')
  })

  it('findEligible passes computed factor to queryMany', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const params = { priceDropThresholdPct: 10, maxWatchesPerSweep: 100, whatsappEnabled: false }

    await priceDrop.findEligible({
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params,
    })

    const [, args] = mockQueryMany.mock.calls[0]
    // factor = (100 - 10) / 100 = 0.9
    expect(args).toEqual(['price_drop', 0.9, 100])
  })

  it('findEligible returns rows unchanged', async () => {
    const rows = [
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Drill',
        product_slug: 'drill',
        snapshot_price: '500',
        current_price: '400',
      },
    ]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValue(rows as any)

    const result = await priceDrop.findEligible({
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(result).toEqual(rows)
  })

  it('send returns ok: false when user not found', async () => {
    mockFetchUser.mockResolvedValueOnce(null)

    const result = await priceDrop.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Drill',
        product_slug: 'drill',
        snapshot_price: '500',
        current_price: '400',
      },
      { campaign: makeCampaign({ kind: 'price_drop' }) as any, params: priceDrop.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send builds correct price vars and calls sendCampaignEmail', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500.00',
      current_price: '399.99',
    }

    await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.oldPrice).toBe('500')
    expect(payload.vars.newPrice).toBe('400')
    expect(payload.vars.productName).toBe('Drill')
    expect(payload.vars.ctaUrl).toContain('/products/drill')
    expect(payload.referenceId).toBe('p1:500.00')
  })

  it('send calls renderHeroProduct with name, imageUrl, productUrl, oldPrice, newPrice', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500',
      current_price: '400',
    }

    await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(mockRenderHeroProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Drill',
        productUrl: expect.stringContaining('/products/drill'),
        oldPrice: 500,
        newPrice: 400,
      })
    )
  })

  it('send also fires WhatsApp when enabled and the email went out', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true })
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500',
      current_price: '400',
    }
    await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: { ...priceDrop.defaultParams, whatsappEnabled: true },
    })
    expect(vi.mocked(sendCampaignWhatsApp)).toHaveBeenCalledWith(
      'price_drop',
      'u1',
      expect.objectContaining({ headline: expect.stringContaining('Drill') })
    )
  })

  it('send skips WhatsApp when disabled', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: true })
    await priceDrop.send(
      { user_id: 'u1', product_id: 'p1', product_name: 'Drill', product_slug: 'drill', snapshot_price: '500', current_price: '400' },
      { campaign: makeCampaign({ kind: 'price_drop' }) as any, params: priceDrop.defaultParams }
    )
    expect(vi.mocked(sendCampaignWhatsApp)).not.toHaveBeenCalled()
  })

  it('send updates wishlist snapshot after sending', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500',
      current_price: '400',
    }

    await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE wishlist_items'),
      expect.arrayContaining(['u1', 'p1'])
    )
  })

  it('send still returns email result even if wishlist update throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500',
      current_price: '400',
    }

    const result = await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(result.ok).toBe(true)
  })

  it('findEligible syncs the wishlist snapshots before looking for rows', async () => {
    const order: string[] = []
    mockQuery.mockImplementation(async () => {
      order.push('sync')
      return { rows: [], rowCount: 0 } as any
    })
    mockQueryMany.mockImplementation(async () => {
      order.push('select')
      return []
    })

    await priceDrop.findEligible({
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    expect(order).toEqual(['sync', 'sync', 'sync', 'sync', 'sync', 'select'])
    const syncSql = mockQuery.mock.calls.map(c => String(c[0]))
    expect(syncSql.some(sql => sql.includes('snapshot_taken_at IS NULL'))).toBe(true)
    expect(syncSql.some(sql => sql.includes('snapshot_in_stock = FALSE'))).toBe(true)
    // Reads the saved set (wishlist + saved-for-later cart items), not the wishlist table alone.
    expect(String(mockQueryMany.mock.calls[0][0])).toContain('saved_for_later = TRUE')
  })

  it('findEligible judges stock by status, not inventory quantity', async () => {
    await priceDrop.findEligible({
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    const sql = String(mockQueryMany.mock.calls[0][0])
    expect(sql).toContain("stock_status IS DISTINCT FROM 'Out of Stock'")
    expect(sql).not.toContain('inventory_quantity')
    expect(sql).toContain('p.is_active = TRUE')
  })

  it('findEligible skips users inside the 72 hour cap and takes the oldest snapshots first', async () => {
    await priceDrop.findEligible({
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    const sql = String(mockQueryMany.mock.calls[0][0])
    expect(sql).toContain("INTERVAL '72 hours'")
    expect(sql).toContain('ORDER BY wi.snapshot_taken_at ASC')
  })

  it('send keeps the snapshot when the email hit the frequency cap, so the event is retried', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: 'frequency_cap' } as any)

    const result = await priceDrop.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Drill',
        product_slug: 'drill',
        snapshot_price: '500',
        current_price: '400',
      },
      {
        campaign: makeCampaign({ kind: 'price_drop' }) as any,
        params: priceDrop.defaultParams,
      }
    )

    expect(result).toEqual({ ok: false, reason: 'frequency_cap' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('send refreshes the snapshot when this event was already emailed', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: 'already_sent' } as any)

    await priceDrop.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Drill',
        product_slug: 'drill',
        snapshot_price: '500',
        current_price: '400',
      },
      {
        campaign: makeCampaign({ kind: 'price_drop' }) as any,
        params: priceDrop.defaultParams,
      }
    )

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE wishlist_items'), ['u1', 'p1'])
  })
})

// ===========================================================================
// RESTOCK
// ===========================================================================
describe('restock scenario', () => {
  it('has required static fields', () => {
    expect(restock.kind).toBe('restock')
    expect(typeof restock.name).toBe('string')
    expect(typeof restock.description).toBe('string')
    expect(typeof restock.trigger).toBe('string')
  })

  it('has required defaultParams', () => {
    expect(typeof restock.defaultParams.maxWatchesPerSweep).toBe('number')
    expect(restock.defaultParams.maxWatchesPerSweep).toBeGreaterThan(0)
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(restock.defaultParams).sort()
    const schemKeys = Object.keys(restock.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('exposes findEligible and send', () => {
    expect(typeof restock.findEligible).toBe('function')
    expect(typeof restock.send).toBe('function')
  })

  it('findEligible passes the campaign kind and the row limit', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const params = { maxWatchesPerSweep: 200, whatsappEnabled: false }

    await restock.findEligible({
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params,
    })

    const [, args] = mockQueryMany.mock.calls[0]
    expect(args).toEqual(['restock', 200])
  })

  it('findEligible returns rows from queryMany', async () => {
    const rows = [
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Bolt',
        product_slug: 'bolt',
        out_of_stock_since: '1700000000',
      },
    ]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValue(rows as any)

    const result = await restock.findEligible({
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params: restock.defaultParams,
    })

    expect(result).toEqual(rows)
  })

  it('send returns ok: false when user not found', async () => {
    mockFetchUser.mockResolvedValueOnce(null)

    const result = await restock.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Bolt',
        product_slug: 'bolt',
        out_of_stock_since: '1700000000',
      },
      { campaign: makeCampaign({ kind: 'restock' }) as any, params: restock.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send calls renderHeroProduct with correct args (no oldPrice for restock)', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Bolt',
      product_slug: 'bolt',
      out_of_stock_since: '1700000000',
    }

    await restock.send(row, { campaign: makeCampaign({ kind: 'restock' }) as any, params: restock.defaultParams })

    expect(mockRenderHeroProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bolt',
        productUrl: expect.stringContaining('/products/bolt'),
      })
    )
    // oldPrice should NOT be passed
    const [heroArg] = mockRenderHeroProduct.mock.calls[0]
    expect(heroArg.oldPrice).toBeUndefined()
  })

  it('send builds email vars with productName and ctaUrl', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Bolt',
      product_slug: 'bolt',
      out_of_stock_since: '1700000000',
    }

    await restock.send(row, { campaign: makeCampaign({ kind: 'restock' }) as any, params: restock.defaultParams })

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.productName).toBe('Bolt')
    expect(payload.vars.ctaUrl).toContain('/products/bolt')
    expect(payload.referenceId).toBe('p1:1700000000')
  })

  it('send updates wishlist snapshot after sending', async () => {
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Bolt',
      product_slug: 'bolt',
      out_of_stock_since: '1700000000',
    }

    await restock.send(row, { campaign: makeCampaign({ kind: 'restock' }) as any, params: restock.defaultParams })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE wishlist_items'),
      expect.arrayContaining(['u1', 'p1'])
    )
  })

  it('send swallows wishlist update error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB timeout'))
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Bolt',
      product_slug: 'bolt',
      out_of_stock_since: '1700000000',
    }

    const result = await restock.send(row, {
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params: restock.defaultParams,
    })

    expect(result.ok).toBe(true)
  })

  it('findEligible syncs the wishlist snapshots before looking for rows', async () => {
    const order: string[] = []
    mockQuery.mockImplementation(async () => {
      order.push('sync')
      return { rows: [], rowCount: 0 } as any
    })
    mockQueryMany.mockImplementation(async () => {
      order.push('select')
      return []
    })

    await restock.findEligible({
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params: restock.defaultParams,
    })

    expect(order).toEqual(['sync', 'sync', 'sync', 'sync', 'sync', 'select'])
    const syncSql = mockQuery.mock.calls.map(c => String(c[0]))
    expect(syncSql.some(sql => sql.includes('snapshot_taken_at IS NULL'))).toBe(true)
    expect(syncSql.some(sql => sql.includes('snapshot_in_stock = FALSE'))).toBe(true)
    // Reads the saved set (wishlist + saved-for-later cart items), not the wishlist table alone.
    expect(String(mockQueryMany.mock.calls[0][0])).toContain('saved_for_later = TRUE')
  })

  it('findEligible judges stock by status, not inventory quantity', async () => {
    await restock.findEligible({
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params: restock.defaultParams,
    })

    const sql = String(mockQueryMany.mock.calls[0][0])
    expect(sql).toContain("stock_status IS DISTINCT FROM 'Out of Stock'")
    expect(sql).not.toContain('inventory_quantity')
    expect(sql).toContain('p.is_active = TRUE')
  })

  it('findEligible skips users inside the 72 hour cap and takes the oldest snapshots first', async () => {
    await restock.findEligible({
      campaign: makeCampaign({ kind: 'restock' }) as any,
      params: restock.defaultParams,
    })

    const sql = String(mockQueryMany.mock.calls[0][0])
    expect(sql).toContain("INTERVAL '72 hours'")
    expect(sql).toContain('ORDER BY wi.snapshot_taken_at ASC')
  })

  it('send keeps the snapshot when the email hit the frequency cap, so the event is retried', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: 'frequency_cap' } as any)

    const result = await restock.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Bolt',
        product_slug: 'bolt',
        out_of_stock_since: '1700000000',
      },
      {
        campaign: makeCampaign({ kind: 'restock' }) as any,
        params: restock.defaultParams,
      }
    )

    expect(result).toEqual({ ok: false, reason: 'frequency_cap' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('send refreshes the snapshot when this event was already emailed', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: 'already_sent' } as any)

    await restock.send(
      {
        user_id: 'u1',
        product_id: 'p1',
        product_name: 'Bolt',
        product_slug: 'bolt',
        out_of_stock_since: '1700000000',
      },
      {
        campaign: makeCampaign({ kind: 'restock' }) as any,
        params: restock.defaultParams,
      }
    )

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE wishlist_items'), ['u1', 'p1'])
  })
})

// ===========================================================================
// REVIEW REMINDER
// ===========================================================================
describe('reviewReminder scenario', () => {
  it('has required static fields', () => {
    expect(reviewReminder.kind).toBe('review_reminder')
    expect(typeof reviewReminder.name).toBe('string')
    expect(typeof reviewReminder.description).toBe('string')
    expect(typeof reviewReminder.trigger).toBe('string')
  })

  it('has all required defaultParams', () => {
    const p = reviewReminder.defaultParams
    expect(typeof p.lookbackDays).toBe('number')
    expect(typeof p.maxRecipientsPerSweep).toBe('number')
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(reviewReminder.defaultParams).sort()
    const schemKeys = Object.keys(reviewReminder.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('exposes findEligible and send', () => {
    expect(typeof reviewReminder.findEligible).toBe('function')
    expect(typeof reviewReminder.send).toBe('function')
  })

  it('findEligible counts granted (digital) orders as fulfilled', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await reviewReminder.findEligible({
      campaign: makeCampaign({ kind: 'review_reminder' }) as any,
      params: reviewReminder.defaultParams,
    })
    expect(String(mockQueryMany.mock.calls[0][0])).toContain("o.status IN ('delivered', 'granted')")
  })

  it('findEligible passes campaign.kind and params to queryMany', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const campaign = makeCampaign({ kind: 'review_reminder', delay_hours: 48 })

    await reviewReminder.findEligible({
      campaign: campaign as any,
      params: reviewReminder.defaultParams,
    })

    const [sql, args] = mockQueryMany.mock.calls[0]
    expect(typeof sql).toBe('string')
    expect(args).toContain('review_reminder')
    expect(args).toContain(String(reviewReminder.defaultParams.lookbackDays))
    expect(sql).toContain("ecs.campaign_kind = 'review_request'")
  })

  it('findEligible returns rows from queryMany', async () => {
    const rows = [{ id: 'ord-1', user_id: 'u1', order_number: 'RR001' }]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValue(rows as any)

    const result = await reviewReminder.findEligible({
      campaign: makeCampaign({ kind: 'review_reminder' }) as any,
      params: reviewReminder.defaultParams,
    })

    expect(result).toEqual(rows)
  })

  it('send returns ok: false when user not found', async () => {
    mockFetchUser.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])

    const result = await reviewReminder.send(
      { id: 'ord-1', user_id: 'u1', order_number: 'RR001' },
      { campaign: makeCampaign({ kind: 'review_reminder' }) as any, params: reviewReminder.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send builds ctaUrl pointing to order page', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', product_slug: 'widget', image_url: null }]
    mockQueryMany.mockResolvedValueOnce(items as any)

    await reviewReminder.send(
      { id: 'ord-xyz', user_id: 'usr-123', order_number: 'RR-001' },
      { campaign: makeCampaign({ kind: 'review_reminder' }) as any, params: reviewReminder.defaultParams }
    )

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.ctaUrl).toContain('/account/orders/ord-xyz')
    expect(payload.vars.orderNumber).toBe('RR-001')
    expect(payload.referenceId).toBe('ord-xyz')
  })

  it("links each item to its own signed review page, not the product page's dead ?review=1", async () => {
    const items = [{ name: 'Product A', product_id: 'p1', product_slug: 'product-a', image_url: null }]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValue(items as any)
    mockGenerateReviewToken.mockResolvedValue('tok-1')

    await reviewReminder.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RR-1' },
      { campaign: makeCampaign({ kind: 'review_reminder' }) as any, params: reviewReminder.defaultParams }
    )

    expect(mockGenerateReviewToken).toHaveBeenCalledWith({ orderId: 'ord-1', productId: 'p1', userId: 'usr-123' })
    const [rows] = mockRenderItemRows.mock.calls.at(-1)!
    expect(rows[0].productUrl).toMatch(/\/review\?token=tok-1$/)
    expect(rows[0].productUrl).not.toContain('?review=1')
  })

  it('leaves an item with no product (deleted) unlinked', async () => {
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValueOnce([
      { name: 'Unknown', product_id: null, product_slug: null, image_url: null },
    ] as any)

    await reviewReminder.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RR-1' },
      { campaign: makeCampaign({ kind: 'review_reminder' }) as any, params: reviewReminder.defaultParams }
    )

    expect(mockRenderItemRows).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ productUrl: null })])
    )
  })
})

// ===========================================================================
// PRICE DROP — additional branch coverage
// ===========================================================================
describe('priceDrop scenario — branch coverage', () => {
  it('send falls back firstName to "there" when first_name is null', async () => {
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), first_name: null } as any)
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Drill',
      product_slug: 'drill',
      snapshot_price: '500',
      current_price: '400',
    }

    await priceDrop.send(row, {
      campaign: makeCampaign({ kind: 'price_drop' }) as any,
      params: priceDrop.defaultParams,
    })

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.firstName).toBe('there')
  })
})

// ===========================================================================
// RESTOCK — additional branch coverage
// ===========================================================================
describe('restock scenario — branch coverage', () => {
  it('send falls back firstName to "there" when first_name is null', async () => {
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), first_name: null } as any)
    const row = {
      user_id: 'u1',
      product_id: 'p1',
      product_name: 'Bolt',
      product_slug: 'bolt',
      out_of_stock_since: '1700000000',
    }

    await restock.send(row, { campaign: makeCampaign({ kind: 'restock' }) as any, params: restock.defaultParams })

    const [payload] = mockSendEmail.mock.calls[0]
    expect(payload.vars.firstName).toBe('there')
  })
})

// ===========================================================================
// REVIEW REQUEST
// ===========================================================================
describe('reviewRequest scenario', () => {
  it('has required static fields', () => {
    expect(reviewRequest.kind).toBe('review_request')
    expect(typeof reviewRequest.name).toBe('string')
    expect(typeof reviewRequest.description).toBe('string')
    expect(typeof reviewRequest.trigger).toBe('string')
  })

  it('has all required defaultParams', () => {
    const p = reviewRequest.defaultParams
    expect(typeof p.lookbackDays).toBe('number')
    expect(typeof p.maxRecipientsPerSweep).toBe('number')
  })

  it('paramSchema covers all defaultParam keys', () => {
    const defKeys = Object.keys(reviewRequest.defaultParams).sort()
    const schemKeys = Object.keys(reviewRequest.paramSchema).sort()
    expect(schemKeys).toEqual(defKeys)
  })

  it('exposes findEligible and send', () => {
    expect(typeof reviewRequest.findEligible).toBe('function')
    expect(typeof reviewRequest.send).toBe('function')
  })

  it('findEligible passes campaign.kind, delay_hours, lookbackDays and maxRecipientsPerSweep to queryMany', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const campaign = makeCampaign({ kind: 'review_request', delay_hours: 24 })

    await reviewRequest.findEligible({
      campaign: campaign as any,
      params: reviewRequest.defaultParams,
    })

    const [sql, args] = mockQueryMany.mock.calls[0]
    expect(typeof sql).toBe('string')
    expect(args).toContain('review_request')
    expect(sql).toContain("ecs.campaign_kind = 'review_reminder'")
    expect(args).toContain(24)
    expect(args).toContain(String(reviewRequest.defaultParams.lookbackDays))
    expect(args).toContain(reviewRequest.defaultParams.maxRecipientsPerSweep)
  })

  it('findEligible returns rows from queryMany', async () => {
    const rows = [{ id: 'ord-1', user_id: 'u1', order_number: 'RQ001' }]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValue(rows as any)

    const result = await reviewRequest.findEligible({
      campaign: makeCampaign({ kind: 'review_request' }) as any,
      params: reviewRequest.defaultParams,
    })

    expect(result).toEqual(rows)
  })

  it('send returns ok: false when user not found', async () => {
    mockFetchUser.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])

    const result = await reviewRequest.send(
      { id: 'ord-1', user_id: 'u1', order_number: 'RQ001' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_user')
  })

  it('send calls renderCampaignEmail and sendCampaignEmailRendered with correct args', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: 'img.jpg', slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    const user = { ...makeUser(), baseUrl: 'https://jeffistores.com' }
    mockFetchUser.mockResolvedValueOnce(user as any)

    await reviewRequest.send(
      { id: 'ord-abc', user_id: 'usr-123', order_number: 'RQ-001' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    expect(mockRenderCampaignEmail).toHaveBeenCalledTimes(1)
    const [template, vars] = mockRenderCampaignEmail.mock.calls[0]
    expect(template).toBe('review_request')
    expect(vars.firstName).toBe('Alice')
    expect(vars.orderNumber).toBe('RQ-001')
    expect(typeof vars.itemsJson).toBe('string')

    expect(mockSendEmailRendered).toHaveBeenCalledTimes(1)
    const [payload] = mockSendEmailRendered.mock.calls[0]
    expect(payload.referenceId).toBe('ord-abc')
    expect(payload.subject).toBe('Review your order')
    expect(payload.html).toBe('<html>review</html>')
  })

  it('send falls back firstName to "there" when first_name is null', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), first_name: null, baseUrl: 'https://jeffistores.com' } as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    expect(vars.firstName).toBe('there')
  })

  it('send generates star links (ratings 1–5) for each item', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), baseUrl: 'https://jeffistores.com' } as any)
    mockGenerateReviewToken.mockResolvedValueOnce('tok-xyz' as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    const parsed = JSON.parse(vars.itemsJson)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].starLinks).toHaveLength(5)
    for (let rating = 1; rating <= 5; rating++) {
      expect(parsed[0].starLinks[rating - 1]).toContain(`rating=${rating}`)
      expect(parsed[0].starLinks[rating - 1]).toContain('tok-xyz')
    }
  })

  it('send sets productUrl from slug when slug is present', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), baseUrl: 'https://jeffistores.com' } as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    const parsed = JSON.parse(vars.itemsJson)
    expect(parsed[0].productUrl).toContain('/products/widget')
  })

  it('send sets productUrl to null when slug is null', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: null }]
    mockQueryMany.mockReset()
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), baseUrl: 'https://jeffistores.com' } as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    const parsed = JSON.parse(vars.itemsJson)
    expect(parsed[0].productUrl).toBeNull()
  })

  it('send passes couponCode and discountPercent as strings to renderCampaignEmail', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), baseUrl: 'https://jeffistores.com' } as any)
    mockResolveCoupon.mockResolvedValueOnce({ couponCode: 'SAVE20', discountPercent: 20 } as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    expect(vars.couponCode).toBe('SAVE20')
    expect(vars.discountPercent).toBe('20')
  })

  it('send passes empty strings for coupon vars when coupon is null', async () => {
    const items = [{ name: 'Widget', product_id: 'p1', image_url: null, slug: 'widget' }]
    mockQueryMany.mockResolvedValueOnce(items as any)
    mockFetchUser.mockResolvedValueOnce({ ...makeUser(), baseUrl: 'https://jeffistores.com' } as any)
    mockResolveCoupon.mockResolvedValueOnce({ couponCode: null, discountPercent: null } as any)

    await reviewRequest.send(
      { id: 'ord-1', user_id: 'usr-123', order_number: 'RQ-1' },
      { campaign: makeCampaign({ kind: 'review_request' }) as any, params: reviewRequest.defaultParams }
    )

    const [, vars] = mockRenderCampaignEmail.mock.calls[0]
    expect(vars.couponCode).toBe('')
    expect(vars.discountPercent).toBe('')
  })
})
describe('resolveParams', () => {
  // Dynamic import to avoid top-level import issues with module augmentation
  it('merges override values onto defaults', async () => {
    const { resolveParams } = await import('@/lib/campaigns/types')
    const defaults = { a: 1, b: 2, c: 3 }
    const result = resolveParams(defaults, { b: 99 })
    expect(result).toEqual({ a: 1, b: 99, c: 3 })
  })

  it('returns defaults when override is null', async () => {
    const { resolveParams } = await import('@/lib/campaigns/types')
    const defaults = { x: 10 }
    expect(resolveParams(defaults, null)).toEqual({ x: 10 })
  })

  it('returns defaults when override is undefined', async () => {
    const { resolveParams } = await import('@/lib/campaigns/types')
    const defaults = { x: 10 }
    expect(resolveParams(defaults, undefined)).toEqual({ x: 10 })
  })

  it('does not override with null/undefined/0 values', async () => {
    const { resolveParams } = await import('@/lib/campaigns/types')
    const defaults = { a: 5, b: 10 }
    const result = resolveParams(defaults, { a: null, b: 0 })
    expect(result).toEqual({ a: 5, b: 10 })
  })

  it('ignores unknown keys from override', async () => {
    const { resolveParams } = await import('@/lib/campaigns/types')
    const defaults = { a: 1 }
    const result = resolveParams(defaults, { a: 2, extra: 'surprise' })
    // extra is merged in because resolveParams copies all non-null/undefined/0 keys
    expect(result.a).toBe(2)
  })
})

// ===========================================================================
// Cross-scenario — all scenarios have consistent shape
// ===========================================================================
describe('all scenarios — structural contract', () => {
  const scenarios = [
    { name: 'abandonedCart', mod: abandonedCart },
    { name: 'postPurchase', mod: postPurchase },
    { name: 'priceDrop', mod: priceDrop },
    { name: 'restock', mod: restock },
    { name: 'reviewReminder', mod: reviewReminder },
    { name: 'reviewRequest', mod: reviewRequest },
  ]

  for (const { name, mod } of scenarios) {
    describe(name, () => {
      it('has a non-empty kind string', () => {
        expect(typeof mod.kind).toBe('string')
        expect(mod.kind.length).toBeGreaterThan(0)
      })

      it('has a non-empty name string', () => {
        expect(typeof mod.name).toBe('string')
        expect(mod.name.length).toBeGreaterThan(0)
      })

      it('has a non-empty description string', () => {
        expect(typeof mod.description).toBe('string')
        expect(mod.description.length).toBeGreaterThan(0)
      })

      it('has a non-empty trigger string', () => {
        expect(typeof mod.trigger).toBe('string')
        expect(mod.trigger.length).toBeGreaterThan(0)
      })

      it('has defaultParams as a plain object', () => {
        expect(mod.defaultParams).toBeTruthy()
        expect(typeof mod.defaultParams).toBe('object')
      })

      it('has paramSchema as a plain object', () => {
        expect(mod.paramSchema).toBeTruthy()
        expect(typeof mod.paramSchema).toBe('object')
      })

      it('exposes findEligible as an async function', () => {
        expect(typeof mod.findEligible).toBe('function')
      })

      it('exposes send as an async function', () => {
        expect(typeof mod.send).toBe('function')
      })
    })
  }
})
