/**
 * Seed SS 202 fastener products into the live DB.
 * Run on EC2: node scripts/seed-ss202.mjs
 *
 * Prerequisites on EC2:
 *   npm install pg   (or already present in node_modules)
 *   DATABASE_URL env var set
 *
 * Images are downloaded to /tmp/product-images/ for review.
 * After review, upload them to S3 and update the image_url values.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on slugs/skus.
 */

import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ─── Images from manufacturer site ───────────────────────────────────────────
// These are the Wix CDN URLs — they block hotlinking, so images must be
// downloaded manually and provided in /tmp/product-images/ before running.
// The script will use whatever files are already present in IMG_DIR.
const LOCAL_IMAGES = {
  hex_bolt:          'ss202-hex_bolt.png',
  hex_bolt_photo2:   'photo2-hex-bolt.jpg',
  hex_bolt_diag_metric: 'diag-hex-bolt-metric.png',
  hex_bolt_diag_bsw: 'diag-hex-bolt-bsw.png',
  allen_cap:         'ss202-allen_cap.png',
  allen_cap_photo2:  'photo2-allen-cap.jpg',
  allen_cap_diag:    'diag-allen-cap.png',
  allen_csk:         'ss202-allen_csk.jpg',
  allen_csk_photo2:  'photo2-allen-csk.jpg',
  allen_csk_diag:    'diag-allen-csk.png',
  hex_nut:           'ss202-hex_nut.jpg',
  hex_nut_photo2:    'photo2-hex-nut.jpg',
  hex_nut_diag:      'diag-hex-nut-metric.png',
}

const IMG_DIR = '/tmp/product-images'

// ─── Pricing helpers ─────────────────────────────────────────────────────────
const GST = 1.18

// Bolts & screws: pdf is per 100 pcs excl GST, sell at 60% off MRP
function boltPricing(pdfPer100) {
  const mrp = Math.ceil((pdfPer100 / 100) * GST * 100) / 100
  const sale = Math.ceil(mrp * 0.40 * 100) / 100  // 60% off
  return { mrp, sale_price: sale, base_price: sale }
}

// Hex nut: pdf is NET rate per 100 pcs excl GST
// Our MRP = pdf × 4 (double to get base, then ×2 more for margin) + GST
// Selling = 50% off MRP
function nutPricing(pdfPer100) {
  const mrp = Math.ceil((pdfPer100 / 100) * 4 * GST * 100) / 100
  const sale = Math.ceil(mrp * 0.50 * 100) / 100  // 50% off
  return { mrp, sale_price: sale, base_price: sale }
}

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ─── Raw price data from PDF ─────────────────────────────────────────────────

// SS 202 Hex Bolt — Metric (per 100 pcs)
// dia: { length: price }
const HEX_BOLT_METRIC = {
  'M3':  { 10:406, 12:405, 16:413, 20:432, 25:482, 30:900, 35:980, 40:1059, 45:1152, 50:1157 },
  'M4':  { 10:357, 12:374, 16:389, 20:423, 25:488, 30:601, 35:697, 40:1006, 45:1113, 50:1135 },
  'M5':  { 10:424, 12:452, 16:478, 20:531, 25:598, 30:696, 35:846, 40:1027, 45:1157, 50:1199, 55:1468, 60:1623, 65:1811, 70:1858, 75:2071, 80:2126 },
  'M6':  { 10:621, 12:660, 16:711, 20:789, 25:909, 30:1044, 35:1150, 40:1284, 45:1407, 50:1566, 55:1702, 60:1758, 65:1944, 70:2076, 75:2242, 80:2315, 90:2642, 100:2922 },
  'M8':  { 16:1418, 20:1564, 25:1757, 30:1940, 35:2149, 40:2359, 45:2619, 50:2851, 55:3012, 60:3242, 65:3498, 70:3734, 75:3894, 80:4019, 90:4674, 100:4868 },
  'M10': { 20:2730, 25:2961, 30:3257, 35:3562, 40:3838, 45:4116, 50:4515, 55:4892, 60:5182, 65:5499, 70:5894, 75:6240, 80:6784, 90:6933, 100:7644, 110:8289 },
  'M12': { 25:4524, 30:4785, 35:5195, 40:5748, 45:6220, 50:6638, 55:7044, 60:7622, 65:8160, 70:8767, 75:9093, 80:9605, 90:10243, 100:11148, 110:12008 },
  'M14': { 25:7477, 30:7900, 35:8416, 40:8841, 45:9707, 50:9828, 55:10422, 60:10862, 65:11884, 70:11990, 75:13163, 80:13323, 90:14868, 100:15530 },
  'M16': { 25:9810, 30:10615, 35:11245, 40:11995, 45:12989, 50:13230, 55:14089, 60:15105, 65:16470, 70:17195, 75:17831, 80:19071, 90:20693, 100:22220 },
  'M18': { 40:17434, 45:19151, 50:19525, 55:19723, 60:21696, 65:23156, 70:24367, 75:25361, 80:26768, 90:28980, 100:31092 },
  'M20': { 40:21430, 45:23728, 50:24204, 55:23725, 60:26491, 65:27923, 70:29521, 75:30792, 80:32252, 90:34868, 100:37392 },
}

