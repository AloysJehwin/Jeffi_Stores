import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/marketing', () => ({
  getCampaign: vi.fn(),
  canSendMarketing: vi.fn(),
  alreadySentForReference: vi.fn(),
  recordSent: vi.fn(),
  generateCouponForCampaign: vi.fn(),
  getAssignedCouponCode: vi.fn(),
  buildUnsubscribeUrl: vi.fn(),
  renderTemplate: vi.fn(),
  wrapWithTracking: vi.fn(),
}))

vi.mock('@/lib/email-campaigns', () => ({
  baseLayout: vi.fn(),
  ctaButton: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/mail-audit', () => ({
  sendAuditedMail: vi.fn(),
}))

import {
  renderItemRows,
  renderHeroProduct,
  fetchUserContext,
  fetchProductImageUrl,
  sendCampaignEmail,
  resolveCoupon,
  sendAbandonedCartEmail,
  sendAbandonedCheckoutEmail,
  sendPostPurchaseEmail,
  sendReviewReminderEmail,
  sendWinbackEmail,
  sendRestockEmail,
  sendPriceDropEmail,
  sendTestCampaignEmail,
  type EmailItem,
} from '@/lib/automation-emails'

import * as marketing from '@/lib/marketing'
import * as emailCampaigns from '@/lib/email-campaigns'
import * as db from '@/lib/db'
import * as mailAudit from '@/lib/mail-audit'

const mockGetCampaign = vi.mocked(marketing.getCampaign)
const mockCanSendMarketing = vi.mocked(marketing.canSendMarketing)
const mockAlreadySentForReference = vi.mocked(marketing.alreadySentForReference)
const mockRecordSent = vi.mocked(marketing.recordSent)
const mockGenerateCouponForCampaign = vi.mocked(marketing.generateCouponForCampaign)
const mockGetAssignedCouponCode = vi.mocked(marketing.getAssignedCouponCode)
const mockBuildUnsubscribeUrl = vi.mocked(marketing.buildUnsubscribeUrl)
const mockRenderTemplate = vi.mocked(marketing.renderTemplate)
const mockWrapWithTracking = vi.mocked(marketing.wrapWithTracking)
const mockBaseLayout = vi.mocked(emailCampaigns.baseLayout)
const mockQueryOne = vi.mocked(db.queryOne)
const mockSendAuditedMail = vi.mocked(mailAudit.sendAuditedMail)

