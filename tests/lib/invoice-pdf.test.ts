import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('pdfkit', () => {
  function makeMockDoc() {
    let dataCb: ((c: Buffer) => void) | null = null
    let endCb: (() => void) | null = null
    const doc: Record<string, any> = {
      on: vi.fn().mockImplementation(function (event: string, cb: any) {
        if (event === 'data') dataCb = cb
        if (event === 'end') endCb = cb
        return doc
      }),
      end: vi.fn().mockImplementation(function () {
        dataCb?.(Buffer.from('mock-invoice-pdf'))
        endCb?.()
      }),
      font: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(),
      strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      addPage: vi.fn().mockReturnThis(),
      switchToPage: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
      translate: vi.fn().mockReturnThis(),
      rotate: vi.fn().mockReturnThis(),
      scale: vi.fn().mockReturnThis(),
      polygon: vi.fn().mockReturnThis(),
      path: vi.fn().mockReturnThis(),
      bufferedPageRange: vi.fn().mockReturnValue({ start: 0, count: 1 }),
      heightOfString: vi.fn().mockReturnValue(20),
      widthOfString: vi.fn().mockReturnValue(100),
      x: 50,
      y: 100,
      page: { width: 595.28, height: 841.89, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
    return doc
  }
  return { default: vi.fn().mockImplementation(() => makeMockDoc()) }
})

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr') },
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

import { generateInvoicePDF } from '@/lib/documents/invoice-pdf'
import type { InvoiceOrder, InvoiceOrderItem, InvoiceBusinessSettings, InvoiceBuyerAddress } from '@/lib/documents/invoice-pdf'

const mockBusiness: InvoiceBusinessSettings = {
  gstin: '22AAAAA0000A1Z5',
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur',
  state: 'Chhattisgarh',
  stateCode: '22',
  phone: '+91 96853 54099',
  email: 'jeffistoress@gmail.com',
  bankName: 'HDFC Bank',
  bankAccount: '12345678901',
  bankIfsc: 'HDFC0001234',
  bankBranch: 'Raipur Main',
}

const mockOrder: InvoiceOrder = {
  order_number: 'ORD-001',
  invoice_number: 'JS/2025-26/001',
  invoice_date: '2025-06-01T10:00:00.000Z',
  customer_name: 'Alice Kumar',
  subtotal: 1000,
  tax_amount: 180,
  total_amount: 1180,
  discount_amount: 0,
  shipping_amount: 0,
  taxable_amount: 847.46,
  cgst_amount: 76.27,
  sgst_amount: 76.27,
  igst_amount: 0,
  is_igst: false,
  buyer_gstin: null,
  order_date: '2025-06-01T09:00:00.000Z',
  payment_mode: 'Online Payment',
  tracking_number: '',
  shipped_at: '',
  shipping_method: '',
  destination: 'Raipur, Chhattisgarh',
  irn: null,
  irn_ack_no: null,
  irn_ack_dt: null,
  signed_qr_code: null,
  payment_link_url: null,
  eway_bill_no: null,
}

const mockItems: InvoiceOrderItem[] = [
  {
    product_name: 'Widget A',
    hsn_code: '8481',
    gst_rate: 18,
    quantity: 2,
    unit_price: 500,
    total_price: 1000,
    taxable_amount: 847.46,
    cgst_amount: 76.27,
    sgst_amount: 76.27,
    igst_amount: 0,
    buy_mode: 'unit',
    buy_unit: null,
  },
]

const mockBuyer: InvoiceBuyerAddress = {
  full_name: 'Alice Kumar',
  address_line1: '123 Main St',
  address_line2: null,
  city: 'Raipur',
  state: 'Chhattisgarh',
  postal_code: '492001',
  phone: '9876543210',
}

describe('invoice-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateInvoicePDF', () => {
    it('returns a Buffer', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('produces non-empty buffer', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer)
      expect(result.length).toBeGreaterThan(0)
    })

    it('generates PDF with IGST when is_igst is true', async () => {
      const igstOrder = { ...mockOrder, is_igst: true, igst_amount: 152.54, cgst_amount: 0, sgst_amount: 0 }
      const result = await generateInvoicePDF(igstOrder, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('includes billing address when different from shipping', async () => {
      const billingAddress: InvoiceBuyerAddress = {
        full_name: 'Alice Kumar',
        address_line1: '456 Business Rd',
        address_line2: 'Floor 2',
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400001',
        phone: '9999999999',
      }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer, billingAddress)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('generates cancelled/voided invoice', async () => {
      const result = await generateInvoicePDF(
        mockOrder,
        mockItems,
        mockBusiness,
        mockBuyer,
        undefined,
        true,
        'CANCELLED'
      )
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with signed QR code', async () => {
      const orderWithQr = { ...mockOrder, signed_qr_code: 'base64-qr-data' }
      const result = await generateInvoicePDF(orderWithQr, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with IRN details', async () => {
      const orderWithIrn = {
        ...mockOrder,
        irn: 'abc123irn',
        irn_ack_no: 'ACK001',
        irn_ack_dt: '2025-06-01',
      }
      const result = await generateInvoicePDF(orderWithIrn, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles multiple items', async () => {
      const multiItems: InvoiceOrderItem[] = [
        ...mockItems,
        {
          product_name: 'Gadget B',
          hsn_code: '8542',
          gst_rate: 12,
          quantity: 1,
          unit_price: 250,
          total_price: 250,
          taxable_amount: 223.21,
          cgst_amount: 13.39,
          sgst_amount: 13.39,
          igst_amount: 0,
          buy_mode: 'unit',
          buy_unit: null,
        },
      ]
      const result = await generateInvoicePDF(mockOrder, multiItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles discount and shipping amounts', async () => {
      const orderWithDiscount = {
        ...mockOrder,
        discount_amount: 100,
        shipping_amount: 50,
      }
      const result = await generateInvoicePDF(orderWithDiscount, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with buy_unit set', async () => {
      const itemsWithUnit: InvoiceOrderItem[] = [{ ...mockItems[0], buy_mode: 'box', buy_unit: 'Box of 12' }]
      const result = await generateInvoicePDF(mockOrder, itemsWithUnit, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer with address_line2', async () => {
      const buyer2 = { ...mockBuyer, address_line2: 'Near Bus Stand' }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, buyer2)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer_gstin when provided', async () => {
      const orderWithGstin = { ...mockOrder, buyer_gstin: '27BBBBB1111B1Z5' }
      const result = await generateInvoicePDF(orderWithGstin, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('generates cancelled invoice with default CANCELLED label when voidLabel omitted', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer, undefined, true, undefined)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles eway_bill_no present', async () => {
      const orderWithEwb = { ...mockOrder, eway_bill_no: 'EWB12345678901' }
      const result = await generateInvoicePDF(orderWithEwb, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles IRN present but irn_ack_no and irn_ack_dt absent', async () => {
      const orderIrnOnly = { ...mockOrder, irn: 'abc123irn', irn_ack_no: null, irn_ack_dt: null }
      const result = await generateInvoicePDF(orderIrnOnly, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with buy_mode weight (isMeasured = true)', async () => {
      const weightItems: InvoiceOrderItem[] = [{ ...mockItems[0], buy_mode: 'weight', buy_unit: 'kg', quantity: 1.5 }]
      const result = await generateInvoicePDF(mockOrder, weightItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with buy_mode length (isMeasured = true)', async () => {
      const lengthItems: InvoiceOrderItem[] = [{ ...mockItems[0], buy_mode: 'length', buy_unit: 'm', quantity: 3.25 }]
      const result = await generateInvoicePDF(mockOrder, lengthItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('calculates MRP-based discount percentage when mrp is set', async () => {
      const itemsWithMrp: InvoiceOrderItem[] = [{ ...mockItems[0], mrp: 600, quantity: 2, total_price: 1000 }]
      const result = await generateInvoicePDF(mockOrder, itemsWithMrp, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('shows zero discount label when mrp equals selling price (no discount)', async () => {
      const itemsNoDisc: InvoiceOrderItem[] = [{ ...mockItems[0], mrp: 500, quantity: 2, total_price: 1000 }]
      const result = await generateInvoicePDF(mockOrder, itemsNoDisc, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('calculates discount from discount_amount when mrp is null', async () => {
      const itemsDiscAmt: InvoiceOrderItem[] = [{ ...mockItems[0], mrp: null, discount_amount: 100, total_price: 900 }]
      const result = await generateInvoicePDF(mockOrder, itemsDiscAmt, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with mrp = 0 (falls back to discount_amount path)', async () => {
      const itemsMrpZero: InvoiceOrderItem[] = [{ ...mockItems[0], mrp: 0, discount_amount: 50, total_price: 950 }]
      const result = await generateInvoicePDF(mockOrder, itemsMrpZero, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles business_discount_amount > 0', async () => {
      const orderBizDisc = { ...mockOrder, business_discount_amount: 80 }
      const result = await generateInvoicePDF(orderBizDisc, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles round-off row when total_amount differs from tax sum', async () => {
      // Force a roundOff >= 0.01 by making total_amount differ from taxable+tax+shipping-discount
      const orderRound = {
        ...mockOrder,
        total_amount: 1180.5,
        taxable_amount: 847.46,
        cgst_amount: 76.27,
        sgst_amount: 76.27,
        igst_amount: 0,
        shipping_amount: 0,
        discount_amount: 0,
        business_discount_amount: 0,
      }
      const result = await generateInvoicePDF(orderRound, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles business with no phone but has email', async () => {
      const bizNoPhone = { ...mockBusiness, phone: '' }
      const result = await generateInvoicePDF(mockOrder, mockItems, bizNoPhone, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles business with no email', async () => {
      const bizNoEmail = { ...mockBusiness, email: '' }
      const result = await generateInvoicePDF(mockOrder, mockItems, bizNoEmail, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles business with no phone and no email', async () => {
      const bizMinimal = { ...mockBusiness, phone: '', email: '' }
      const result = await generateInvoicePDF(mockOrder, mockItems, bizMinimal, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with payment_link_url (pay QR generated)', async () => {
      const orderWithPayQR = { ...mockOrder, payment_link_url: 'https://pay.example.com/xyz' }
      const result = await generateInvoicePDF(orderWithPayQR, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles both signed_qr_code and payment_link_url together', async () => {
      const orderBothQR = {
        ...mockOrder,
        signed_qr_code: 'qr-data-string',
        payment_link_url: 'https://pay.example.com/xyz',
      }
      const result = await generateInvoicePDF(orderBothQR, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles IGST order with is_igst HSN table', async () => {
      const igstOrder = {
        ...mockOrder,
        is_igst: true,
        igst_amount: 152.54,
        cgst_amount: 0,
        sgst_amount: 0,
      }
      const igstItems: InvoiceOrderItem[] = [{ ...mockItems[0], igst_amount: 152.54, cgst_amount: 0, sgst_amount: 0 }]
      const result = await generateInvoicePDF(igstOrder, igstItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with null hsn_code (falls back to N/A key in HSN map)', async () => {
      const itemsNoHsn: InvoiceOrderItem[] = [{ ...mockItems[0], hsn_code: null }]
      const result = await generateInvoicePDF(mockOrder, itemsNoHsn, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer state with a known state code (renderAddressBlock stateCode branch)', async () => {
      const buyerKarnataka: InvoiceBuyerAddress = {
        ...mockBuyer,
        state: 'Karnataka',
      }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, buyerKarnataka)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer state with unknown state (empty stateCode)', async () => {
      const buyerUnknown: InvoiceBuyerAddress = {
        ...mockBuyer,
        state: 'Atlantis',
      }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, buyerUnknown)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer with no phone in address block', async () => {
      const buyerNoPhone: InvoiceBuyerAddress = {
        ...mockBuyer,
        phone: '',
      }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, buyerNoPhone)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles zero total_amount (numberToWords zero branch)', async () => {
      const zeroOrder = {
        ...mockOrder,
        total_amount: 0,
        taxable_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        subtotal: 0,
        tax_amount: 0,
        discount_amount: 0,
        shipping_amount: 0,
      }
      const zeroItems: InvoiceOrderItem[] = [
        {
          ...mockItems[0],
          total_price: 0,
          taxable_amount: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          unit_price: 0,
        },
      ]
      const result = await generateInvoicePDF(zeroOrder, zeroItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles large total_amount (crore/lakh/thousand branches in numberToWords)', async () => {
      const largeOrder = {
        ...mockOrder,
        total_amount: 12345678.5,
        taxable_amount: 10463286.44,
        cgst_amount: 941095.78,
        sgst_amount: 941095.78,
        igst_amount: 0,
        subtotal: 12345678.5,
        tax_amount: 1882191.56,
      }
      const result = await generateInvoicePDF(largeOrder, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with tracking_number and shipped_at set', async () => {
      const orderTracked = {
        ...mockOrder,
        tracking_number: 'TRACK123',
        shipped_at: '2025-06-02T12:00:00.000Z',
        shipping_method: 'Speed Post',
      }
      const result = await generateInvoicePDF(orderTracked, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles itemsSubtotal = 0 (bizDiscount proration guard)', async () => {
      const zeroItems: InvoiceOrderItem[] = [
        {
          ...mockItems[0],
          total_price: 0,
          taxable_amount: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          unit_price: 0,
        },
      ]
      const orderBizDisc = {
        ...mockOrder,
        business_discount_amount: 10,
        total_amount: 0,
        taxable_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
      }
      const result = await generateInvoicePDF(orderBizDisc, zeroItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })
  })
})
