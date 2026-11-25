// Demo orders for checking the admin dashboard's charts, on the jeffi_test DB only:
//   npx tsx --tsconfig tests/responsive/tsconfig.sweep.json tests/dashboard/seed.ts up|down
// up: ~26 weeks of synthetic orders (weekday rhythm, COD, business buyers, shipped 0-6 days after placing, a few
// cancelled or returned) over a few demo products and categories. Everything is tagged (DEMO- order numbers, demo-dash
// emails/SKUs/slugs) so down removes exactly it.
import { Pool } from 'pg'
import { loadLocalEnv } from '../responsive/env'

loadLocalEnv()

const TAG = 'demo-dash'
const WEEKS = 26
const DAY = 86_400_000
// Mon..Sun placed-order rhythm.
const RHYTHM = [9, 10, 8, 9, 11, 5, 3]
const CATEGORIES = ['Power Tools', 'Hand Tools', 'Safety Gear', 'Fasteners']
const PRODUCTS = [
  { name: 'Cordless Drill 18V', cat: 0, price: 5400 },
  { name: 'Angle Grinder', cat: 0, price: 3200 },
  { name: 'Socket Set 40pc', cat: 1, price: 1800 },
  { name: 'Claw Hammer', cat: 1, price: 450 },
  { name: 'Safety Helmet', cat: 2, price: 320 },
  { name: 'Work Gloves', cat: 2, price: 180 },
  { name: 'Wood Screws 500pc', cat: 3, price: 260 },
  { name: 'Anchor Bolts 100pc', cat: 3, price: 640 },
]

// Small deterministic PRNG so a re-run draws the same history.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function down(pool: Pool) {
  await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'DEMO-%')`)
  await pool.query(`DELETE FROM orders WHERE order_number LIKE 'DEMO-%'`)
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${TAG}-%`])
  await pool.query(`DELETE FROM categories WHERE slug LIKE $1`, [`${TAG}-%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${TAG}-%@example.test`])
}

async function up(pool: Pool) {
  await down(pool)
  const rand = rng(20261124)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

  const catIds: string[] = []
  for (const [i, name] of CATEGORIES.entries()) {
    const r = await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [name, `${TAG}-${i}`])
    catIds.push(r.rows[0].id)
  }
  const prods: { id: string; name: string; price: number; sku: string }[] = []
  for (const [i, p] of PRODUCTS.entries()) {
    const sku = `${TAG}-${i}`
    const r = await pool.query(`INSERT INTO products (sku, name, slug, base_price, category_id, inventory_quantity) VALUES ($1, $2, $3, $4, $5, 500) RETURNING id`, [sku, p.name, sku, p.price, catIds[p.cat]])
    prods.push({ id: r.rows[0].id, name: p.name, price: p.price, sku })
  }
  const userIds: string[] = []
  for (let i = 0; i < 40; i++) {
    const r = await pool.query(`INSERT INTO users (email, first_name, last_name) VALUES ($1, $2, 'Demo') RETURNING id`, [`${TAG}-${i}@example.test`, `Buyer${i}`])
    userIds.push(r.rows[0].id)
  }

  const now = Date.now()
  const start = now - WEEKS * 7 * DAY
  let n = 0
  let items = 0
  for (let t = start; t < now; t += DAY) {
    const day = new Date(t)
    const dow = (day.getUTCDay() + 6) % 7
    const ramp = 0.6 + 0.5 * ((t - start) / (now - start))
    const count = Math.max(0, Math.round(RHYTHM[dow] * ramp * (0.7 + rand() * 0.6)))
    for (let k = 0; k < count; k++) {
      const created = new Date(t + Math.floor((8 + rand() * 12) * 3_600_000))
      if (created.getTime() > now) continue
      const biz = rand() < 0.12
      const cod = !biz && rand() < 0.25
      const roll = rand()
      const cancelled = roll < 0.04
      const returned = !cancelled && roll < 0.07
      const shippedAt = new Date(created.getTime() + Math.floor(rand() * 6.99 * DAY))
      const shipped = !cancelled && shippedAt.getTime() <= now
      const deliveredAt = shipped && now - shippedAt.getTime() > 3 * DAY ? new Date(shippedAt.getTime() + Math.floor((2 + rand() * 3) * DAY)) : null
      const delivered = !!deliveredAt && deliveredAt.getTime() <= now && !returned
      const status = cancelled ? 'cancelled' : returned && shipped ? 'returned' : delivered ? 'delivered' : shipped ? 'shipped' : rand() < 0.5 ? 'pending' : 'processing'
      const paid = !cancelled && (!cod || delivered)

      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const p = pick(prods)
        const qty = 1 + Math.floor(rand() * (biz ? 6 : 2))
        return { p, qty, total: p.price * qty }
      })
      const subtotal = lines.reduce((s, l) => s + l.total, 0)
      n++
      const order = await pool.query(
        `INSERT INTO orders (order_number, user_id, customer_name, customer_email, status, payment_status, payment_mode, subtotal, total_amount, created_at, updated_at,
                             confirmed_at, shipped_at, delivered_at, cancelled_at, buyer_gstin, business_discount_amount)
         VALUES ($1, $2, 'Demo Buyer', $3, $4, $5, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          `DEMO-${String(n).padStart(5, '0')}`,
          pick(userIds),
          `${TAG}-${n}@example.test`,
          status,
          paid ? 'paid' : 'unpaid',
          cod ? 'cod' : 'razorpay',
          subtotal,
          created,
          cancelled ? null : created,
          shipped ? shippedAt : null,
          delivered ? deliveredAt : null,
          cancelled ? new Date(created.getTime() + 3_600_000) : null,
          biz ? `27AAAAA${String(1000 + (n % 9000))}A1Z5` : null,
          biz ? Math.round(subtotal * 0.05) : 0,
        ]
      )
      for (const l of lines) {
        await pool.query(
          `INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, total_price, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [order.rows[0].id, l.p.id, l.p.name, l.p.sku, l.qty, l.p.price, l.total, created]
        )
        items++
      }
    }
  }
  process.stdout.write(`[dashboard demo] ${n} orders, ${items} items on ${new URL(process.env.DATABASE_URL!).pathname.slice(1)}\n`)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  // Writes hundreds of orders: never on a real store's DB.
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`refusing to seed ${new URL(url).pathname.slice(1)}: point DATABASE_URL at jeffi_test`)
  const cmd = process.argv[2]
  if (cmd !== 'up' && cmd !== 'down') throw new Error('usage: seed.ts up|down')
  const pool = new Pool({ connectionString: url })
  try {
    if (cmd === 'up') await up(pool)
    else {
      await down(pool)
      process.stdout.write('[dashboard demo] removed\n')
    }
  } finally {
    await pool.end()
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[dashboard demo] seed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
