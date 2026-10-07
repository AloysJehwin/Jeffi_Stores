// @vitest-environment node
//
// DB-backed replay of signed Razorpay subscription webhooks through the real POST handler and cycle
// engine. Opt-in: REPLAY_DB=1 + a LOCAL Postgres (.env.local DATABASE_URL on localhost:5432). Only
// the tenant router, the Razorpay SDK/Route, invoices and every outbound sender are mocked.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const ENABLED = process.env.REPLAY_DB === '1'

const { stubAll } = vi.hoisted(() => ({
  // Every exported function becomes a resolved no-op so `fn(...).catch()` call sites keep working.
  stubAll: (mod: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn().mockResolvedValue(undefined) : v])
    ),
}))

vi.mock('@/lib/payments/webhook-tenant', () => ({
  resolveSubscriptionTenant: vi.fn(async () => ({
    tenantId: '00000000-0000-0000-0000-000000000000',
    slug: 'platform',
    ctx: null,
  })),
  runInTenant: vi.fn(async (_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('razorpay', () => ({ default: vi.fn() }))
vi.mock('@/lib/payments/razorpay', async orig => stubAll(await orig()))
vi.mock('@/lib/payments/razorpay-route', async orig => stubAll(await orig()))
vi.mock('@/lib/email', async orig => stubAll(await orig()))
vi.mock('@/lib/email/subscription', async orig => stubAll(await orig()))
vi.mock('@/lib/email/sms', async orig => stubAll(await orig()))
vi.mock('@/lib/email/whatsapp', async orig => stubAll(await orig()))
vi.mock('@/lib/shared/sms', async orig => stubAll(await orig()))
vi.mock('@/lib/shared/whatsapp', async orig => stubAll(await orig()))
vi.mock('@/lib/shared/notify', async orig => stubAll(await orig()))
vi.mock('@/lib/shared/s3', async orig => stubAll(await orig()))
vi.mock('@/lib/documents/invoice', async orig => stubAll(await orig()))

const SECRET = 'test-webhook-secret'
const DAY = 24 * 60 * 60 * 1000

function loadLocalDbUrl(): string {
  const raw = fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8')
  const line = raw.split('\n').find(l => l.startsWith('DATABASE_URL='))
  const url = (line ?? '').slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  const host = new URL(url).host
  if (host !== 'localhost:5432' && host !== '127.0.0.1:5432') {
    throw new Error(`webhook-replay refuses to run against non-local DB (${host})`)
  }
  return url
}

describe.skipIf(!ENABLED)('Razorpay subscription webhook replay (real DB)', () => {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`
  let POST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let NextRequest: typeof import('next/server').NextRequest

  let userId = ''
  let addressId = ''
  let physId = ''
  let digiId = ''
  const subs: Record<string, { id: string; rzp: string }> = {}

  const nowSec = Math.floor(Date.now() / 1000)
  const p1 = { start: nowSec, end: nowSec + 30 * 86400 }
  const p2 = { start: p1.end, end: p1.end + 30 * 86400 }

  function subEntity(rzp: string, status: string, paidCount: number, period: { start: number; end: number }) {
    return {
      id: rzp,
      entity: 'subscription',
      plan_id: `plan_replay_${suffix}`,
      status,
      quantity: 1,
      total_count: 120,
      paid_count: paidCount,
      remaining_count: 120 - paidCount,
      current_start: period.start,
      current_end: period.end,
      charge_at: period.end,
      notes: { tenant_id: '00000000-0000-0000-0000-000000000000' },
    }
  }

  function paymentEntity(payId: string, amountPaise: number) {
    return {
      id: payId,
      entity: 'payment',
      amount: amountPaise,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      captured: true,
      invoice_id: `inv_${payId}`,
      order_id: `order_${payId}`,
    }
  }

  function chargedEvent(rzp: string, payId: string, paidCount: number, period = p1, amountPaise = 49900) {
    return {
      entity: 'event',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
      payload: {
        subscription: { entity: subEntity(rzp, 'active', paidCount, period) },
        payment: { entity: paymentEntity(payId, amountPaise) },
      },
      created_at: nowSec,
    }
  }

  function stateEvent(type: string, rzp: string, status: string, paidCount: number, period = p1) {
    return {
      entity: 'event',
      event: type,
      contains: ['subscription'],
      payload: { subscription: { entity: subEntity(rzp, status, paidCount, period) } },
      created_at: nowSec,
    }
  }

  async function send(event: unknown, opts: { badSig?: boolean } = {}) {
    const body = JSON.stringify(event)
    const sig = crypto.createHmac('sha256', opts.badSig ? 'wrong-secret' : SECRET).update(body).digest('hex')
    const req = new NextRequest('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': `evt_${crypto.randomBytes(6).toString('hex')}`,
      },
    })
    return POST(req)
  }

  const ordersFor = (subId: string) =>
    db.queryMany<{ id: string; status: string; payment_status: string; subscription_cycle: number }>(
      `SELECT id, status, payment_status, subscription_cycle FROM orders WHERE subscription_id = $1 ORDER BY subscription_cycle`,
      [subId]
    )
  const ledgerFor = (subId: string) =>
    db.queryMany<{ cycle_number: number; razorpay_payment_id: string; order_id: string | null }>(
      `SELECT cycle_number, razorpay_payment_id, order_id FROM subscription_cycle_orders WHERE subscription_id = $1 ORDER BY cycle_number`,
      [subId]
    )
  const subRow = (subId: string) => db.queryOne<any>(`SELECT * FROM subscriptions WHERE id = $1`, [subId])

  async function insertSub(key: string, productId: string, isDigital: boolean) {
    const rzp = `sub_replay_${key}_${suffix}`
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO subscriptions (
         user_id, product_id, status, interval_minutes, next_renewal_at, source,
         razorpay_subscription_id, razorpay_plan_id, quantity, interval, interval_count, period,
         unit_price_paise, unit_price_ex_gst, shipping_paise, gst_rate, hsn_code, is_digital,
         address_id, address_snapshot, collecting_account, current_cycle, total_count, term_cycles,
         consent_version, consent_at, locked_price_at
       ) VALUES (
         $1, $2, 'authenticated', 43200, NOW() + interval '30 days', 'razorpay',
         $3, $4, 1, 'monthly', 1, 'monthly', 49900, 422.88, $5, 18, '8471', $6,
         $7, $8::jsonb, 'platform', 0, 120, NULL, 'v1', NOW(), NOW()
       ) RETURNING id`,
      [
        userId,
        productId,
        rzp,
        `plan_replay_${suffix}`,
        isDigital ? 0 : 5000,
        isDigital,
        addressId,
        JSON.stringify({
          full_name: 'Replay Tester',
          phone: '9999999999',
          address_line1: '1 Test Street',
          address_line2: null,
          landmark: null,
          city: 'Chennai',
          state: 'Tamil Nadu',
          postal_code: '600001',
          country: 'India',
        }),
      ]
    )
    subs[key] = { id: row!.id, rzp }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = loadLocalDbUrl()
    delete process.env.RDS_IAM_AUTH
    db = await import('@/lib/shared/db')
    ;({ NextRequest } = await import('next/server'))
    ;({ POST } = (await import('@/app/api/(public)/webhooks/razorpay/route')) as any)

    const u = await db.queryOne<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name, phone) VALUES ($1, 'Replay', 'Tester', '9999999999') RETURNING id`,
      [`replay-${suffix}@example.invalid`]
    )
    userId = u!.id
    const a = await db.queryOne<{ id: string }>(
      `INSERT INTO addresses (user_id, full_name, phone, address_line1, city, state, postal_code, country)
       VALUES ($1, 'Replay Tester', '9999999999', '1 Test Street', 'Chennai', 'Tamil Nadu', '600001', 'India') RETURNING id`,
      [userId]
    )
    addressId = a!.id
    const mkProduct = async (kind: string, isDigital: boolean) =>
      (await db.queryOne<{ id: string }>(
        `INSERT INTO products (sku, name, slug, base_price, is_digital, is_subscription, is_draft, inventory_quantity)
         VALUES ($1, $2, $3, 499, $4, true, true, 100) RETURNING id`,
        [`REPLAY-${kind}-${suffix}`, `Replay ${kind} ${suffix}`, `replay-${kind}-${suffix}`.toLowerCase(), isDigital]
      ))!.id
    physId = await mkProduct('PHYS', false)
    digiId = await mkProduct('DIGI', true)

    await insertSub('phys', physId, false)
    await insertSub('digi', digiId, true)
    await insertSub('cancel', physId, false)
    await insertSub('conc', physId, false)
    await insertSub('badsig', physId, false)
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    // Let fire-and-forget side effects (activity log, signals) settle before deleting their parents.
    await new Promise(r => setTimeout(r, 750))
    const ids = Object.values(subs).map(s => s.id)
    const steps: Array<[string, unknown[]]> = [
      [`DELETE FROM vault_entitlements WHERE user_id = $1`, [userId]],
      [`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`, [userId]],
      [`DELETE FROM subscription_cycle_orders WHERE subscription_id = ANY($1::uuid[])`, [ids]],
      [`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`, [userId]],
      [`DELETE FROM orders WHERE user_id = $1`, [userId]],
      [`DELETE FROM subscriptions WHERE id = ANY($1::uuid[]) OR user_id = $2`, [ids, userId]],
      [`DELETE FROM addresses WHERE user_id = $1`, [userId]],
      [`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[physId, digiId].filter(Boolean)]],
      [`DELETE FROM users WHERE id = $1`, [userId]],
    ]
    for (const [sql, params] of steps) {
      if (!userId) break
      await db.query(sql, params).catch(err => console.error('[webhook-replay cleanup]', sql, err.message))
    }
    await (globalThis as any).__appPool?.end().catch(() => {})
  }, 60_000)

  it('1. subscription.charged (cycle 1) mints one confirmed paid order + ledger row, sub goes active', async () => {
    const { id, rzp } = subs.phys
    const res = await send(chargedEvent(rzp, `pay_replay_phys1_${suffix}`, 1))
    expect(res.status).toBe(200)

    const orders = await ordersFor(id)
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ subscription_cycle: 1, payment_status: 'paid', status: 'confirmed' })
    const ledger = await ledgerFor(id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ cycle_number: 1, order_id: orders[0].id })

    const sub = await subRow(id)
    expect(sub.status).toBe('active')
    expect(new Date(sub.current_end).getTime()).toBe(p1.end * 1000)
    expect(sub.current_cycle).toBe(1)
  })

  it('2. replaying the identical signed event is idempotent', async () => {
    const { id, rzp } = subs.phys
    const res = await send(chargedEvent(rzp, `pay_replay_phys1_${suffix}`, 1))
    expect(res.status).toBe(200)
    expect(await ordersFor(id)).toHaveLength(1)
    expect(await ledgerFor(id)).toHaveLength(1)
  })

  it('3. second cycle (new payment, paid_count 2) mints cycle 2', async () => {
    const { id, rzp } = subs.phys
    const res = await send(chargedEvent(rzp, `pay_replay_phys2_${suffix}`, 2, p2))
    expect(res.status).toBe(200)
    const orders = await ordersFor(id)
    expect(orders.map(o => o.subscription_cycle)).toEqual([1, 2])
    expect((await ledgerFor(id)).map(l => l.cycle_number)).toEqual([1, 2])
    const sub = await subRow(id)
    expect(sub.current_cycle).toBe(2)
    expect(new Date(sub.current_end).getTime()).toBe(p2.end * 1000)
  })

  it('4. digital cycle → granted order + subscription entitlement expiring at current_end + 3 days', async () => {
    const { id, rzp } = subs.digi
    const res = await send(chargedEvent(rzp, `pay_replay_digi1_${suffix}`, 1))
    expect(res.status).toBe(200)

    const orders = await ordersFor(id)
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ status: 'granted', payment_status: 'paid', subscription_cycle: 1 })

    const ents = await db.queryMany<any>(`SELECT * FROM vault_entitlements WHERE subscription_id = $1`, [id])
    expect(ents).toHaveLength(1)
    expect(ents[0]).toMatchObject({ source: 'subscription', status: 'active', order_id: orders[0].id })
    const expected = p1.end * 1000 + 3 * DAY
    expect(Math.abs(new Date(ents[0].access_expires_at).getTime() - expected)).toBeLessThan(1000)
    expect((await subRow(id)).status).toBe('active')
  })

  it('5. subscription.halted → halted, entitlement capped at current_end', async () => {
    const { id, rzp } = subs.digi
    const res = await send(stateEvent('subscription.halted', rzp, 'halted', 1))
    expect(res.status).toBe(200)
    const sub = await subRow(id)
    expect(sub.status).toBe('halted')
    expect(new Date(sub.access_expires_at).getTime()).toBe(p1.end * 1000)
    const ent = await db.queryOne<any>(`SELECT * FROM vault_entitlements WHERE subscription_id = $1`, [id])
    expect(new Date(ent.access_expires_at).getTime()).toBe(p1.end * 1000)
  })

  it('6. cancelled then a late charge: status stays cancelled; the captured payment is still recorded', async () => {
    const { id, rzp } = subs.cancel
    expect((await send(chargedEvent(rzp, `pay_replay_cancel1_${suffix}`, 1))).status).toBe(200)
    expect((await send(stateEvent('subscription.cancelled', rzp, 'cancelled', 1))).status).toBe(200)
    expect((await subRow(id)).status).toBe('cancelled')

    const res = await send(chargedEvent(rzp, `pay_replay_cancel2_${suffix}`, 2, p2))
    expect(res.status).toBe(200)
    const sub = await subRow(id)
    expect(sub.status).toBe('cancelled')
    expect(sub.cancelled_at).not.toBeNull()
    // Engine behaviour: money was captured, so the cycle order is still minted (paid, cycle 2) —
    // the terminal status is never reopened by the late charge.
    const orders = await ordersFor(id)
    expect(orders.map(o => o.subscription_cycle)).toEqual([1, 2])
    expect(orders[1]).toMatchObject({ payment_status: 'paid', status: 'confirmed' })
  })

  it('7. bad signature → 400 and no DB writes', async () => {
    const { id, rzp } = subs.badsig
    const before = await db.queryOne<{ n: string }>(
      `SELECT (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM subscription_cycle_orders) AS n`
    )
    const res = await send(chargedEvent(rzp, `pay_replay_bad_${suffix}`, 1), { badSig: true })
    expect(res.status).toBe(400)
    const after = await db.queryOne<{ n: string }>(
      `SELECT (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM subscription_cycle_orders) AS n`
    )
    expect(after!.n).toBe(before!.n)
    expect(await ordersFor(id)).toHaveLength(0)
    const sub = await subRow(id)
    expect(sub.status).toBe('authenticated')
    expect(sub.current_end).toBeNull()
  })

  it('8. the same charged event delivered twice in parallel commits exactly one order', async () => {
    const { id, rzp } = subs.conc
    const ev = chargedEvent(rzp, `pay_replay_conc_${suffix}`, 1)
    const [a, b] = await Promise.all([send(ev), send(ev)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await ordersFor(id)).toHaveLength(1)
    expect(await ledgerFor(id)).toHaveLength(1)
    expect((await subRow(id)).status).toBe('active')
  })
})
