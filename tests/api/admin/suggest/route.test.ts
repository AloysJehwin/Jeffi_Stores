import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn(),
  buildProductSearchRank: vi.fn(),
  buildVectorSearchClause: vi.fn(),
  buildSearchClause: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/(admin)/admin/suggest/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'
import {
  buildProductSearchClause,
  buildProductSearchRank,
  buildVectorSearchClause,
  buildSearchClause,
} from '@/lib/catalog/search'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryMany = vi.mocked(queryMany)
const mockBuildProduct = vi.mocked(buildProductSearchClause)
const mockBuildRank = vi.mocked(buildProductSearchRank)
const mockBuildVector = vi.mocked(buildVectorSearchClause)
const mockBuildSearch = vi.mocked(buildSearchClause)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: [],
}

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/suggest')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

// Default search clause mock that returns valid SQL fragment
function setupSearchMocks() {
  mockBuildProduct.mockReturnValue({
    clause: 'p.name ILIKE $1',
    params: ['%bolt%'],
    nextIdx: 2,
  } as any)
  mockBuildRank.mockReturnValue({
    rank: 'ts_rank(p.search_vector, $2)',
    params: ['bolt'],
    nextIdx: 3,
  } as any)
  mockBuildVector.mockReturnValue({
    clause: 'o.search_vector @@ $1',
    params: ['bolt'],
    nextIdx: 2,
  } as any)
  mockBuildSearch.mockReturnValue({
    clause: 'name ILIKE $1',
    params: ['%bolt%'],
    nextIdx: 2,
  } as any)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/suggest', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupSearchMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet({ q: 'bolt', type: 'products' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns empty items when query too short (< 2 chars)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    const res = await GET(makeGet({ q: 'b', type: 'products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  it('returns empty items when type is unknown', async () => {
    mockAuth.mockResolvedValue(admin as any)
    const res = await GET(makeGet({ q: 'bolt', type: 'unknown_type' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  it('returns empty items when query is empty', async () => {
    mockAuth.mockResolvedValue(admin as any)
    const res = await GET(makeGet({ type: 'products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  // ── products type ──────────────────────────────────────────────────────────

  it('returns product suggestions for type=products', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'p1', name: 'Hex Bolt M6', sku: 'BOLT-M6' }])

    const res = await GET(makeGet({ q: 'bolt', type: 'products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('Hex Bolt M6')
    expect(data.items[0].sublabel).toBe('BOLT-M6')
    expect(data.items[0].href).toContain('/admin/products')
  })

  it('returns empty items when no products found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGet({ q: 'xyz', type: 'products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  // ── orders type ────────────────────────────────────────────────────────────

  it('returns order suggestions for type=orders', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'o1', order_number: 'ORD-001', customer_name: 'John Doe' }])

    const res = await GET(makeGet({ q: 'ORD', type: 'orders' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('ORD-001')
    expect(data.items[0].sublabel).toBe('John Doe')
    expect(data.items[0].href).toContain('/admin/orders')
  })

  // ── customers type ─────────────────────────────────────────────────────────

  it('returns customer suggestions for type=customers', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      { id: 'u1', first_name: 'Jane', last_name: 'Smith', email: 'jane@smith.com', phone: '9876543210' },
    ])

    const res = await GET(makeGet({ q: 'jane', type: 'customers' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('Jane Smith')
    expect(data.items[0].sublabel).toBe('9876543210')
  })

  it('falls back to email as customer label when name missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      { id: 'u2', first_name: null, last_name: null, email: 'unknown@example.com', phone: null },
    ])

    const res = await GET(makeGet({ q: 'unknown', type: 'customers' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('unknown@example.com')
    expect(data.items[0].sublabel).toBe('unknown@example.com')
  })

  // ── invoices type ──────────────────────────────────────────────────────────

  it('returns invoice suggestions for type=invoices', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      { id: 'o1', invoice_number: 'JS/24-25/0001', order_number: 'ORD-001', customer_name: 'Alice' },
    ])

    const res = await GET(makeGet({ q: 'JS', type: 'invoices' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('JS/24-25/0001')
    expect(data.items[0].sublabel).toBe('Alice')
  })

  // ── categories type ────────────────────────────────────────────────────────

  it('returns category suggestions for type=categories', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'cat1', name: 'Fasteners', slug: 'fasteners' }])

    const res = await GET(makeGet({ q: 'fast', type: 'categories' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Fasteners')
    expect(data.items[0].sublabel).toBe('fasteners')
  })

  // ── coupons type ──────────────────────────────────────────────────────────

  it('returns coupon suggestions with percentage discount', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'c1', code: 'SAVE10', discount_type: 'percentage', discount_value: '10' }])

    const res = await GET(makeGet({ q: 'SAVE', type: 'coupons' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('SAVE10')
    expect(data.items[0].sublabel).toBe('10% off')
  })

  it('returns coupon suggestions with flat discount', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'c2', code: 'FLAT50', discount_type: 'flat', discount_value: '50' }])

    const res = await GET(makeGet({ q: 'FLAT', type: 'coupons' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].sublabel).toBe('₹50 off')
  })

  // ── brands type ───────────────────────────────────────────────────────────

  it('returns brand suggestions for type=brands', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'b1', name: 'Unbrako' }])

    const res = await GET(makeGet({ q: 'unbr', type: 'brands' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Unbrako')
  })

  // ── suppliers type ────────────────────────────────────────────────────────

  it('returns supplier suggestions for type=suppliers', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 's1', name: 'Acme Supplies', phone: '9876543210' }])

    const res = await GET(makeGet({ q: 'acme', type: 'suppliers' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Acme Supplies')
    expect(data.items[0].sublabel).toBe('9876543210')
  })

  // ── purchase_orders type ───────────────────────────────────────────────────

  it('returns PO suggestions for type=purchase_orders', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'po1', po_number: 'PO-001', supplier_name: 'Acme', total_amount: '5000' }])

    const res = await GET(makeGet({ q: 'PO', type: 'purchase_orders' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('PO-001')
    expect(data.items[0].sublabel).toContain('Acme')
    expect(data.items[0].sublabel).toContain('5,000')
  })

  // ── receivables type ───────────────────────────────────────────────────────

  it('returns receivable suggestions for type=receivables', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      { id: 'o1', order_number: 'ORD-001', customer_name: 'Bob', total_amount: '10000' },
    ])

    const res = await GET(makeGet({ q: 'bob', type: 'receivables' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Bob')
    expect(data.items[0].sublabel).toContain('ORD-001')
  })

  // ── payables type ──────────────────────────────────────────────────────────

  it('returns payable suggestions for type=payables', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      { id: 'e1', supplier_name: 'Acme', expense_number: 'EXP-001', total_amount: '2000' },
    ])

    const res = await GET(makeGet({ q: 'acme', type: 'payables' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Acme')
    expect(data.items[0].sublabel).toContain('EXP-001')
  })

  // ── quotations type ────────────────────────────────────────────────────────

  it('returns quotation suggestions for type=quotations', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'q1', quote_number: 'QUO-001', consignee_name: 'Client A' }])

    const res = await GET(makeGet({ q: 'QUO', type: 'quotations' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('QUO-001')
    expect(data.items[0].sublabel).toBe('Client A')
  })

  // ── review_forms type ─────────────────────────────────────────────────────

  it('returns review form suggestions for type=review_forms', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'rf1', title: 'Product Feedback', slug: 'product-feedback' }])

    const res = await GET(makeGet({ q: 'feed', type: 'review_forms' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Product Feedback')
    expect(data.items[0].sublabel).toBe('product-feedback')
  })

  // ── line_items type ───────────────────────────────────────────────────────

  it('returns line item suggestions for type=line_items', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        name: 'Hex Bolt',
        variant_name: null,
        sku: 'BOLT-1',
        base_price: 100,
        mrp: 118,
        gst_percentage: 18,
        hsn_code: '7318',
        inventory_quantity: 50,
        discount_pct: 10,
      },
    ])

    const res = await GET(makeGet({ q: 'bolt', type: 'line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('Hex Bolt')
    expect(data.items[0].sublabel).toContain('BOLT-1')
    // id should encode product metadata
    expect(data.items[0].id).toContain('p1')
  })

  it('encodes variant name in label for line_items', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: 'v1',
        sub_variant_id: null,
        name: 'Bolt Set',
        variant_name: 'M6',
        sku: 'BOLT-M6',
        base_price: 50,
        mrp: 59,
        gst_percentage: 18,
        hsn_code: null,
        inventory_quantity: 20,
        discount_pct: 0,
      },
    ])

    const res = await GET(makeGet({ q: 'bolt', type: 'line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Bolt Set — M6')
  })

  // ── po_line_items type ────────────────────────────────────────────────────

  it('returns PO line item suggestions for type=po_line_items', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: null,
        name: 'Socket Wrench',
        variant_name: null,
        sku: 'SW-01',
        base_price: 200,
        mrp: 240,
        gst_percentage: 12,
        hsn_code: '8204',
      },
    ])

    const res = await GET(makeGet({ q: 'socket', type: 'po_line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Socket Wrench')
    expect(data.items[0].id).toContain('p1')
  })

  it('returns same results for type=admin_line_items (alias)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: null,
        name: 'Allen Key',
        variant_name: null,
        sku: 'AK-3',
        base_price: 30,
        mrp: 35,
        gst_percentage: 18,
        hsn_code: null,
      },
    ])

    const res = await GET(makeGet({ q: 'allen', type: 'admin_line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Allen Key')
  })

  // ── label_products type ───────────────────────────────────────────────────

  it('returns label product suggestions for type=label_products', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'product:p1',
        name: 'Bolt',
        variant_name: null,
        sku: 'B-1',
        slug: 'bolt',
        mrp: 100,
        price_ex_gst: 80,
        base_price: 90,
        gst_percentage: 12,
        brand_name: 'Unbrako',
        gtin: null,
        inventory_quantity: 30,
      },
    ])

    const res = await GET(makeGet({ q: 'bolt', type: 'label_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('Bolt')
    expect(data.items[0].sublabel).toContain('Unbrako')
  })

  // ── error handling ────────────────────────────────────────────────────────

  it('returns 500 with empty items on db error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeGet({ q: 'bolt', type: 'products' }))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  // ── line_items null-field branches (lines 84–99) ──────────────────────────

  it('line_items: encodes empty strings for null base_price, mrp, hsn_code, sub_variant_id', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        name: 'Bolt',
        variant_name: null,
        sku: 'B-1',
        base_price: null,
        mrp: null,
        gst_percentage: 18,
        hsn_code: null,
        inventory_quantity: null,
        discount_pct: null,
      },
    ])

    const res = await GET(makeGet({ q: 'bolt', type: 'line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    const item = data.items[0]
    // label has no price suffix when base_price is null
    expect(item.sublabel).toBe('B-1')
    // encoded id: product_id|variant_id(empty)|base_price(empty)|gst|hsn(empty)|mrp(empty)|inv(empty)|sub_variant_id(empty)|discount_pct(0)
    const parts = item.id.split('|')
    expect(parts[0]).toBe('p1')
    expect(parts[1]).toBe('') // variant_id null -> ''
    expect(parts[2]).toBe('') // base_price null -> ''
    expect(parts[4]).toBe('') // hsn_code null -> ''
    expect(parts[5]).toBe('') // mrp null -> ''
    expect(parts[6]).toBe('') // inventory_quantity null -> ''
    expect(parts[7]).toBe('') // sub_variant_id null -> ''
    expect(parts[8]).toBe('0') // discount_pct null -> '0'
  })

  it('line_items: encodes sub_variant_id when present', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p1',
        variant_id: 'v1',
        sub_variant_id: 'sv1',
        name: 'Bolt',
        variant_name: 'M8',
        sku: 'B-M8',
        base_price: 75,
        mrp: 90,
        gst_percentage: 18,
        hsn_code: '7318',
        inventory_quantity: 10,
        discount_pct: 5,
      },
    ])

    const res = await GET(makeGet({ q: 'bolt', type: 'line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    const parts = data.items[0].id.split('|')
    expect(parts[1]).toBe('v1')
    expect(parts[7]).toBe('sv1')
    expect(parts[8]).toBe('5')
  })

  it('line_items: handles null queryMany result (rows || [])', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeGet({ q: 'bolt', type: 'line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  // ── po_line_items null-field branches (lines 173–185) ─────────────────────

  it('po_line_items: encodes empty strings for null base_price, mrp, hsn_code, sell_unit fields', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p2',
        variant_id: null,
        name: 'Wrench',
        variant_name: null,
        sku: 'WR-1',
        base_price: null,
        mrp: null,
        gst_percentage: 12,
        hsn_code: null,
        sell_unit_label: null,
        sell_unit_dimension: null,
      },
    ])

    const res = await GET(makeGet({ q: 'wrench', type: 'po_line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    const item = data.items[0]
    expect(item.label).toBe('Wrench')
    expect(item.sublabel).toBe('WR-1')
    const parts = item.id.split('|')
    expect(parts[0]).toBe('p2')
    expect(parts[1]).toBe('') // variant_id null -> ''
    expect(parts[2]).toBe('') // base_price null -> ''
    expect(parts[4]).toBe('') // hsn_code null -> ''
    expect(parts[5]).toBe('') // mrp null -> ''
    expect(parts[6]).toBe('') // sell_unit_label null -> ''
    expect(parts[7]).toBe('') // sell_unit_dimension null -> ''
  })

  it('po_line_items: encodes variant name in label when present', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        product_id: 'p2',
        variant_id: 'v2',
        name: 'Wrench',
        variant_name: '1/2 inch',
        sku: 'WR-H',
        base_price: 150,
        mrp: 180,
        gst_percentage: 12,
        hsn_code: '8204',
        sell_unit_label: 'Piece',
        sell_unit_dimension: 'unit',
      },
    ])

    const res = await GET(makeGet({ q: 'wrench', type: 'po_line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Wrench — 1/2 inch')
    const parts = data.items[0].id.split('|')
    expect(parts[6]).toBe('Piece')
    expect(parts[7]).toBe('unit')
  })

  it('po_line_items: handles null queryMany result (rows || [])', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeGet({ q: 'wrench', type: 'po_line_items' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toEqual([])
  })

  // ── null queryMany fallback in simple-map handlers (rows || []) ────────────

  it('products: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'bolt', type: 'products' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('orders: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'ORD', type: 'orders' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('customers: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'jane', type: 'customers' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('invoices: falls back to order_number when invoice_number is null', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([{ id: 'o2', invoice_number: null, order_number: 'ORD-999', customer_name: 'Dan' }])
    const res = await GET(makeGet({ q: 'ORD', type: 'invoices' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('ORD-999')
  })

  it('invoices: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'inv', type: 'invoices' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('quotations: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'QUO', type: 'quotations' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('categories: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'fast', type: 'categories' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('coupons: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'SAVE', type: 'coupons' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('brands: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'unbr', type: 'brands' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('suppliers: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'acme', type: 'suppliers' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  // ── serial_products / batch_products (suggestScopedLabelProducts) ─────────────

  it('returns serial product suggestions for type=serial_products', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'product:p1',
        name: 'Serial Bolt',
        variant_name: null,
        sku: 'SB-1',
        slug: 'serial-bolt',
        mrp: 100,
        price_ex_gst: 85,
        base_price: 90,
        gst_percentage: 18,
        brand_name: 'Unbrako',
        gtin: '890123',
        inventory_quantity: 12,
        product_id: 'p1',
        sell_unit_id: 'su1',
        parent_variant_id: null,
      },
    ])
    const res = await GET(makeGet({ q: 'bolt', type: 'serial_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].label).toBe('Serial Bolt')
    expect(data.items[0].sublabel).toContain('Unbrako')
    // encoded id uses \x1f separator
    const parts = data.items[0].id.split('\x1f')
    expect(parts[0]).toBe('product:p1')
    expect(parts[2]).toBe('') // variant_name null -> ''
  })

  it('serial_products: encodes variant name in label when present', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'variant:v1',
        name: 'Bolt',
        variant_name: 'M8',
        sku: 'B-M8',
        slug: 'bolt',
        mrp: 50,
        price_ex_gst: 42,
        base_price: 45,
        gst_percentage: 18,
        brand_name: null,
        gtin: null,
        inventory_quantity: 5,
        product_id: 'p1',
        sell_unit_id: null,
        parent_variant_id: null,
      },
    ])
    const res = await GET(makeGet({ q: 'bolt', type: 'serial_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Bolt — M8')
    // no brand → sublabel is just sku
    expect(data.items[0].sublabel).toBe('B-M8')
  })

  it('serial_products: encodes empty strings for null numeric/text fields', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'subvariant:s1',
        name: 'Bolt',
        variant_name: 'M8 (Set)',
        sku: 'B-S',
        slug: 'bolt',
        mrp: null,
        price_ex_gst: null,
        base_price: null,
        gst_percentage: 18,
        brand_name: null,
        gtin: null,
        inventory_quantity: null,
        product_id: 'p1',
        sell_unit_id: null,
        parent_variant_id: 'v1',
      },
    ])
    const res = await GET(makeGet({ q: 'bolt', type: 'serial_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    const parts = data.items[0].id.split('\x1f')
    expect(parts[5]).toBe('0') // mrp null -> '0'
    expect(parts[6]).toBe('') // price_ex_gst null -> ''
    expect(parts[7]).toBe('0') // base_price null -> '0'
    expect(parts[9]).toBe('') // brand_name null -> ''
    expect(parts[10]).toBe('') // gtin null -> ''
    expect(parts[11]).toBe('0') // inventory_quantity null -> '0'
    expect(parts[14]).toBe('v1') // parent_variant_id present
  })

  it('serial_products: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'bolt', type: 'serial_products' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('returns batch product suggestions for type=batch_products', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'product:p9',
        name: 'Perishable Item',
        variant_name: null,
        sku: 'PI-1',
        slug: 'perishable',
        mrp: 200,
        price_ex_gst: 170,
        base_price: 180,
        gst_percentage: 12,
        brand_name: 'FreshCo',
        gtin: null,
        inventory_quantity: 30,
        product_id: 'p9',
        sell_unit_id: null,
        parent_variant_id: null,
      },
    ])
    const res = await GET(makeGet({ q: 'item', type: 'batch_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Perishable Item')
    expect(data.items[0].sublabel).toContain('FreshCo')
  })

  it('batch_products: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'item', type: 'batch_products' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  // ── label_products null-field encoding branches ───────────────────────────────

  it('label_products: encodes empty strings for null numeric/text fields', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'variant:v2',
        name: 'Nut',
        variant_name: 'M6',
        sku: 'N-M6',
        slug: 'nut',
        mrp: null,
        price_ex_gst: null,
        base_price: null,
        gst_percentage: 18,
        brand_name: null,
        gtin: null,
        inventory_quantity: null,
        product_id: 'p3',
        sell_unit_id: null,
        parent_variant_id: null,
      },
    ])
    const res = await GET(makeGet({ q: 'nut', type: 'label_products' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].label).toBe('Nut — M6')
    const parts = data.items[0].id.split('\x1f')
    expect(parts[5]).toBe('0') // mrp null -> '0'
    expect(parts[6]).toBe('') // price_ex_gst null -> ''
    expect(parts[7]).toBe('0') // base_price null -> '0'
    expect(parts[11]).toBe('0') // inventory_quantity null -> '0'
  })

  it('label_products: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'bolt', type: 'label_products' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  // ── payables label/sublabel + null fallback ───────────────────────────────────

  it('payables: handles null queryMany result', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeGet({ q: 'acme', type: 'payables' }))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })
})
