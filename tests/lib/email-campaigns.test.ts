import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/mail-audit', () => ({
  sendAuditedMail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/template-vars', () => ({
  buildVarMap: vi.fn(() => ({})),
  substituteVars: vi.fn((str: string) => str),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
  },
}))

import * as mailAudit from '@/lib/mail-audit'
import * as db from '@/lib/db'
import { renderCampaignEmail, sendCampaign, baseLayout, ctaButton } from '@/lib/email-campaigns'

const mockSendAuditedMail = mailAudit.sendAuditedMail as ReturnType<typeof vi.fn>
const mockQuery = db.query as ReturnType<typeof vi.fn>
const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

describe('email-campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
    mockQuery.mockResolvedValue({ rows: [] })
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
  })

  describe('baseLayout', () => {
    it('wraps body in HTML with branding', () => {
      const html = baseLayout('Test Title', '<p>body content</p>')
      expect(html).toContain('body content')
      expect(html).toContain('Jeffi Store')
    })
  })

  describe('ctaButton', () => {
    it('renders an anchor tag with text and url', () => {
      const btn = ctaButton('Shop Now', 'https://example.com')
      expect(btn).toContain('href="https://example.com"')
      expect(btn).toContain('Shop Now')
    })
  })

  describe('renderCampaignEmail', () => {
    it('renders review_form_share template with default subject', () => {
      const { subject, html } = renderCampaignEmail('review_form_share', {
        formUrl: 'https://review.example.com',
        formTitle: 'Leave a Review',
      })
      expect(subject).toBeTruthy()
      expect(html).toContain('review')
    })

    it('renders review_form_share with couponCode in subject', () => {
      const { subject } = renderCampaignEmail('review_form_share', {
        formUrl: 'https://review.example.com',
        couponCode: 'SAVE10',
        subject: '',
      })
      // subject is data.subject || `Share your experience — get ${couponCode}!`
      // when subject is empty string, falls to default
      expect(subject).toContain('SAVE10')
    })

    it('renders review_form_share with provided subject override', () => {
      const { subject } = renderCampaignEmail('review_form_share', {
        formUrl: 'https://review.example.com',
        subject: 'My Custom Subject',
      })
      expect(subject).toBe('My Custom Subject')
    })

    it('renders promotion template', () => {
      const { subject, html } = renderCampaignEmail('promotion', {
        headline: 'Big Sale',
        body: 'Get 50% off',
        ctaUrl: 'https://shop.example.com',
        ctaText: 'Shop Now',
      })
      expect(subject).toBe('Big Sale')
      expect(html).toContain('Big Sale')
      expect(html).toContain('Get 50% off')
      expect(html).toContain('Shop Now')
    })

    it('renders promotion without a CTA button when no ctaUrl', () => {
      const { html } = renderCampaignEmail('promotion', {
        headline: 'Sale',
        body: 'Deals',
      })
      // No CTA anchor — footer links are present but no inline-block button
      expect(html).not.toContain('display:inline-block')
    })

    it('renders event template', () => {
      const { subject, html } = renderCampaignEmail('event', {
        eventName: 'Grand Opening',
        eventDate: '2026-07-01',
        eventDetails: 'Come join us',
        ctaUrl: 'https://event.example.com',
      })
      expect(subject).toContain('Grand Opening')
      expect(html).toContain('Grand Opening')
      expect(html).toContain('Come join us')
    })

    it('renders announcement template', () => {
      const { subject, html } = renderCampaignEmail('announcement', {
        headline: 'New Store Opening',
        body: 'We are opening a new store',
      })
      expect(subject).toBe('New Store Opening')
      expect(html).toContain('New Store Opening')
    })

    it('uses provided subject in announcement', () => {
      const { subject } = renderCampaignEmail('announcement', {
        headline: 'Something',
        body: 'Details',
        subject: 'Custom Announcement Subject',
      })
      expect(subject).toBe('Custom Announcement Subject')
    })

    it('renders custom template with raw html', () => {
      const { subject, html } = renderCampaignEmail('custom', {
        subject: 'Custom Email',
        htmlBody: '<p>Custom HTML body</p>',
      })
      expect(subject).toBe('Custom Email')
      expect(html).toContain('Custom HTML body')
    })

    it('renders custom template with full html doc as-is', () => {
      const fullDoc = '<!DOCTYPE html><html><body>Full Document</body></html>'
      const { html } = renderCampaignEmail('custom', {
        subject: 'Full Doc',
        htmlBody: fullDoc,
      })
      expect(html).toBe(fullDoc)
    })

    it('uses default subject in custom when not provided', () => {
      const { subject } = renderCampaignEmail('custom', {
        htmlBody: '<p>body</p>',
      })
      expect(subject).toBeTruthy()
    })

    it('includes recipient greeting when recipientName provided', () => {
      const { html } = renderCampaignEmail('announcement', {
        headline: 'Hello',
        body: 'Msg',
      }, 'Alice')
      expect(html).toContain('Hi Alice,')
    })

    it('uses fallback greeting when no recipient name', () => {
      const { html } = renderCampaignEmail('announcement', {
        headline: 'Hello',
        body: 'Msg',
      })
      expect(html).toContain('Hi there,')
    })

    it('throws on unknown template key', () => {
      expect(() => renderCampaignEmail('unknown_key', {})).toThrow(
        'Unknown template key: unknown_key'
      )
    })

    it('converts newlines to <br> in promotion body', () => {
      const { html } = renderCampaignEmail('promotion', {
        headline: 'Sale',
        body: 'Line1\nLine2',
      })
      expect(html).toContain('<br>')
    })

    it('converts newlines to <br> in event details', () => {
      const { html } = renderCampaignEmail('event', {
        eventName: 'Fest',
        eventDetails: 'Day1\nDay2',
      })
      expect(html).toContain('<br>')
    })

    // ── event: subject override and missing optional fields ──────────────────
    it('uses provided subject override in event template', () => {
      const { subject } = renderCampaignEmail('event', {
        eventName: 'Fest',
        subject: 'Custom Event Subject',
      })
      expect(subject).toBe('Custom Event Subject')
    })

    it('renders event without eventDate (no orange date line)', () => {
      const { html } = renderCampaignEmail('event', {
        eventName: 'Fest',
        eventDetails: 'Details here',
      })
      // eventDate block is omitted
      expect(html).not.toContain('color:#e07b3f;font-weight:600')
    })

    it('renders event without ctaUrl (no CTA button)', () => {
      const { html } = renderCampaignEmail('event', {
        eventName: 'Fest',
        eventDetails: 'Details',
      })
      expect(html).not.toContain('display:inline-block')
    })

    // ── promotion: subject override ──────────────────────────────────────────
    it('uses provided subject override in promotion template', () => {
      const { subject } = renderCampaignEmail('promotion', {
        headline: 'Sale',
        body: 'Deals',
        subject: 'Override Subject',
      })
      expect(subject).toBe('Override Subject')
    })

    it('falls back to default promotion subject when neither subject nor headline provided', () => {
      const { subject } = renderCampaignEmail('promotion', { body: 'Deals' })
      expect(subject).toBe('Special offer just for you')
    })

    // ── announcement: fallback when headline absent ──────────────────────────
    it('uses default announcement subject when neither subject nor headline given', () => {
      const { subject } = renderCampaignEmail('announcement', { body: 'Msg' })
      expect(subject).toContain("update from Jeffi Store")
    })

    // ── custom: <html tag detection (not DOCTYPE) ────────────────────────────
    it('returns full-doc html unchanged when body starts with <html tag', () => {
      const htmlDoc = '<html><head></head><body>Hello</body></html>'
      const { html } = renderCampaignEmail('custom', {
        subject: 'Test',
        htmlBody: htmlDoc,
      })
      expect(html).toBe(htmlDoc)
    })

    it('wraps partial html body in baseLayout', () => {
      const { html } = renderCampaignEmail('custom', {
        subject: 'Test',
        htmlBody: '<p>Just a paragraph</p>',
      })
      expect(html).toContain('Jeffi Store')
      expect(html).toContain('Just a paragraph')
    })

    it('renders custom template with empty htmlBody', () => {
      const { html } = renderCampaignEmail('custom', {
        subject: 'Empty',
        htmlBody: '',
      })
      expect(html).toContain('Jeffi Store')
    })

    // ── review_form_share: no couponCode → subject uses 'a reward' ───────────
    it('renders review_form_share subject with "a reward" when no couponCode', () => {
      const { subject } = renderCampaignEmail('review_form_share', {
        formUrl: 'https://review.example.com',
      })
      expect(subject).toContain('a reward')
    })

    // ── review_request: basic rendering ─────────────────────────────────────
    it('renders review_request template with items and returns ampHtml', () => {
      const items = [
        {
          name: 'Widget A',
          imageUrl: 'https://img.example.com/a.jpg',
          starLinks: ['https://review.example.com/rate?token=abc123&star=1', '', '', '', 'https://review.example.com/rate?token=abc123&star=5'],
          productUrl: 'https://jeffistores.in/products/widget-a',
        },
      ]
      const { subject, html, ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
        firstName: 'Alice',
      })
      expect(subject).toBeTruthy()
      expect(html).toContain('Widget A')
      expect(ampHtml).toContain('amp4email')
      expect(ampHtml).toContain('abc123')
    })

    it('renders review_request with custom subject override', () => {
      const { subject } = renderCampaignEmail('review_request', {
        itemsJson: '[]',
        subject: 'Rate your purchase',
      })
      expect(subject).toBe('Rate your purchase')
    })

    it('renders review_request with couponCode and discountPercent', () => {
      const items = [{ name: 'Item', imageUrl: null, starLinks: ['', '', '', '', ''] }]
      const { html, ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
        couponCode: 'THANKS10',
        discountPercent: '10',
      })
      expect(html).toContain('THANKS10')
      expect(html).toContain('10% off')
      expect(ampHtml).toContain('THANKS10')
      expect(ampHtml).toContain('10% off')
    })

    it('renders review_request with couponCode but no discountPercent', () => {
      const items = [{ name: 'Item', imageUrl: null, starLinks: [] }]
      const { html, ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
        couponCode: 'SAVE5',
      })
      expect(html).toContain('SAVE5')
      // discountPercent block is absent
      expect(html).not.toContain('% off your next purchase')
      expect(ampHtml).toContain('SAVE5')
    })

    it('renders review_request without couponCode (no coupon block)', () => {
      const items = [{ name: 'Item', imageUrl: null, starLinks: [] }]
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      expect(html).not.toContain('thank-you, use this code')
    })

    it('renders review_request item without imageUrl (no img tag in fallback)', () => {
      const items = [
        { name: 'No Image Item', imageUrl: null, starLinks: ['', '', '', '', 'https://jeffistores.in/products/x'] },
      ]
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      expect(html).toContain('No Image Item')
      expect(html).not.toContain('<img')
    })

    it('renders review_request item without productUrl falls back to starLinks[4]', () => {
      const items = [
        { name: 'Item', imageUrl: null, starLinks: ['', '', '', '', 'https://jeffistores.in/products/star'] },
      ]
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      expect(html).toContain('https://jeffistores.in/products/star')
    })

    it('renders review_request item without productUrl and no starLinks falls back to /products', () => {
      const items = [{ name: 'Item', imageUrl: null, starLinks: [] }]
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      expect(html).toContain('/products')
    })

    it('renders review_request with imageUrl in both fallback html and ampHtml', () => {
      const items = [
        { name: 'Img Item', imageUrl: 'https://cdn.example.com/img.jpg', starLinks: ['https://r.example.com?token=xyz'] },
      ]
      const { html, ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      expect(html).toContain('https://cdn.example.com/img.jpg')
      expect(ampHtml).toContain('https://cdn.example.com/img.jpg')
    })

    it('renders review_request AMP form without image when imageUrl is null', () => {
      const items = [{ name: 'Item', imageUrl: null, starLinks: ['https://r.example.com?token=tok1'] }]
      const { ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: JSON.stringify(items),
      })
      // td with width=68 only appears when there is an image
      expect(ampHtml).not.toContain('width="68"')
    })

    it('renders review_request with empty itemsJson array', () => {
      const { html, ampHtml } = renderCampaignEmail('review_request', {
        itemsJson: '[]',
      })
      expect(html).toContain('How did we do')
      expect(ampHtml).toContain('amp4email')
    })

    it('renders review_request without firstName (falls back to "there")', () => {
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: '[]',
      })
      expect(html).toContain('Hi there,')
    })

    it('renders review_request with firstName', () => {
      const { html } = renderCampaignEmail('review_request', {
        itemsJson: '[]',
        firstName: 'Bob',
      })
      expect(html).toContain('Hi Bob,')
    })
  })

  describe('sendCampaign', () => {
    const baseCampaign = {
      id: 'camp-1',
      title: 'Test Campaign',
      template_key: 'promotion',
      subject: 'Big Sale',
      template_data: { headline: 'Big Sale', body: 'Deals!' },
      audience_type: 'all',
      audience_filter: {},
      status: 'draft',
    }

    const recipients = [
      { user_id: 'u1', email: 'alice@example.com', first_name: 'Alice' },
      { user_id: 'u2', email: 'bob@example.com', first_name: 'Bob' },
    ]

    function setupDefaultCampaign(overrides: Record<string, unknown> = {}) {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue(recipients)
      mockQueryOne.mockResolvedValue({ ...baseCampaign, ...overrides })
    }

    it('throws if campaign not found', async () => {
      vi.clearAllMocks()
      mockQueryOne.mockResolvedValue(null)
      await expect(sendCampaign('nonexistent')).rejects.toThrow('Campaign not found')
    })

    it('throws if campaign already sent', async () => {
      vi.clearAllMocks()
      mockQueryOne.mockResolvedValue({ ...baseCampaign, status: 'sent' })
      await expect(sendCampaign('camp-1')).rejects.toThrow('Campaign already sent')
    })

    it('sends to all resolved recipients and returns counts', async () => {
      setupDefaultCampaign()
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
    })

    it('increments failed count on send error', async () => {
      setupDefaultCampaign()
      mockSendAuditedMail
        .mockResolvedValueOnce({ messageId: 'ok' })
        .mockRejectedValueOnce(new Error('Send failed'))

      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      expect(result.failed).toBe(1)
    })

    it('marks campaign as sending then sent', async () => {
      setupDefaultCampaign()
      await sendCampaign('camp-1')

      const queryCalls = mockQuery.mock.calls.map((c: any[]) => c[0] as string)
      expect(queryCalls.some(q => q.includes("status = 'sending'"))).toBe(true)
      expect(queryCalls.some(q => q.includes("status = 'sent'"))).toBe(true)
    })

    it('logs sent status for successful sends', async () => {
      setupDefaultCampaign()
      await sendCampaign('camp-1')

      const queryCalls = mockQuery.mock.calls.map((c: any[]) => c[0] as string)
      expect(queryCalls.some(q => q.includes('email_campaign_logs') && q.includes('sent'))).toBe(true)
    })

    it('logs failed status on send error', async () => {
      setupDefaultCampaign()
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP'))

      await sendCampaign('camp-1')

      const queryCalls = mockQuery.mock.calls.map((c: any[]) => c[0] as string)
      expect(queryCalls.some(q => q.includes('email_campaign_logs') && q.includes('failed'))).toBe(true)
    })

    it('grants coupon access when sourceCouponId provided', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      // queryOne: campaign fetch, then coupon fetch
      mockQueryOne
        .mockResolvedValueOnce({ ...baseCampaign, audience_filter: { couponId: 'coupon-123' } })
        .mockResolvedValueOnce({ id: 'coupon-123', code: 'SAVE20', discount_type: 'percentage', discount_value: 20 })

      await sendCampaign('camp-1')

      const queryCalls = mockQuery.mock.calls.map((c: any[]) => c[0] as string)
      expect(queryCalls.some(q => q.includes('coupon_eligible_users'))).toBe(true)
    })

    it('appends percentage coupon label to email body', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne
        .mockResolvedValueOnce({
          ...baseCampaign,
          template_key: 'promotion',
          template_data: { headline: 'Sale', body: 'Deals' },
          audience_filter: { couponId: 'coupon-123' },
        })
        .mockResolvedValueOnce({ id: 'coupon-123', code: 'SAVE20', discount_type: 'percentage', discount_value: 20 })

      await sendCampaign('camp-1')

      const sentHtml = mockSendAuditedMail.mock.calls[0][0].html as string
      expect(sentHtml).toContain('SAVE20')
      expect(sentHtml).toContain('20% off')
    })

    it('appends fixed coupon label to email body', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne
        .mockResolvedValueOnce({
          ...baseCampaign,
          template_key: 'promotion',
          template_data: { headline: 'Sale', body: 'Deals' },
          audience_filter: { couponId: 'coupon-fixed' },
        })
        .mockResolvedValueOnce({ id: 'coupon-fixed', code: 'FLAT50', discount_type: 'fixed', discount_value: 50 })

      await sendCampaign('camp-1')

      const sentHtml = mockSendAuditedMail.mock.calls[0][0].html as string
      expect(sentHtml).toContain('FLAT50')
      expect(sentHtml).toContain('₹50 off')
    })

    it('sends with null first_name recipient (no name greeting)', async () => {
      setupDefaultCampaign()
      mockQueryMany.mockResolvedValue([
        { user_id: 'u3', email: 'noname@example.com', first_name: null },
      ])
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      expect(result.failed).toBe(0)
      const sentHtml = mockSendAuditedMail.mock.calls[0][0].html as string
      expect(sentHtml).toContain('Hi there,')
    })

    it('skips coupon grant when couponId provided but coupon lookup returns null', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne
        .mockResolvedValueOnce({ ...baseCampaign, audience_filter: { couponId: 'missing-coupon' } })
        .mockResolvedValueOnce(null) // coupon not found

      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      const queryCalls = mockQuery.mock.calls.map((c: any[]) => c[0] as string)
      expect(queryCalls.some(q => q.includes('coupon_eligible_users'))).toBe(false)
    })

    it('sends to zero recipients when audience resolves empty', async () => {
      setupDefaultCampaign()
      mockQueryMany.mockResolvedValue([])
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('resolves customer_type audience', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'customer_type',
        audience_filter: { customerTypes: ['retail'] },
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining('customer_type'),
        expect.anything()
      )
    })

    it('resolves order_history audience with custom daysSinceOrder', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'order_history',
        audience_filter: { daysSinceOrder: 60 },
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      const sql60 = mockQueryMany.mock.calls[0][0] as string
      expect(sql60).toContain('60 days')
    })

    it('resolves order_history audience with default 30 days when not specified', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'order_history',
        audience_filter: {},
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      const sql30 = mockQueryMany.mock.calls[0][0] as string
      expect(sql30).toContain('30 days')
    })

    it('resolves specific_user audience', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'specific_user',
        audience_filter: { userId: 'u1' },
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining('u.id = $1'),
        expect.arrayContaining(['u1'])
      )
    })

    it.each([
      ['vip', 'lifetime_value'],
      ['loyal', 'paid_orders'],
      ['b2b', 'gst_number'],
      ['repeat', 'order_count'],
      ['one_time', 'order_count'],
      ['new', 'created_at'],
      ['at_risk', 'last_order_at'],
      ['dormant', 'last_order_at'],
      ['lead', 'order_count'],
    ])('resolves segment audience "%s"', async (seg, expectedToken) => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'segment',
        audience_filter: { segment: seg },
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      const segSql = mockQueryMany.mock.calls[0][0] as string
      expect(segSql).toContain(expectedToken)
    })

    it('resolves segment audience with unknown segment falls back to all', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'segment',
        audience_filter: { segment: 'nonexistent_segment' },
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
      // Falls through to default queryMany — no segment-specific condition appended
      const fallbackSql = mockQueryMany.mock.calls[0][0] as string
      expect(fallbackSql).toContain('is_active = true')
    })

    it('resolves unknown audienceType falls back to all users', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne.mockResolvedValue({
        ...baseCampaign,
        audience_type: 'totally_unknown',
        audience_filter: {},
      })
      const result = await sendCampaign('camp-1')
      expect(result.sent).toBe(1)
    })

    it('appends coupon body when template_data has no existing body', async () => {
      vi.clearAllMocks()
      mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
      mockQuery.mockResolvedValue({ rows: [] })
      mockQueryMany.mockResolvedValue([recipients[0]])
      mockQueryOne
        .mockResolvedValueOnce({
          ...baseCampaign,
          template_key: 'promotion',
          template_data: { headline: 'Sale' }, // no body key
          audience_filter: { couponId: 'c1' },
        })
        .mockResolvedValueOnce({ id: 'c1', code: 'NODEAL', discount_type: 'percentage', discount_value: 5 })

      await sendCampaign('camp-1')
      const sentHtml = mockSendAuditedMail.mock.calls[0][0].html as string
      expect(sentHtml).toContain('NODEAL')
    })
  })
})
