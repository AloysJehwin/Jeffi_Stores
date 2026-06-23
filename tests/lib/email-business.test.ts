import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/mail-audit', () => ({
  sendAuditedMail: vi.fn(),
}))

import * as mailAudit from '@/lib/mail-audit'
import {
  sendRfqSubmittedEmail,
  sendRfqConvertedToQuotationEmail,
  sendBusinessAccountApprovedEmail,
  sendBusinessAccountRejectedEmail,
  sendBusinessInvoiceGeneratedEmail,
  sendBusinessOrderStatusEmail,
} from '@/lib/email-business'

const mockSendAuditedMail = mailAudit.sendAuditedMail as ReturnType<typeof vi.fn>

describe('email-business', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
  })

  describe('sendRfqSubmittedEmail', () => {
    it('sends two emails (user + admin) via Promise.allSettled', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Alice', 'RFQ-001')

      expect(mockSendAuditedMail).toHaveBeenCalledTimes(2)
    })

    it('sends to buyer email and admin email', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Alice', 'RFQ-001')

      const calls = mockSendAuditedMail.mock.calls.map((c: any[]) => c[0].to)
      expect(calls).toContain('buyer@example.com')
      // admin email: env var or default
      const adminRecipient = calls.find((t: string) => t !== 'buyer@example.com')
      expect(adminRecipient).toBeTruthy()
    })

    it('uses correct template names', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Bob', 'RFQ-002')

      const templateNames = mockSendAuditedMail.mock.calls.map(
        (c: any[]) => c[0].templateName
      )
      expect(templateNames).toContain('rfq_submitted_user')
      expect(templateNames).toContain('rfq_submitted_admin')
    })

    it('includes rfqNumber in subject', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Carol', 'RFQ-999')

      const subjects = mockSendAuditedMail.mock.calls.map((c: any[]) => c[0].subject)
      expect(subjects.some((s: string) => s.includes('RFQ-999'))).toBe(true)
    })

    it('does not throw even if one email fails (allSettled)', async () => {
      mockSendAuditedMail
        .mockResolvedValueOnce({ messageId: 'ok' })
        .mockRejectedValueOnce(new Error('Admin mail failed'))

      // Should complete without throwing
      await expect(
        sendRfqSubmittedEmail('buyer@example.com', 'Dave', 'RFQ-003')
      ).resolves.toBeUndefined()
    })
  })

  describe('sendRfqConvertedToQuotationEmail', () => {
    it('returns success on valid call', async () => {
      const result = await sendRfqConvertedToQuotationEmail(
        'buyer@example.com', 'Eve', 'RFQ-010', 'QT-010', 12500, 'https://example.com/qt/010'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes quotation number in subject', async () => {
      await sendRfqConvertedToQuotationEmail(
        'buyer@example.com', 'Eve', 'RFQ-010', 'QT-010', 12500, 'https://example.com'
      )
      const { subject } = mockSendAuditedMail.mock.calls[0][0]
      expect(subject).toContain('QT-010')
    })

    it('formats total amount with 2 decimal places in html', async () => {
      await sendRfqConvertedToQuotationEmail(
        'buyer@example.com', 'Eve', 'RFQ-010', 'QT-010', 12500, 'https://example.com'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('12,500.00')
    })

    it('returns error object on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP'))
      const result = await sendRfqConvertedToQuotationEmail(
        'buyer@example.com', 'Eve', 'RFQ-010', 'QT-010', 0, 'https://example.com'
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendBusinessAccountApprovedEmail', () => {
    it('returns success result', async () => {
      const result = await sendBusinessAccountApprovedEmail(
        'biz@example.com', 'Frank', 'Acme Corp'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('uses correct template name', async () => {
      await sendBusinessAccountApprovedEmail('biz@example.com', 'Frank', 'Acme Corp')
      expect(mockSendAuditedMail.mock.calls[0][0].templateName).toBe('business_account_approved')
    })

    it('includes company name in html', async () => {
      await sendBusinessAccountApprovedEmail('biz@example.com', 'Frank', 'Acme Corp')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Acme Corp')
    })
  })

  describe('sendBusinessAccountRejectedEmail', () => {
    it('returns success result', async () => {
      const result = await sendBusinessAccountRejectedEmail(
        'biz@example.com', 'Grace', 'Globex', null
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes rejection note when provided', async () => {
      await sendBusinessAccountRejectedEmail(
        'biz@example.com', 'Grace', 'Globex', 'Incomplete documents'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Incomplete documents')
    })

    it('omits rejection note block when null', async () => {
      await sendBusinessAccountRejectedEmail(
        'biz@example.com', 'Grace', 'Globex', null
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Reason:')
    })

    it('uses correct template name', async () => {
      await sendBusinessAccountRejectedEmail('biz@example.com', 'G', 'Co', undefined)
      expect(mockSendAuditedMail.mock.calls[0][0].templateName).toBe('business_account_rejected')
    })
  })

  describe('sendBusinessInvoiceGeneratedEmail', () => {
    it('returns success result', async () => {
      const result = await sendBusinessInvoiceGeneratedEmail(
        'biz@example.com', 'Hank', 'INV-001', 'ORD-001', 9999.99, 'https://example.com/inv/1'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes invoice number in subject', async () => {
      await sendBusinessInvoiceGeneratedEmail(
        'biz@example.com', 'Hank', 'INV-007', 'ORD-007', 1000, 'https://example.com'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].subject).toContain('INV-007')
    })

    it('formats amount with 2 decimal places', async () => {
      await sendBusinessInvoiceGeneratedEmail(
        'biz@example.com', 'Hank', 'INV-007', 'ORD-007', 9999.99, 'https://example.com'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('9,999.99')
    })
  })

  describe('sendBusinessOrderStatusEmail', () => {
    it('returns success for known status', async () => {
      const result = await sendBusinessOrderStatusEmail(
        'biz@example.com', 'Iris', 'ORD-100', 'shipped'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('maps status to human-readable label', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'delivered')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Delivered')
    })

    it('falls back to raw status for unknown status', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'on_hold')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('on_hold')
    })

    it('includes invoice link when provided', async () => {
      await sendBusinessOrderStatusEmail(
        'biz@example.com', 'Iris', 'ORD-100', 'delivered', 'https://example.com/inv/1'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('https://example.com/inv/1')
    })

    it('omits invoice link when not provided', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'shipped')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('View Invoice')
    })

    it('uses correct template name', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'processing')
      expect(mockSendAuditedMail.mock.calls[0][0].templateName).toBe('business_order_status')
    })

    it('uses business kind', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'processing')
      expect(mockSendAuditedMail.mock.calls[0][0].kind).toBe('business')
    })
  })
})