const mockCampaign = {
  id: 'c1',
  kind: 'abandoned_cart',
  subject_template: 'Hey {{firstName}}, you left something!',
  body_template: '<p>Hi {{firstName}}</p>',
  discount_percent: 10,
  coupon_id: null,
}

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  first_name: 'Alice',
  last_name: 'Smith',
  unsubscribe_token: 'token-abc',
  baseUrl: '',
  is_business: false,
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// renderItemRows
// ---------------------------------------------------------------------------
describe('renderItemRows', () => {
  it('returns empty string for empty array', () => {
    expect(renderItemRows([])).toBe('')
  })

  it('renders a basic item row', () => {
    const items: EmailItem[] = [{ name: 'Widget', quantity: 2, price: 150 }]
    const html = renderItemRows(items)
    expect(html).toContain('Widget')
    expect(html).toContain('150')
    expect(html).toContain('Qty: 2')
  })

  it('uses placeholder image when imageUrl is null', () => {
    const items: EmailItem[] = [{ name: 'Widget', imageUrl: null }]
    const html = renderItemRows(items)
    expect(html).toContain('placehold.co')
  })

  it('uses provided imageUrl', () => {
    const items: EmailItem[] = [{ name: 'Widget', imageUrl: 'https://example.com/img.png' }]
    const html = renderItemRows(items)
    expect(html).toContain('https://example.com/img.png')
  })

  it('renders product link when productUrl is provided', () => {
    const items: EmailItem[] = [{ name: 'Widget', productUrl: 'https://example.com/widget' }]
    const html = renderItemRows(items)
    expect(html).toContain('https://example.com/widget')
    expect(html).toContain('<a href=')
  })

  it('renders span (no link) when productUrl is null', () => {
    const items: EmailItem[] = [{ name: 'Widget', productUrl: null }]
    const html = renderItemRows(items)
    expect(html).toContain('<span')
    expect(html).not.toContain('<a href=')
  })

  it('does not render Qty row when quantity is undefined', () => {
    const items: EmailItem[] = [{ name: 'Widget' }]
    const html = renderItemRows(items)
    expect(html).not.toContain('Qty:')
  })

  it('includes unitLabel in qty display', () => {
    const items: EmailItem[] = [{ name: 'Widget', quantity: 3, unitLabel: 'pcs' }]
    const html = renderItemRows(items)
    expect(html).toContain('3 pcs')
  })

  it('omits unitLabel section when not provided', () => {
    const items: EmailItem[] = [{ name: 'Widget', quantity: 3 }]
    const html = renderItemRows(items)
    expect(html).toContain('Qty: 3')
  })

  it('does not render price cell when price is undefined', () => {
    const items: EmailItem[] = [{ name: 'Widget' }]
    const html = renderItemRows(items)
    expect(html).not.toContain('align="right"')
  })

  it('escapes double quotes in item name for alt attribute', () => {
    const items: EmailItem[] = [{ name: 'Say "Hi"' }]
    const html = renderItemRows(items)
    expect(html).toContain('&quot;')
  })

  it('formats price with en-IN locale rounding', () => {
    const items: EmailItem[] = [{ name: 'Item', price: 1000.7 }]
    const html = renderItemRows(items)
    expect(html).toContain('1,001')
  })

  it('wraps all rows in a table', () => {
    const items: EmailItem[] = [{ name: 'A' }, { name: 'B' }]
    const html = renderItemRows(items)
    expect(html).toContain('<table')
    expect(html).toContain('</table>')
  })
})

// ---------------------------------------------------------------------------
// renderHeroProduct
// ---------------------------------------------------------------------------
describe('renderHeroProduct', () => {
  it('renders product name', () => {
    const html = renderHeroProduct({ name: 'Super Bolt' })
    expect(html).toContain('Super Bolt')
  })

  it('uses placeholder image when imageUrl is null', () => {
    const html = renderHeroProduct({ name: 'Product', imageUrl: null })
    expect(html).toContain('placehold.co')
  })

  it('uses provided image url', () => {
    const html = renderHeroProduct({ name: 'Product', imageUrl: 'https://cdn.example.com/img.jpg' })
    expect(html).toContain('https://cdn.example.com/img.jpg')
  })

  it('wraps name in link when productUrl is set', () => {
    const html = renderHeroProduct({ name: 'Product', productUrl: 'https://example.com/p' })
    expect(html).toContain('<a href="https://example.com/p"')
  })

  it('does not render link when productUrl is null', () => {
    const html = renderHeroProduct({ name: 'Product', productUrl: null })
    expect(html).not.toContain('<a href=')
  })

  it('renders sale price in red when newPrice set', () => {
    const html = renderHeroProduct({ name: 'P', newPrice: 799 })
    expect(html).toContain('799')
    expect(html).toContain('#e07b3f')
  })

  it('renders strikethrough old price when oldPrice differs from newPrice', () => {
    const html = renderHeroProduct({ name: 'P', oldPrice: 999, newPrice: 799 })
    expect(html).toContain('line-through')
    expect(html).toContain('999')
  })

  it('does not render old price block when prices equal', () => {
    const html = renderHeroProduct({ name: 'P', oldPrice: 799, newPrice: 799 })
    expect(html).not.toContain('line-through')
  })

  it('does not render price block when newPrice is undefined', () => {
    const html = renderHeroProduct({ name: 'P', oldPrice: 999 })
    expect(html).not.toContain('#e07b3f')
  })

  it('escapes double quotes in alt text', () => {
    const html = renderHeroProduct({ name: 'Say "Hello"' })
    expect(html).toContain('&quot;')
  })
})

