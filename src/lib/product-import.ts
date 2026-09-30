import { query, queryOne } from '@/lib/db'
import { publishProductDraft, OpenOrdersBlockError } from '@/lib/product-draft'
import { fetchRemoteImage, uploadGalleryImage } from '@/lib/s3'
import { parseWorkbook } from './import/parse'
import { groupRows, type ProductGroup } from './import/validate-row'
import {
  buildFields,
  buildVariants,
  buildSubVariants,
  hasSubVariants,
  type ResolvedIds,
  type DraftImage,
} from './import/to-draft'
import type { RowResult, ImageProgress } from './import/jobs'

export interface ImportOutcome {
  totalRows: number
  rowResults: RowResult[]
  createdCount: number
  updatedCount: number
  errorCount: number
  imageProgress: ImageProgress
  // Products successfully created/updated this run, for sheet-ownership tracking. The worker
  // consumes this for google_sheet jobs; upload jobs ignore it.
  seenProducts: Array<{ productId: string; sku: string }>
}

export interface RunOptions {
  // Called after each group so the worker can persist incremental progress.
  onProgress?: (partial: {
    processed: number
    created: number
    updated: number
    errors: number
    rowResults: RowResult[]
    imageProgress: ImageProgress
  }) => Promise<void>
}

// Run a full import from a workbook buffer, in the CURRENT tenant context (the worker
// wraps this in runWithTenantContext). Good groups are created/updated via the canonical
// publishProductDraft path; bad groups become row errors. Never throws for row-level
// problems — only a fatal parse error propagates.
export async function runImport(buf: Buffer, opts: RunOptions = {}): Promise<ImportOutcome> {
  const parsed = parseWorkbook(buf)
  if (parsed.fatal) throw new Error(parsed.fatal)

  const { groups, orphans } = groupRows(parsed.rows)

  const rowResults: RowResult[] = []
  const imageProgress: ImageProgress = { total: 0, fetched: 0, failed: 0 }
  const seenProducts: Array<{ productId: string; sku: string }> = []
  let created = 0,
    updated = 0,
    errors = 0

  for (const o of orphans) {
    rowResults.push({ row: o.rowNumber, sku: null, outcome: 'error', message: o.message })
    errors++
  }

  const catCache = new Map<string, string | null>()
  const brandCache = new Map<string, string | null>()
  const supplierCache = new Map<string, string | null>()

  let processed = 0
  for (const group of groups) {
    processed++
    try {
      if (group.errors.length > 0) {
        rowResults.push({
          row: group.rowNumber,
          sku: group.sku || null,
          outcome: 'error',
          message: group.errors.join('; '),
        })
        errors++
        continue
      }

      const ids = await resolveRefs(group, catCache, brandCache, supplierCache)
      if (ids.error) {
        rowResults.push({ row: group.rowNumber, sku: group.sku, outcome: 'error', message: ids.error })
        errors++
        continue
      }

      const { productId, isNew } = await findOrCreateProduct(group)

      const images = await fetchImages(group, imageProgress, rowResults)

      await writeDraft(productId, buildFields(group, ids), buildVariants(group), images, [])
      await publishProductDraft(productId)

      // Phase 2: sub-variants AND variant images need real variant ids (only exist post-publish).
      // Re-read the persisted variant ids, seed both, and republish. Idempotent — the product +
      // variant fields are unchanged; only sub_variants and variant_images are added.
      const hasVariantImages = group.variants.some(v =>
        String((v.values as Record<string, unknown>)?.image_urls ?? '').trim()
      )
      if (hasSubVariants(group) || hasVariantImages) {
        const variantIdBySku = await variantIdsForProduct(productId)
        const subVariants = buildSubVariants(group, variantIdBySku)
        const variantImages = await buildVariantImages(group, variantIdBySku, imageProgress, rowResults)
        if (subVariants.length > 0 || variantImages.length > 0) {
          await writeDraft(productId, buildFields(group, ids), buildVariants(group), images, subVariants, variantImages)
          await publishProductDraft(productId)
        }
      }

      rowResults.push({ row: group.rowNumber, sku: group.sku, outcome: isNew ? 'created' : 'updated' })
      if (isNew) created++
      else updated++
      seenProducts.push({ productId, sku: group.sku })
    } catch (err: unknown) {
      const message =
        err instanceof OpenOrdersBlockError ? err.message : err instanceof Error ? err.message : 'Unknown error'
      rowResults.push({ row: group.rowNumber, sku: group.sku || null, outcome: 'error', message })
      errors++
    }

    if (opts.onProgress) {
      await opts.onProgress({ processed, created, updated, errors, rowResults, imageProgress })
    }
  }

  return {
    totalRows: groups.length + orphans.length,
    rowResults,
    createdCount: created,
    updatedCount: updated,
    errorCount: errors,
    imageProgress,
    seenProducts,
  }
}

