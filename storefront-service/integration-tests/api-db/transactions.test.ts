// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront (public) transactions route.
// Single GET handler: payments JOIN orders WHERE o.user_id = <authed customer>, paginated.
// Exercises real auth (401), ownership scoping, payment shape mapping, and pagination.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('storefront transactions API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId

  const sfx = uniqueSuffix()
  const myOrderId = `00000000-0000-4000-d111-${sfx.slice(0, 12)}`
  const otherUserId = `00000000-0000-4000-d222-${sfx.slice(0, 12)}`
  const otherOrderId = `00000000-0000-4000-d333-${sfx.slice(0, 12)}`
  const allOrderIds = [myOrderId, otherOrderId]
  // transaction_id is UNIQUE; keep per-run distinct.
  const myTxns = Array.from({ length: 12 }, (_, i) => `TXN-${sfx}-${String(i).padStart(2, '0')}`)
  const otherTxn = `TXN-${sfx}-OTHER`

  async function seedOrder(id: string, uid: string, num: string) {
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, customer_email, customer_name,
        status, payment_status, subtotal, total_amount)
       VALUES ($1,$2,$3,$4,'API Customer','confirmed','paid',100,100)`,
      [id, num, uid, 'apitest-txn@jeffi.test']
    )
  }

  async function seedPayment(orderId: string, txnId: string, amount: number, status: string, method = 'card', gateway = 'razorpay') {
    await db.query(
      `INSERT INTO payments (order_id, transaction_id, payment_method, payment_gateway, amount, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, txnId, method, gateway, amount, status]
    )
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    GET = (await import('@storefront/app/api/(public)/transactions/route')).GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))

    await db.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [otherUserId]).catch(() => {})

    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, is_active) VALUES ($1,$2,'Other','User',true)`,
      [otherUserId, `other-txn-${sfx}@jeffi.test`]
    )
    await seedOrder(myOrderId, userId, `ORD-TXN-${sfx}-A`)
    await seedOrder(otherOrderId, otherUserId, `ORD-TXN-${sfx}-O`)

    // 12 payments for our order (to prove pagination), plus one for the other user's order.
    for (let i = 0; i < myTxns.length; i++) {
      await seedPayment(myOrderId, myTxns[i], 50 + i, i === 0 ? 'captured' : 'pending')
    }
    await seedPayment(otherOrderId, otherTxn, 999, 'captured')
  })

  afterAll(async () => {
    await db.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [otherUserId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [userId]).catch(() => {})
    await endPool()
  })

  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/transactions') as any)
    expect(res.status).toBe(401)
  })

  it('GET returns the customer transactions, scoped to their orders', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/transactions', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.transactions)).toBe(true)
    expect(body.pageSize).toBe(10)
    expect(body.page).toBe(1)
    // 12 payments seeded for this user, but page size caps the list at 10.
    expect(body.total).toBe(12)
    expect(body.transactions.length).toBe(10)
    const txnIds = body.transactions.map((t: any) => t.transactionId)
    // The other user's payment is never returned.
    expect(txnIds).not.toContain(otherTxn)
    for (const id of txnIds) expect(myTxns).toContain(id)
    // Mapped shape: amount parsed to number, order join fields present.
    const first = body.transactions[0]
    expect(typeof first.amount).toBe('number')
    expect(first.orderId).toBe(myOrderId)
    expect(first.orderNumber).toBe(`ORD-TXN-${sfx}-A`)
    expect(first.paymentGateway).toBe('razorpay')
  })

  it('GET page=2 returns the remaining 2 transactions', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/transactions?page=2', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.total).toBe(12)
    expect(body.transactions.length).toBe(2)
  })

  it('GET clamps a non-positive page to 1', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/transactions?page=0', { sid }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).page).toBe(1)
    // NOTE: ?page=abc → parseInt NaN → Math.max(1,NaN)=NaN → offset NaN → int8 scan 500.
    // Latent route bug (Math.max does not coerce NaN); not asserted here so the test does not pin a 500.
  })

  it('GET returns an empty well-formed page for a customer with no transactions', async () => {
    const auth = await import('@/lib/auth/auth-sessions')
    const { sid: emptySid } = await makeCustomerSession(auth, otherUserId)
    // otherUser DOES own a payment — so instead use a brand-new user with none.
    const freshUserId = `00000000-0000-4000-d444-${sfx.slice(0, 12)}`
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, is_active) VALUES ($1,$2,'Fresh','User',true)`,
      [freshUserId, `fresh-txn-${sfx}@jeffi.test`]
    )
    const { sid: freshSid } = await makeCustomerSession(auth, freshUserId)
    const res = await GET(await apiRequest('GET', 'http://localhost/api/transactions', { sid: freshSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(body.transactions.length).toBe(0)
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = ANY($1::uuid[]) AND principal_type='customer'`, [[otherUserId, freshUserId]]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [freshUserId]).catch(() => {})
    void emptySid
  })
})
