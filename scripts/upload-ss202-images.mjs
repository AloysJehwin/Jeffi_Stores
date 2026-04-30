\
/**
 * Upload SS202 product images to S3 and update product_images in RDS.
 * Run locally: node /tmp/upload-ss202-images.mjs
 */

import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const { Pool } = require('pg')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')

const DB_URL  = 'postgresql://postgres:JeffiStores2026Rds@jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com:5432/jeffi_stores'
const BUCKET  = 'jeffi-stores-bucket'
const REGION  = 'us-east-1'
const IMG_DIR = '/tmp/product-images'

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
const s3   = new S3Client({ region: REGION })

// ── Image sets per product type ───────────────────────────────────────────────
// Each entry: { file, thumb, altSuffix, isPrimary, order }
const IMAGE_SETS = {
  hex_bolt: [
    { file: 'ss202-hex_bolt.png',        thumb: 'ss202-hex_bolt-thumb.jpg',        alt: 'photo',       isPrimary: true,  order: 0 },
    { file: 'photo2-hex-bolt.jpg',        thumb: 'photo2-hex-bolt-thumb.jpg',        alt: 'photo 2',     isPrimary: false, order: 1 },
    { file: 'diag-hex-bolt-metric.png',   thumb: 'diag-hex-bolt-metric-thumb.jpg',   alt: 'metric diagram', isPrimary: false, order: 2 },
    { file: 'diag-hex-bolt-bsw.png',      thumb: 'diag-hex-bolt-bsw-thumb.jpg',      alt: 'BSW diagram', isPrimary: false, order: 3 },
  ],
  allen_cap: [
    { file: 'ss202-allen_cap.png',        thumb: 'ss202-allen_cap-thumb.jpg',        alt: 'photo',       isPrimary: true,  order: 0 },
    { file: 'photo2-allen-cap.jpg',        thumb: 'photo2-allen-cap-thumb.jpg',       alt: 'photo 2',     isPrimary: false, order: 1 },
    { file: 'diag-allen-cap.png',          thumb: 'diag-allen-cap-thumb.jpg',         alt: 'diagram',     isPrimary: false, order: 2 },
  ],
  allen_csk: [
    { file: 'ss202-allen_csk.jpg',         thumb: 'ss202-allen_csk-thumb.jpg',        alt: 'photo',       isPrimary: true,  order: 0 },
    { file: 'photo2-allen-csk.jpg',        thumb: 'photo2-allen-csk-thumb.jpg',       alt: 'photo 2',     isPrimary: false, order: 1 },
    { file: 'diag-allen-csk.png',          thumb: 'diag-allen-csk-thumb.jpg',         alt: 'diagram',     isPrimary: false, order: 2 },
  ],
  hex_nut: [
    { file: 'ss202-hex_nut.jpg',           thumb: 'ss202-hex_nut-thumb.jpg',          alt: 'photo',       isPrimary: true,  order: 0 },
    { file: 'photo2-hex-nut.jpg',          thumb: 'photo2-hex-nut-thumb.jpg',         alt: 'photo 2',     isPrimary: false, order: 1 },
    { file: 'diag-hex-nut-metric.png',     thumb: 'diag-hex-nut-metric-thumb.jpg',    alt: 'diagram',     isPrimary: false, order: 2 },
  ],
}

function imageSetForSku(sku) {
  if (sku.startsWith('SS202-HB-') || sku.startsWith('SS202-LHB-')) return 'hex_bolt'
  if (sku.startsWith('SS202-ACS-'))  return 'allen_cap'
  if (sku.startsWith('SS202-ACSK-')) return 'allen_csk'
  if (sku === 'SS202-HN')            return 'hex_nut'
  return null
}

function mimeType(file) {
  if (file.endsWith('.png')) return 'image/png'
  return 'image/jpeg'
}

async function uploadFile(localPath, s3Key) {
  const body = fs.readFileSync(localPath)
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: body,
    ContentType: mimeType(localPath),
    CacheControl: 'public, max-age=31536000',
  }))
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`
}

async function run() {
  const client = await pool.connect()
  try {
    // Fetch all SS202 products
    const { rows: products } = await client.query(`
      SELECT p.id, p.sku, p.name
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE c.slug IN ('ss-hex-bolts','ss-allen-cap-screws','ss-allen-csk-screws','ss-hex-nuts')
      ORDER BY p.sku
    `)
    console.log(`Found ${products.length} SS202 products\n`)

    // Track which image files we've already uploaded (shared across products)
    const uploadedUrls = {}  // localFile -> { url, thumbUrl }

    let imgInserted = 0
    let imgSkipped  = 0

    for (const product of products) {
      const setKey = imageSetForSku(product.sku)
      if (!setKey) { console.warn(`  ✗ No image set for ${product.sku}`); continue }

      const imageSet = IMAGE_SETS[setKey]

      // Delete existing placeholder images for this product
      await client.query(`DELETE FROM product_images WHERE product_id = $1`, [product.id])

      for (const slot of imageSet) {
        const mainPath  = path.join(IMG_DIR, slot.file)
        const thumbPath = path.join(IMG_DIR, slot.thumb)

        if (!fs.existsSync(mainPath)) {
          console.warn(`  ✗ Missing: ${slot.file}`)
          imgSkipped++
          continue
        }

        // Upload main image (shared: same file → same S3 key across all products)
        if (!uploadedUrls[slot.file]) {
          const mainKey  = `products/ss202/${slot.file}`
          const thumbKey = `products/ss202/thumbnails/${slot.thumb}`

          process.stdout.write(`  ↑ Uploading ${slot.file}...`)
          const mainUrl  = await uploadFile(mainPath, mainKey)
          const thumbUrl = fs.existsSync(thumbPath)
            ? await uploadFile(thumbPath, thumbKey)
            : mainUrl
          uploadedUrls[slot.file] = { url: mainUrl, thumbUrl }
          console.log(' done')
        }

        const { url, thumbUrl } = uploadedUrls[slot.file]
        const altText = `${product.name} ${slot.alt}`

        await client.query(`
          INSERT INTO product_images (product_id, image_url, thumbnail_url, file_name, alt_text, is_primary, display_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [product.id, url, thumbUrl, slot.file, altText, slot.isPrimary, slot.order])

        imgInserted++
      }
    }

    console.log(`\n✅ Done — ${imgInserted} image rows inserted, ${imgSkipped} skipped`)
    console.log('\nAll products share the same S3 images under:')
    console.log(`  https://${BUCKET}.s3.${REGION}.amazonaws.com/products/ss202/`)
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error(err); process.exit(1) })