interface ResolvedRefs extends ResolvedIds {
  error?: string
}

// Resolve category/brand/supplier NAMES to ids. Category & brand must exist (locked:
// error out, no auto-create). Supplier is optional and silently skipped if absent.
async function resolveRefs(
  group: ProductGroup,
  catCache: Map<string, string | null>,
  brandCache: Map<string, string | null>,
  supplierCache: Map<string, string | null>
): Promise<ResolvedRefs> {
  const categoryName = str(group.values.category)
  const brandName = str(group.values.brand)
  const supplierName = str(group.values.supplier)

  let categoryId: string | null = null
  if (categoryName) {
    categoryId = await lookup(catCache, categoryName, 'SELECT id FROM categories WHERE lower(name) = lower($1) LIMIT 1')
    if (!categoryId)
      return {
        categoryId: null,
        brandId: null,
        supplierId: null,
        error: `category "${categoryName}" does not exist — create it first`,
      }
  }
  let brandId: string | null = null
  if (brandName) {
    brandId = await lookup(brandCache, brandName, 'SELECT id FROM brands WHERE lower(name) = lower($1) LIMIT 1')
    if (!brandId)
      return {
        categoryId: null,
        brandId: null,
        supplierId: null,
        error: `brand "${brandName}" does not exist — create it first`,
      }
  }
  let supplierId: string | null = null
  if (supplierName) {
    supplierId = await lookup(
      supplierCache,
      supplierName,
      'SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1'
    )
    if (!supplierId)
      return {
        categoryId: null,
        brandId: null,
        supplierId: null,
        error: `supplier "${supplierName}" does not exist — create it first`,
      }
  }
  return { categoryId, brandId, supplierId }
}

async function lookup(cache: Map<string, string | null>, name: string, sql: string): Promise<string | null> {
  const key = name.toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null
  const row = await queryOne<{ id: string }>(sql, [name])
  const id = row?.id ?? null
  cache.set(key, id)
  return id
}

// Upsert by SKU: existing product -> update; new SKU -> skeleton row (publish then fills
// every field). Mirrors the skeleton create in the products/draft route.
async function findOrCreateProduct(group: ProductGroup): Promise<{ productId: string; isNew: boolean }> {
  // Dedup by SKU regardless of data_source: an existing product with this SKU (manual OR
  // sheet-sourced) is UPDATED, never duplicated. A found manual product is also promoted to
  // google_sheet so the sync owns it from now on (and can delete-sweep it when removed from the sheet).
  const existing = await queryOne<{ id: string }>('SELECT id FROM products WHERE sku = $1 LIMIT 1', [group.sku])
  if (existing) {
    await query(`UPDATE products SET data_source = 'google_sheet' WHERE id = $1`, [existing.id])
    return { productId: existing.id, isNew: false }
  }

  const slug =
    group.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    Date.now().toString(36)
  const created = await queryOne<{ id: string }>(
    `INSERT INTO products (name, slug, sku, base_price, mrp, gst_percentage, is_active, is_featured, has_variants, data_source)
     VALUES ($1, $2, $3, 0, 0, 18, false, false, false, 'google_sheet') RETURNING id`,
    [group.name, slug, group.sku]
  )
  if (!created) throw new Error('failed to create product row')
  return { productId: created.id, isNew: true }
}

