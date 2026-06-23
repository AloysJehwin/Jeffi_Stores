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
  })
})
