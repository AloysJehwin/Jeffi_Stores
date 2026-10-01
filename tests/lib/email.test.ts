import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/mail-audit', () => ({
  sendAuditedMail: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
  },
}))

import * as mailAudit from '@/lib/shared/mail-audit'
import * as db from '@/lib/shared/db'
import {
  sendOTPEmail,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendNewOrderNotification,
  sendOrderStatusUpdate,
  sendPaymentStatusUpdate,
  sendAdminCertificateEmail,
  sendNewReviewNotification,
  sendPaymentFailedAdminNotification,
  sendAdminContactEmail,
  sendSupportEscalationEmail,
  sendAgentConnectedEmail,
  sendReturnStatusEmail,
  sendPaymentRetryEmail,
  sendInvoiceFinalizedEmail,
  sendPurchaseOrderEmail,
  sendPOReceiveNotificationEmail,
  sendQuotationFinalizedEmail,
  sendOrderAutoCancelledEmail,
  sendOrderAutoCancelledAdminNotification,
  sendOrderDelayNotification,
  sendProductAnnouncementEmail,
} from '@/lib/email'

const mockSendAuditedMail = mailAudit.sendAuditedMail as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

const mockOrder = {
  order_number: 'ORD-001',
  id: 'order-id-1',
  customer_name: 'Alice',
  customer_email: 'alice@example.com',
  customer_phone: '9876543210',
  subtotal: '1000',
  tax_amount: '180',
  total_amount: '1180',
  discount_amount: '0',
  shipping_amount: '0',
  payment_status: 'paid',
  shipping_address: '123 Main St, Raipur',
}

const mockOrderItems = [{ product_name: 'Widget A', quantity: 2, unit_price: '500', total_price: '1000', sku: 'WGT-A' }]

