// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) for the admin inventory route group.
// Every scoped route is exercised 401 (no sid) / 403 (narrow admin) / 200 (full admin) through the
// real authenticateAdmin → resolveSession → hasScope chain, plus payload/param validation and the
// real read/write against jeffi_test. Routes that proxy to document-service (po/**) are skipped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// inventory:write implies inventory:read in hasScope, so a narrow admin that must 403 on an
// inventory:read route may hold NEITHER. 'manager' is a non-platform role (no short-circuit).
const NARROW_INV = ['dashboard:read'] // lacks inventory:read + inventory:write
const NARROW_ORDERS = ['dashboard:read'] // lacks orders:read + orders:write

describe.skipIf(!API_DB_ENABLED)('admin inventory API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  // Rows this suite creates and must clean up.
  const supplierIds: string[] = []
  const serialIds: string[] = []

  // Route handlers, imported after requireTestDb pins the safe DATABASE_URL.
  let suppliers: any
  let supplierById: any
  let stockLevels: any
  let stock: any
  let cost: any
  let overview: any
  let serialsAvailable: any
  let nextSeq: any
  let batchesAvailable: any
  let batchById: any

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    suppliers = await import('@admin/app/api/(admin)/admin/inventory/suppliers/route')
    supplierById = await import('@admin/app/api/(admin)/admin/inventory/suppliers/[id]/route')
    stockLevels = await import('@admin/app/api/(admin)/admin/inventory/stock-levels/route')
    stock = await import('@admin/app/api/(admin)/admin/inventory/stock/route')
    cost = await import('@admin/app/api/(admin)/admin/inventory/cost/route')
    overview = await import('@admin/app/api/(admin)/admin/inventory/overview/route')
    serialsAvailable = await import('@admin/app/api/(admin)/admin/inventory/serials/available/route')
    nextSeq = await import('@admin/app/api/(admin)/admin/inventory/serials/next-seq/route')
    batchesAvailable = await import('@admin/app/api/(admin)/admin/inventory/batches/available/route')
    batchById = await import('@admin/app/api/(admin)/admin/inventory/batches/[id]/route')
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, NARROW_INV, 'manager'))
  })

  afterAll(async () => {
    if (serialIds.length)
      await db.query(`DELETE FROM product_serials WHERE id = ANY($1::uuid[])`, [serialIds]).catch(() => {})
    if (supplierIds.length)
      await db.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [supplierIds]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // ---- suppliers (GET inventory:read, POST inventory:write) --------------------------------

  describe('GET /suppliers', () => {
    const url = 'http://localhost/api/admin/inventory/suppliers'
    it('401 without a session', async () => {
      const res = await suppliers.GET(await apiRequest('GET', url))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:read', async () => {
      const res = await suppliers.GET(await apiRequest('GET', url, { sid: narrowSid }))
      expect(res.status).toBe(403)
    })
    it('200 returns the suppliers list shape', async () => {
      const res = await suppliers.GET(await apiRequest('GET', `${url}?all=true&limit=5`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.suppliers)).toBe(true)
      expect(body).toHaveProperty('total')
      expect(body).toHaveProperty('page')
    })
  })

  describe('POST /suppliers', () => {
    const url = 'http://localhost/api/admin/inventory/suppliers'
    it('401 without a session', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url, { body: { name: 'x' } }))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:write', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url, { sid: narrowSid, body: { name: 'x' } }))
      expect(res.status).toBe(403)
    })
    it('400 on invalid JSON', async () => {
      const req = await apiRequest('POST', url, { sid: fullSid })
      const res = await suppliers.POST(req)
      expect(res.status).toBe(400)
    })
    it('400 when name is empty (zNonEmpty)', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url, { sid: fullSid, body: { name: '' } }))
      expect(res.status).toBe(400)
    })
    it('200 inserts a real supplier row', async () => {
      const name = `API Test Supplier ${crypto.randomBytes(4).toString('hex')}`
      const res = await suppliers.POST(await apiRequest('POST', url, { sid: fullSid, body: { name, email: 'sup@test.local', payment_terms: '45' } }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.id).toBeTruthy()
      supplierIds.push(body.id)
      const row = await db.queryOne<any>(`SELECT name, email, payment_terms FROM suppliers WHERE id = $1`, [body.id])
      expect(row?.name).toBe(name)
      expect(row?.email).toBe('sup@test.local')
      expect(row?.payment_terms).toBe(45) // '45' parsed to int
    })
  })

  // ---- suppliers/[id] (GET inventory:read + 404, PATCH inventory:write) ---------------------

  describe('suppliers/[id]', () => {
    const base = 'http://localhost/api/admin/inventory/suppliers'
    let id = ''
    beforeAll(async () => {
      id = crypto.randomUUID()
      await db.query(`INSERT INTO suppliers (id, name) VALUES ($1,$2)`, [id, 'API Test Supplier Detail'])
      supplierIds.push(id)
    })
    const ctx = (sid: string) => ({ params: Promise.resolve({ id }) })

    it('GET 401 without a session', async () => {
      const res = await supplierById.GET(await apiRequest('GET', `${base}/${id}`), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(401)
    })
    it('GET 403 for an admin lacking inventory:read', async () => {
      const res = await supplierById.GET(await apiRequest('GET', `${base}/${id}`, { sid: narrowSid }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(403)
    })
    it('GET 404 for an unknown supplier', async () => {
      const missing = crypto.randomUUID()
      const res = await supplierById.GET(await apiRequest('GET', `${base}/${missing}`, { sid: fullSid }), { params: Promise.resolve({ id: missing }) })
      expect(res.status).toBe(404)
    })
    it('GET 200 returns the real supplier', async () => {
      const res = await supplierById.GET(await apiRequest('GET', `${base}/${id}`, { sid: fullSid }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.supplier.id).toBe(id)
      expect(body.supplier).toHaveProperty('po_count')
    })
    it('PATCH 403 for an admin lacking inventory:write', async () => {
      const res = await supplierById.PATCH(await apiRequest('PATCH', `${base}/${id}`, { sid: narrowSid, body: { name: 'Renamed' } }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(403)
    })
    it('PATCH 400 when the body has no fields', async () => {
      const res = await supplierById.PATCH(await apiRequest('PATCH', `${base}/${id}`, { sid: fullSid, body: {} }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(400)
    })
    it('PATCH 200 writes the change to the DB', async () => {
      const res = await supplierById.PATCH(await apiRequest('PATCH', `${base}/${id}`, { sid: fullSid, body: { name: 'Renamed Supplier', is_active: false } }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(200)
      const row = await db.queryOne<any>(`SELECT name, is_active FROM suppliers WHERE id = $1`, [id])
      expect(row?.name).toBe('Renamed Supplier')
      expect(row?.is_active).toBe(false)
    })
  })

  // ---- stock-levels (GET inventory:read) ---------------------------------------------------

  describe('GET /stock-levels', () => {
    const url = 'http://localhost/api/admin/inventory/stock-levels'
    it('401 without a session', async () => {
      const res = await stockLevels.GET(await apiRequest('GET', url))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:read', async () => {
      const res = await stockLevels.GET(await apiRequest('GET', url, { sid: narrowSid }))
      expect(res.status).toBe(403)
    })
    it('200 returns numeric out_of_stock / low_stock counts', async () => {
      const res = await stockLevels.GET(await apiRequest('GET', url, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(typeof body.out_of_stock).toBe('number')
      expect(typeof body.low_stock).toBe('number')
    })
  })

  // ---- stock (GET ledger inventory:read, PATCH adjust inventory:write) ----------------------

  describe('stock', () => {
    const url = 'http://localhost/api/admin/inventory/stock'
    it('GET 401 without a session', async () => {
      const res = await stock.GET(await apiRequest('GET', url))
      expect(res.status).toBe(401)
    })
    it('GET 403 for an admin lacking inventory:read', async () => {
      const res = await stock.GET(await apiRequest('GET', url, { sid: narrowSid }))
      expect(res.status).toBe(403)
    })
    it('GET 200 returns the ledger view', async () => {
      const res = await stock.GET(await apiRequest('GET', `${url}?limit=5`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.transactions)).toBe(true)
      expect(body).toHaveProperty('total')
    })
    it('GET 200 valuation view', async () => {
      const res = await stock.GET(await apiRequest('GET', `${url}?view=valuation&limit=5`, { sid: fullSid }))
      expect(res.status).toBe(200)
    })
    it('PATCH 403 for an admin lacking inventory:write', async () => {
      const res = await stock.PATCH(await apiRequest('PATCH', url, { sid: narrowSid, body: { product_id: FIXTURES.product1, new_quantity: 10 } }))
      expect(res.status).toBe(403)
    })
    it('PATCH 400 when neither new_quantity nor unit pair provided', async () => {
      const res = await stock.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { product_id: FIXTURES.product1 } }))
      expect(res.status).toBe(400)
    })
    it('PATCH 200 adjusts a non-tracked product and logs a movement', async () => {
      const before = await db.queryOne<any>(`SELECT inventory_quantity FROM products WHERE id = $1`, [FIXTURES.product1])
      const target = (parseFloat(before?.inventory_quantity) || 0) + 7
      const res = await stock.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { product_id: FIXTURES.product1, new_quantity: target, notes: 'api-db test adjust' } }))
      expect(res.status).toBe(200)
      const after = await db.queryOne<any>(`SELECT inventory_quantity FROM products WHERE id = $1`, [FIXTURES.product1])
      expect(parseFloat(after?.inventory_quantity)).toBe(target)
      const mv = await db.queryOne<any>(
        `SELECT quantity_change FROM inventory_transactions WHERE product_id = $1 AND reference_type='manual' ORDER BY created_at DESC LIMIT 1`,
        [FIXTURES.product1]
      )
      expect(mv).toBeTruthy()
    })
  })

  // ---- cost (PATCH inventory:write) --------------------------------------------------------

  describe('PATCH /cost', () => {
    const url = 'http://localhost/api/admin/inventory/cost'
    it('401 without a session', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { body: { product_id: FIXTURES.product1, cost_price: 5 } }))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:write', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { sid: narrowSid, body: { product_id: FIXTURES.product1, cost_price: 5 } }))
      expect(res.status).toBe(403)
    })
    it('400 when product_id is missing', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { cost_price: 5 } }))
      expect(res.status).toBe(400)
    })
    it('400 when cost_price is missing', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { product_id: FIXTURES.product1 } }))
      expect(res.status).toBe(400)
    })
    it('400 on a negative cost_price', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { product_id: FIXTURES.product1, cost_price: -3 } }))
      expect(res.status).toBe(400)
    })
    it('200 writes cost_price to the product', async () => {
      const res = await cost.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { product_id: FIXTURES.product2, cost_price: '12.50' } }))
      expect(res.status).toBe(200)
      const row = await db.queryOne<any>(`SELECT cost_price FROM products WHERE id = $1`, [FIXTURES.product2])
      expect(parseFloat(row?.cost_price)).toBe(12.5)
    })
  })

  // ---- overview (GET inventory:read via requireAdminScope) ---------------------------------

  describe('GET /overview', () => {
    const url = 'http://localhost/api/admin/inventory/overview'
    it('401 without a session', async () => {
      const res = await overview.GET(await apiRequest('GET', url))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:read', async () => {
      const res = await overview.GET(await apiRequest('GET', url, { sid: narrowSid }))
      expect(res.status).toBe(403)
    })
    it('200 returns the overview aggregate shape', async () => {
      const res = await overview.GET(await apiRequest('GET', url, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('stock')
      expect(body).toHaveProperty('po')
      expect(body).toHaveProperty('period')
    })
  })

  // ---- serials/available (GET orders:read) -------------------------------------------------

  describe('GET /serials/available', () => {
    const url = 'http://localhost/api/admin/inventory/serials/available'
    let ordersNarrowSid = ''
    beforeAll(async () => {
      const auth = await import('@/lib/auth/auth-sessions')
      ;({ sid: ordersNarrowSid } = await makeAdminSession(auth, FIXTURES.adminId, NARROW_ORDERS, 'manager'))
    })
    it('401 without a session', async () => {
      const res = await serialsAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await serialsAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`, { sid: ordersNarrowSid }))
      expect(res.status).toBe(403)
    })
    it('400 when product_id is missing', async () => {
      const res = await serialsAvailable.GET(await apiRequest('GET', url, { sid: fullSid }))
      expect(res.status).toBe(400)
    })
    it('200 returns serials for a product (empty is fine)', async () => {
      const res = await serialsAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.serials)).toBe(true)
    })
    it('200 reads a real in-stock serial back', async () => {
      const sid = crypto.randomUUID()
      const serialNo = `APITEST-${crypto.randomBytes(4).toString('hex')}`
      await db.query(
        `INSERT INTO product_serials (id, product_id, serial_number, status) VALUES ($1,$2,$3,'in_stock')`,
        [sid, FIXTURES.product1, serialNo]
      )
      serialIds.push(sid)
      const res = await serialsAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.serials.some((s: any) => s.serial_number === serialNo)).toBe(true)
    })
  })

  // ---- serials/next-seq (GET inventory:write) ----------------------------------------------

  describe('GET /serials/next-seq', () => {
    const url = 'http://localhost/api/admin/inventory/serials/next-seq'
    it('401 without a session', async () => {
      const res = await nextSeq.GET(await apiRequest('GET', `${url}?prefix=APITEST`))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:write', async () => {
      const res = await nextSeq.GET(await apiRequest('GET', `${url}?prefix=APITEST`, { sid: narrowSid }))
      expect(res.status).toBe(403)
    })
    it('400 when prefix is missing', async () => {
      const res = await nextSeq.GET(await apiRequest('GET', url, { sid: fullSid }))
      expect(res.status).toBe(400)
    })
    it('200 returns the next sequence for a fresh prefix', async () => {
      const prefix = `SEQTEST${crypto.randomBytes(3).toString('hex')}`
      const res = await nextSeq.GET(await apiRequest('GET', `${url}?prefix=${prefix}`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.next_seq).toBe(1)
    })
    it('200 advances past an existing in-stock serial', async () => {
      const prefix = `SEQTEST${crypto.randomBytes(3).toString('hex')}`
      const sid = crypto.randomUUID()
      await db.query(
        `INSERT INTO product_serials (id, product_id, serial_number, status) VALUES ($1,$2,$3,'in_stock')`,
        [sid, FIXTURES.product1, `${prefix}-0007`]
      )
      serialIds.push(sid)
      const res = await nextSeq.GET(await apiRequest('GET', `${url}?prefix=${prefix}`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.next_seq).toBe(8)
    })
  })

  // ---- batches/available (GET orders:read) -------------------------------------------------

  describe('GET /batches/available', () => {
    const url = 'http://localhost/api/admin/inventory/batches/available'
    let ordersNarrowSid = ''
    beforeAll(async () => {
      const auth = await import('@/lib/auth/auth-sessions')
      ;({ sid: ordersNarrowSid } = await makeAdminSession(auth, FIXTURES.adminId, NARROW_ORDERS, 'manager'))
    })
    it('401 without a session', async () => {
      const res = await batchesAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await batchesAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`, { sid: ordersNarrowSid }))
      expect(res.status).toBe(403)
    })
    it('400 when no order/quotation/product id is given', async () => {
      const res = await batchesAvailable.GET(await apiRequest('GET', url, { sid: fullSid }))
      expect(res.status).toBe(400)
    })
    it('200 for a non-tracked product returns empty item sets', async () => {
      // product1 is neither perishable nor serialized → route short-circuits to empty.
      const res = await batchesAvailable.GET(await apiRequest('GET', `${url}?product_id=${FIXTURES.product1}`, { sid: fullSid }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ items: [], serialized_items: [] })
    })
  })

  // ---- batches/[id] (DELETE inventory:write + 404) -----------------------------------------

  describe('DELETE /batches/[id]', () => {
    const base = 'http://localhost/api/admin/inventory/batches'
    it('401 without a session', async () => {
      const id = crypto.randomUUID()
      const res = await batchById.DELETE(await apiRequest('DELETE', `${base}/${id}`), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking inventory:write', async () => {
      const id = crypto.randomUUID()
      const res = await batchById.DELETE(await apiRequest('DELETE', `${base}/${id}`, { sid: narrowSid }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(403)
    })
    it('404 for an unknown batch', async () => {
      const id = crypto.randomUUID()
      const res = await batchById.DELETE(await apiRequest('DELETE', `${base}/${id}`, { sid: fullSid }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(404)
    })
    it('200 deletes a real batch row', async () => {
      const id = crypto.randomUUID()
      await db.query(
        `INSERT INTO product_batches (id, product_id, lot_number, quantity, quantity_remaining) VALUES ($1,$2,$3,5,5)`,
        [id, FIXTURES.product1, `LOT-${crypto.randomBytes(3).toString('hex')}`]
      )
      const res = await batchById.DELETE(await apiRequest('DELETE', `${base}/${id}`, { sid: fullSid }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(200)
      const gone = await db.queryOne<any>(`SELECT id FROM product_batches WHERE id = $1`, [id])
      expect(gone).toBeFalsy()
    })
  })
})
