#!/usr/bin/env node
/**
 * calculate-variant-weights.mjs
 *
 * Estimates shipping weight (grams) for every product_variant based on its
 * variant_name and category. Uses engineering reference weights for standard
 * fastener packs (typically 25–100 pieces per box depending on size).
 *
 * Run once after delhivery_prep.sql migration:
 *   node scripts/calculate-variant-weights.mjs
 *
 * Safe to re-run — uses UPDATE so existing manual overrides are replaced.
 * After running, review outliers with:
 *   SELECT variant_name, weight_grams FROM product_variants ORDER BY weight_grams DESC LIMIT 20;
 */

import pg from 'pg'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.production') })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

// ---------------------------------------------------------------------------
// Weight reference data (grams per single piece, steel/SS)
// Source: standard ISO fastener weight tables
// ---------------------------------------------------------------------------

// Nut weight per piece (grams) by diameter mm
const NUT_WEIGHT_G = {
  3: 0.3, 4: 0.6, 5: 1.0, 6: 2.0, 8: 4.0, 10: 8.0,
  12: 14.0, 14: 20.0, 16: 28.0, 18: 40.0, 20: 55.0,
  22: 70.0, 24: 90.0, 27: 130.0, 30: 180.0, 33: 240.0,
  36: 310.0, 39: 400.0, 42: 500.0, 45: 630.0, 48: 780.0,
  52: 980.0, 56: 1200.0,
}

// Bolt/screw weight per mm of length × diameter factor (grams / mm length)
const BOLT_WEIGHT_PER_MM = {
  3: 0.04, 4: 0.07, 5: 0.11, 6: 0.18, 8: 0.35,
  10: 0.60, 12: 0.95, 14: 1.40, 16: 1.90, 18: 2.50,
  20: 3.20, 22: 4.00, 24: 5.00, 27: 6.50, 30: 8.50,
}

// Socket key (hex key) weight per piece grams by across-flats mm
const KEY_WEIGHT_G = {
  1.5: 2, 2: 3, 2.5: 5, 3: 7, 4: 12, 5: 18,
  6: 28, 7: 40, 8: 55, 9: 70, 10: 90, 12: 130,
  14: 180, 17: 260, 19: 340, 22: 450, 24: 560,
  27: 700, 32: 1000, 36: 1400,
}

// Inch diameter → mm equivalent
const INCH_TO_MM = {
  '1/16': 1.6, '3/32': 2.4, '1/8': 3.2, '5/32': 4.0,
  '3/16': 4.8, '7/32': 5.6, '1/4': 6.35, '5/16': 7.94,
  '3/8': 9.53, '7/16': 11.1, '1/2': 12.7, '9/16': 14.3,
  '5/8': 15.9, '3/4': 19.1, '7/8': 22.2, '1': 25.4,
  '1-1/8': 28.6, '1-1/4': 31.75, '1-3/8': 34.9, '1-1/2': 38.1,
  '1-3/4': 44.5, '2': 50.8,
}