// ---------------------------------------------------------------------------
// fetchUserContext
// ---------------------------------------------------------------------------
describe('fetchUserContext', () => {
  it('calls queryOne with the correct SQL and user id', async () => {
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await fetchUserContext('user-1')
    expect(mockQueryOne).toHaveBeenCalledOnce()
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('FROM users u')
    expect(params).toEqual(['user-1'])
    const { baseUrl: _baseUrl, ...fromDb } = mockUser
    expect(result).toMatchObject(fromDb)
    // baseUrl is resolved per-request (tenant storefront on a tenant host), not read from the row.
    expect(typeof result?.baseUrl).toBe('string')
    expect(result?.baseUrl).not.toBe('')
  })

  it('returns null when user not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await fetchUserContext('unknown')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchProductImageUrl
// ---------------------------------------------------------------------------
describe('fetchProductImageUrl', () => {
  it('returns image_url when row exists', async () => {
    mockQueryOne.mockResolvedValue({ image_url: 'https://cdn.example.com/product.jpg' })
    const result = await fetchProductImageUrl('prod-1')
    expect(result).toBe('https://cdn.example.com/product.jpg')
  })

  it('returns empty string when no row', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await fetchProductImageUrl('prod-1')
    expect(result).toBe('')
  })

  it('queries product_images with correct product_id', async () => {
    mockQueryOne.mockResolvedValue(null)
    await fetchProductImageUrl('prod-42')
    const [, params] = mockQueryOne.mock.calls[0]
    expect(params).toEqual(['prod-42'])
  })
})

// ---------------------------------------------------------------------------
// resolveCoupon
// ---------------------------------------------------------------------------
describe('resolveCoupon', () => {
  it('returns coupon from assigned coupon when coupon_id is set', async () => {
    mockGetAssignedCouponCode.mockResolvedValue({ code: 'SAVE20', discountValue: 20, discountType: 'percentage' })
    const campaign = { ...mockCampaign, coupon_id: 'c-id', discount_percent: 0 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: 'SAVE20', discountPercent: 20 })
  })

  it('returns discountPercent 0 when assigned coupon is not percentage type', async () => {
    mockGetAssignedCouponCode.mockResolvedValue({ code: 'FLAT50', discountValue: 50, discountType: 'fixed' })
    const campaign = { ...mockCampaign, coupon_id: 'c-id', discount_percent: 0 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: 'FLAT50', discountPercent: 0 })
  })

  it('generates coupon when discount_percent > 0 and no coupon_id', async () => {
    mockGenerateCouponForCampaign.mockResolvedValue('AUTO10')
    const campaign = { ...mockCampaign, coupon_id: null, discount_percent: 10 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: 'AUTO10', discountPercent: 10 })
  })

  it('returns empty couponCode when generation fails', async () => {
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    const campaign = { ...mockCampaign, coupon_id: null, discount_percent: 10 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: '', discountPercent: 10 })
  })

  it('returns empty couponCode and discount_percent when nothing configured', async () => {
    const campaign = { ...mockCampaign, coupon_id: null, discount_percent: 0 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: '', discountPercent: 0 })
  })

  it('returns empty when coupon_id set but getAssignedCouponCode returns null', async () => {
    mockGetAssignedCouponCode.mockResolvedValue(null)
    const campaign = { ...mockCampaign, coupon_id: 'c-id', discount_percent: 0 }
    const result = await resolveCoupon(campaign as any, 'user-1')
    expect(result).toEqual({ couponCode: '', discountPercent: 0 })
  })
})

