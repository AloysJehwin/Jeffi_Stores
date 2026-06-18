import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/mail-audit', () => ({
  sendAuditedMail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
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

import * as mailAudit from '@/lib/mail-audit'
import * as db from '@/lib/db'
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

const mockOrderItems = [
  { product_name: 'Widget A', quantity: 2, unit_price: '500', total_price: '1000', sku: 'WGT-A' },
]

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

    it('falls back to env ADMIN_EMAIL when DB returns empty', async () => {
      mockQueryMany.mockResolvedValue([])
      await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      // Should still send (to default admin)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('returns success result', async () => {
      const result = await sendNewOrderNotification(mockOrder, mockOrderItems, {})
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })
  })

  describe('sendOrderStatusUpdate', () => {
    it('sends status update for shipped status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'shipped')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toBeTruthy()
    })

    it('sends status update for delivered status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'delivered')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('sends status update for cancelled status', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'cancelled')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('attaches invoice PDF when provided', async () => {
      const pdfBuf = Buffer.from('fake-pdf')
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'confirmed', undefined, pdfBuf)
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments).toBeDefined()
      expect(opts.attachments?.length).toBeGreaterThan(0)
    })

    it('includes cancellation note when provided', async () => {
      await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'cancelled', undefined, null, 'Out of stock')
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toContain('Out of stock')
    })

    it('returns success result', async () => {
      const result = await sendOrderStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'processing')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })
  })

  describe('sendPaymentStatusUpdate', () => {
    it('sends payment paid update', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 1180)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const { html } = mockSendAuditedMail.mock.calls[0][0]
      expect(html).toBeTruthy()
    })

    it('sends payment failed update', async () => {
      await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'failed', 1180)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('returns success result', async () => {
      const result = await sendPaymentStatusUpdate('cust@example.com', 'Alice', 'ORD-001', 'id-1', 'paid', 500)
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })
  })

  describe('sendAdminCertificateEmail', () => {
    it('sends certificate email with attachment', async () => {
      await sendAdminCertificateEmail(
        'admin@example.com', 'admin_user', Buffer.from('p12data'),
        'pass123', 'SN001', '2027-01-01', 'admin'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.attachments?.length).toBeGreaterThan(0)
    })

    it('includes serial number in html', async () => {
      await sendAdminCertificateEmail(
        'admin@example.com', 'admin_user', Buffer.from('p12data'),
        'pass123', 'SN-UNIQUE-001', '2027-01-01', 'admin'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('SN-UNIQUE-001')
    })

    it('returns success result', async () => {
      const result = await sendAdminCertificateEmail(
        'admin@example.com', 'admin_user', Buffer.from('p12'),
        'pw', 'SN1', '2027-01-01', 'admin'
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })
  })

  describe('sendNewReviewNotification', () => {
    it('sends review notification to admin', async () => {
      const review = { id: 'r1', rating: 5, comment: 'Great!' }
      const user = { name: 'Alice', email: 'alice@example.com' }
      const product = { name: 'Widget', id: 'p1' }
      await sendNewReviewNotification(review, user, product)
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('Widget')
    })

    it('returns success result', async () => {
      const result = await sendNewReviewNotification(
        { rating: 4, comment: 'Good' },
        { name: 'Bob', email: 'bob@example.com' },
        { name: 'Gadget', id: 'p2' }
      )
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
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
        { order_number: 'ORD-003', id: 'id-3', customer_name: 'Eve', customer_email: 'eve@example.com', total_amount: '500' },
        'Card declined'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Card declined')
    })

    it('returns success result', async () => {
      const result = await sendPaymentFailedAdminNotification({
        order_number: 'ORD-004', id: 'id-4', customer_name: 'Frank',
        customer_email: 'frank@example.com', total_amount: '100',
      })
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
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

    it('returns success result', async () => {
      const result = await sendAdminContactEmail('admin@example.com', 'User', 'Subj', 'Msg')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })
  })

  describe('sendSupportEscalationEmail', () => {
    it('sends escalation to specified admin emails', async () => {
      const result = await sendSupportEscalationEmail(
        'Alice', 'alice@example.com', 'cust-1', 'sess-1', ['support@example.com']
      )
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
  })

  describe('sendReturnStatusEmail', () => {
    it('sends return requested_admin notification', async () => {
      const result = await sendReturnStatusEmail(
        'admin@example.com', 'Admin', 'ORD-010', 'id-10', 'requested_admin'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
    })

    it('sends approved status email', async () => {
      await sendReturnStatusEmail('cust@example.com', 'Alice', 'ORD-010', 'id-10', 'approved')
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    })

    it('handles array recipient', async () => {
      await sendReturnStatusEmail(['a@b.com', 'c@d.com'], 'Alice', 'ORD-010', 'id-10', 'received')
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.to).toContain('a@b.com')
    })

    it('includes admin notes when provided', async () => {
      await sendReturnStatusEmail(
        'cust@example.com', 'Alice', 'ORD-010', 'id-10', 'rejected',
        { adminNotes: 'Policy violation' }
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Policy violation')
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
  })

  describe('sendPurchaseOrderEmail', () => {
    const poItems = [
      { product_name: 'Bolt Set', variant_name: '10mm', quantity: 50, unit_cost: 12.5 },
    ]

    it('sends purchase order email', async () => {
      const result = await sendPurchaseOrderEmail(
        'supplier@example.com', 'Vendor', 'Supplier Co', 'PO-001', 625, poItems
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('PO-001')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('renders item rows in html', async () => {
      await sendPurchaseOrderEmail(
        'supplier@example.com', 'Vendor', 'Supplier', 'PO-002', 100, poItems
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Bolt Set')
    })
  })

  describe('sendPOReceiveNotificationEmail', () => {
    const receiveItems = [
      { product_name: 'Nut Set', variant_name: null, quantity_received: 20, unit_cost: 5 },
    ]

    it('sends PO receive notification', async () => {
      const result = await sendPOReceiveNotificationEmail(
        'supplier@example.com', 'Vendor', 'Supplier', 'PO-001', 'GRN-001', 'received', receiveItems
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('shows Fully Received label for received status', async () => {
      await sendPOReceiveNotificationEmail(
        'supplier@example.com', 'Vendor', 'Supplier', 'PO-001', 'GRN-001', 'received', receiveItems
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Fully Received')
    })

    it('shows Partially Received label for partial status', async () => {
      await sendPOReceiveNotificationEmail(
        'supplier@example.com', 'Vendor', 'Supplier', 'PO-001', 'GRN-001', 'partial', receiveItems
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Partially Received')
    })
  })

  describe('sendQuotationFinalizedEmail', () => {
    it('sends quotation finalized email', async () => {
      const result = await sendQuotationFinalizedEmail(
        'buyer@example.com', 'Alice', 'QT-001', 5000, 'https://example.com/qt/1'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      const opts = mockSendAuditedMail.mock.calls[0][0]
      expect(opts.subject).toContain('QT-001')
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('includes formatted total in html', async () => {
      await sendQuotationFinalizedEmail(
        'buyer@example.com', 'Alice', 'QT-002', 12500, 'https://example.com'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('12,500.00')
    })
  })

  describe('sendOrderAutoCancelledEmail', () => {
    it('sends auto-cancelled email for direct order', async () => {
      const result = await sendOrderAutoCancelledEmail(
        'cust@example.com', 'Alice', 'ORD-050', 'id-50', 'direct', 1000, '/products/slug'
      )
      expect(mockSendAuditedMail).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true, messageId: 'msg-ok' })
    })

    it('uses Place Order Again CTA for direct order type', async () => {
      await sendOrderAutoCancelledEmail(
        'cust@example.com', 'Alice', 'ORD-050', 'id-50', 'direct', 1000, '/products/slug'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Place Order Again')
    })

    it('uses Return to Cart CTA for non-direct order type', async () => {
      await sendOrderAutoCancelledEmail(
        'cust@example.com', 'Alice', 'ORD-051', 'id-51', 'cart', 1000, '/cart'
      )
      expect(mockSendAuditedMail.mock.calls[0][0].html).toContain('Return to Cart')
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
  })
})