async function fetchImages(
  group: ProductGroup,
  progress: ImageProgress,
  rowResults: RowResult[]
): Promise<DraftImage[]> {
  const images: DraftImage[] = []
  progress.total += group.imageUrls.length
  for (let i = 0; i < group.imageUrls.length; i++) {
    const url = group.imageUrls[i]
    try {
      const buffer = await fetchRemoteImage(url)
      const fileName = safeFileName(url)
      const r = await uploadGalleryImage(buffer, fileName)
      images.push({
        image_url: r.url,
        thumbnail_url: r.thumbnailUrl,
        s3_bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
        s3_key: r.s3Key,
        s3_thumbnail_key: r.s3ThumbnailKey,
        file_name: r.fileName,
        file_size: r.fileSize,
        mime_type: 'image/png',
        width: r.width,
        height: r.height,
        is_primary: images.length === 0,
        display_order: images.length,
      })
      progress.fetched++
    } catch (err: unknown) {
      // Image failure degrades to a row warning — the product still imports (locked).
      progress.failed++
      const msg = err instanceof Error ? err.message : 'fetch failed'
      rowResults.push({ row: group.rowNumber, sku: group.sku, outcome: 'warning', message: `image ${url}: ${msg}` })
    }
  }
  return images
}

async function variantIdsForProduct(productId: string): Promise<Map<string, string>> {
  const rows = await query<{ id: string; sku: string }>(
    'SELECT id, sku FROM product_variants WHERE product_id = $1 AND is_active = true',
    [productId]
  )
  const map = new Map<string, string>()
  for (const r of rows.rows) if (r.sku) map.set(r.sku, r.id)
  return map
}

async function writeDraft(
  productId: string,
  fields: Record<string, unknown>,
  variants: Record<string, unknown>[],
  images: DraftImage[],
  subVariants: Record<string, unknown>[],
  variantImages: Record<string, unknown>[] = []
): Promise<void> {
  await query(
    `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units, variant_images, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, '[]'::jsonb, $6::jsonb, now())
     ON CONFLICT (product_id) DO UPDATE SET
       fields = EXCLUDED.fields, variants = EXCLUDED.variants, images = EXCLUDED.images,
       sub_variants = EXCLUDED.sub_variants, variant_images = EXCLUDED.variant_images, updated_at = now()`,
    [
      productId,
      JSON.stringify(fields),
      JSON.stringify(variants),
      JSON.stringify(images),
      JSON.stringify(subVariants),
      JSON.stringify(variantImages),
    ]
  )
}

// Fetch each variant's image_urls and stage them as draft variant_images rows, tagged with the
// variant's real id (available only post-publish, phase 2) and a draft-vi- id so the publisher
// treats them as fresh uploads. Mirrors fetchImages + the variant-image reconcile in product-draft.
async function buildVariantImages(
  group: ProductGroup,
  variantIdBySku: Map<string, string>,
  progress: ImageProgress,
  rowResults: RowResult[]
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (const v of group.variants) {
    const variantId = v.sku ? variantIdBySku.get(v.sku) : undefined
    if (!variantId) continue
    const raw = String((v.values as Record<string, unknown>)?.image_urls ?? '').trim()
    if (!raw) continue
    const urls = raw
      .split('|')
      .map(u => u.trim())
      .filter(Boolean)
    progress.total += urls.length
    let order = 0
    for (const url of urls) {
      try {
        const buffer = await fetchRemoteImage(url)
        const r = await uploadGalleryImage(buffer, safeFileName(url))
        out.push({
          id: `draft-vi-${variantId}-${order}`,
          variant_id: variantId,
          image_url: r.url,
          thumbnail_url: r.thumbnailUrl,
          s3_bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
          s3_key: r.s3Key,
          s3_thumbnail_key: r.s3ThumbnailKey,
          file_name: r.fileName,
          file_size: r.fileSize,
          mime_type: 'image/png',
          width: r.width,
          height: r.height,
          is_primary: order === 0,
          display_order: order,
        })
        progress.fetched++
        order++
      } catch (err: unknown) {
        progress.failed++
        const msg = err instanceof Error ? err.message : 'fetch failed'
        rowResults.push({
          row: group.rowNumber,
          sku: group.sku,
          outcome: 'warning',
          message: `variant ${v.sku} image ${url}: ${msg}`,
        })
      }
    }
  }
  return out
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function safeFileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() || 'image'
  } catch {
    return 'image'
  }
}