// Pieces per pack by diameter mm (industry standard box quantities)
function packSize(diamMm) {
  if (diamMm <= 4)  return 200
  if (diamMm <= 5)  return 100
  if (diamMm <= 8)  return 50
  if (diamMm <= 12) return 25
  if (diamMm <= 16) return 10
  if (diamMm <= 24) return 5
  return 2
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse metric diameter from variant name.
 * Handles: "M6", "M10 x 1.5 GR8", "M12 × 25mm"
 * Returns diameter in mm or null.
 */
function parseMetricDiam(name) {
  const m = name.match(/M(\d+)/i)
  return m ? parseInt(m[1]) : null
}

/**
 * Parse length in mm from variant name.
 * Handles: "M6 × 25mm", "M5 × 8mm", "1/2" × 3""
 * Returns length in mm or null.
 */
function parseLengthMm(name) {
  // metric length: "× 25mm" or "x 25mm"
  const metricLen = name.match(/[×x]\s*(\d+(?:\.\d+)?)\s*mm/i)
  if (metricLen) return parseFloat(metricLen[1])

  // inch length after ×: "× 3"" or "× 2-1/2""
  const inchLen = name.match(/[×x]\s*([\d\-\/]+)"/)
  if (inchLen) return inchToMm(inchLen[1])

  return null
}

/**
 * Parse inch size from variant name into mm.
 * Handles: "1/2" GR5", "3/8" BSF", "1-1/4" × 3""
 */
function parseInchDiam(name) {
  // Leading inch fraction before × or end: "1/2"", "1-1/4""
  const m = name.match(/^([\d\-\/]+)"/)
  if (m) return inchToMm(m[1])
  return null
}

function inchToMm(str) {
  str = str.trim()
  // mixed number: "1-1/4" → 1 + 1/4
  const mixed = str.match(/^(\d+)-(\d+)\/(\d+)$/)
  if (mixed) return (parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])) * 25.4
  // simple fraction: "1/2"
  const frac = str.match(/^(\d+)\/(\d+)$/)
  if (frac) return (parseInt(frac[1]) / parseInt(frac[2])) * 25.4
  // whole: "1"
  const whole = str.match(/^(\d+(?:\.\d+)?)$/)
  if (whole) return parseFloat(whole[0]) * 25.4
  // lookup table
  if (INCH_TO_MM[str]) return INCH_TO_MM[str]
  return null
}

/**
 * Parse plain mm value (socket keys, anchors): "10.0mm", "8mm"
 */
function parsePlainMm(name) {
  const m = name.match(/^(\d+(?:\.\d+)?)\s*mm/i)
  return m ? parseFloat(m[1]) : null
}

// ---------------------------------------------------------------------------
// Weight calculator per category
// ---------------------------------------------------------------------------

function calcWeight(variantName, category) {
  const name = variantName.trim()
  const cat = category.toLowerCase()

  // ── Nuts & Hex Nuts ──────────────────────────────────────────────────────
  if (cat.includes('nut')) {
    const diamMm = parseMetricDiam(name) || parseInchDiam(name)
    if (diamMm) {
      // find closest diameter key
      const key = closestKey(NUT_WEIGHT_G, diamMm)
      const pieceW = NUT_WEIGHT_G[key]
      const pack = packSize(diamMm)
      return Math.round(pieceW * pack + 150) // +150g for box/bag
    }
    return 400
  }

  // ── Socket Keys ──────────────────────────────────────────────────────────
  if (cat.includes('socket key')) {
    const mm = parsePlainMm(name) || parseInchDiam(name)
    if (mm) {
      const key = closestKey(KEY_WEIGHT_G, mm)
      return Math.round(KEY_WEIGHT_G[key] + 100) // single key + packaging
    }
    return 200
  }

  // ── Anchors ──────────────────────────────────────────────────────────────
  if (cat.includes('anchor')) {
    // "10mm × 75mm" — diameter × embedment
    const diamMm = parsePlainMm(name)
    const lengthMm = parseLengthMm(name) || 100
    if (diamMm) {
      // anchor is a solid steel cylinder roughly: weight ≈ diam² × length × 0.006 g/mm³ × 0.7 fill
      const pieceW = Math.round(diamMm * diamMm * lengthMm * 0.004)
      const pack = diamMm <= 10 ? 25 : diamMm <= 12 ? 10 : 5
      return Math.round(pieceW * pack + 200)
    }
    return 800
  }

  // ── Bolts, Screws (all variants) ─────────────────────────────────────────
  if (cat.includes('bolt') || cat.includes('screw') || cat.includes('cap') || cat.includes('countersunk') || cat.includes('button') || cat.includes('set screw')) {
    let diamMm = parseMetricDiam(name)
    let lengthMm = parseLengthMm(name)

    // inch bolts: "1/2" × 3""
    if (!diamMm) {
      diamMm = parseInchDiam(name)
    }

    if (diamMm && lengthMm) {
      const key = closestKey(BOLT_WEIGHT_PER_MM, diamMm)
      const pieceW = BOLT_WEIGHT_PER_MM[key] * lengthMm
      const pack = packSize(diamMm)
      return Math.round(pieceW * pack + 150)
    }

    // diameter only (no length parsed) — use average length estimate
    if (diamMm) {
      const avgLength = diamMm * 4 // rough average
      const key = closestKey(BOLT_WEIGHT_PER_MM, diamMm)
      const pieceW = BOLT_WEIGHT_PER_MM[key] * avgLength
      const pack = packSize(diamMm)
      return Math.round(pieceW * pack + 150)
    }

    return 500
  }

  return 500
}

function closestKey(table, value) {
  const keys = Object.keys(table).map(Number)
  return keys.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { rows: variants } = await pool.query(`
    SELECT pv.id, pv.variant_name, c.name as category
    FROM product_variants pv
    JOIN products p ON pv.product_id = p.id
    JOIN categories c ON p.category_id = c.id
  `)

  console.log(`Processing ${variants.length} variants...`)

  let updated = 0
  const updates = []

  for (const v of variants) {
    const weight = calcWeight(v.variant_name, v.category)
    updates.push({ id: v.id, weight, name: v.variant_name, category: v.category })
  }

  // Batch update
  for (const u of updates) {
    await pool.query('UPDATE product_variants SET weight_grams = $1 WHERE id = $2', [u.weight, u.id])
    updated++
    if (updated % 50 === 0) console.log(`  ${updated}/${variants.length}...`)
  }

  // Also update products.weight_grams as average of their variants
  await pool.query(`
    UPDATE products p
    SET weight_grams = sub.avg_weight
    FROM (
      SELECT product_id, ROUND(AVG(weight_grams)) as avg_weight
      FROM product_variants
      GROUP BY product_id
    ) sub
    WHERE p.id = sub.product_id
  `)

  console.log(`\nDone. Updated ${updated} variants.`)

  // Print sample for review
  const { rows: sample } = await pool.query(`
    SELECT pv.variant_name, c.name as category, pv.weight_grams
    FROM product_variants pv
    JOIN products p ON pv.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    ORDER BY pv.weight_grams DESC
    LIMIT 10
  `)
  console.log('\nTop 10 heaviest variants (sanity check):')
  sample.forEach(r => console.log(`  ${r.weight_grams}g  [${r.category}]  ${r.variant_name}`))

  const { rows: light } = await pool.query(`
    SELECT pv.variant_name, c.name as category, pv.weight_grams
    FROM product_variants pv
    JOIN products p ON pv.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    ORDER BY pv.weight_grams ASC
    LIMIT 10
  `)
  console.log('\nTop 10 lightest variants (sanity check):')
  light.forEach(r => console.log(`  ${r.weight_grams}g  [${r.category}]  ${r.variant_name}`))

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
