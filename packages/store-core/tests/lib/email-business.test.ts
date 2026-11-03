import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate: vi.fn() }))
vi.mock('@/lib/email/shared', () => ({ getAdminNotificationEmails: vi.fn(async () => 'admin@example.com') }))
vi.mock('@/lib/catalog/brand', () => ({
  businessBaseUrlAsync: vi.fn(async () => 'https://business.example.com'),
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin.example.com'),
}))

import { sendByTemplate } from '@/lib/shared/send-by-template'
import {
  sendRfqSubmittedEmail,
  sendRfqConvertedToQuotationEmail,
  sendBusinessAccountApprovedEmail,
  sendBusinessAccountRejectedEmail,
  sendBusinessInvoiceGeneratedEmail,
  sendBusinessOrderStatusEmail,
} from '@/lib/shared/email-business'

const mockSend = vi.mocked(sendByTemplate)
const call = (i = 0) => mockSend.mock.calls[i][0]

describe('email-business', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ id: 'msg-ok', status: 'sent' })
  })

  describe('sendRfqSubmittedEmail', () => {
    it('sends two emails (user + admin) via Promise.allSettled', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Alice', 'RFQ-001')
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('sends to buyer email and admin email', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Alice', 'RFQ-001')
      const tos = mockSend.mock.calls.map(c => c[0].to)
      expect(tos).toContain('buyer@example.com')
      expect(tos).toContain('admin@example.com')
    })

    it('uses correct template slugs', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Bob', 'RFQ-002')
      const slugs = mockSend.mock.calls.map(c => c[0].slug)
      expect(slugs).toContain('b2b/rfq-submitted')
      expect(slugs).toContain('b2b/rfq-submitted-admin')
    })

    it('passes rfqNumber to both templates', async () => {
      await sendRfqSubmittedEmail('buyer@example.com', 'Carol', 'RFQ-999')
      expect(mockSend.mock.calls.every(c => c[0].variables?.rfq_number === 'RFQ-999')).toBe(true)
    })

    it('does not throw even if one email fails (allSettled)', async () => {
      mockSend.mockResolvedValueOnce({ id: 'ok', status: 'sent' }).mockRejectedValueOnce(new Error('Admin mail failed'))
      await expect(sendRfqSubmittedEmail('buyer@example.com', 'Dave', 'RFQ-003')).resolves.toBeUndefined()
    })
  })

  describe('sendRfqConvertedToQuotationEmail', () => {
    const send = (total = 12500) =>
      sendRfqConvertedToQuotationEmail('buyer@example.com', 'Eve', 'RFQ-010', 'QT-010', total, 'https://example.com/qt/010')

    it('returns the send result on valid call', async () => {
      expect(await send()).toEqual({ id: 'msg-ok', status: 'sent' })
      expect(call().slug).toBe('b2b/quotation-ready')
    })

    it('passes quotation number and url', async () => {
      await send()
      expect(call().variables).toMatchObject({ quotation_number: 'QT-010', quotation_url: 'https://example.com/qt/010' })
    })

    it('formats total amount with 2 decimal places', async () => {
      await send()
      expect(call().variables?.total).toBe('12,500.00')
    })

    it('returns the failed result on failure', async () => {
      mockSend.mockResolvedValue({ status: 'failed', error: 'SMTP' })
      expect(await send(0)).toEqual({ status: 'failed', error: 'SMTP' })
    })
  })

  describe('sendBusinessAccountApprovedEmail', () => {
    it('returns the send result', async () => {
      const result = await sendBusinessAccountApprovedEmail('biz@example.com', 'Frank', 'Acme Corp')
      expect(result).toEqual({ id: 'msg-ok', status: 'sent' })
    })

    it('uses correct template slug', async () => {
      await sendBusinessAccountApprovedEmail('biz@example.com', 'Frank', 'Acme Corp')
      expect(call().slug).toBe('b2b/account-approved')
    })

    it('passes company name and sign-in url', async () => {
      await sendBusinessAccountApprovedEmail('biz@example.com', 'Frank', 'Acme Corp')
      expect(call().variables).toMatchObject({ company_name: 'Acme Corp', signin_url: 'https://business.example.com/signin' })
    })
  })

  describe('sendBusinessAccountRejectedEmail', () => {
    it('returns the send result', async () => {
      const result = await sendBusinessAccountRejectedEmail('biz@example.com', 'Grace', 'Globex', null)
      expect(result).toEqual({ id: 'msg-ok', status: 'sent' })
    })

    it('includes rejection note when provided', async () => {
      await sendBusinessAccountRejectedEmail('biz@example.com', 'Grace', 'Globex', 'Incomplete documents')
      expect(call().variables?.reason).toBe('Reason: Incomplete documents')
    })

    it('omits rejection note when null', async () => {
      await sendBusinessAccountRejectedEmail('biz@example.com', 'Grace', 'Globex', null)
      expect(call().variables?.reason).toBe('')
    })

    it('uses correct template slug', async () => {
      await sendBusinessAccountRejectedEmail('biz@example.com', 'G', 'Co', undefined)
      expect(call().slug).toBe('b2b/account-rejected')
    })
  })

  describe('sendBusinessInvoiceGeneratedEmail', () => {
    const send = (inv = 'INV-001', total = 9999.99) =>
      sendBusinessInvoiceGeneratedEmail('biz@example.com', 'Hank', inv, 'ORD-001', total, 'https://example.com/inv/1')

    it('returns the send result', async () => {
      expect(await send()).toEqual({ id: 'msg-ok', status: 'sent' })
      expect(call().slug).toBe('b2b/invoice-generated')
    })

    it('passes invoice number', async () => {
      await send('INV-007', 1000)
      expect(call().variables?.invoice_number).toBe('INV-007')
    })

    it('formats amount with 2 decimal places', async () => {
      await send()
      expect(call().variables?.total).toBe('9,999.99')
    })
  })

  describe('sendBusinessOrderStatusEmail', () => {
    it('returns the send result for known status', async () => {
      const result = await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'shipped')
      expect(result).toEqual({ id: 'msg-ok', status: 'sent' })
    })

    it('maps status to human-readable label', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'delivered')
      expect(call().variables?.status_label).toBe('Delivered')
    })

    it('falls back to raw status for unknown status', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'on_hold')
      expect(call().variables?.status_label).toBe('on_hold')
    })

    it('includes invoice link when provided', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'delivered', 'https://example.com/inv/1')
      expect(call().variables?.extra_cta).toContain('https://example.com/inv/1')
    })

    it('omits invoice link when not provided', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'shipped')
      expect(call().variables?.extra_cta).toBe('')
    })

    it('uses correct template slug', async () => {
      await sendBusinessOrderStatusEmail('biz@example.com', 'Iris', 'ORD-100', 'processing')
      expect(call().slug).toBe('b2b/order-status')
    })
  })
})