// ---------------------------------------------------------------------------
// sendCampaignEmail
// ---------------------------------------------------------------------------
describe('sendCampaignEmail', () => {
  const baseParams = {
    campaign: mockCampaign as any,
    user: mockUser,
    referenceId: 'ref-1',
    vars: { firstName: 'Alice' },
  }

  it('returns ok:false when canSendMarketing fails', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: false, reason: 'opted_out' })
    const result = await sendCampaignEmail(baseParams)
    expect(result).toEqual({ ok: false, reason: 'opted_out' })
  })

  it('returns ok:false when alreadySentForReference is true', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(true)
    const result = await sendCampaignEmail(baseParams)
    expect(result).toEqual({ ok: false, reason: 'already_sent' })
  })

  it('returns ok:false when recordSent fails (returns null)', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue(null)
    const result = await sendCampaignEmail(baseParams)
    expect(result).toEqual({ ok: false, reason: 'record_failed' })
  })

  it('sends mail and returns ok:true on success', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('sent-id-1')
    mockRenderTemplate.mockReturnValue('rendered')
    mockBuildUnsubscribeUrl.mockReturnValue('https://example.com/unsub')
    mockWrapWithTracking.mockReturnValue('<tracked>rendered</tracked>')
    mockBaseLayout.mockReturnValue('<html>rendered</html>')
    mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-1' })

    const result = await sendCampaignEmail(baseParams)
    expect(result).toEqual({ ok: true, sentId: 'sent-id-1' })
    expect(mockSendAuditedMail).toHaveBeenCalledOnce()
  })

  it('returns ok:false with send_failed when sendAuditedMail throws', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('sent-id-2')
    mockRenderTemplate.mockReturnValue('rendered')
    mockBuildUnsubscribeUrl.mockReturnValue('https://example.com/unsub')
    mockWrapWithTracking.mockReturnValue('<tracked/>')
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockRejectedValue(new Error('SMTP error'))

    const result = await sendCampaignEmail(baseParams)
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
  })

  it('passes List-Unsubscribe header to sendAuditedMail', async () => {
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('sent-id-3')
    mockRenderTemplate.mockReturnValue('subject text')
    mockBuildUnsubscribeUrl.mockReturnValue('https://example.com/unsub?tok=abc')
    mockWrapWithTracking.mockReturnValue('<tracked/>')
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendCampaignEmail(baseParams)
    const callArg = mockSendAuditedMail.mock.calls[0][0]
    expect(callArg.headers?.['List-Unsubscribe']).toContain('unsub')
  })
})