describe('email.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-ok' })
    // Default: no admin rows → falls back to env / default
    mockQueryMany.mockResolvedValue([])
  })

  describe('sendOTPEmail', () => {
    it('sends OTP email with subject containing verification', async () => {
      await sendOTPEmail('user@example.com', '123456')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toBe('user@example.com')
      expect(opts.subject).toContain('Verification')
    })

    it('includes OTP code in html body', async () => {
      await sendOTPEmail('user@example.com', '654321')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('654321')
    })

    it('includes recipient name when provided', async () => {
      await sendOTPEmail('user@example.com', '111111', 'Bob')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Bob')
    })

    it('falls back to Customer when name is omitted', async () => {
      await sendOTPEmail('user@example.com', '222222')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Customer')
    })

    it('returns success result', async () => {
      const result = await sendOTPEmail('user@example.com', '000000')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOTPEmail('user@example.com', '000000')
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendWelcomeEmail', () => {
    it('sends welcome email', async () => {
      await sendWelcomeEmail('new@example.com', 'Carol')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toBe('new@example.com')
      expect(opts.subject).toContain('Welcome')
    })

    it('includes recipient name in html', async () => {
      await sendWelcomeEmail('new@example.com', 'Carol')
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Carol')
    })

    it('returns success result', async () => {
      const result = await sendWelcomeEmail('new@example.com', 'Carol')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendWelcomeEmail('new@example.com', 'Carol')
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendOrderConfirmationEmail', () => {
    it('sends order confirmation email', async () => {
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, mockOrderItems)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toBe('cust@example.com')
      expect(opts.subject).toContain('ORD-001')
    })

    it('includes order items in html', async () => {
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, mockOrderItems)
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Widget A')
    })

    it('returns success result', async () => {
      const result = await sendOrderConfirmationEmail('cust@example.com', mockOrder, mockOrderItems)
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('shows GSTIN when taxable_amount > 0', async () => {
      const order = {
        ...mockOrder,
        taxable_amount: 1000,
        is_igst: false,
        igst_amount: 0,
        cgst_amount: 90,
        sgst_amount: 90,
        created_at: new Date().toISOString(),
      }
      await sendOrderConfirmationEmail('cust@example.com', order, mockOrderItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('GSTIN')
    })

    it('shows IGST line when is_igst is true', async () => {
      const order = {
        ...mockOrder,
        taxable_amount: 1000,
        is_igst: true,
        igst_amount: 180,
        cgst_amount: 0,
        sgst_amount: 0,
        created_at: new Date().toISOString(),
      }
      await sendOrderConfirmationEmail('cust@example.com', order, mockOrderItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('IGST')
      expect(html).not.toContain('CGST')
    })

    it('shows CGST/SGST lines when is_igst is false', async () => {
      const order = {
        ...mockOrder,
        taxable_amount: 1000,
        is_igst: false,
        igst_amount: 0,
        cgst_amount: 90,
        sgst_amount: 90,
        created_at: new Date().toISOString(),
      }
      await sendOrderConfirmationEmail('cust@example.com', order, mockOrderItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('CGST')
      expect(html).toContain('SGST')
    })

    it('hides GSTIN block when taxable_amount is 0', async () => {
      const order = { ...mockOrder, taxable_amount: 0, created_at: new Date().toISOString() }
      await sendOrderConfirmationEmail('cust@example.com', order, mockOrderItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('GSTIN')
    })

    it('formats weight/length buy_mode items with decimal quantity and unit', async () => {
      const items = [{ product_name: 'Wire', quantity: 2.5, total_price: 500, buy_mode: 'weight', buy_unit: 'kg' }]
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, items)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('2.500')
      expect(html).toContain('kg')
    })

    it('formats length buy_mode items with decimal quantity', async () => {
      const items = [{ product_name: 'Rod', quantity: 3.1, total_price: 300, buy_mode: 'length', buy_unit: 'm' }]
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, items)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('3.100')
    })

    it('uses empty string when buy_unit is null', async () => {
      const items = [{ product_name: 'Rope', quantity: 1.5, total_price: 150, buy_mode: 'weight', buy_unit: null }]
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, items)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('1.500')
    })

    it('formats regular buy_mode items as integer quantity', async () => {
      const items = [{ product_name: 'Bolt', quantity: 10, total_price: 100, buy_mode: 'unit', buy_unit: 'pcs' }]
      await sendOrderConfirmationEmail('cust@example.com', mockOrder, items)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('>10<')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOrderConfirmationEmail('cust@example.com', mockOrder, mockOrderItems)
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendNewOrderNotification', () => {
    it('sends to admin email', async () => {
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('ORD-001')
    })

    it('uses admin emails from DB when available', async () => {
      mockQueryMany.mockResolvedValue([{ email: 'db-admin@example.com' }])
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toContain('db-admin@example.com')
    })

    it('joins multiple DB admin emails with comma', async () => {
      mockQueryMany.mockResolvedValue([{ email: 'a@example.com' }, { email: 'b@example.com' }])
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toContain('a@example.com')
      expect(opts.to).toContain('b@example.com')
    })

    it('falls back to env ADMIN_EMAIL when DB returns empty', async () => {
      mockQueryMany.mockResolvedValue([])
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      // Should still send (to default admin)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('falls back to default when DB query throws', async () => {
      mockQueryMany.mockRejectedValue(new Error('DB down'))
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('shows order notes when present', async () => {
      const orderWithNotes = { ...mockOrder, notes: 'Please deliver before noon' }
      await sendNewOrderNotification(orderWithNotes, mockOrderItems, {})
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Please deliver before noon')
    })

    it('omits notes section when notes is absent', async () => {
      const orderWithoutNotes = { ...mockOrder, notes: undefined }
      await sendNewOrderNotification(orderWithoutNotes, mockOrderItems, {})
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Customer Notes')
    })

    it('shows Not provided when customer_phone is missing', async () => {
      const orderNoPhone = { ...mockOrder, customer_phone: undefined }
      await sendNewOrderNotification(orderNoPhone, mockOrderItems, {})
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Not provided')
    })

    it('formats weight buy_mode items in admin notification', async () => {
      const items = [
        {
          product_name: 'Wire',
          product_sku: 'W1',
          quantity: 1.5,
          unit_price: 100,
          total_price: 150,
          buy_mode: 'weight',
          buy_unit: 'kg',
        },
      ]
      await sendNewOrderNotification(mockOrder, items, {})
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('1.500')
      expect(html).toContain('kg')
    })

    it('returns success result', async () => {
      const result = await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendOrderStatusUpdate', () => {
    it('sends status update for shipped status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'shipped')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toBeTruthy()
    })

    it('includes Track Your Order link for shipped status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'shipped')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Track Your Order')
    })

    it('sends status update for delivered status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'delivered')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('includes Thank You block for delivered status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'delivered')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Thank You')
    })

    it('sends status update for cancelled status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'cancelled')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('uses fallback title/message for unknown status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'awaiting_customs')
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('Order Update')
      expect(opts.html).toContain('awaiting_customs')
    })

    it('shows previousStatus when provided', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'confirmed', 'pending')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('pending')
    })

    it('omits previousStatus line when not provided', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'confirmed')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Previous Status')
    })

    it('attaches invoice PDF when provided', async () => {
      const pdfBuf = Buffer.from('fake-pdf')
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'confirmed', undefined, pdfBuf)
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments).toBeDefined()
      expect(opts.attachments?.length).toBeGreaterThan(0)
    })

    it('sends empty attachments when invoicePdfBuffer is null', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'confirmed', undefined, null)
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments).toEqual([])
    })

    it('includes cancellation note when provided', async () => {
      await sendOrderStatusUpdate(
        'cust@example.com',
        'Alice',
        'ORD-001',
        'id-1',
        'cancelled',
        undefined,
        null,
        'Out of stock'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Out of stock')
    })

    it('omits cancellation note block when not provided', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'cancelled')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Reason')
    })

    it('returns success result', async () => {
      const result = await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'processing')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'shipped')
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendPaymentStatusUpdate', () => {
    it('sends payment paid update', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 1180)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toBeTruthy()
    })

    it('includes Payment Confirmed block for paid status', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 1180)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Payment Confirmed')
    })

    it('sends payment pending update with Action Required block', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'pending', 1180)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Action Required')
    })

    it('sends payment refunded update with Refund Processed block', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'refunded', 1180)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Refund Processed')
    })

    it('sends payment failed update', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'failed', 1180)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('includes 10 minute window block for failed status', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'failed', 1180)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('10 Minute Window')
    })

    it('uses fallback title/message for unknown payment status', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'disputed', 500)
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('Payment Update')
      expect(opts.html).toContain('disputed')
    })

    it('returns success result', async () => {
      const result = await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 500)
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 500)
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendAdminCertificateEmail', () => {
    it('sends certificate email with attachment', async () => {
      await sendAdminCertificateEmail(
        'admin@example.com',
        'admin_user',
        Buffer.from('p12data'),
        'pass123',
        'SN001',
        '2027-01-01',
        'admin'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments?.length).toBeGreaterThan(0)
    })

    it('includes serial number in html', async () => {
      await sendAdminCertificateEmail(
        'admin@example.com',
        'admin_user',
        Buffer.from('p12data'),
        'pass123',
        'SN-UNIQUE-001',
        '2027-01-01',
        'admin'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('SN-UNIQUE-001')
    })

    it('returns success result', async () => {
      const result = await sendAdminCertificateEmail(
        'admin@example.com',
        'admin_user',
        Buffer.from('p12'),
        'pw',
        'SN1',
        '2027-01-01',
        'admin'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendAdminCertificateEmail(
        'admin@example.com',
        'admin_user',
        Buffer.from('p12'),
        'pw',
        'SN1',
        '2027-01-01',
        'admin'
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })

    it('default (both) mode: the attachment mail also carries the certificate portal link', async () => {
      delete process.env.CERT_PORTAL_DELIVERY
      await sendAdminCertificateEmail(
        'admin@example.com',
        'admin_user',
        Buffer.from('p12'),
        'pw',
        'SN1',
        '2027-01-01',
        'admin'
      )
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments?.length).toBeGreaterThan(0)
      expect(opts.html).toContain('https://certificate.jeffistores.in')
      expect(opts.html).toContain('admin@example.com')
    })

    it('email mode: attachment only, no portal link', async () => {
      process.env.CERT_PORTAL_DELIVERY = 'email'
      try {
        await sendAdminCertificateEmail(
          'admin@example.com',
          'admin_user',
          Buffer.from('p12'),
          'pw',
          'SN1',
          '2027-01-01',
          'admin'
        )
        const opts = mockSendAuditedMail.mock.calls[0][0]
        expect(opts.attachments?.length).toBeGreaterThan(0)
        expect(opts.html).not.toContain('certificate.jeffistores.in')
      } finally {
        delete process.env.CERT_PORTAL_DELIVERY
      }
    })

    it('portal mode: sends the invite instead, with no attachment', async () => {
      process.env.CERT_PORTAL_DELIVERY = 'portal'
      try {
        await sendAdminCertificateEmail(
          'admin@example.com',
          'admin_user',
          Buffer.from('p12'),
          'Plain-Text-Pass-9Q',
          'SN1',
          '2027-01-01',
          'admin'
        )
        expect(mockSendAuditedMail).toHaveBeenCalledOnce()
        const opts = mockSendAuditedMail.mock.calls[0][0]
        expect(opts.templateName).toBe('admin_cert_invite')
        expect(opts.attachments).toEqual([])
        expect(opts.html).toContain('https://certificate.jeffistores.in')
        expect(opts.html).not.toContain('Plain-Text-Pass-9Q')
      } finally {
        delete process.env.CERT_PORTAL_DELIVERY
      }
    })
  })

  describe('sendNewReviewNotification', () => {
    it('sends review notification to admin', async () => {
      const review = { id: 'r1', rating: 5, comment: 'Great!' }
      const user = { name: 'Alice', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' }
      const product = { name: 'Widget', id: 'p1' }
      await sendNewReviewNotification(review, user, product)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('Widget')
    })

    it('shows Verified Purchase badge when is_verified_purchase is true', async () => {
      const review = { id: 'r2', rating: 4, comment: 'Good', is_verified_purchase: true }
      const user = { name: 'Bob', email: 'bob@example.com', first_name: 'Bob', last_name: 'Jones' }
      const product = { name: 'Tool', id: 'p2' }
      await sendNewReviewNotification(review, user, product)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Verified Purchase')
    })

    it('omits verified badge when is_verified_purchase is false', async () => {
      const review = { id: 'r3', rating: 3, comment: 'OK', is_verified_purchase: false }
      const user = { first_name: 'Carol', last_name: 'White', email: 'carol@example.com' }
      const product = { name: 'Gadget', id: 'p3' }
      await sendNewReviewNotification(review, user, product)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Verified Purchase')
    })

    it('shows review title when present', async () => {
      const review = { id: 'r4', rating: 5, comment: 'Excellent', title: 'Best product ever' }
      const user = { first_name: 'Dan', last_name: 'Brown', email: 'dan@example.com' }
      const product = { name: 'Widget Pro', id: 'p4' }
      await sendNewReviewNotification(review, user, product)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Best product ever')
    })

    it('omits review title block when title is absent', async () => {
      const review = { id: 'r5', rating: 5, comment: 'Great' }
      const user = { first_name: 'Eve', last_name: 'Green', email: 'eve@example.com' }
      const product = { name: 'Widget Lite', id: 'p5' }
      await sendNewReviewNotification(review, user, product)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Review Title')
    })

    it('returns success result', async () => {
      const result = await sendNewReviewNotification(
        { rating: 4, comment: 'Good' },
        { name: 'Bob', email: 'bob@example.com', first_name: 'Bob', last_name: 'Jones' },
        { name: 'Gadget', id: 'p2' }
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendNewReviewNotification(
        { rating: 3, comment: 'OK' },
        { first_name: 'X', last_name: 'Y', email: 'x@y.com' },
        { name: 'Item', id: 'p6' }
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendPaymentFailedAdminNotification', () => {
    it('sends payment failure notification to admin', async () => {
      await sendPaymentFailedAdminNotification({
        order_number: 'ORD-002',
        id: 'id-2',
        customer_name: 'Dave',
        customer_email: 'dave@example.com',
        total_amount: '2000',
      })
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('ORD-002')
    })

    it('includes error description when provided', async () => {
      await sendPaymentFailedAdminNotification(
        {
          order_number: 'ORD-003',
          id: 'id-3',
          customer_name: 'Eve',
          customer_email: 'eve@example.com',
          total_amount: '500',
        },
        'Card declined'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Card declined')
    })

    it('omits error description when not provided', async () => {
      await sendPaymentFailedAdminNotification({
        order_number: 'ORD-005',
        id: 'id-5',
        customer_name: 'George',
        customer_email: 'george@example.com',
        total_amount: '300',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Reason:')
    })

    it('shows phone when customer_phone is provided', async () => {
      await sendPaymentFailedAdminNotification({
        order_number: 'ORD-006',
        id: 'id-6',
        customer_name: 'Hana',
        customer_email: 'hana@example.com',
        total_amount: '800',
        customer_phone: '9876543210',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('9876543210')
    })

    it('omits phone when customer_phone is not provided', async () => {
      await sendPaymentFailedAdminNotification({
        order_number: 'ORD-007',
        id: 'id-7',
        customer_name: 'Ivan',
        customer_email: 'ivan@example.com',
        total_amount: '200',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Phone:')
    })

    it('returns success result', async () => {
      const result = await sendPaymentFailedAdminNotification({
        order_number: 'ORD-004',
        id: 'id-4',
        customer_name: 'Frank',
        customer_email: 'frank@example.com',
        total_amount: '100',
      })
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendPaymentFailedAdminNotification({
        order_number: 'ORD-008',
        id: 'id-8',
        customer_name: 'Jane',
        customer_email: 'jane@example.com',
        total_amount: '50',
      })
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendAdminContactEmail', () => {
    it('sends contact email with plain text', async () => {
      await sendAdminContactEmail('admin@example.com', 'User', 'Help needed', 'I need help')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toBe('Help needed')
    })

    it('escapes HTML in plain text message', async () => {
      await sendAdminContactEmail('admin@example.com', 'User', 'Subject', '<script>alert(1)</script>')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    })

    it('passes HTML through when isHtml is true', async () => {
      await sendAdminContactEmail('admin@example.com', 'User', 'Subject', '<b>Bold</b>', { isHtml: true })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('<b>Bold</b>')
    })

    it('uses Valued Customer fallback when name is empty', async () => {
      await sendAdminContactEmail('admin@example.com', '', 'Subject', 'Message')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Message')
    })

    it('uses provided name when non-empty', async () => {
      await sendAdminContactEmail('admin@example.com', 'Alice', 'Subject', 'Message')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Message')
    })

    it('returns success result', async () => {
      const result = await sendAdminContactEmail('admin@example.com', 'User', 'Subj', 'Msg')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendAdminContactEmail('admin@example.com', 'User', 'Subj', 'Msg')
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendSupportEscalationEmail', () => {
    it('sends escalation to specified admin emails', async () => {
      const result = await sendSupportEscalationEmail('Alice', 'alice@example.com', 'cust-1', 'sess-1', [
        'support@example.com',
      ])
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
    })

    it('falls back to SUPPORT_EMAIL when admin list is empty', async () => {
      await sendSupportEscalationEmail('Alice', 'alice@example.com', 'c1', 's1', [])
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('returns error object on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('fail'))
      const result = await sendSupportEscalationEmail('Alice', 'a@b.com', 'c', 's', ['x@y.com'])
      expect(result.success).toBe(false)
    })
  })

  describe('sendAgentConnectedEmail', () => {
    it('sends agent connected email to customer', async () => {
      const result = await sendAgentConnectedEmail('Alice', 'alice@example.com', 'Bob Agent')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toBe('alice@example.com')
      expect(result.success).toBe(true)
    })

    it('includes agent name in html', async () => {
      await sendAgentConnectedEmail('Alice', 'alice@example.com', 'Charlie Agent')
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Charlie Agent')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendAgentConnectedEmail('Alice', 'alice@example.com', 'Agent')
      expect(result.success).toBe(false)
    })
  })

  describe('sendReturnStatusEmail', () => {
    it('sends return requested_admin notification', async () => {
      const result = await sendReturnStatusEmail('admin@example.com', 'Admin', 'ORD-010', 'id-10', 'requested_admin')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
    })

    it('shows returnType and reason in requested_admin body', async () => {
      await sendReturnStatusEmail('admin@example.com', 'Admin', 'ORD-010', 'id-10', 'requested_admin', {
        returnType: 'replacement',
        reason: 'Defective item',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('replacement')
      expect(html).toContain('Defective item')
    })

    it('omits Hi greeting for requested_admin event', async () => {
      await sendReturnStatusEmail('admin@example.com', 'Admin', 'ORD-010', 'id-10', 'requested_admin')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Hi Admin')
    })

    it('sends approved status email', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('uses replacement wording in approved body when returnType is replacement', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved', {
        returnType: 'replacement',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('replacement shipment')
    })

    it('uses refund wording in approved body when returnType is not replacement', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved', { returnType: 'refund' })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('refund')
    })

    it('shows admin notes in rejected body when provided', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'rejected', {
        adminNotes: 'Policy violation',
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Policy violation')
    })

    it('omits admin notes block in rejected body when absent', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'rejected')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Reason:')
    })

    it('uses replacement wording in received body when returnType is replacement', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'received', {
        returnType: 'replacement',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('replacement shipment')
    })

    it('shows replacement order number in replacement_created body', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'replacement_created', {
        replacementOrderNumber: 'ORD-099',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('ORD-099')
    })

    it('omits replacement order number paragraph when absent', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'replacement_created')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('new order number')
    })

    it('handles array recipient', async () => {
      await sendReturnStatusEmail(['a@b.com', 'c@d.com'], 'Alice', 'ORD-010', 'id-10', 'received')
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toContain('a@b.com')
    })

    it('uses extra.appUrl when provided', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved', {
        appUrl: 'https://custom.example.com',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('custom.example.com')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved')
      expect(result.success).toBe(false)
    })
  })

  describe('sendPaymentRetryEmail', () => {
    it('sends payment retry email', async () => {
      const result = await sendPaymentRetryEmail('cust@example.com', 'Alice', 'ORD-020', 1500)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      // sendPaymentRetryEmail returns { success: true } without messageId
      expect(result).toEqual({ success: true })
    })

    it('includes formatted amount in html', async () => {
      await sendPaymentRetryEmail('cust@example.com', 'Alice', 'ORD-020', 2500)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('2,500')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendPaymentRetryEmail('cust@example.com', 'Alice', 'ORD-020', 1000)
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendInvoiceFinalizedEmail', () => {
    it('sends invoice finalized email', async () => {
      const result = await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-001', 1180)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('INV-001')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes formatted amount in html', async () => {
      await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-002', 9999.99)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('9,999.99')
    })

    it('shows order number when provided', async () => {
      await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-003', 500, 'ORD-100')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('ORD-100')
    })

    it('omits order number line when absent', async () => {
      await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-004', 500)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('Order No')
    })

    it('shows View Invoice button when viewUrl is provided', async () => {
      await sendInvoiceFinalizedEmail(
        'cust@example.com',
        'Alice',
        'INV-005',
        500,
        undefined,
        'https://example.com/invoice/1'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('View Invoice')
    })

    it('omits View Invoice button when viewUrl is absent', async () => {
      await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-006', 500)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('View Invoice')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendInvoiceFinalizedEmail('cust@example.com', 'Alice', 'INV-007', 500)
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendPurchaseOrderEmail', () => {
    const poItems = [{ product_name: 'Bolt Set', variant_name: '10mm', quantity: 50, unit_cost: 12.5 }]

    it('sends purchase order email', async () => {
      const result = await sendPurchaseOrderEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier Co',
        'PO-001',
        625,
        poItems
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('PO-001')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('renders item rows in html', async () => {
      await sendPurchaseOrderEmail('supplier@example.com', 'Vendor', 'Supplier', 'PO-002', 100, poItems)
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Bolt Set')
    })

    it('appends variant_name to product name when present', async () => {
      await sendPurchaseOrderEmail('supplier@example.com', 'Vendor', 'Supplier', 'PO-003', 100, poItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('10mm')
    })

    it('omits variant separator when variant_name is null', async () => {
      const itemsNoVariant = [{ product_name: 'Nut', variant_name: null, quantity: 10, unit_cost: 5 }]
      await sendPurchaseOrderEmail('supplier@example.com', 'Vendor', 'Supplier', 'PO-004', 50, itemsNoVariant)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Nut')
      expect(html).not.toContain('Nut /')
    })

    it('shows View Purchase Order button when viewUrl is provided', async () => {
      await sendPurchaseOrderEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-005',
        100,
        poItems,
        'https://example.com/po/1'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('View Purchase Order')
    })

    it('omits View Purchase Order button when viewUrl is absent', async () => {
      await sendPurchaseOrderEmail('supplier@example.com', 'Vendor', 'Supplier', 'PO-006', 100, poItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('View Purchase Order')
    })

    it('uses supplierName in greeting when contactName is empty', async () => {
      await sendPurchaseOrderEmail('supplier@example.com', '', 'ACME Corp', 'PO-007', 100, poItems)
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('ACME Corp')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendPurchaseOrderEmail('supplier@example.com', 'Vendor', 'Supplier', 'PO-008', 100, poItems)
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendPOReceiveNotificationEmail', () => {
    const receiveItems = [{ product_name: 'Nut Set', variant_name: null, quantity_received: 20, unit_cost: 5 }]

    it('sends PO receive notification', async () => {
      const result = await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-001',
        'GRN-001',
        'received',
        receiveItems
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('shows Fully Received label for received status', async () => {
      await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-001',
        'GRN-001',
        'received',
        receiveItems
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Fully Received')
    })

    it('shows Partially Received label for partial status', async () => {
      await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-001',
        'GRN-001',
        'partial',
        receiveItems
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Partially Received')
    })

    it('appends variant_name when present', async () => {
      const itemsWithVariant = [{ product_name: 'Bolt', variant_name: 'M6', quantity_received: 5, unit_cost: 2 }]
      await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-002',
        'GRN-002',
        'partial',
        itemsWithVariant
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Bolt / M6')
    })

    it('omits variant separator when variant_name is null', async () => {
      await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-003',
        'GRN-003',
        'partial',
        receiveItems
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Nut Set')
      expect(html).not.toContain('Nut Set /')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendPOReceiveNotificationEmail(
        'supplier@example.com',
        'Vendor',
        'Supplier',
        'PO-004',
        'GRN-004',
        'received',
        receiveItems
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendQuotationFinalizedEmail', () => {
    it('sends quotation finalized email', async () => {
      const result = await sendQuotationFinalizedEmail(
        'buyer@example.com',
        'Alice',
        'QT-001',
        5000,
        'https://example.com/qt/1'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('QT-001')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes formatted total in html', async () => {
      await sendQuotationFinalizedEmail('buyer@example.com', 'Alice', 'QT-002', 12500, 'https://example.com')
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('12,500.00')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendQuotationFinalizedEmail(
        'buyer@example.com',
        'Alice',
        'QT-003',
        1000,
        'https://example.com'
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendOrderAutoCancelledEmail', () => {
    it('sends auto-cancelled email for direct order', async () => {
      const result = await sendOrderAutoCancelledEmail(
        'cust@example.com',
        'Alice',
        'ORD-050',
        'id-50',
        'direct',
        1000,
        '/products/slug'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('uses Place Order Again CTA for direct order type', async () => {
      await sendOrderAutoCancelledEmail(
        'cust@example.com',
        'Alice',
        'ORD-050',
        'id-50',
        'direct',
        1000,
        '/products/slug'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Place Order Again')
    })

    it('uses Return to Cart CTA for non-direct order type', async () => {
      await sendOrderAutoCancelledEmail('cust@example.com', 'Alice', 'ORD-051', 'id-51', 'cart', 1000, '/cart')
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Return to Cart')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOrderAutoCancelledEmail(
        'cust@example.com',
        'Alice',
        'ORD-052',
        'id-52',
        'direct',
        500,
        '/products/slug'
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendOrderAutoCancelledAdminNotification', () => {
    it('sends admin notification for auto-cancelled order', async () => {
      const result = await sendOrderAutoCancelledAdminNotification(
        { order_number: 'ORD-060', id: 'id-60', total_amount: '1500' },
        '/products/slug'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes order number in subject', async () => {
      await sendOrderAutoCancelledAdminNotification(
        { order_number: 'ORD-061', id: 'id-61', total_amount: '2000' },
        '/cart'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].subject).toContain('ORD-061')
    })

    it('shows direct order message when order_type is direct', async () => {
      await sendOrderAutoCancelledAdminNotification(
        { order_number: 'ORD-062', id: 'id-62', total_amount: '500', order_type: 'direct' },
        '/products/slug'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Items were not restored to a cart (direct order).')
    })

    it('shows cart restored message when order_type is not direct', async () => {
      await sendOrderAutoCancelledAdminNotification(
        { order_number: 'ORD-063', id: 'id-63', total_amount: '500', order_type: 'cart' },
        '/cart'
      )
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Items were restored to the customer cart.')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOrderAutoCancelledAdminNotification(
        { order_number: 'ORD-064', id: 'id-64', total_amount: '300' },
        '/cart'
      )
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendOrderDelayNotification', () => {
    it('sends delay notification email', async () => {
      const result = await sendOrderDelayNotification({
        toEmail: 'cust@example.com',
        customerName: 'Alice',
        orderNumber: 'ORD-070',
        delayDays: 3,
        reason: 'Supply shortage',
      })
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('uses plural days label for multiple days', async () => {
      await sendOrderDelayNotification({
        toEmail: 'cust@example.com',
        customerName: 'Alice',
        orderNumber: 'ORD-070',
        delayDays: 3,
        reason: 'Delay',
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('days')
    })

    it('uses singular day label for 1 day', async () => {
      await sendOrderDelayNotification({
        toEmail: 'cust@example.com',
        customerName: 'Alice',
        orderNumber: 'ORD-071',
        delayDays: 1,
        reason: 'Short delay',
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('1 day')
      expect(html).not.toContain('1 days')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendOrderDelayNotification({
        toEmail: 'cust@example.com',
        customerName: 'Alice',
        orderNumber: 'ORD-072',
        delayDays: 2,
        reason: 'Weather',
      })
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })

  describe('sendProductAnnouncementEmail', () => {
    const products = [
      {
        id: 'prod-1',
        name: 'New Widget',
        slug: 'new-widget',
        price: '299',
        short_description: null,
        primary_image_url: 'https://example.com/img.jpg',
      },
    ]

    it('sends product announcement email', async () => {
      const result = await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        customerName: 'Alice',
        subject: 'New Arrivals',
        intro: 'Check out our latest products',
        products,
      })
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes product name in html', async () => {
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New Arrivals',
        intro: 'New stuff',
        products,
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('New Widget')
    })

    it('strips markdown from intro', async () => {
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: '**Bold text** and [link](https://example.com)',
        products,
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('**')
      expect(html).not.toContain('](https://')
    })

    it('uses there as greeting when customerName is omitted', async () => {
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products,
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Hi there,')
    })

    it('renders short_description when provided', async () => {
      const productsWithDesc = [{ ...products[0], short_description: 'Great product description' }]
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products: productsWithDesc,
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Great product description')
    })

    it('omits description block when short_description is null', async () => {
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products,
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).not.toContain('font-size:13px;line-height:1.4')
    })

    it('renders image tag when primary_image_url is provided', async () => {
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products,
      })
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('https://example.com/img.jpg')
    })

    it('omits image cell when primary_image_url is null', async () => {
      const productsNoImage = [{ ...products[0], primary_image_url: null }]
      await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products: productsNoImage,
      })
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).not.toContain('<img')
    })

    it('returns error on failure', async () => {
      mockSendAuditedMail.mockRejectedValue(new Error('SMTP fail'))
      const result = await sendProductAnnouncementEmail({
        toEmail: 'cust@example.com',
        subject: 'New',
        intro: 'Hello',
        products,
      })
      expect(result).toEqual({ success: false, error: expect.any(Error) })
    })
  })
})
