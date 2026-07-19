/**
 * Generate a synthetic fine-tuning dataset for the on-device checkout recap model.
 *
 *   node scripts/gen-onboarding-dataset.mjs [--n 1500] [--out data/onboarding]
 *
 * Reads the LOCAL catalog only (never live). Samples real products / categories /
 * brands, synthesizes plausible shopping sessions, and pairs each with a templated
 * "ideal" 2–3 sentence recap in the target voice. Output is JSONL that mirrors the
 * shared prompt serialization (src/lib/on-device/prompt.ts).
 *
 * Privacy: uses catalog data + synthetic sessions only — no real customers, no PII.
 *
 * Env: DATABASE_URL (defaults to the local dev DB on port 5432). This script
 * REFUSES to run against a host that looks like the live RDS unless
 * ALLOW_NONLOCAL=1 is set.
 */

import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const { Pool } = require('pg')

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const N = parseInt(arg('n', '1500'), 10)
const OUT_DIR = arg('out', 'data/onboarding')
const SAMPLE_ONLY = args.includes('--sample')

// ── local-DB guard ──────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/jeffi_production_ready'
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL) || DB_URL.includes(':5432')
if (!isLocal && process.env.ALLOW_NONLOCAL !== '1') {
  console.error('Refusing to run against a non-local DB. Set ALLOW_NONLOCAL=1 to override.')
  process.exit(1)
}
const pool = new Pool({
  connectionString: DB_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})

// ── deterministic PRNG (seeded) so runs are reproducible ─────────────────────
let seed = 0x2f6e2b1
function rnd() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
  return ((seed >>> 0) % 100000) / 100000
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1))
function sample(xs, k) {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, k)
}

// ── recap templates (target voice: warm, concrete, reassuring, 2–3 sentences) ─
// {items} {cats} {brand} {n} {total} are filled in.
const TEMPLATES = [
  "You've picked {n} items — {items}. That's a solid {cats} set; everything here works together for your build.",
  "Great choices! Your cart has {items}. These {cats} pair up nicely, and you're all set to check out.",
  "Here's your order at a glance: {items}. A well-matched {cats} selection — nothing missing for the job.",
  "You're buying {items}. This covers your {cats} needs neatly; a dependable pick from {brand}.",
  "Nice cart — {items}. These {cats} items complement each other, so you're ready to go.",
  "Your selection of {items} makes a complete {cats} kit. Quality hardware, ready to ship.",
  "All set: {items}. A tidy {cats} order that should have everything you need for the task.",
]

function humanList(names) {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function renderRecap(cart, cats, brands, total) {
  const names = cart.map(c => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name))
  const t = pick(TEMPLATES)
  return t
    .replaceAll('{items}', humanList(names.slice(0, 4)))
    .replaceAll('{cats}', humanList([...new Set(cats)].slice(0, 3)) || 'hardware')
    .replaceAll('{brand}', brands.filter(Boolean)[0] || 'a trusted brand')
    .replaceAll('{n}', String(cart.reduce((s, c) => s + c.qty, 0)))
    .replaceAll('{total}', total != null ? `Rs.${total.toFixed(2)}` : '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── prompt serialization (mirrors src/lib/on-device/prompt.ts) ────────────────
const RECAP_INSTRUCTION =
  'You are a friendly shopping assistant for an industrial hardware store. ' +
  'Write a warm, concise 2–3 sentence recap of what the customer is about to buy, ' +
  'noting how the items fit together and reassuring them. Do not invent products or prices.'

function serialize(sig) {
  const lines = ['### Cart']
  for (const it of sig.cart) {
    const meta = [it.brand, it.category].filter(Boolean).join(', ')
    lines.push(`- ${it.qty}x ${it.name}${meta ? ` (${meta})` : ''}`)
  }
  if (sig.itemCount != null || sig.total != null) {
    lines.push(`Summary: ${sig.itemCount} items, total Rs.${sig.total.toFixed(2)}`)
  }
  if (sig.viewed?.length) { lines.push('### Also viewed'); lines.push(sig.viewed.map(v => `- ${v}`).join('\n')) }
  if (sig.pastCategories?.length) { lines.push('### Previously bought categories'); lines.push(sig.pastCategories.join(', ')) }
  if (sig.searches?.length) { lines.push('### Searched for'); lines.push(sig.searches.join(', ')) }
  lines.push('### Recap')
  return `${RECAP_INSTRUCTION}\n\n${lines.join('\n')}`
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const { rows: products } = await pool.query(
    `SELECT p.name, p.base_price, p.mrp, c.name AS category, b.name AS brand
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.is_active = true AND p.name IS NOT NULL
     LIMIT 5000`
  )
  if (products.length < 5) {
    console.error(`Only ${products.length} products found — is the local DB seeded? Aborting.`)
    process.exit(1)
  }
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))]
  const searchesPool = categories.concat(products.slice(0, 200).map(p => p.name.split(' ').slice(0, 2).join(' ')))

  const priceOf = (p) => {
    const bp = Number(p.base_price) || 0
    const mrp = Number(p.mrp) || 0
    return bp > 0 ? bp : mrp
  }

  const examples = []
  const count = SAMPLE_ONLY ? 8 : N
  for (let i = 0; i < count; i++) {
    const cartSize = randInt(1, 5)
    const cartProds = sample(products, cartSize)
    const cart = cartProds.map(p => ({
      name: p.name, category: p.category, brand: p.brand, qty: randInt(1, 6),
    }))
    const total = cartProds.reduce((s, p, idx) => s + priceOf(p) * cart[idx].qty, 0)
    const itemCount = cart.reduce((s, c) => s + c.qty, 0)

    const sig = {
      cart,
      total: Math.round(total * 100) / 100,
      itemCount,
      viewed: rnd() > 0.4 ? sample(products, randInt(1, 4)).map(p => p.name) : undefined,
      pastCategories: rnd() > 0.6 ? sample(categories, randInt(1, 3)) : undefined,
      searches: rnd() > 0.6 ? sample(searchesPool, randInt(1, 2)) : undefined,
    }
    const completion = renderRecap(cart, cartProds.map(p => p.category).filter(Boolean), cartProds.map(p => p.brand), sig.total)
    examples.push({ prompt: serialize(sig), completion: ' ' + completion })
  }

  if (SAMPLE_ONLY) {
    for (const ex of examples) {
      console.log('\n─── PROMPT ───\n' + ex.prompt + '\n─── COMPLETION ───\n' + ex.completion)
    }
    await pool.end()
    return
  }

  // deterministic 90/10 split
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const train = [], val = []
  examples.forEach((ex, i) => (i % 10 === 0 ? val : train).push(ex))
  fs.writeFileSync(path.join(OUT_DIR, 'train.jsonl'), train.map(e => JSON.stringify(e)).join('\n') + '\n')
  fs.writeFileSync(path.join(OUT_DIR, 'val.jsonl'), val.map(e => JSON.stringify(e)).join('\n') + '\n')
  console.log(`Wrote ${train.length} train + ${val.length} val examples to ${OUT_DIR}/`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