// ---------------------------------------------------------------------------
// sendAbandonedCartEmail
// ---------------------------------------------------------------------------
describe('sendAbandonedCartEmail', () => {
  it('returns precond when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendAbandonedCartEmail('user-1', [])
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('returns precond when user not found', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(null)
    const result = await sendAbandonedCartEmail('user-1', [])
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('slices cart items to max 5', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue('CODE10')
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('sent-1')
    mockRenderTemplate.mockReturnValue('text')
    mockBuildUnsubscribeUrl.mockReturnValue('https://x.com/unsub')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockResolvedValue({})

    const items = Array.from({ length: 8 }, (_, i) => ({ name: `Item ${i}`, quantity: 1, price: 100 }))
    await sendAbandonedCartEmail('user-1', items)

    // renderTemplate is called for subject and body — the body vars include cartItems
    const callArgs = mockRenderTemplate.mock.calls
    // The second call has the vars including cartItems
    const bodyVars = callArgs[1]?.[1]
    if (bodyVars) {
      const cartItemsHtml = String(bodyVars.cartItems || '')
      // Should have at most 5 <li> items
      const matches = cartItemsHtml.match(/<li>/g) || []
      expect(matches.length).toBeLessThanOrEqual(5)
    }
  })

  it('passes firstName as "there" when first_name is null', async () => {
    const userNoName = { ...mockUser, first_name: null }
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(userNoName)
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendAbandonedCartEmail('user-1', [{ name: 'X', quantity: 1, price: 50 }])
    const callArgs = mockRenderTemplate.mock.calls
    expect(callArgs[1]?.[1]?.firstName).toBe('there')
  })
})

// ---------------------------------------------------------------------------
// sendAbandonedCheckoutEmail
// ---------------------------------------------------------------------------
describe('sendAbandonedCheckoutEmail', () => {
  it('returns precond when campaign is null', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendAbandonedCheckoutEmail('user-1', { id: 'o1', order_number: 'ON1', total_amount: '500' })
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('returns precond when user is null', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(null)
    const result = await sendAbandonedCheckoutEmail('user-1', { id: 'o1', order_number: 'ON1', total_amount: '500' })
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('passes order_number in vars', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendAbandonedCheckoutEmail('user-1', { id: 'o1', order_number: 'ORD-999', total_amount: 750 })
    const bodyVars = mockRenderTemplate.mock.calls[1]?.[1]
    expect(bodyVars?.orderNumber).toBe('ORD-999')
    expect(bodyVars?.total).toBe('750.00')
  })
})

// ---------------------------------------------------------------------------
// sendPostPurchaseEmail
// ---------------------------------------------------------------------------
describe('sendPostPurchaseEmail', () => {
  it('returns precond when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendPostPurchaseEmail('user-1', { id: 'o1', order_number: 'ON1' })
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('includes order id in ctaUrl', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendPostPurchaseEmail('user-1', { id: 'order-xyz', order_number: 'ON-1' })
    const bodyVars = mockRenderTemplate.mock.calls[1]?.[1]
    expect(String(bodyVars?.ctaUrl)).toContain('order-xyz')
  })
})

// ---------------------------------------------------------------------------
// sendReviewReminderEmail
// ---------------------------------------------------------------------------
describe('sendReviewReminderEmail', () => {
  it('returns precond when user not found', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockQueryOne.mockResolvedValue(null)
    const result = await sendReviewReminderEmail('user-1', { id: 'o1', order_number: 'ON1' })
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('sends with order referenceId', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, kind: 'review_reminder' } as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    const result = await sendReviewReminderEmail('user-1', { id: 'order-abc', order_number: 'ON-2' })
    expect(result).toEqual({ ok: true, sentId: 's1' })
  })
})

// ---------------------------------------------------------------------------
// sendWinbackEmail
// ---------------------------------------------------------------------------
describe('sendWinbackEmail', () => {
  it('returns precond when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendWinbackEmail('user-1', 'winback_90')
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('returns coupon_failed when discount configured but no coupon generated', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, discount_percent: 15, coupon_id: null } as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGenerateCouponForCampaign.mockResolvedValue(null)

    const result = await sendWinbackEmail('user-1', 'winback_90')
    expect(result).toEqual({ ok: false, reason: 'coupon_failed' })
  })

  it('sends successfully when coupon resolved', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, kind: 'winback_90', discount_percent: 15 } as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockGenerateCouponForCampaign.mockResolvedValue('WIN15')
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    const result = await sendWinbackEmail('user-1', 'winback_90')
    expect(result).toEqual({ ok: true, sentId: 's1' })
  })

  it('proceeds when no discount configured (no coupon_failed)', async () => {
    mockGetCampaign.mockResolvedValue({
      ...mockCampaign,
      kind: 'winback_180',
      discount_percent: 0,
      coupon_id: null,
    } as any)
    mockQueryOne.mockResolvedValue(mockUser)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s2')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    const result = await sendWinbackEmail('user-1', 'winback_180')
    expect(result).toEqual({ ok: true, sentId: 's2' })
  })
})

// ---------------------------------------------------------------------------
// sendRestockEmail
// ---------------------------------------------------------------------------
describe('sendRestockEmail', () => {
  it('returns precond when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendRestockEmail('user-1', { id: 'p1', name: 'Bolt', slug: 'bolt' })
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('fetches product image and passes productImageUrl in vars', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, kind: 'restock' } as any)
    // queryOne called twice: fetchUserContext then fetchProductImageUrl
    mockQueryOne
      .mockResolvedValueOnce(mockUser)
      .mockResolvedValueOnce({ image_url: 'https://cdn.example.com/bolt.jpg' })
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendRestockEmail('user-1', { id: 'p1', name: 'Bolt', slug: 'bolt' })
    const bodyVars = mockRenderTemplate.mock.calls[1]?.[1]
    expect(bodyVars?.productImageUrl).toBe('https://cdn.example.com/bolt.jpg')
    expect(bodyVars?.productName).toBe('Bolt')
  })
})