// SS 202 Hex Bolt — BSW (per 100 pcs)
const HEX_BOLT_BSW = {
  '1/8"':  { '1/2"':430, '3/4"':456, '1"':483, '1.1/4"':895, '1.1/2"':1113, '2"':1231 },
  '3/16"': { '1/2"':418, '3/4"':476, '1"':533, '1.1/4"':649, '1.1/2"':868, '2"':1081, '2.1/2"':1681, '3"':1990 },
  '1/4"':  { '1/2"':789, '3/4"':948, '1"':1197, '1.1/4"':1295, '1.1/2"':1454, '2"':1799, '2.1/2"':2189, '3"':2543, '3.1/2"':2727, '4"':3232 },
  '5/16"': { '1/2"':1362, '3/4"':1552, '1"':1726, '1.1/4"':1991, '1.1/2"':2228, '2"':2700, '2.1/2"':3262, '3"':3769, '3.1/2"':4253, '4"':4770, '5"':5890 },
  '3/8"':  { '1/2"':2257, '3/4"':2390, '1"':2657, '1.1/4"':3074, '1.1/2"':3392, '2"':4095, '2.1/2"':4797, '3"':5531, '3.1/2"':6267, '4"':6967, '5"':9841, '6"':11509 },
  '7/16"': { '1"':5797, '1.1/4"':6310, '1.1/2"':6857, '2"':7959, '2.1/2"':9309, '3"':10406, '3.1/2"':11578, '4"':12749, '5"':16394, '6"':18739 },
  '1/2"':  { '1"':5497, '1.1/4"':5982, '1.1/2"':6565, '2"':7917, '2.1/2"':9259, '3"':10449, '3.1/2"':11625, '4"':12800, '5"':16154, '6"':18464 },
  '5/8"':  { '1"':10830, '1.1/4"':11445, '1.1/2"':12233, '2"':13923, '2.1/2"':15866, '3"':18214, '3.1/2"':20418, '4"':22392, '5"':26569, '6"':30386 },
}

// Long Hex Bolt 202 — Metric (per 100 pcs)
const LONG_HEX_BOLT = {
  'M8':  { 110:5538, 120:6110, 125:6547, 130:6827, 140:7302, 150:7885 },
  'M10': { 110:9145, 120:9905, 125:10344, 130:10715, 140:11517, 150:12192 },
  'M12': { 110:13305, 120:14289, 125:14933, 130:15317, 140:16369, 150:17468, 160:20070 },
  'M16': { 110:23948, 120:25407, 125:26183, 130:26959, 140:28660, 150:30277, 160:30233, 170:33279, 180:35864 },
}

// Allen Cap Screw — Metric (per 100 pcs)
const ALLEN_CAP_METRIC = {
  'M3':  { 6:472, 8:472, 10:472, 12:472, 16:545, 20:575, 25:667 },
  'M4':  { 6:611, 8:584, 10:511, 12:526, 16:611, 20:640, 25:684, 30:836, 35:967, 40:1130 },
  'M5':  { 10:673, 12:660, 16:684, 20:776, 25:857, 30:948, 35:1022, 40:1117, 45:1301, 50:1386 },
  'M6':  { 10:846, 12:868, 16:921, 20:1028, 25:1107, 30:1218, 35:1312, 40:1479, 45:1631, 50:1659, 60:2004, 70:2585, 75:2855 },
  'M8':  { 12:1950, 16:1847, 20:1948, 25:2118, 30:2378, 35:2509, 40:2679, 45:2999, 50:3092, 60:4383, 70:5059, 75:5771, 80:6038 },
  'M10': { 20:3619, 25:3703, 30:3831, 35:3987, 40:4252, 45:4457, 50:4974, 60:5192, 70:6140, 75:6804, 80:8025, 90:8440, 100:9769, 110:11141 },
  'M12': { 25:6035, 30:6100, 35:6436, 40:6873, 45:7572, 50:7689, 60:8764, 70:9503, 75:10598, 80:10877, 90:11867, 100:13937 },
  'M16': { 30:13273, 35:13886, 40:15371, 45:15673, 50:18087, 60:19912, 70:22640, 75:23628, 80:26764, 90:28999 },
}

