import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

vi.mock('bwip-js', () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-barcode-png')),
  },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-barcode-png')),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

// Mock path.join for logo path resolution
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    default: actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  }
})

import {
  loadStoreSettings,
  generatePackingSlipPDF,
  generateBulkPackingSlipPDF,
  type PackingSlipOrder,
  type PackingSlipItem,
  type PackingSlipAddress,
  type StoreSettings,
} from '@/lib/packing-slip-pdf'

import { queryMany } from '@/lib/db'
const mockQueryMany = vi.mocked(queryMany)

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const mockAddress: PackingSlipAddress = {
  full_name: 'Alice Wonderland',
  address_line1: '123 Main Street',
  address_line2: 'Apt 4B',
  landmark: 'Near City Mall',
  city: 'Raipur',
  state: 'Chhattisgarh',
  postal_code: '492001',
  phone: '9876543210',
}

const mockItems: PackingSlipItem[] = [
  {
    product_name: 'M6 Hex Bolt',
    variant_name: 'M6 x 30mm',
    quantity: 5,
    buy_mode: 'unit',
    buy_unit: 'pcs',
    unit_price: 15,
    total_price: 75,
  },
  {
    product_name: 'Steel Nut',
    variant_name: null,
    quantity: 10,
    buy_mode: 'unit',
    buy_unit: null,
    unit_price: 5,
    total_price: 50,
  },
]

const mockOrder: PackingSlipOrder = {
  id: 'order-1',
  order_number: 'ON-001',
  created_at: '2024-01-15T10:00:00Z',
  customer_name: 'Alice Wonderland',
  customer_phone: '9876543210',
  shipping_address: mockAddress,
  items: mockItems,
  total_amount: 125,
  subtotal: 125,
  discount_amount: 0,
  shipping_amount: 0,
}

const mockStore: StoreSettings = {
  name: 'Jeffi Stores',
  address: 'Station Road, Raipur',
  city: 'Chhattisgarh',
  phone: '+91 96853 54099',
  email: 'jeffistoress@gmail.com',
  gstin: '22AAAAA0000A1Z5',
  web: 'jeffistores.in',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// loadStoreSettings
// ---------------------------------------------------------------------------
describe('loadStoreSettings', () => {
  it('returns defaults when no settings rows', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await loadStoreSettings()
    expect(result.name).toBe('JEFFI STORES')
    expect(result.web).toBe('jeffistores.in')
  })

  it('uses business_trade_name when available', async () => {
    mockQueryMany.mockResolvedValue([
      { key: 'business_trade_name', value: 'Jeffi Stores' },
    ])
    const result = await loadStoreSettings()
    expect(result.name).toBe('Jeffi Stores')
  })

  it('falls back to business_legal_name when trade_name absent', async () => {
    mockQueryMany.mockResolvedValue([
      { key: 'business_legal_name', value: 'Jeffi Stores Pvt Ltd' },
    ])
    const result = await loadStoreSettings()
    expect(result.name).toBe('Jeffi Stores Pvt Ltd')
  })

  it('maps all settings fields correctly', async () => {
    mockQueryMany.mockResolvedValue([
      { key: 'business_trade_name', value: 'Jeffi Stores' },
      { key: 'business_address', value: '123 Station Road' },
      { key: 'business_state', value: 'Chhattisgarh' },
      { key: 'business_phone', value: '+91 96853 54099' },
      { key: 'business_email', value: 'test@example.com' },
      { key: 'business_gstin', value: '22AAAAA0000A1Z5' },
    ])
    const result = await loadStoreSettings()
    expect(result.address).toBe('123 Station Road')
    expect(result.city).toBe('Chhattisgarh')
    expect(result.phone).toBe('+91 96853 54099')
    expect(result.email).toBe('test@example.com')
    expect(result.gstin).toBe('22AAAAA0000A1Z5')
  })

  it('handles null value rows gracefully', async () => {
    mockQueryMany.mockResolvedValue([
      { key: 'business_trade_name', value: null },
      { key: 'business_phone', value: null },
    ])
    const result = await loadStoreSettings()
    expect(result.name).toBe('JEFFI STORES')
    expect(result.phone).toBe('')
  })

  it('queries with business_% filter', async () => {
    mockQueryMany.mockResolvedValue([])
    await loadStoreSettings()
    const [sql] = mockQueryMany.mock.calls[0]
    expect(sql).toContain("business_%")
  })
})