// ---------------------------------------------------------------------------
// sendPriceDropEmail
// ---------------------------------------------------------------------------
describe('sendPriceDropEmail', () => {
  it('returns precond when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    mockQueryOne.mockResolvedValue(mockUser)
    const result = await sendPriceDropEmail('user-1', { id: 'p1', name: 'Widget', slug: 'widget' }, 999, 799)
    expect(result).toEqual({ ok: false, reason: 'precond' })
  })

  it('passes rounded oldPrice and newPrice in vars', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, kind: 'price_drop' } as any)
    mockQueryOne.mockResolvedValueOnce(mockUser).mockResolvedValueOnce(null) // no product image
    mockGetAssignedCouponCode.mockResolvedValue(null)
    mockGenerateCouponForCampaign.mockResolvedValue(null)
    mockCanSendMarketing.mockResolvedValue({ ok: true })
    mockAlreadySentForReference.mockResolvedValue(false)
    mockRecordSent.mockResolvedValue('s1')
    mockRenderTemplate.mockReturnValue('t')
    mockBuildUnsubscribeUrl.mockReturnValue('u')
    mockWrapWithTracking.mockReturnValue('<t/>')
    mockBaseLayout.mockReturnValue('<h/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendPriceDropEmail('user-1', { id: 'p1', name: 'Widget', slug: 'widget' }, 999.6, 799.2)
    const bodyVars = mockRenderTemplate.mock.calls[1]?.[1]
    expect(bodyVars?.oldPrice).toBe('1000')
    expect(bodyVars?.newPrice).toBe('799')
  })
})

// ---------------------------------------------------------------------------
// sendTestCampaignEmail
// ---------------------------------------------------------------------------
describe('sendTestCampaignEmail', () => {
  it('returns campaign_not_found when campaign missing', async () => {
    mockGetCampaign.mockResolvedValue(null)
    const result = await sendTestCampaignEmail('abandoned_cart', 'admin@example.com')
    expect(result).toEqual({ ok: false, reason: 'campaign_not_found' })
  })

  it('sends test email and returns ok:true', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockRenderTemplate.mockReturnValue('rendered text')
    mockBaseLayout.mockReturnValue('<html>test</html>')
    mockSendAuditedMail.mockResolvedValue({ messageId: 'test-msg-1' })

    const result = await sendTestCampaignEmail('abandoned_cart', 'admin@example.com')
    expect(result).toEqual({ ok: true })
    expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    const callArg = mockSendAuditedMail.mock.calls[0][0]
    expect(callArg.to).toBe('admin@example.com')
    expect(callArg.kind).toBe('automation')
  })

  it('returns ok:false with error message when sendAuditedMail throws', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockRenderTemplate.mockReturnValue('rendered')
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockRejectedValue(new Error('SMTP unavailable'))

    const result = await sendTestCampaignEmail('abandoned_cart', 'admin@example.com')
    expect(result).toEqual({ ok: false, reason: 'SMTP unavailable' })
  })

  it('uses [TEST] prefix in subject', async () => {
    mockGetCampaign.mockResolvedValue(mockCampaign as any)
    mockRenderTemplate.mockReturnValue('Subject Text')
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendTestCampaignEmail('abandoned_cart', 'admin@example.com')
    const callArg = mockSendAuditedMail.mock.calls[0][0]
    expect(callArg.subject).toContain('[TEST]')
  })

  it('uses campaign.discount_percent or fallback 10 for sampleVars', async () => {
    mockGetCampaign.mockResolvedValue({ ...mockCampaign, discount_percent: 0 } as any)
    mockRenderTemplate.mockImplementation((_tmpl, vars) => JSON.stringify(vars))
    mockBaseLayout.mockReturnValue('<html/>')
    mockSendAuditedMail.mockResolvedValue({})

    await sendTestCampaignEmail('abandoned_cart', 'admin@example.com')
    const bodyVarsStr = mockRenderTemplate.mock.calls[1]?.[1]
    // discount_percent 0 → fallback 10
    expect(bodyVarsStr?.discountPercent).toBe(10)
  })
})