// Allen Cap Screw — BSW (per 100 pcs)
const ALLEN_CAP_BSW = {
  '3/16"': { '1/2"':886, '3/4"':962, '1"':1037, '1.1/4"':1151, '1.1/2"':1347 },
  '1/4"':  { '1/2"':1085, '3/4"':1131, '1"':1231, '1.1/4"':1369, '1.1/2"':1584, '2"':1878, '2.1/2"':2452, '3"':3221 },
  '5/16"': { '1/2"':1868, '3/4"':1868, '1"':1934, '1.1/4"':2275, '1.1/2"':2418, '2"':2865, '2.1/2"':3806, '3"':4566 },
  '3/8"':  { '3/4"':2883, '1"':2809, '1.1/4"':3138, '1.1/2"':3552, '2"':4306, '2.1/2"':5219, '3"':6280, '3.1/2"':7516, '4"':8000 },
  '1/2"':  { '1.1/4"':7321, '1.1/2"':8043, '2"':9110, '2.1/2"':10802, '3"':11985, '3.1/2"':14765, '4"':16805 },
}

// Allen CSK Screw — Metric (per 100 pcs)
const ALLEN_CSK_METRIC = {
  'M3':  { 6:219, 8:228, 10:254, 12:294, 16:473, 20:602 },
  'M4':  { 6:294, 8:307, 10:327, 12:385, 16:440, 20:506, 25:637, 30:732, 35:829 },
  'M5':  { 8:402, 10:416, 12:449, 16:526, 20:602, 25:699, 30:772, 35:938, 40:1108, 50:1455 },
  'M6':  { 10:680, 12:728, 16:793, 20:875, 25:994, 30:1135, 35:1281, 40:1566, 50:1909 },
  'M8':  { 16:1805, 20:1872, 25:2066, 30:2297, 35:2506, 40:2726, 50:3346, 60:4068, 70:4644, 80:5080, 90:5561, 100:6256 },
  'M10': { 20:3340, 25:3714, 30:4043, 35:4324, 40:4811, 50:5603, 60:6256, 70:7108, 80:7768, 90:8784, 100:9858 },
}

// Hex Nut — per 100 pcs (net rate, ×4 for MRP)
const HEX_NUT = {
  'M5':    30,
  'M6':    47,
  'M8':    112,
  'M8x8':  175,
  'M10':   240,
  'M12':   360,
  'M10x10':315,
  'M16':   675,
  'M20':   1325,
  '1/4"':  65,
  '5/16"': 115,
  '3/8"':  175,
  '1/2"':  460,
  '5/8"':  790,
  '3/4"':  1575,
}

// ─── Category & brand definitions ────────────────────────────────────────────
const CATEGORIES = [
  { name: 'SS Hex Bolts',         slug: 'ss-hex-bolts',         description: 'Stainless Steel 202 Grade Hex Bolts — Metric and BSW sizes', google_product_category: 'Hardware > Fasteners > Bolts' },
  { name: 'SS Allen Cap Screws',  slug: 'ss-allen-cap-screws',  description: 'Stainless Steel 202 Grade Allen Cap Screws — Metric and BSW sizes', google_product_category: 'Hardware > Fasteners > Screws' },
  { name: 'SS Allen CSK Screws',  slug: 'ss-allen-csk-screws',  description: 'Stainless Steel 202 Grade Allen Countersunk Screws', google_product_category: 'Hardware > Fasteners > Screws' },
  { name: 'SS Hex Nuts',          slug: 'ss-hex-nuts',          description: 'Stainless Steel 202 Grade Hex Nuts — Metric and BSW sizes', google_product_category: 'Hardware > Fasteners > Nuts' },
]