// ---------------------------------------------------------------------------
// generatePackingSlipPDF
// ---------------------------------------------------------------------------
describe('generatePackingSlipPDF', () => {
  it('returns a Buffer', async () => {
    const result = await generatePackingSlipPDF(mockOrder, mockStore)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles order without shipping address', async () => {
    const orderNoAddr: PackingSlipOrder = { ...mockOrder, shipping_address: null }
    const result = await generatePackingSlipPDF(orderNoAddr, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles order without address_line2 and landmark', async () => {
    const addrSimple: PackingSlipAddress = {
      ...mockAddress,
      address_line2: null,
      landmark: null,
    }
    const orderSimpleAddr: PackingSlipOrder = { ...mockOrder, shipping_address: addrSimple }
    const result = await generatePackingSlipPDF(orderSimpleAddr, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles order without customer_phone on address', async () => {
    const addrNoPhone = { ...mockAddress, phone: null }
    const orderNoPhone: PackingSlipOrder = { ...mockOrder, shipping_address: addrNoPhone, customer_phone: null }
    const result = await generatePackingSlipPDF(orderNoPhone, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles discount amount > 0', async () => {
    const orderWithDiscount: PackingSlipOrder = { ...mockOrder, discount_amount: 25 }
    const result = await generatePackingSlipPDF(orderWithDiscount, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles weight/length buy_mode items', async () => {
    const weightItem: PackingSlipItem = {
      product_name: 'Steel Wire',
      variant_name: null,
      quantity: 2.500,
      buy_mode: 'weight',
      buy_unit: 'kg',
      unit_price: 100,
      total_price: 250,
    }
    const orderWithWeight: PackingSlipOrder = { ...mockOrder, items: [weightItem] }
    const result = await generatePackingSlipPDF(orderWithWeight, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles length buy_mode items', async () => {
    const lengthItem: PackingSlipItem = {
      product_name: 'Rope',
      variant_name: null,
      quantity: 5.000,
      buy_mode: 'length',
      buy_unit: 'm',
      unit_price: 50,
      total_price: 250,
    }
    const orderWithLength: PackingSlipOrder = { ...mockOrder, items: [lengthItem] }
    const result = await generatePackingSlipPDF(orderWithLength, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles store without GSTIN', async () => {
    const storeNoGstin: StoreSettings = { ...mockStore, gstin: '' }
    const result = await generatePackingSlipPDF(mockOrder, storeNoGstin)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles store without phone or email', async () => {
    const storeMinimal: StoreSettings = { ...mockStore, phone: '', email: '' }
    const result = await generatePackingSlipPDF(mockOrder, storeMinimal)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles store without address or city', async () => {
    const storeNoAddr: StoreSettings = { ...mockStore, address: '', city: '' }
    const result = await generatePackingSlipPDF(mockOrder, storeNoAddr)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty items list', async () => {
    const orderEmpty: PackingSlipOrder = { ...mockOrder, items: [] }
    const result = await generatePackingSlipPDF(orderEmpty, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles items with variant names', async () => {
    const result = await generatePackingSlipPDF(mockOrder, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles items without variant names', async () => {
    const orderNoVariants: PackingSlipOrder = {
      ...mockOrder,
      items: mockItems.map(i => ({ ...i, variant_name: null })),
    }
    const result = await generatePackingSlipPDF(orderNoVariants, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// generateBulkPackingSlipPDF
// ---------------------------------------------------------------------------
describe('generateBulkPackingSlipPDF', () => {
  it('returns a Buffer for multiple orders', async () => {
    const orders = [mockOrder, { ...mockOrder, id: 'order-2', order_number: 'ON-002' }]
    const result = await generateBulkPackingSlipPDF(orders, mockStore)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a Buffer for single order', async () => {
    const result = await generateBulkPackingSlipPDF([mockOrder], mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('returns a Buffer for empty orders list', async () => {
    const result = await generateBulkPackingSlipPDF([], mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles mixed orders (with/without addresses)', async () => {
    const orders: PackingSlipOrder[] = [
      mockOrder,
      { ...mockOrder, id: 'order-3', order_number: 'ON-003', shipping_address: null },
    ]
    const result = await generateBulkPackingSlipPDF(orders, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles orders with discount and without discount', async () => {
    const orders: PackingSlipOrder[] = [
      { ...mockOrder, discount_amount: 10 },
      { ...mockOrder, id: 'order-4', order_number: 'ON-004', discount_amount: 0 },
    ]
    const result = await generateBulkPackingSlipPDF(orders, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// Additional branch coverage — generatePackingSlipPDF
// ---------------------------------------------------------------------------
describe('generatePackingSlipPDF — additional branches', () => {
  it('renders CGST/SGST summary rows when is_igst=false and tax amounts > 0', async () => {
    const orderWithTax: PackingSlipOrder = {
      ...mockOrder,
      is_igst: false,
      taxable_amount: 100,
      cgst_amount: 9,
      sgst_amount: 9,
      igst_amount: 0,
      items: [
        {
          ...mockItems[0],
          taxable_amount: 100,
          cgst_amount: 9,
          sgst_amount: 9,
          igst_amount: 0,
        },
      ],
    }
    const result = await generatePackingSlipPDF(orderWithTax, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('renders IGST summary row when is_igst=true and igst_amount > 0', async () => {
    const orderIgst: PackingSlipOrder = {
      ...mockOrder,
      is_igst: true,
      taxable_amount: 100,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 18,
      items: [
        {
          ...mockItems[0],
          taxable_amount: 100,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 18,
        },
      ],
    }
    const result = await generatePackingSlipPDF(orderIgst, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('renders shipping summary row when shipping_amount > 0', async () => {
    const orderShipping: PackingSlipOrder = { ...mockOrder, shipping_amount: 50 }
    const result = await generatePackingSlipPDF(orderShipping, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('uses mrp as rateInclTax when item.mrp > 0', async () => {
    const itemWithMrp: PackingSlipItem = {
      ...mockItems[0],
      mrp: 25,
      unit_price: 15,
      total_price: 75,
    }
    const orderMrp: PackingSlipOrder = { ...mockOrder, items: [itemWithMrp] }
    const result = await generatePackingSlipPDF(orderMrp, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('uses unit_price as rateInclTax when mrp is null', async () => {
    const itemNoMrp: PackingSlipItem = {
      ...mockItems[0],
      mrp: null,
      unit_price: 20,
    }
    const orderNoMrp: PackingSlipOrder = { ...mockOrder, items: [itemNoMrp] }
    const result = await generatePackingSlipPDF(orderNoMrp, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('calculates disc% from discount_amount when mrp is null and discount_amount > 0', async () => {
    const itemDiscAmt: PackingSlipItem = {
      ...mockItems[0],
      mrp: null,
      unit_price: 20,
      total_price: 60,
      discount_amount: 15,
    }
    const orderDiscAmt: PackingSlipOrder = { ...mockOrder, items: [itemDiscAmt] }
    const result = await generatePackingSlipPDF(orderDiscAmt, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('shows zero discount when mrp <= total_price (mrp-based disc% = 0)', async () => {
    const itemMrpNoDisc: PackingSlipItem = {
      ...mockItems[0],
      mrp: 15,
      quantity: 5,
      total_price: 75,  // mrp * qty = 75 = total_price, so discPct = 0
    }
    const orderMrpNoDisc: PackingSlipOrder = { ...mockOrder, items: [itemMrpNoDisc] }
    const result = await generatePackingSlipPDF(orderMrpNoDisc, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('uses taxable_amount from item when order.taxable_amount is undefined', async () => {
    const orderNoTaxable: PackingSlipOrder = {
      ...mockOrder,
      taxable_amount: undefined,
      cgst_amount: 9,
      sgst_amount: 9,
      igst_amount: 0,
      is_igst: false,
      items: [
        {
          ...mockItems[0],
          taxable_amount: 100,
          cgst_amount: 9,
          sgst_amount: 9,
          igst_amount: 0,
        },
      ],
    }
    const result = await generatePackingSlipPDF(orderNoTaxable, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles store with no name (empty store.name)', async () => {
    const storeNoName: StoreSettings = { ...mockStore, name: '' }
    const result = await generatePackingSlipPDF(mockOrder, storeNoName)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles item with image_url set (fetchImageBuffer called)', async () => {
    // fetchImageBuffer will fail (no real HTTP) and return null — tests the try/catch path
    const itemWithImage: PackingSlipItem = {
      ...mockItems[0],
      image_url: 'https://example.com/product-image.jpg',
    }
    const orderWithImage: PackingSlipOrder = { ...mockOrder, items: [itemWithImage] }
    const result = await generatePackingSlipPDF(orderWithImage, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles gst_rate = 0 on item (gstStr empty)', async () => {
    const itemNoGst: PackingSlipItem = {
      ...mockItems[0],
      gst_rate: 0,
    }
    const orderNoGst: PackingSlipOrder = { ...mockOrder, items: [itemNoGst] }
    const result = await generatePackingSlipPDF(orderNoGst, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles gst_rate = null on item (gstStr empty)', async () => {
    const itemNullGst: PackingSlipItem = {
      ...mockItems[0],
      gst_rate: null,
    }
    const orderNullGst: PackingSlipOrder = { ...mockOrder, items: [itemNullGst] }
    const result = await generatePackingSlipPDF(orderNullGst, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles item with buy_unit set (unit label uppercased)', async () => {
    const itemWithUnit: PackingSlipItem = {
      ...mockItems[0],
      buy_mode: 'unit',
      buy_unit: 'pcs',
    }
    const orderUnit: PackingSlipOrder = { ...mockOrder, items: [itemWithUnit] }
    const result = await generatePackingSlipPDF(orderUnit, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles item with buy_unit null (defaults to NOS)', async () => {
    const itemNullUnit: PackingSlipItem = {
      ...mockItems[0],
      buy_mode: 'unit',
      buy_unit: null,
    }
    const orderNullUnit: PackingSlipOrder = { ...mockOrder, items: [itemNullUnit] }
    const result = await generatePackingSlipPDF(orderNullUnit, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles both discount and shipping on the same order', async () => {
    const orderBoth: PackingSlipOrder = {
      ...mockOrder,
      discount_amount: 20,
      shipping_amount: 40,
      cgst_amount: 9,
      sgst_amount: 9,
      igst_amount: 0,
      is_igst: false,
      taxable_amount: 100,
    }
    const result = await generatePackingSlipPDF(orderBoth, mockStore)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles store.email absent in footer filter', async () => {
    const storeNoEmail: StoreSettings = { ...mockStore, email: '' }
    const result = await generatePackingSlipPDF(mockOrder, storeNoEmail)
    expect(result).toBeInstanceOf(Buffer)
  })
})
