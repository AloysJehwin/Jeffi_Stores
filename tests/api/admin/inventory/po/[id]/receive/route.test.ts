import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn(),
  updateWeightedAvgCost: vi.fn(),
  recomputeStockStatusForProduct: vi.fn(),
}))
vi.mock('@/lib/shelf', () => ({
  adjustStock: vi.fn(),
  syncPerishableStock: vi.fn(),
  getOrCreateOpenShelf: vi.fn().mockResolvedValue('shelf-open-1'),
}))
vi.mock('@/lib/email', () => ({
  sendPOReceiveNotificationEmail: vi.fn(),
}))
vi.mock('@/lib/validate', async () => {
  const { z } = await import('zod')
  return {
    parseBody: vi.fn(),
    zUuid: z.string().uuid(),
  }
})

// ── Imports ────────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/inventory/po/[id]/receive/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, getClient } from '@/lib/db'
import { logStockMovement, updateWeightedAvgCost } from '@/lib/inventory'
import { sendPOReceiveNotificationEmail } from '@/lib/email'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGetClient = vi.mocked(getClient)
const mockLogStock = vi.mocked(logStockMovement)
const mockUpdateWAC = vi.mocked(updateWeightedAvgCost)
const mockSendEmail = vi.mocked(sendPOReceiveNotificationEmail)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['inventory'],
}

const poId = 'po-uuid-1'
const params = { params: Promise.resolve({ id: poId }) }

function makePost(body: unknown) {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${poId}/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  received_date: '2024-01-15',
  notes: 'First delivery',
  items: [
    {
      po_item_id: 'poi-1',
      product_id: 'prod-1',
      variant_id: null,
      sub_variant_id: null,
      quantity_received: 10,
      unit_cost: 50,
    },
  ],
}

const mockPO = {
  id: poId,
  po_number: 'PO-001',
  status: 'pending',
  supplier_id: 'sup-1',
  supplier_name: 'Acme Ltd',
  contact_name: 'John',
  supplier_email: 'supplier@example.com',
}