const BRAND = {
  name: 'GMF',
  slug: 'gmf',
  website: 'https://www.ghanshyamfastenersllp.com/',
  description: 'Ghanshyam Industries — manufacturer of SS cold forged bolts, nuts, screws and fasteners',
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const client = await pool.connect()
  try {
    // 1. Resolve local image paths
    console.log('\n📸 Resolving local images from', IMG_DIR)
    const imagePaths = {}
    for (const [key, filename] of Object.entries(LOCAL_IMAGES)) {
      const p = path.join(IMG_DIR, filename)
      if (fs.existsSync(p)) {
        imagePaths[key] = p
        console.log(`  ✓ ${filename}`)
      } else {
        console.warn(`  ✗ Missing: ${filename} — upload to S3 separately`)
      }
    }
    console.log()

    // 2. Upsert brand
    const brandRes = await client.query(`
      INSERT INTO brands (name, slug, website, description, is_active)
      VALUES ($1,$2,$3,$4,true)
      ON CONFLICT (slug) DO UPDATE SET website=EXCLUDED.website, description=EXCLUDED.description
      RETURNING id
    `, [BRAND.name, BRAND.slug, BRAND.website, BRAND.description])
    const brandId = brandRes.rows[0].id
    console.log(`✓ Brand: GMF (${brandId})`)

    // 3. Upsert categories
    const catIds = {}
    for (const cat of CATEGORIES) {
      const r = await client.query(`
        INSERT INTO categories (name, slug, description, google_product_category, is_active)
        VALUES ($1,$2,$3,$4,true)
        ON CONFLICT (slug) DO UPDATE SET description=EXCLUDED.description
        RETURNING id
      `, [cat.name, cat.slug, cat.description, cat.google_product_category])
      catIds[cat.slug] = r.rows[0].id
      console.log(`✓ Category: ${cat.name}`)
    }

    let productCount = 0
    let variantCount = 0

    // ── Helper: insert one product + its variants ──────────────────────────
    async function insertProduct({ sku, name, catSlug, imageKey, diagKey, description, shortDesc, material, hasVariants, variants }) {
      const catId = catIds[catSlug]
      const productSlug = slug(name)

      // representative pricing = cheapest variant for base_price/mrp display
      const prices = variants.map(v => v.pricing)
      const minMrp   = Math.min(...prices.map(p => p.mrp))
      const minSale  = Math.min(...prices.map(p => p.sale_price))

      const r = await client.query(`
        INSERT INTO products (
          sku, name, slug, category_id, brand_id,
          description, short_description,
          base_price, mrp, sale_price,
          gst_percentage, hsn_code,
          material, has_variants, variant_type,
          is_active, is_in_stock, stock_quantity
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,
          $8,$9,$10,
          18,'7318',
          $11,true,'Length',
          true,true,9999
        )
        ON CONFLICT (sku) DO NOTHING
        RETURNING id
      `, [sku, name, productSlug, catId, brandId,
          description, shortDesc,
          minSale, minMrp, minSale,
          material])

      if (r.rows.length === 0) {
        // already exists
        const existing = await client.query('SELECT id FROM products WHERE sku=$1', [sku])
        if (existing.rows.length === 0) return
        const pid = existing.rows[0].id
        await insertVariantsForProduct(pid, sku, variants)
        return
      }

      const productId = r.rows[0].id
      productCount++

      // Insert 3 images per product: photo1, photo2, diagram
      // All use placeholder URLs — replace with S3 URLs after upload
      const imageSlots = [
        { file: imagePaths[imageKey],              isPrimary: true,  order: 0, label: 'photo1' },
        { file: imagePaths[imageKey + '_photo2'],  isPrimary: false, order: 1, label: 'photo2' },
        { file: imagePaths[diagKey || imageKey + '_diag'], isPrimary: false, order: 2, label: 'diagram' },
      ]
      for (const slot of imageSlots) {
        if (!slot.file) continue
        const fname = path.basename(slot.file)
        const url = `REPLACE_WITH_S3_URL/${fname}`
        await client.query(`
          INSERT INTO product_images (product_id, image_url, file_name, alt_text, is_primary, display_order)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT DO NOTHING
        `, [productId, url, fname, `${name} ${slot.label}`, slot.isPrimary, slot.order])
      }

      await insertVariantsForProduct(productId, sku, variants)
      console.log(`  ✓ Product: ${name} (${variants.length} variants)`)
    }

    async function insertVariantsForProduct(productId, productSku, variants) {
      for (const v of variants) {
        // Build a clean SKU suffix from attributes: diameter + length, strip non-alphanumeric
        const dia = (v.attributes.diameter || v.attributes.size || '').replace(/[^a-zA-Z0-9]/g, '')
        const len = (v.attributes.length || '').replace(/[^a-zA-Z0-9]/g, '')
        const vSku = len ? `${productSku}-${dia}-${len}` : `${productSku}-${dia}`
        await client.query(`
          INSERT INTO product_variants (
            product_id, sku, variant_name,
            price, mrp, sale_price,
            attributes, pricing_type, unit,
            stock_quantity, is_active
          ) VALUES (
            $1,$2,$3,
            $4,$5,$6,
            $7,'unit','pcs',
            9999,true
          )
          ON CONFLICT (sku) DO NOTHING
        `, [
          productId, vSku, v.label,
          v.pricing.sale_price, v.pricing.mrp, v.pricing.sale_price,
          JSON.stringify(v.attributes),
        ])
        variantCount++
      }
    }

    // ── 4. SS 202 Hex Bolt — Metric ────────────────────────────────────────
    console.log('\n🔩 Inserting SS 202 Hex Bolts (Metric)...')
    for (const [dia, lengths] of Object.entries(HEX_BOLT_METRIC)) {
      const sku = `SS202-HB-${dia.replace('/', '-')}`
      const name = `${dia} SS 202 Hex Bolt`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `${dia} × ${len}mm`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: `${len}mm`, grade: 'SS 202', type: 'Hex Bolt' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-hex-bolts', imageKey: 'hex_bolt', diagKey: 'hex_bolt_diag_metric',
        description: `${dia} Stainless Steel 202 Grade Hex Bolt. Available in lengths from ${Math.min(...Object.keys(lengths))}mm to ${Math.max(...Object.keys(lengths))}mm. Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `${dia} SS 202 Hex Bolt — multiple lengths available`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 5. SS 202 Hex Bolt — BSW ───────────────────────────────────────────
    console.log('\n🔩 Inserting SS 202 Hex Bolts (BSW)...')
    for (const [dia, lengths] of Object.entries(HEX_BOLT_BSW)) {
      const sku = `SS202-HB-BSW-${dia.replace(/[^a-zA-Z0-9]/g, '')}`
      const name = `BSW ${dia} SS 202 Hex Bolt`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `BSW ${dia} × ${len}`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: len, grade: 'SS 202', type: 'Hex Bolt', thread: 'BSW' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-hex-bolts', imageKey: 'hex_bolt', diagKey: 'hex_bolt_diag_bsw',
        description: `BSW ${dia} Stainless Steel 202 Grade Hex Bolt. British Standard Whitworth thread. Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `BSW ${dia} SS 202 Hex Bolt — multiple lengths available`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 6. Long Hex Bolt — Metric ──────────────────────────────────────────
    console.log('\n🔩 Inserting SS 202 Long Hex Bolts (Metric)...')
    for (const [dia, lengths] of Object.entries(LONG_HEX_BOLT)) {
      const sku = `SS202-LHB-${dia.replace('/', '-')}`
      const name = `${dia} SS 202 Long Hex Bolt`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `${dia} × ${len}mm`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: `${len}mm`, grade: 'SS 202', type: 'Long Hex Bolt' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-hex-bolts', imageKey: 'hex_bolt', diagKey: 'hex_bolt_diag_metric',
        description: `${dia} Stainless Steel 202 Grade Long Hex Bolt. Available in lengths from ${Math.min(...Object.keys(lengths))}mm to ${Math.max(...Object.keys(lengths))}mm. Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `${dia} SS 202 Long Hex Bolt — 110mm to ${Math.max(...Object.keys(lengths))}mm`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 7. Allen Cap Screw — Metric ────────────────────────────────────────
    console.log('\n🔧 Inserting SS 202 Allen Cap Screws (Metric)...')
    for (const [dia, lengths] of Object.entries(ALLEN_CAP_METRIC)) {
      const sku = `SS202-ACS-${dia.replace('/', '-')}`
      const name = `${dia} SS 202 Allen Cap Screw`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `${dia} × ${len}mm`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: `${len}mm`, grade: 'SS 202', type: 'Allen Cap Screw' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-allen-cap-screws', imageKey: 'allen_cap', diagKey: 'allen_cap_diag',
        description: `${dia} Stainless Steel 202 Grade Allen Cap Screw (Socket Head Cap Screw). Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `${dia} SS 202 Allen Cap Screw — multiple lengths available`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 8. Allen Cap Screw — BSW ───────────────────────────────────────────
    console.log('\n🔧 Inserting SS 202 Allen Cap Screws (BSW)...')
    for (const [dia, lengths] of Object.entries(ALLEN_CAP_BSW)) {
      const sku = `SS202-ACS-BSW-${dia.replace(/[^a-zA-Z0-9]/g, '')}`
      const name = `BSW ${dia} SS 202 Allen Cap Screw`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `BSW ${dia} × ${len}`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: len, grade: 'SS 202', type: 'Allen Cap Screw', thread: 'BSW' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-allen-cap-screws', imageKey: 'allen_cap', diagKey: 'allen_cap_diag',
        description: `BSW ${dia} Stainless Steel 202 Grade Allen Cap Screw. British Standard Whitworth thread. Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `BSW ${dia} SS 202 Allen Cap Screw — multiple lengths available`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 9. Allen CSK Screw — Metric ────────────────────────────────────────
    console.log('\n🔧 Inserting SS 202 Allen CSK Screws (Metric)...')
    for (const [dia, lengths] of Object.entries(ALLEN_CSK_METRIC)) {
      const sku = `SS202-ACSK-${dia.replace('/', '-')}`
      const name = `${dia} SS 202 Allen CSK Screw`
      const variants = Object.entries(lengths).map(([len, price]) => ({
        label: `${dia} × ${len}mm`,
        pricing: boltPricing(price),
        attributes: { diameter: dia, length: `${len}mm`, grade: 'SS 202', type: 'Allen CSK Screw' },
      }))
      await insertProduct({
        sku, name, catSlug: 'ss-allen-csk-screws', imageKey: 'allen_csk', diagKey: 'allen_csk_diag',
        description: `${dia} Stainless Steel 202 Grade Allen Countersunk Screw (Flat Head Socket Cap Screw). Sold per piece. MRP inclusive of 18% GST. 60% off MRP.`,
        shortDesc: `${dia} SS 202 Allen CSK Screw — multiple lengths available`,
        material: 'Stainless Steel 202',
        variants,
      })
    }

    // ── 10. Hex Nut ────────────────────────────────────────────────────────
    console.log('\n🔩 Inserting SS 202 Hex Nuts...')
    const nutVariants = Object.entries(HEX_NUT).map(([size, price]) => ({
      label: size,
      pricing: nutPricing(price),
      attributes: { size, grade: 'SS 202', type: 'Hex Nut' },
    }))
    await insertProduct({
      sku: 'SS202-HN',
      name: 'SS 202 Hex Nut',
      catSlug: 'ss-hex-nuts',
      imageKey: 'hex_nut',
      diagKey: 'hex_nut_diag',
      description: 'Stainless Steel 202 Grade Hex Nut. Available in metric (M5–M20) and BSW (1/4"–3/4") sizes. Sold per piece. MRP inclusive of 18% GST. 50% off MRP.',
      shortDesc: 'SS 202 Hex Nut — metric and BSW sizes',
      material: 'Stainless Steel 202',
      variants: nutVariants,
    })

    console.log(`\n✅ Done! Inserted ${productCount} products, ${variantCount} variants.`)
    console.log(`\n⚠️  Images saved to ${IMG_DIR}`)
    console.log('   Review them, upload to S3, then UPDATE product_images SET image_url = <s3_url> WHERE image_url LIKE \'REPLACE_WITH_S3_URL/%\'')

    // Print pricing sample for verification
    console.log('\n📊 Pricing verification samples:')
    console.log('  M6×50 Hex Bolt  — PDF: ₹15.66/pc excl GST →', JSON.stringify(boltPricing(1566)))
    console.log('  M10×50 Hex Bolt — PDF: ₹45.15/pc excl GST →', JSON.stringify(boltPricing(4515)))
    console.log('  M8 Hex Nut      — PDF: ₹1.12/pc (net) ×4  →', JSON.stringify(nutPricing(112)))
    console.log('  M10 Hex Nut     — PDF: ₹2.40/pc (net) ×4  →', JSON.stringify(nutPricing(240)))

  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error(err); process.exit(1) })
