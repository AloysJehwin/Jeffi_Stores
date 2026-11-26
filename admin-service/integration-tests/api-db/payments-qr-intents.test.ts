// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier): QR-first invoices. The real routes, offline-invoice code and webhook
// finaliser run against Postgres; only Razorpay (QR create/close/payments) and the poster crop are faked.
// Covered: the dry run creates nothing, the webhook finalises once (paid order + payment row), duplicate webhook,
// poll, cancel (and a payment after it), expiry, and a finalise that fails after payment.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const rzp = vi.hoisted(() => ({
  n: 0,
  payments: new Map<string, any[]>(),
  closed: new Set<string>(),
}))
vi.mock('@/lib/payments/razorpay', () => ({
  getRazorpayInstanceFor: async () => ({
    instance: {
      qrCode: {
        create: async () => ({ id: `qr_test_${++rzp.n}_${Date.now()}`, image_url: 'https://rzp.test/poster.png' }),
        close: async (id: string) => void rzp.closed.add(id),
        fetchAllPayments: async (id: string) => ({ items: rzp.payments.get(id) ?? [] }),
      },
    },
  }),
}))
vi.mock('@/lib/payments/upi-qr', () => ({ cropRazorpayQr: async () => 'data:image/png;base64,QR' }))

describe.skipIf(!API_DB_ENABLED)('QR-first invoice payments (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let lib: typeof import('@/lib/payments/qr-intents')
  let createPOST: (req: any) => Promise<Response>
  let pollGET: (req: any, ctx: any) => Promise<Response>
  let cancelPOST: (req: any, ctx: any) => Promise<Response>
  let sid = ''
  let narrowSid = ''
  const sfx = uniqueSuffix()
  const customer = `QR Test ${sfx}`
  const intents: string[] = []
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  const payload = (price = 590) => ({
    customerName: customer,
    customerPhone: '9000000000',
    customerEmail: '',
    addressLine1: '1 Test Rd',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600001',
    paymentMode: 'upi_qr',
    items: [{ product_name: 'Service visit', unit: 'NOS', unit_price: price, quantity: 1, gst_rate: 18 }],
  })

  async function create(body: unknown, s = sid) {
    const res = await createPOST(await apiRequest('POST', 'http://localhost/api/admin/payments/qr-intents', { sid: s, body }))
    const json: any = await res.json()
    if (json.intentId) intents.push(json.intentId)
    return { res, json }
  }
  const intent = (id: string) => db.queryOne<any>(`SELECT * FROM payment_intents WHERE id = $1`, [id])
  const ordersFor = () => db.queryMany<any>(`SELECT * FROM orders WHERE customer_name = $1`, [customer])

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    lib = await import('@/lib/payments/qr-intents')
    const auth = await import('@/lib/auth/auth-sessions')
    createPOST = (await import('@admin/app/api/(admin)/admin/payments/qr-intents/route')).POST as any
    pollGET = (await import('@admin/app/api/(admin)/admin/payments/qr-intents/[id]/route')).GET as any
    cancelPOST = (await import('@admin/app/api/(admin)/admin/payments/qr-intents/[id]/cancel/route')).POST as any
    ;({ sid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['invoices:read'], 'manager'))
  })

  afterAll(async () => {
    const orders = await ordersFor().catch(() => [] as any[])
    const ids = orders.map(o => o.id)
    if (ids.length) {
      await db.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {})
      await db.query(`DELETE FROM invoices WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {})
      await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {})
      await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]).catch(() => {})
    }
    await db.query(`DELETE FROM addresses WHERE full_name = $1`, [customer]).catch(() => {})
    await db.query(`DELETE FROM admin_notifications WHERE entity_id = ANY($1)`, [intents]).catch(() => {})
    await db.query(`DELETE FROM payment_intents WHERE id = ANY($1::uuid[])`, [intents]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type = 'admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session, 403 without invoices:write', async () => {
    const res = await createPOST(await apiRequest('POST', 'http://localhost/api/admin/payments/qr-intents', { body: { kind: 'invoice', payload: payload() } }))
    expect(res.status).toBe(401)
    expect((await create({ kind: 'invoice', payload: payload() }, narrowSid)).res.status).toBe(403)
  })

  it('validates like the create call and refuses a bad body with nothing written', async () => {
    const { res, json } = await create({ kind: 'invoice', payload: { ...payload(), items: [] } })
    expect(res.status).toBe(400)
    expect(json.error).toBe('Validation failed')
    expect(await ordersFor()).toHaveLength(0)
  })

  it('shows the QR first: the dry run creates no order, the webhook then creates it once, paid by UPI QR', async () => {
    const { res, json } = await create({ kind: 'invoice', payload: payload() })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ intentId: expect.any(String), qrImageUrl: 'data:image/png;base64,QR', amount: expect.any(Number) })
    expect(json.amount).toBeGreaterThan(0)
    // The dry run rolled back: no order, no address left behind.
    expect(await ordersFor()).toHaveLength(0)
    expect(await db.queryOne(`SELECT 1 FROM addresses WHERE full_name = $1`, [customer])).toBeNull()
    const row = await intent(json.intentId)
    expect(row).toMatchObject({ kind: 'invoice', status: 'pending', amount_paise: String(Math.round(json.amount * 100)) })
    expect(row.razorpay_qr_id).toMatch(/^qr_test_/)

    const poll1: any = await (await pollGET(await apiRequest('GET', `http://localhost/x`, { sid }), ctx(json.intentId))).json()
    expect(poll1).toMatchObject({ status: 'pending', amount: json.amount })

    // qr_code.credited for the flagship store (no Route transfer for the platform's own store).
    const pay = { id: `pay_test_${sfx}_1`, amount: Number(row.amount_paise), status: 'captured', method: 'upi', vpa: 'buyer@upi' }
    expect(await lib.applyQrIntentPayment({ id: row.razorpay_qr_id, notes: { payment_intent_id: row.id } }, pay, null)).toBe('paid')
    const done = await intent(json.intentId)
    expect(done).toMatchObject({ status: 'finalised', razorpay_payment_id: pay.id })
    const orders = await ordersFor()
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ id: done.result_ref, payment_status: 'paid', payment_mode: 'upi_qr', razorpay_qr_id: row.razorpay_qr_id, status: 'delivered' })
    expect(orders[0].invoice_number).toBeTruthy()
    const payment = await db.queryOne<any>(`SELECT * FROM payments WHERE transaction_id = $1`, [pay.id])
    expect(payment).toMatchObject({ order_id: orders[0].id, payment_gateway: 'razorpay_qr', status: 'completed', vpa: 'buyer@upi' })

    // A redelivered webhook (and the payment.captured fallback) finalise nothing twice.
    expect(await lib.applyQrIntentPayment({ id: row.razorpay_qr_id, notes: { payment_intent_id: row.id } }, pay, null)).toBe('already_paid')
    expect(await ordersFor()).toHaveLength(1)

    const poll2: any = await (await pollGET(await apiRequest('GET', `http://localhost/x`, { sid }), ctx(json.intentId))).json()
    expect(poll2).toMatchObject({ status: 'finalised', resultRef: orders[0].id, resultUrl: `/admin/invoices/${orders[0].id}/view`, invoiceNumber: orders[0].invoice_number })
  })

  it('the poll finds a payment the webhook missed', async () => {
    const { json } = await create({ kind: 'invoice', payload: payload(100) })
    const row = await intent(json.intentId)
    rzp.payments.set(row.razorpay_qr_id, [{ id: `pay_test_${sfx}_2`, amount: Number(row.amount_paise), status: 'captured', method: 'upi' }])
    const poll: any = await (await pollGET(await apiRequest('GET', `http://localhost/x`, { sid }), ctx(json.intentId))).json()
    expect(poll.status).toBe('finalised')
    expect(await ordersFor()).toHaveLength(2)
  })

  it('cancel closes the QR; a payment that still lands fails the intent and creates nothing', async () => {
    const { json } = await create({ kind: 'invoice', payload: payload(50) })
    const row = await intent(json.intentId)
    const res = await cancelPOST(await apiRequest('POST', `http://localhost/x`, { sid }), ctx(json.intentId))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('cancelled')
    expect(rzp.closed.has(row.razorpay_qr_id)).toBe(true)

    expect(await lib.applyQrIntentPayment({ id: row.razorpay_qr_id, notes: { payment_intent_id: row.id } }, { id: `pay_test_${sfx}_3`, amount: Number(row.amount_paise), status: 'captured' }, null)).toBe('paid')
    expect(await intent(json.intentId)).toMatchObject({ status: 'failed', razorpay_payment_id: `pay_test_${sfx}_3` })
    expect(await ordersFor()).toHaveLength(2)
    const again = await cancelPOST(await apiRequest('POST', `http://localhost/x`, { sid }), ctx(json.intentId))
    expect(again.status).toBe(409)
  })

  it('an overdue intent expires and closes its QR', async () => {
    const { json } = await create({ kind: 'invoice', payload: payload(60) })
    await db.query(`UPDATE payment_intents SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [json.intentId])
    const poll: any = await (await pollGET(await apiRequest('GET', `http://localhost/x`, { sid }), ctx(json.intentId))).json()
    expect(poll.status).toBe('expired')
    expect(rzp.closed.has((await intent(json.intentId)).razorpay_qr_id)).toBe(true)
  })

  it('a finalise that fails after payment leaves the intent failed with the reason and the payment recorded', async () => {
    const { json } = await create({ kind: 'invoice', payload: payload(70) })
    const row = await intent(json.intentId)
    // The stored body no longer prices to what was paid (as if the total changed): the create refuses it.
    await db.query(`UPDATE payment_intents SET payload = jsonb_set(payload, '{items,0,unit_price}', '80') WHERE id = $1`, [json.intentId])
    await lib.applyQrIntentPayment({ id: row.razorpay_qr_id, notes: { payment_intent_id: row.id } }, { id: `pay_test_${sfx}_4`, amount: Number(row.amount_paise), status: 'captured' }, null)
    const failed = await intent(json.intentId)
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/was paid/)
    expect(failed.razorpay_payment_id).toBe(`pay_test_${sfx}_4`)
    expect(await ordersFor()).toHaveLength(2)
    const poll: any = await (await pollGET(await apiRequest('GET', `http://localhost/x`, { sid }), ctx(json.intentId))).json()
    expect(poll).toMatchObject({ status: 'failed', error: failed.error })
  })
})