function buildMockClient(overrides: Record<string, any> = {}) {
  let callCount = 0
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      callCount++
      // GRN insert
      if (sql.includes('INSERT INTO grns')) {
        return { rows: [{ id: 'grn-1' }] }
      }
      // grn_number count
      if (sql.includes('grn_number LIKE')) {
        return null // handled via queryOne mock
      }
      // inventory lock for product
      if (sql.includes('FROM products WHERE id')) {
        return { rows: [{ inventory_quantity: '100' }] }
      }
      // po items check
      if (sql.includes('FROM purchase_order_items WHERE po_id')) {
        return {
          rows: [{ quantity: '10', quantity_received: '10' }],
        }
      }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  return { ...client, ...overrides }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/inventory/po/[id]/receive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLogStock.mockResolvedValue(undefined as any)
    mockUpdateWAC.mockResolvedValue(undefined as any)
    mockSendEmail.mockResolvedValue(undefined as any)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'items required' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makePost({ items: [] }), params as any)
    expect(res.status).toBe(422)
  })

  it('returns 404 when PO not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toMatch(/not found/i)
  })

  it('returns 400 when PO is cancelled', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne.mockResolvedValue({ ...mockPO, status: 'cancelled' } as any)
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/cancelled/i)
  })

  it('creates GRN successfully for product (no variant)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)  // PO lookup
      .mockResolvedValueOnce({ cnt: 0 } as any)  // GRN count

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-1' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '100' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    // second getClient call for expense
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.grn_id).toBe('grn-1')
    expect(data.grn_number).toMatch(/^GRN-/)
  })

  it('creates GRN with variant (no sub-variant)', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const itemsWithVariant = [{ ...validBody.items[0], variant_id: 'var-1', product_id: 'prod-1' }]
    mockParseBody.mockReturnValue({ ok: true, data: { items: itemsWithVariant } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 2 } as any)

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-2' }] }
        if (sql.includes('FROM product_variants WHERE id')) return { rows: [{ inventory_quantity: '20' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makePost({ ...validBody, items: itemsWithVariant }), params as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('creates GRN with sub-variant', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const itemsWithSub = [{
      ...validBody.items[0],
      variant_id: 'var-1',
      sub_variant_id: 'sv-1',
    }]
    mockParseBody.mockReturnValue({ ok: true, data: { items: itemsWithSub } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-3' }] }
        if (sql.includes('FROM product_sub_variants WHERE id')) return { rows: [{ inventory_quantity: '5' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '5', quantity_received: '5' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makePost({ ...validBody, items: itemsWithSub }), params as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('sets status to partial when not all items received', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-4' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '0' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          // Only some received
          return { rows: [{ quantity: '20', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    // Verify UPDATE orders was called with 'partial'
    const updateCall = client.query.mock.calls.find(
      (c: any) => c[0].includes('UPDATE purchase_orders') && c[1].includes('partial')
    )
    expect(updateCall).toBeDefined()
  })

  it('sends notification email when supplier has email', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-5' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '100' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([{
      product_name: 'Bolt', variant_name: null, quantity_received: '10', unit_cost: '50',
    }])

    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'supplier@example.com',
      'John',
      'Acme Ltd',
      'PO-001',
      expect.stringMatching(/^GRN-/),
      'received',
      expect.any(Array)
    )
  })

  it('does not fail if email sending throws', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-6' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '100' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    mockSendEmail.mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne.mockRejectedValue(new Error('DB failure'))

    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/DB failure/i)
  })

  // ── Serialized: serial count = base units ÷ qty_step ─────────────────────────
  describe('serialized serial-count guard (base units ÷ qty_step)', () => {
    // 4 base units (qty_received 4, factor 1) at qty_step 0.5 → 8 serials required.
    const serializedItem = {
      po_item_id: 'poi-1', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 4, unit_cost: 50, purchase_unit_factor: 1,
    }
    function serializedClient() {
      return {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-s' }] }
          if (sql.includes('perishable, serialized')) return { rows: [{ perishable: false, serialized: true }] }
          if (sql.includes('COALESCE(vsu.qty_step')) return { rows: [{ qty_step: '0.5' }] }
          if (sql.includes('FROM product_serials WHERE product_id')) return { rows: [] } // no dupes
          if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '100' }] }
          if (sql.includes('FROM purchase_order_items WHERE po_id')) return { rows: [{ quantity: '4', quantity_received: '4' }] }
          return { rows: [] }
        }),
        release: vi.fn(),
      }
    }

    it('rejects when serial count does not match base units ÷ qty_step', async () => {
      mockAuth.mockResolvedValue(admin as any)
      mockHasScope.mockReturnValue(true)
      // 4 base units / 0.5 = 8 expected, but only 3 provided → throw → 500
      mockParseBody.mockReturnValue({ ok: true, data: { items: [{ ...serializedItem, serial_numbers: ['S1', 'S2', 'S3'] }] } } as any)
      mockQueryOne.mockResolvedValueOnce(mockPO as any).mockResolvedValueOnce({ cnt: 0 } as any)
      mockGetClient.mockResolvedValue(serializedClient() as any)
      mockQueryMany.mockResolvedValue([])

      const res = await POST(makePost(validBody), params as any)
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toMatch(/expected 8 serial number/i)
    })

    it('accepts when serial count equals base units ÷ qty_step', async () => {
      mockAuth.mockResolvedValue(admin as any)
      mockHasScope.mockReturnValue(true)
      const serials = Array.from({ length: 8 }, (_, i) => `S-${i + 1}`)
      mockParseBody.mockReturnValue({ ok: true, data: { items: [{ ...serializedItem, serial_numbers: serials }] } } as any)
      mockQueryOne.mockResolvedValueOnce(mockPO as any).mockResolvedValueOnce({ cnt: 0 } as any)
      const client = serializedClient()
      mockGetClient.mockResolvedValue(client as any)
      mockQueryMany.mockResolvedValue([])

      const res = await POST(makePost(validBody), params as any)
      expect(res.status).toBe(200)
      // exactly 8 product_serials inserts
      const inserts = client.query.mock.calls.filter((c: any[]) => /INSERT INTO product_serials/.test(c[0]))
      expect(inserts).toHaveLength(8)
    })
  })

  // ── New branch coverage ────────────────────────────────────────────────────────

  it('rejects duplicate serial numbers already in stock', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const serialItem = {
      po_item_id: 'poi-1', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 1, unit_cost: 50, serial_numbers: ['SN-DUPE'],
    }
    mockParseBody.mockReturnValue({ ok: true, data: { items: [serialItem] } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-d' }] }
        if (sql.includes('perishable, serialized')) return { rows: [{ perishable: false, serialized: true }] }
        if (sql.includes('COALESCE(vsu.qty_step')) return { rows: [{ qty_step: '1' }] }
        if (sql.includes('FROM product_serials WHERE product_id')) return { rows: [{ serial_number: 'SN-DUPE' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '10' }] }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/duplicate serial/i)
  })

  it('throws when perishable product has no expiry_date', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const perishItem = {
      po_item_id: 'poi-1', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 5, unit_cost: 20, expiry_date: null,
    }
    mockParseBody.mockReturnValue({ ok: true, data: { items: [perishItem] } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-p' }] }
        if (sql.includes('perishable, serialized')) return { rows: [{ perishable: true, serialized: false }] }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/perishable.*expiry_date/i)
  })

  it('creates batch for perishable product with expiry_date', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const perishItem = {
      po_item_id: 'poi-1', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 5, unit_cost: 20, expiry_date: '2025-12-31',
      manufacture_date: '2024-06-01', lot_number: 'LOT-A',
    }
    mockParseBody.mockReturnValue({ ok: true, data: { items: [perishItem] } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-p2' }] }
        if (sql.includes('perishable, serialized')) return { rows: [{ perishable: true, serialized: false }] }
        if (sql.includes('SUM(quantity_remaining)')) return { rows: [{ total: '0' }] }
        if (sql.includes('INSERT INTO product_batches')) return { rows: [{ id: 'batch-p1' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '5', quantity_received: '5' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    const batchInsert = client.query.mock.calls.find(
      (c: any[]) => c[0].includes('INSERT INTO product_batches')
    )
    expect(batchInsert).toBeDefined()
  })

  it('skips items where qtyReceived <= 0', async () => {
    const zeroItem = {
      po_item_id: 'poi-z', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 0, unit_cost: 50,
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: [zeroItem] } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-z' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '0', quantity_received: '0' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    const grnItemInserts = client.query.mock.calls.filter(
      (c: any[]) => c[0].includes('INSERT INTO grn_items')
    )
    expect(grnItemInserts).toHaveLength(0)
  })

  it('sets PO status to received when all items fully received', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 1 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-full' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '0' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    const statusUpdate = client.query.mock.calls.find(
      (c: any[]) => c[0].includes('UPDATE purchase_orders') && c[1]?.[0] === 'received'
    )
    expect(statusUpdate).toBeDefined()
  })

  it('does not send email when supplier_email is absent', async () => {
    const poNoEmail = { ...mockPO, supplier_email: null }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { items: validBody.items } } as any)
    mockQueryOne
      .mockResolvedValueOnce(poNoEmail as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-noemail' }] }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '100' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '10', quantity_received: '10' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('uses purchase_unit_factor to convert received qty to base units', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const itemWithFactor = [{
      po_item_id: 'poi-1', product_id: 'prod-1', variant_id: null, sub_variant_id: null,
      quantity_received: 2, unit_cost: 100, purchase_unit_factor: 6,
    }]
    mockParseBody.mockReturnValue({ ok: true, data: { items: itemWithFactor } } as any)
    mockQueryOne
      .mockResolvedValueOnce(mockPO as any)
      .mockResolvedValueOnce({ cnt: 0 } as any)
    let capturedGrnItemQty: number | null = null
    const client = {
      query: vi.fn().mockImplementation((sql: string, p?: any[]) => {
        if (sql.includes('INSERT INTO grns')) return { rows: [{ id: 'grn-factor' }] }
        if (sql.includes('INSERT INTO grn_items')) {
          capturedGrnItemQty = p?.[5] ?? null
          return { rows: [] }
        }
        if (sql.includes('FROM products WHERE id')) return { rows: [{ inventory_quantity: '20' }] }
        if (sql.includes('FROM purchase_order_items WHERE po_id')) {
          return { rows: [{ quantity: '12', quantity_received: '12' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost(validBody), params as any)
    expect(res.status).toBe(200)
    expect(capturedGrnItemQty).toBe(12)
  })
})
