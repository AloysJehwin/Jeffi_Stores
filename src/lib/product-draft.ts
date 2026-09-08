import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { recomputeStockStatusForProduct } from '@/lib/inventory'

/**
 * Returns the order numbers of any OPEN orders (status pending/confirmed) that
 * reference this product. Publishing a draft can remove variants/sub-variants or
 * rename SKUs, which forks variant rows and diverges an open order's committed
 * stock (deduction/restore resolve by FK id, publish merges by SKU). We therefore
 * block publish while such orders exist. `confirmed` has not yet deducted stock,
 * `pending` is pre-confirmation — both are still fully mutable and must be safe.
 */
export async function openOrdersForProduct(productId: string): Promise<string[]> {
  const rows = await queryMany<{ order_number: string }>(
    `SELECT DISTINCT o.order_number
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1
        AND o.status IN ('pending', 'confirmed')
      ORDER BY o.order_number`,
    [productId]
  )
  return rows.map(r => r.order_number)
}

/** Thrown by publishProductDraft when open orders block the publish. */
export class OpenOrdersBlockError extends Error {
  orderNumbers: string[]
  constructor(orderNumbers: string[]) {
    super(
      `Cannot publish: this product has ${orderNumbers.length} open order(s) (${orderNumbers.join(', ')}) in pending/confirmed status. ` +
      `Publishing could change variants/SKUs and break those orders' stock. Move them past 'confirmed' (or cancel) first.`
    )
    this.name = 'OpenOrdersBlockError'
    this.orderNumbers = orderNumbers
  }
}

interface ProductDraft {
  product_id: string
  fields: Record<string, unknown>
  variants: Record<string, unknown>[]
  images: Record<string, unknown>[]
  sub_variants: Record<string, unknown>[]
  units: Record<string, unknown>[]
  variant_images: Record<string, unknown>[]
}

/**
 * Atomically applies a product_drafts row onto the live products row,
 * replaces all related data (variants, images, sub_variants, units),
 * then deletes the draft. Called from both the API route and the
 * server action so the publish logic is never duplicated or bypassed.
 */
export async function publishProductDraft(productId: string): Promise<void> {
  const draft = await queryOne<ProductDraft>(
    `SELECT * FROM product_drafts WHERE product_id = $1`,
    [productId]
  )
  if (!draft) throw new Error('Draft not found')

  // Hard gate: never publish while the product has open (pending/confirmed) orders.
  // This is the last line of defence — callers surface a friendlier message first.
  const blockingOrders = await openOrdersForProduct(productId)
  if (blockingOrders.length > 0) throw new OpenOrdersBlockError(blockingOrders)

  // Capture the LIVE tracking flags before publishing so we can detect a toggle
  // from ON→OFF and clean up the now-orphaned batch/serial/shelf records below.
  const liveFlags = await queryOne<{ perishable: boolean; serialized: boolean; has_variants: boolean }>(
    `SELECT perishable, serialized, has_variants FROM products WHERE id = $1`,
    [productId]
  )
  const fields: any = draft.fields || {}
  const newPerishable = fields.perishable === true || fields.perishable === 'true'
  const newSerialized = fields.serialized === true || fields.serialized === 'true'
  const newHasVariants = fields.has_variants === true || fields.has_variants === 'true'
  const turnedOffPerishable = !!liveFlags?.perishable && !newPerishable
  const turnedOffSerialized = !!liveFlags?.serialized && !newSerialized
  // Product changed from variant-based → simple. Its old variants/sub-variants (and
  // their orphaned batches/serials/shelf) must be cleaned up; and we must NOT let the
  // live-data fallback below re-activate them.
  const turnedOffVariants = !newHasVariants && !!liveFlags?.has_variants

  // If draft variants/sub_variants are empty, fall back to live data — UNLESS the
  // product just became simple (then there are no intended variants; keep it empty
  // so the upsert doesn't re-persist/re-activate the old ones).
  const variants = turnedOffVariants
    ? []
    : Array.isArray(draft.variants) && draft.variants.length > 0
    ? draft.variants
    : await queryMany(`SELECT * FROM product_variants WHERE product_id = $1`, [productId])

  const subVariants = Array.isArray(draft.sub_variants) && draft.sub_variants.length > 0
    ? draft.sub_variants
    : await queryMany(`SELECT * FROM product_sub_variants WHERE product_id = $1`, [productId])

  const units = Array.isArray(draft.units) && draft.units.length > 0
    ? draft.units
    : await queryMany(`SELECT * FROM product_units WHERE product_id = $1`, [productId])

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE products SET
         category_id              = NULLIF(($2::jsonb)->>'category_id', '')::uuid,
         brand_id                 = NULLIF(($2::jsonb)->>'brand_id', '')::uuid,
         sku                      = ($2::jsonb)->>'sku',
         name                     = ($2::jsonb)->>'name',
         slug                     = COALESCE(NULLIF(($2::jsonb)->>'slug', ''), slug),
         description              = ($2::jsonb)->>'description',
         short_description        = ($2::jsonb)->>'short_description',
         base_price               = COALESCE(NULLIF(($2::jsonb)->>'base_price', '')::numeric, 0),
         price_ex_gst             = NULLIF(($2::jsonb)->>'price_ex_gst', '')::numeric,
         currency                 = ($2::jsonb)->>'currency',
         weight                   = NULLIF(($2::jsonb)->>'weight', '')::numeric,
         dimensions               = ($2::jsonb)->>'dimensions',
         material                 = ($2::jsonb)->>'material',
         finish                   = ($2::jsonb)->>'finish',
         size                     = ($2::jsonb)->>'size',
         is_featured              = (($2::jsonb)->>'is_featured')::boolean,
         mrp                      = NULLIF(($2::jsonb)->>'mrp', '')::numeric,
         gst_percentage           = NULLIF(($2::jsonb)->>'gst_percentage', '')::numeric,
         hsn_code                 = ($2::jsonb)->>'hsn_code',
         has_variants             = (($2::jsonb)->>'has_variants')::boolean,
         variant_type             = ($2::jsonb)->>'variant_type',
         mpn                      = ($2::jsonb)->>'mpn',
         gtin                     = ($2::jsonb)->>'gtin',
         weight_grams             = NULLIF(($2::jsonb)->>'weight_grams', '')::integer,
         length_cm                = NULLIF(($2::jsonb)->>'length_cm', '')::numeric,
         breadth_cm               = NULLIF(($2::jsonb)->>'breadth_cm', '')::numeric,
         height_cm                = NULLIF(($2::jsonb)->>'height_cm', '')::numeric,
         package_type             = ($2::jsonb)->>'package_type',
         cost_price               = NULLIF(($2::jsonb)->>'cost_price', '')::numeric,
         supplier_id              = NULLIF(($2::jsonb)->>'supplier_id', '')::uuid,
         extra_delivery_days      = NULLIF(($2::jsonb)->>'extra_delivery_days', '')::integer,
         inventory_quantity       = COALESCE(NULLIF(($2::jsonb)->>'inventory_quantity', '')::numeric, 0),
         inventory_sync           = COALESCE((($2::jsonb)->>'inventory_sync')::boolean, false),
         low_stock_threshold      = NULLIF(($2::jsonb)->>'low_stock_threshold', '')::numeric,
         mrp_ex_gst               = NULLIF(($2::jsonb)->>'mrp_ex_gst', '')::numeric,
         sub_variant_type         = ($2::jsonb)->>'sub_variant_type',
         ai_description           = ($2::jsonb)->>'ai_description',
         ai_use_cases             = CASE WHEN jsonb_typeof(($2::jsonb)->'ai_use_cases') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'ai_use_cases')) ELSE NULL END,
         ai_enriched_at           = NULLIF(($2::jsonb)->>'ai_enriched_at', '')::timestamptz,
         ai_keywords              = CASE WHEN jsonb_typeof(($2::jsonb)->'ai_keywords') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'ai_keywords')) ELSE NULL END,
         ai_who_uses_it           = ($2::jsonb)->>'ai_who_uses_it',
         ai_application           = ($2::jsonb)->>'ai_application',
         ai_product_type          = ($2::jsonb)->>'ai_product_type',
         ai_features              = CASE WHEN jsonb_typeof(($2::jsonb)->'ai_features') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'ai_features')) ELSE NULL END,
         ai_search_tags           = CASE WHEN jsonb_typeof(($2::jsonb)->'ai_search_tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'ai_search_tags')) ELSE NULL END,
         discount_pct             = NULLIF(($2::jsonb)->>'discount_pct', '')::numeric,
         sell_unit_id             = NULLIF(($2::jsonb)->>'sell_unit_id', '')::uuid,
         stock_status             = COALESCE(NULLIF(($2::jsonb)->>'stock_status', ''), stock_status),
         image_url                = ($2::jsonb)->>'image_url',
         barcode                  = ($2::jsonb)->>'barcode',
         isbn                     = ($2::jsonb)->>'isbn',
         asin                     = ($2::jsonb)->>'asin',
         brand_part_number        = ($2::jsonb)->>'brand_part_number',
         country_of_origin        = ($2::jsonb)->>'country_of_origin',
         shelf_life_days          = NULLIF(($2::jsonb)->>'shelf_life_days', '')::integer,
         color                    = ($2::jsonb)->>'color',
         color_hex                = ($2::jsonb)->>'color_hex',
         volume_ml                = NULLIF(($2::jsonb)->>'volume_ml', '')::numeric,
         net_weight_grams         = NULLIF(($2::jsonb)->>'net_weight_grams', '')::integer,
         fragile                  = (($2::jsonb)->>'fragile')::boolean,
         hazardous                = (($2::jsonb)->>'hazardous')::boolean,
         flammable                = (($2::jsonb)->>'flammable')::boolean,
         perishable               = (($2::jsonb)->>'perishable')::boolean,
         certifications           = CASE WHEN jsonb_typeof(($2::jsonb)->'certifications') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'certifications')) ELSE NULL END,
         compliance_standard      = ($2::jsonb)->>'compliance_standard',
         safety_rating            = ($2::jsonb)->>'safety_rating',
         warranty_months          = NULLIF(($2::jsonb)->>'warranty_months', '')::integer,
         warranty_type            = ($2::jsonb)->>'warranty_type',
         condition                = ($2::jsonb)->>'condition',
         is_cod_allowed           = (($2::jsonb)->>'is_cod_allowed')::boolean,
         launch_date              = NULLIF(($2::jsonb)->>'launch_date', '')::date,
         discontinue_date         = NULLIF(($2::jsonb)->>'discontinue_date', '')::date,
         sort_order               = NULLIF(($2::jsonb)->>'sort_order', '')::integer,
         handling_days            = NULLIF(($2::jsonb)->>'handling_days', '')::integer,
         shipping_class           = ($2::jsonb)->>'shipping_class',
         is_oversized             = (($2::jsonb)->>'is_oversized')::boolean,
         volumetric_weight_grams  = NULLIF(($2::jsonb)->>'volumetric_weight_grams', '')::integer,
         is_digital               = (($2::jsonb)->>'is_digital')::boolean,
         download_url             = ($2::jsonb)->>'download_url',
         license_type             = ($2::jsonb)->>'license_type',
         file_format              = ($2::jsonb)->>'file_format',
         platform_compatibility   = CASE WHEN jsonb_typeof(($2::jsonb)->'platform_compatibility') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'platform_compatibility')) ELSE NULL END,
         is_subscription          = (($2::jsonb)->>'is_subscription')::boolean,
         subscription_interval    = ($2::jsonb)->>'subscription_interval',
         subscription_price       = NULLIF(($2::jsonb)->>'subscription_price', '')::numeric,
         is_bundle                = (($2::jsonb)->>'is_bundle')::boolean,
         bundle_items             = ($2::jsonb)->'bundle_items',
         meta_title               = ($2::jsonb)->>'meta_title',
         meta_description         = ($2::jsonb)->>'meta_description',
         meta_keywords            = CASE WHEN jsonb_typeof(($2::jsonb)->'meta_keywords') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'meta_keywords')) ELSE NULL END,
         is_searchable            = (($2::jsonb)->>'is_searchable')::boolean,
         tax_class                = ($2::jsonb)->>'tax_class',
         inclusive_tax            = (($2::jsonb)->>'inclusive_tax')::boolean,
         age_min                  = NULLIF(($2::jsonb)->>'age_min', '')::integer,
         age_max                  = NULLIF(($2::jsonb)->>'age_max', '')::integer,
         target_gender            = ($2::jsonb)->>'target_gender',
         target_audience          = CASE WHEN jsonb_typeof(($2::jsonb)->'target_audience') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(($2::jsonb)->'target_audience')) ELSE NULL END,
         serialized               = (($2::jsonb)->>'serialized')::boolean,
         grade                    = ($2::jsonb)->>'grade',
         specifications           = ($2::jsonb)->'specifications',
         updated_at               = NOW()
       WHERE id = $1`,
      [productId, JSON.stringify(draft.fields)]
    )

    // NOTE: Leaf-level supplier reconcile runs AFTER the variant + sub-variant
    // upserts below, so each row's variant_sku / sub_variant_sku resolves to a
    // freshly-persisted id. See "Reconcile suppliers per leaf" further down.

    // UPSERT variants — never hard-delete to preserve FK references from POs/orders
    // Only process variants that have valid SKUs
    const validVariants = (variants as any[]).filter((v: any) => v.sku)
    const draftSkus = validVariants.map((v: any) => v.sku)

    if (validVariants.length > 0) {
      // Deactivate variants removed from draft (soft delete only)
      await client.query(
        `UPDATE product_variants SET is_active = false, updated_at = NOW()
         WHERE product_id = $1 AND sku != ALL($2::text[])`,
        [productId, draftSkus]
      )
    await client.query(
      `INSERT INTO product_variants (
         product_id, sku, variant_name, price, attributes, is_active, mrp,
         price_ex_gst, mpn, gtin, asin, asin_match, isbn, pricing_type, unit, numeric_value,
         weight_grams, length_cm, breadth_cm, height_cm,
         package_type, cost_price, inventory_quantity, mrp_ex_gst,
         variant_type, sub_variant_type, sub_variant_type_on, use_own_images,
         discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
         created_at, updated_at
       )
       SELECT $1, v->>'sku', v->>'variant_name', NULLIF(v->>'price','')::numeric, v->'attributes',
         COALESCE((v->>'is_active')::boolean, true), NULLIF(v->>'mrp','')::numeric,
         NULLIF(v->>'price_ex_gst','')::numeric, v->>'mpn', v->>'gtin',
         NULLIF(v->>'asin',''), CASE WHEN NULLIF(v->>'asin','') IS NOT NULL THEN 'manual' ELSE NULL END,
         NULLIF(v->>'isbn',''),
         COALESCE(NULLIF(v->>'pricing_type',''), 'unit'),
         v->>'unit', NULLIF(v->>'numeric_value','')::numeric,
         NULLIF(v->>'weight_grams','')::integer, NULLIF(v->>'length_cm','')::numeric,
         NULLIF(v->>'breadth_cm','')::numeric, NULLIF(v->>'height_cm','')::numeric,
         v->>'package_type', NULLIF(v->>'cost_price','')::numeric,
         COALESCE(NULLIF(v->>'inventory_quantity','')::numeric, 0), NULLIF(v->>'mrp_ex_gst','')::numeric,
         v->>'variant_type', v->>'sub_variant_type', COALESCE((v->>'sub_variant_type_on')::boolean, false),
         COALESCE((v->>'use_own_images')::boolean, false), COALESCE(NULLIF(v->>'discount_pct','')::numeric, 0),
         COALESCE(NULLIF(v->>'stock_decimal_precision','')::integer, 0), NULLIF(v->>'sell_unit_id','')::uuid,
         COALESCE(NULLIF(v->>'stock_status',''), 'In Stock'), NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS v
       ON CONFLICT (sku) DO UPDATE SET
         variant_name = EXCLUDED.variant_name, price = EXCLUDED.price,
         attributes = EXCLUDED.attributes, is_active = EXCLUDED.is_active,
         mrp = EXCLUDED.mrp, price_ex_gst = EXCLUDED.price_ex_gst,
         mpn = EXCLUDED.mpn, gtin = EXCLUDED.gtin,
         asin = COALESCE(EXCLUDED.asin, product_variants.asin),
         asin_match = COALESCE(EXCLUDED.asin_match, product_variants.asin_match),
         isbn = EXCLUDED.isbn,
         pricing_type = EXCLUDED.pricing_type,
         unit = EXCLUDED.unit, numeric_value = EXCLUDED.numeric_value,
         weight_grams = EXCLUDED.weight_grams, length_cm = EXCLUDED.length_cm,
         breadth_cm = EXCLUDED.breadth_cm, height_cm = EXCLUDED.height_cm,
         package_type = EXCLUDED.package_type, cost_price = EXCLUDED.cost_price,
         -- inventory_quantity is managed out-of-band (shelf_stock / batches / serials
         -- via syncCentralInventory / bootstrap), NOT by the draft form snapshot which
         -- drops it. Overwriting with the snapshot's COALESCE(...,0) zeroed live stock
         -- on a 2nd publish. On conflict, PRESERVE the existing live value — the draft
         -- is not the source of truth for variant stock.
         inventory_quantity = product_variants.inventory_quantity, mrp_ex_gst = EXCLUDED.mrp_ex_gst,
         variant_type = EXCLUDED.variant_type, sub_variant_type = EXCLUDED.sub_variant_type,
         sub_variant_type_on = EXCLUDED.sub_variant_type_on,
         use_own_images = EXCLUDED.use_own_images, discount_pct = EXCLUDED.discount_pct,
         stock_decimal_precision = EXCLUDED.stock_decimal_precision,
         sell_unit_id = EXCLUDED.sell_unit_id, stock_status = EXCLUDED.stock_status,
         updated_at = NOW()`,
      [productId, JSON.stringify(validVariants)]
    )
    // Deactivate sub-variants for variants where sub_variant_type_on was turned off
    const variantsWithSubsOff = validVariants.filter((v: any) => !v.sub_variant_type_on && v.sku)
    for (const v of variantsWithSubsOff) {
      await client.query(
        `UPDATE product_sub_variants SET is_active = false, updated_at = NOW()
         WHERE variant_id = (SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2)`,
        [productId, v.sku]
      )
    }
    // Delete variant images for variants where use_own_images was turned off
    const variantsWithOwnImagesOff = validVariants.filter((v: any) => !v.use_own_images && v.sku)
    for (const v of variantsWithOwnImagesOff) {
      await client.query(
        `DELETE FROM variant_images
         WHERE variant_id = (SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2)`,
        [productId, v.sku]
      )
    }
    }

    // ── Reconcile staged variant images → live variant_images ─────────────────
    // Draft-staged variant images live in product_drafts.variant_images (flat array,
    // each row tagged variant_id). Rows with a real uuid id are KEPT live rows; rows
    // with a draft-vi- id are freshly-uploaded S3 files to INSERT. For every variant
    // present in the stage we reconcile: delete live rows not in the keep-set, insert
    // new staged rows, then apply display_order + a single is_primary. Runs after the
    // variant upsert so variant ids are stable. Only variants that appear in the stage
    // are touched (draft-entry seeds all active variants' images, so the admin clearing
    // a variant's images shows up as that variant having zero staged rows → cleared).
    const stagedVI = Array.isArray(draft.variant_images) ? (draft.variant_images as any[]) : []
    if (stagedVI.length > 0 || validVariants.length > 0) {
      const byVariant = new Map<string, any[]>()
      for (const vi of stagedVI) {
        if (!vi.variant_id) continue
        const list = byVariant.get(vi.variant_id) || []
        list.push(vi)
        byVariant.set(vi.variant_id, list)
      }
      // Reconcile each variant that (a) has staged rows, or (b) is an active variant in
      // this publish (so a cleared-to-zero variant also gets its live images removed).
      const activeVariantIds = await client.query<{ id: string }>(
        `SELECT id FROM product_variants WHERE product_id = $1 AND is_active = true`, [productId]
      )
      const variantIds = new Set<string>([...byVariant.keys(), ...activeVariantIds.rows.map(r => r.id)])
      for (const vid of variantIds) {
        const rows = (byVariant.get(vid) || []).slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        const keepIds = rows.map(r => r.id).filter((id: any) => id && !String(id).startsWith('draft-vi-'))
        // Remove live rows no longer kept.
        await client.query(
          `DELETE FROM variant_images WHERE variant_id = $1 AND id <> ALL($2::uuid[])`,
          [vid, keepIds]
        )
        // Insert freshly-staged uploads (draft-vi- ids).
        for (const r of rows) {
          if (r.id && !String(r.id).startsWith('draft-vi-')) continue // existing live row
          await client.query(
            `INSERT INTO variant_images
               (variant_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
                file_name, file_size, mime_type, width, height, display_order, is_primary)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              vid, r.image_url, r.thumbnail_url,
              r.s3_bucket || (process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'),
              r.s3_key || null, r.s3_thumbnail_key || null,
              r.file_name || null, r.file_size ?? null, r.mime_type || null,
              r.width ?? null, r.height ?? null, r.display_order ?? 0, !!r.is_primary,
            ]
          )
        }
        // Apply display_order + is_primary for kept (existing) live rows.
        for (const r of rows) {
          if (!r.id || String(r.id).startsWith('draft-vi-')) continue
          await client.query(
            `UPDATE variant_images SET display_order = $2, is_primary = $3 WHERE id = $1 AND variant_id = $4`,
            [r.id, r.display_order ?? 0, !!r.is_primary, vid]
          )
        }
        // Guarantee exactly one primary when the variant has any images.
        const hasPrimary = rows.some(r => r.is_primary)
        if (!hasPrimary) {
          await client.query(
            `UPDATE variant_images SET is_primary = TRUE
             WHERE id = (SELECT id FROM variant_images WHERE variant_id = $1 ORDER BY display_order ASC, created_at ASC LIMIT 1)`,
            [vid]
          )
        }
      }
    }

    await client.query(`DELETE FROM product_images WHERE product_id = $1`, [productId])
    await client.query(
      `INSERT INTO product_images (
         product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
         file_name, file_size, mime_type, width, height, alt_text,
         display_order, is_primary, created_at, updated_at
       )
       SELECT $1, img->>'image_url', img->>'thumbnail_url', img->>'s3_bucket',
         img->>'s3_key', img->>'s3_thumbnail_key', img->>'file_name',
         NULLIF(img->>'file_size','')::bigint, img->>'mime_type',
         NULLIF(img->>'width','')::integer, NULLIF(img->>'height','')::integer,
         img->>'alt_text', NULLIF(img->>'display_order','')::integer,
         (img->>'is_primary')::boolean, NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS img`,
      [productId, JSON.stringify(draft.images)]
    )

    // Apply staged sub-variants — only if the admin actually made sub-variant
    // changes in draft mode. Detected by any of: a _cleared sentinel (deletion), a
    // draft-sv- prefixed id (new row), or a _seeded/_edited marker (the draft now
    // holds the variant's COMPLETE snapshot because an edit/add/delete touched it).
    // Draft-entry now seeds every sub-variant (with its real id, no marker), so an
    // untouched product carries them here WITHOUT triggering this block.
    const hasSubVariantChanges = (subVariants as any[]).some(
      (sv: any) => sv._cleared || sv._seeded || sv._edited || (sv.id && String(sv.id).startsWith('draft-sv-'))
    )
    if (hasSubVariantChanges) {
      const num = (x: any): number | null => {
        if (x == null || x === '') return null
        const n = Number(x)
        return Number.isFinite(n) ? n : null
      }
      const staged = (subVariants as any[]).filter((sv: any) => !sv._cleared && sv.sub_variant_name && sv.variant_id)
      const clearedVariantIds = new Set(
        (subVariants as any[]).filter((sv: any) => sv._cleared).map((sv: any) => sv.variant_id)
      )
      const touchedVariantIds = new Set<string>([
        ...staged.map((sv: any) => sv.variant_id),
        ...Array.from(clearedVariantIds),
      ])

      // id-preserving UPSERT per touched variant. A real UUID id → UPDATE in place
      // (keeps FKs from order_items intact, no churn); a draft-sv- id (or missing) →
      // INSERT a fresh row. Sub-variants of a touched variant that are absent from
      // the staged set are SOFT-deactivated (never hard-deleted — order_items FK is
      // SET NULL and we must preserve order provenance). inventory_quantity is
      // preserved on UPDATE (managed out-of-band; the draft snapshot drops it), and
      // the variant/product rollup below recomputes from the active children.
      for (const vid of touchedVariantIds) {
        const svsForVariant = staged.filter((sv: any) => sv.variant_id === vid)
        const keepIds = svsForVariant
          .map((sv: any) => sv.id)
          .filter((id: any) => id && !String(id).startsWith('draft-sv-'))

        // Soft-deactivate sub-variants of this variant that the draft dropped.
        await client.query(
          `UPDATE product_sub_variants SET is_active = false, updated_at = NOW()
           WHERE variant_id = $1 AND id <> ALL($2::uuid[])`,
          [vid, keepIds]
        )

        for (const sv of svsForVariant) {
          const isNew = !sv.id || String(sv.id).startsWith('draft-sv-')
          if (isNew) {
            await client.query(
              `INSERT INTO product_sub_variants (variant_id, product_id, sku, sub_variant_name, price, mrp,
                 price_ex_gst, mrp_ex_gst, attributes, is_active, inventory_quantity, discount_pct, stock_status,
                 weight_grams, length_cm, breadth_cm, height_cm, package_type,
                 created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
              [
                vid, productId, sv.sku || null, sv.sub_variant_name,
                num(sv.price), num(sv.mrp), num(sv.price_ex_gst), num(sv.mrp_ex_gst),
                sv.attributes || null, sv.is_active != null ? sv.is_active : true,
                num(sv.inventory_quantity) ?? 0, num(sv.discount_pct) ?? 0,
                sv.stock_status || 'In Stock',
                num(sv.weight_grams) ?? null, num(sv.length_cm) ?? null,
                num(sv.breadth_cm) ?? null, num(sv.height_cm) ?? null,
                sv.package_type || null,
              ]
            )
          } else {
            // UPDATE by id — preserve inventory_quantity (out-of-band source of truth).
            await client.query(
              `UPDATE product_sub_variants SET
                 sku = $3, sub_variant_name = $4, price = $5, mrp = $6,
                 price_ex_gst = $7, mrp_ex_gst = $8, attributes = COALESCE($9, attributes),
                 is_active = $10, discount_pct = $11, stock_status = $12,
                 weight_grams = $13, length_cm = $14, breadth_cm = $15, height_cm = $16, package_type = $17,
                 updated_at = NOW()
               WHERE id = $1 AND product_id = $2`,
              [
                sv.id, productId, sv.sku || null, sv.sub_variant_name,
                num(sv.price), num(sv.mrp), num(sv.price_ex_gst), num(sv.mrp_ex_gst),
                sv.attributes || null, sv.is_active != null ? sv.is_active : true,
                num(sv.discount_pct) ?? 0, sv.stock_status || 'In Stock',
                num(sv.weight_grams) ?? null, num(sv.length_cm) ?? null,
                num(sv.breadth_cm) ?? null, num(sv.height_cm) ?? null,
                sv.package_type || null,
              ]
            )
          }
        }
      }
    }

    // ── Roll variant/product inventory up from the child grains ──────────────
    // The variant upsert can't set variant inventory_quantity (the draft snapshot
    // drops it), so for a variant that HAS active sub-variants, recompute its
    // inventory = SUM(active sub-variants). Then roll the product up = SUM(active
    // variants). This runs on EVERY publish (not just the first), so a 2nd publish
    // no longer leaves the variant at 0 when the client-side bootstrap re-sync
    // doesn't fire. Variants WITHOUT sub-variants keep their preserved value (the
    // EXISTS guard + COALESCE fallback leave them untouched).
    await client.query(
      `UPDATE product_variants pv SET inventory_quantity = COALESCE(
         (SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv
          WHERE sv.variant_id = pv.id AND sv.is_active = true), pv.inventory_quantity),
         updated_at = NOW()
       WHERE pv.product_id = $1
         AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)`,
      [productId]
    )
    await client.query(
      `UPDATE products SET inventory_quantity = COALESCE(
         (SELECT SUM(inventory_quantity) FROM product_variants WHERE product_id = $1 AND is_active = true), inventory_quantity),
         updated_at = NOW()
       WHERE id = $1
         AND EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1 AND is_active = true)`,
      [productId]
    )

    // ── Reconcile suppliers per LEAF ─────────────────────────────────────────
    // Runs AFTER the variant + sub-variant upserts above so variant_sku /
    // sub_variant_sku carried on each draft row resolves to a persisted id.
    // Carrier: one flat fields.product_suppliers array. Each row optionally
    // carries variant_sku (variant leaf) or sub_variant_sku (sub-variant leaf),
    // or neither (product leaf). We resolve the SKU to an id, group rows per
    // leaf, and reconcile each leaf scoped by (product_id, variant_id,
    // sub_variant_id) using IS NOT DISTINCT FROM for the nullable leaf columns.
    const draftSuppliers = Array.isArray((draft.fields as any)?.product_suppliers)
      ? ((draft.fields as any).product_suppliers as any[])
      : null
    if (draftSuppliers) {
      // Resolve each row to a leaf { variantId, subVariantId } — skip rows whose
      // tagged SKU does not resolve to a persisted variant/sub-variant.
      const skuVariantCache = new Map<string, string | null>()
      const skuSubVariantCache = new Map<string, string | null>()
      async function resolveVariantId(sku: string): Promise<string | null> {
        if (skuVariantCache.has(sku)) return skuVariantCache.get(sku) ?? null
        const r = await client.query(
          `SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2 LIMIT 1`,
          [productId, sku]
        )
        const id = r.rows[0]?.id ?? null
        skuVariantCache.set(sku, id)
        return id
      }
      async function resolveSubVariantId(variantId: string, subName: string): Promise<string | null> {
        const cacheKey = `${variantId}:${subName}`
        if (skuSubVariantCache.has(cacheKey)) return skuSubVariantCache.get(cacheKey) ?? null
        const r = await client.query(
          `SELECT id FROM product_sub_variants
           WHERE product_id = $1 AND variant_id = $2 AND sub_variant_name = $3 AND is_active = true
           ORDER BY created_at DESC LIMIT 1`,
          [productId, variantId, subName]
        )
        const id = r.rows[0]?.id ?? null
        skuSubVariantCache.set(cacheKey, id)
        return id
      }

      // leafKey `${variantId||NIL}:${subVariantId||NIL}` -> { variantId, subVariantId, rows }
      const NIL = '00000000-0000-0000-0000-000000000000'
      const leaves = new Map<string, { variantId: string | null; subVariantId: string | null; rows: any[] }>()
      for (const s of draftSuppliers) {
        const supplierId = String(s.supplier_id || '').trim()
        if (!supplierId) continue
        let variantId: string | null = null
        let subVariantId: string | null = null
        const subName = s.sub_variant_name ? String(s.sub_variant_name) : ''
        const varSku = s.variant_sku ? String(s.variant_sku) : ''
        if (subName && varSku) {
          // Sub-variant leaf: resolve parent variant by SKU, then sub-variant by name.
          variantId = await resolveVariantId(varSku)
          if (!variantId) continue
          subVariantId = await resolveSubVariantId(variantId, subName)
          if (!subVariantId) continue
          variantId = null // leaf is the sub-variant, not the variant
        } else if (varSku) {
          variantId = await resolveVariantId(varSku)
          if (!variantId) continue // SKU didn't resolve → skip row
        }
        const key = `${variantId || NIL}:${subVariantId || NIL}`
        let leaf = leaves.get(key)
        if (!leaf) { leaf = { variantId, subVariantId, rows: [] }; leaves.set(key, leaf) }
        leaf.rows.push(s)
      }

      for (const { variantId, subVariantId, rows } of leaves.values()) {
        const keepSupplierIds = rows
          .map((s: any) => String(s.supplier_id || '').trim())
          .filter(Boolean)
        // Deactivate rows for this leaf whose supplier is no longer in the draft set.
        await client.query(
          `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW()
           WHERE product_id = $1
             AND variant_id IS NOT DISTINCT FROM $2::uuid
             AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
             AND is_active = true
             AND supplier_id <> ALL($4::uuid[])`,
          [productId, variantId, subVariantId, keepSupplierIds]
        )

        for (const s of rows) {
          const supplierId = String(s.supplier_id || '').trim()
          if (!supplierId) continue
          const unitCost = Number(s.unit_cost)
          if (!Number.isFinite(unitCost) || unitCost < 0) continue
          const currency = s.currency ? String(s.currency).slice(0, 3) : 'INR'
          const gstInclusive = !!s.gst_inclusive
          const moq = s.moq != null && Number.isFinite(Number(s.moq)) ? Number(s.moq) : null
          const leadTime = s.lead_time_days != null && Number.isInteger(Number(s.lead_time_days)) ? Number(s.lead_time_days) : null
          const notes = s.notes ? String(s.notes).slice(0, 500) : null

          // Current active row for this leaf + supplier (latest), if any.
          const cur = await client.query(
            `SELECT id, unit_cost FROM product_suppliers
             WHERE product_id = $1
               AND variant_id IS NOT DISTINCT FROM $2::uuid
               AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
               AND supplier_id = $4 AND is_active = true
             ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
            [productId, variantId, subVariantId, supplierId]
          )
          const existing = cur.rows[0]
          if (!existing) {
            await client.query(
              `INSERT INTO product_suppliers
                 (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, moq, lead_time_days, is_preferred, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10)`,
              [productId, variantId, subVariantId, supplierId, unitCost, currency, gstInclusive, moq, leadTime, notes]
            )
          } else if (Number(existing.unit_cost) !== unitCost) {
            // Price changed → new dated row, deactivate old (preserve history).
            await client.query(
              `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW() WHERE id = $1`,
              [existing.id]
            )
            await client.query(
              `INSERT INTO product_suppliers
                 (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, moq, lead_time_days, is_preferred, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10)`,
              [productId, variantId, subVariantId, supplierId, unitCost, currency, gstInclusive, moq, leadTime, notes]
            )
          } else {
            await client.query(
              `UPDATE product_suppliers
                 SET currency = $1, gst_inclusive = $2, moq = $3, lead_time_days = $4, notes = $5,
                     is_preferred = false, updated_at = NOW()
               WHERE id = $6`,
              [currency, gstInclusive, moq, leadTime, notes, existing.id]
            )
          }
        }

        // Set the single preferred flag LAST per leaf, matching the draft row.
        await client.query(
          `UPDATE product_suppliers SET is_preferred = false, updated_at = NOW()
           WHERE product_id = $1
             AND variant_id IS NOT DISTINCT FROM $2::uuid
             AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
             AND is_preferred = true`,
          [productId, variantId, subVariantId]
        )
        const preferredSupplierId = rows.find((s: any) => s.is_preferred)?.supplier_id
        if (preferredSupplierId) {
          await client.query(
            `UPDATE product_suppliers SET is_preferred = true, updated_at = NOW()
             WHERE id = (
               SELECT id FROM product_suppliers
               WHERE product_id = $1
                 AND variant_id IS NOT DISTINCT FROM $2::uuid
                 AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
                 AND supplier_id = $4 AND is_active = true
               ORDER BY effective_date DESC, created_at DESC LIMIT 1
             )`,
            [productId, variantId, subVariantId, String(preferredSupplierId)]
          )
        }

        // Denormalize the leaf's preferred supplier to its cache column.
        // products.supplier_id (product leaf) is already handled by the main
        // UPDATE above; here we cache the variant/sub-variant leaves.
        const cachedSupplierId = preferredSupplierId ? String(preferredSupplierId) : null
        if (subVariantId) {
          await client.query(
            `UPDATE product_sub_variants SET supplier_id = $2::uuid, updated_at = NOW() WHERE id = $1`,
            [subVariantId, cachedSupplierId]
          )
        } else if (variantId) {
          await client.query(
            `UPDATE product_variants SET supplier_id = $2::uuid, updated_at = NOW() WHERE id = $1`,
            [variantId, cachedSupplierId]
          )
        }
      }

      // Deactivate suppliers for leaves that are entirely absent from the draft
      // (all suppliers removed). The per-leaf loop only visits leaves that still
      // have >= 1 row; leaves with zero rows are skipped and their DB rows stay
      // active without this cleanup.
      const coveredLeafKeys = new Set(Array.from(leaves.keys()))
      const dbLeaves = await client.query(
        `SELECT DISTINCT
           COALESCE(variant_id::text, '${NIL}') AS vid,
           COALESCE(sub_variant_id::text, '${NIL}') AS svid,
           variant_id, sub_variant_id
         FROM product_suppliers
         WHERE product_id = $1 AND is_active = true`,
        [productId]
      )
      for (const row of dbLeaves.rows) {
        const key = `${row.vid}:${row.svid}`
        if (!coveredLeafKeys.has(key)) {
          await client.query(
            `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW()
             WHERE product_id = $1
               AND variant_id IS NOT DISTINCT FROM $2::uuid
               AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
               AND is_active = true`,
            [productId, row.variant_id, row.sub_variant_id]
          )
        }
      }
    }

    // Units: UPSERT all scopes — product-level, variant-level, sub-variant-level
    // Delete only product-level units first (safe — variant-level kept to avoid FK issues)
    await client.query(`DELETE FROM product_units WHERE product_id = $1 AND variant_id IS NULL AND sub_variant_id IS NULL`, [productId])

    // Insert product-level units from draft (scope: no variant AND no sub-variant).
    const productUnits = (units as any[]).filter((u: any) =>
      !u._cleared &&
      (!u.variant_id || u.variant_id === 'null') &&
      (!u.sub_variant_id || u.sub_variant_id === 'null')
    )
    if (productUnits.length > 0) {
      await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, is_base, is_purchase_default,
           price_override, display_label, notes, dimension, conversion_meta,
           sub_variant_id, min_qty, max_qty, qty_step, created_at, updated_at
         )
         SELECT $1, NULL,
           u->>'unit', (u->>'factor')::numeric,
           COALESCE((u->>'is_base')::boolean, false), COALESCE((u->>'is_purchase_default')::boolean, false),
           NULLIF(u->>'price_override','')::numeric, u->>'display_label',
           u->>'notes', u->>'dimension', u->'conversion_meta', NULL,
           NULLIF(u->>'min_qty','')::numeric, NULLIF(u->>'max_qty','')::numeric,
           NULLIF(u->>'qty_step','')::numeric, NOW(), NOW()
         FROM jsonb_array_elements($2::jsonb) AS u`,
        [productId, JSON.stringify(productUnits)]
      )
    }

    // UPSERT variant-level units from draft (preserve IDs via ON CONFLICT on product_id+variant_id+unit)
    // First delete variant units that were explicitly cleared (Reset to product default)
    const clearedVariantUnitIds = (units as any[])
      .filter((u: any) => u._cleared && u.variant_id && u.variant_id !== 'null')
      .map((u: any) => u.variant_id)
    for (const vid of clearedVariantUnitIds) {
      await client.query(
        `DELETE FROM product_units WHERE product_id = $1 AND variant_id = $2`,
        [productId, vid]
      )
      // Clear sell_unit_id on the variant so it inherits from product
      await client.query(
        `UPDATE product_variants SET sell_unit_id = NULL, updated_at = NOW() WHERE id = $1`,
        [vid]
      )
    }
    const variantUnits = (units as any[]).filter((u: any) => !u._cleared && u.variant_id && u.variant_id !== 'null')
    for (const u of variantUnits) {
      await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, is_base, is_purchase_default,
           price_override, display_label, notes, dimension, conversion_meta,
           sub_variant_id, min_qty, max_qty, qty_step, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
         ON CONFLICT (variant_id, unit) WHERE variant_id IS NOT NULL DO UPDATE SET
           factor = EXCLUDED.factor, is_base = EXCLUDED.is_base,
           is_purchase_default = EXCLUDED.is_purchase_default,
           price_override = EXCLUDED.price_override, display_label = EXCLUDED.display_label,
           notes = EXCLUDED.notes, dimension = EXCLUDED.dimension,
           conversion_meta = EXCLUDED.conversion_meta, min_qty = EXCLUDED.min_qty,
           max_qty = EXCLUDED.max_qty, qty_step = EXCLUDED.qty_step, updated_at = NOW()`,
        [
          productId, u.variant_id, u.unit, u.factor ?? 1,
          u.is_base ?? false, u.is_purchase_default ?? false,
          u.price_override ?? null, u.display_label ?? null,
          u.notes ?? null, u.dimension ?? 'count', u.conversion_meta ?? null,
          u.sub_variant_id ?? null,
          u.min_qty ?? 1, u.max_qty ?? null, u.qty_step ?? 1
        ]
      )
    }

    // UPSERT sub-variant-level units from draft (scope: sub_variant_id set). These
    // are stored with variant_id null + sub_variant_id in the draft; without this
    // branch they were silently dropped on publish. Cleared ones are deleted first.
    const clearedSubVariantUnitIds = (units as any[])
      .filter((u: any) => u._cleared && u.sub_variant_id && u.sub_variant_id !== 'null')
      .map((u: any) => u.sub_variant_id)
    for (const svid of clearedSubVariantUnitIds) {
      await client.query(
        `DELETE FROM product_units WHERE product_id = $1 AND sub_variant_id = $2`,
        [productId, svid]
      )
      await client.query(
        `UPDATE product_sub_variants SET sell_unit_id = NULL, updated_at = NOW() WHERE id = $1`,
        [svid]
      )
    }
    const subVariantUnits = (units as any[]).filter((u: any) => !u._cleared && u.sub_variant_id && u.sub_variant_id !== 'null')
    for (const u of subVariantUnits) {
      // Sub-variant units are stored with variant_id NULL, so they fall under the
      // product-level partial unique index (product_id, unit) WHERE variant_id IS NULL
      // in addition to the sub-variant index. A same-`unit` product-level row would
      // therefore raise a unique_violation that ON CONFLICT (sub_variant_id, unit)
      // can't catch — and abort the whole publish. Guard with a savepoint: try the
      // sub-variant upsert; on ANY unique collision, fall back to updating the
      // existing sub-variant row (or skip if none), never failing the transaction.
      await client.query('SAVEPOINT sv_unit')
      try {
        await client.query(
          `INSERT INTO product_units (
             product_id, variant_id, unit, factor, is_base, is_purchase_default,
             price_override, display_label, notes, dimension, conversion_meta,
             sub_variant_id, min_qty, max_qty, qty_step, created_at, updated_at
           ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
           ON CONFLICT (sub_variant_id, unit) WHERE sub_variant_id IS NOT NULL DO UPDATE SET
             factor = EXCLUDED.factor, is_base = EXCLUDED.is_base,
             is_purchase_default = EXCLUDED.is_purchase_default,
             price_override = EXCLUDED.price_override, display_label = EXCLUDED.display_label,
             notes = EXCLUDED.notes, dimension = EXCLUDED.dimension,
             conversion_meta = EXCLUDED.conversion_meta, min_qty = EXCLUDED.min_qty,
             max_qty = EXCLUDED.max_qty, qty_step = EXCLUDED.qty_step, updated_at = NOW()`,
          [
            productId, u.unit, u.factor ?? 1,
            u.is_base ?? false, u.is_purchase_default ?? false,
            u.price_override ?? null, u.display_label ?? null,
            u.notes ?? null, u.dimension ?? 'count', u.conversion_meta ?? null,
            u.sub_variant_id,
            u.min_qty ?? 1, u.max_qty ?? null, u.qty_step ?? 1
          ]
        )
        await client.query('RELEASE SAVEPOINT sv_unit')
      } catch (e: any) {
        await client.query('ROLLBACK TO SAVEPOINT sv_unit')
        if (e?.code !== '23505') throw e // only swallow unique-violation cross-scope collisions
        // Collided with a product-level (or other) row on (product_id, unit). Update
        // the existing sub-variant unit in place if one exists; else leave it — a
        // product-level unit of the same name already covers this grain.
        await client.query(
          `UPDATE product_units SET
             factor = $3, is_base = $4, is_purchase_default = $5, price_override = $6,
             display_label = $7, notes = $8, dimension = $9, conversion_meta = $10,
             min_qty = $11, max_qty = $12, qty_step = $13, updated_at = NOW()
           WHERE product_id = $1 AND sub_variant_id = $2 AND unit = $14`,
          [
            productId, u.sub_variant_id, u.factor ?? 1, u.is_base ?? false,
            u.is_purchase_default ?? false, u.price_override ?? null, u.display_label ?? null,
            u.notes ?? null, u.dimension ?? 'count', u.conversion_meta ?? null,
            u.min_qty ?? 1, u.max_qty ?? null, u.qty_step ?? 1, u.unit,
          ]
        )
      }
    }

    // ── Toggle-OFF cleanup: perishable/serialized turned OFF ──────────────────
    // When a tracking flag is turned off, delete the now-orphaned batch/serial (and
    // their shelf) records but PRESERVE the stock by rolling the on-hand count back
    // into plain inventory_quantity at the correct grain. Runs AFTER the variant /
    // sub-variant upserts above (which set inventory from the draft snapshot) so this
    // is the final authority on the toggled-off grains. Counts are captured BEFORE
    // any delete. Only in_stock serials / remaining batch qty count as live stock;
    // sold/reserved serials are FK-referenced by orders and are left untouched.
    if (turnedOffPerishable || turnedOffSerialized) {
      // Per-grain on-hand count, captured BEFORE deleting. A grain may be tracked by
      // batches (perishable), serials (serialized), or both — and for a both-flags
      // product a batch of N carries N serials for the same units. So the true count
      // per grain is the GREATER of the two sources being removed (they should be
      // equal; MAX also covers a grain tracked by only one). We only include a source
      // when that flag is actually turning off, so a still-active tracking type is
      // never double-counted or wrongly dropped.
      //   batchExpr  → SUM(product_batches.quantity_remaining) when perishable off
      //   serialExpr → COUNT(product_serials in_stock)         when serialized off
      // Combined via a UNION-based subquery aggregated per grain with GREATEST.
      const sources: string[] = []
      if (turnedOffPerishable) {
        sources.push(`SELECT variant_id, sub_variant_id, COALESCE(quantity_remaining,0)::numeric AS q
                      FROM product_batches WHERE product_id = $1`)
      }
      if (turnedOffSerialized) {
        sources.push(`SELECT variant_id, sub_variant_id, 1::numeric AS q
                      FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`)
      }
      // Each source contributes its own per-grain SUM; take the max across sources so
      // a batch(N)+serials(N) grain reads N (not 2N), and a single-source grain reads N.
      const unioned = sources.map((s, i) => `SELECT variant_id, sub_variant_id, SUM(q) AS total FROM (${s}) src${i} GROUP BY variant_id, sub_variant_id`).join(' UNION ALL ')
      const perGrain = await client.query<{ variant_id: string | null; sub_variant_id: string | null; total: string }>(
        `SELECT variant_id, sub_variant_id, MAX(total)::text AS total
         FROM (${unioned}) u GROUP BY variant_id, sub_variant_id`,
        [productId]
      )
      const subCounts = { rows: perGrain.rows.filter(r => r.sub_variant_id).map(r => ({ sub_variant_id: r.sub_variant_id as string, total: r.total })) }
      const varCounts = { rows: perGrain.rows.filter(r => r.variant_id && !r.sub_variant_id).map(r => ({ variant_id: r.variant_id as string, total: r.total })) }
      const prodTotal = perGrain.rows.find(r => !r.variant_id && !r.sub_variant_id)?.total ?? '0'
      const prodCount = { rows: [{ total: prodTotal }] }

      // Delete tracking records. Perishable-off drops batches; serialized-off drops
      // in_stock serials (never sold/reserved). If BOTH are now off, drop both.
      if (turnedOffSerialized) {
        await client.query(`DELETE FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`, [productId])
      }
      // Drop batches only when perishable is off (a still-perishable product keeps them).
      if (!newPerishable) {
        await client.query(`DELETE FROM product_batches WHERE product_id = $1`, [productId])
        // Batch-driven shelf rows are now orphaned; the count lives in inventory_quantity.
        await client.query(`DELETE FROM shelf_stock WHERE product_id = $1`, [productId])
      }

      // Roll counts back into plain inventory at the correct grain.
      for (const sv of subCounts.rows) {
        await client.query(
          `UPDATE product_sub_variants SET inventory_quantity = $1, stock_status = $2, updated_at = NOW() WHERE id = $3`,
          [parseFloat(sv.total) || 0, (parseFloat(sv.total) || 0) > 0 ? 'In Stock' : 'Out of Stock', sv.sub_variant_id]
        )
      }
      for (const v of varCounts.rows) {
        // A variant with active sub-variants derives its qty from their rollup;
        // otherwise it takes its own captured count.
        await client.query(
          `UPDATE product_variants pv SET inventory_quantity = CASE
             WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
             THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
             ELSE $1 END,
             updated_at = NOW()
           WHERE pv.id = $2`,
          [parseFloat(v.total) || 0, v.variant_id]
        )
      }
      // Ensure variants that only have sub-variant grains still roll up correctly.
      await client.query(
        `UPDATE product_variants pv SET inventory_quantity = COALESCE(
           (SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), pv.inventory_quantity)
         WHERE pv.product_id = $1
           AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)`,
        [productId]
      )
      // Product-level inventory: rollup of active variants for a variant product,
      // else its own captured count. Derive "is a variant product" from STRUCTURE
      // (does it have any active variant?), NOT from whether grains happened to have
      // stock — otherwise a variant product whose grains are all at zero at toggle
      // time would be misclassified as simple and force products.inventory_quantity=0,
      // clobbering the correct variant rollup.
      const structRow = await client.query<{ has_active_variant: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM product_variants WHERE product_id = $1 AND is_active = true) AS has_active_variant`,
        [productId]
      )
      const isVariantProduct = !!structRow.rows[0]?.has_active_variant
      if (isVariantProduct) {
        await client.query(
          `UPDATE products SET inventory_quantity = COALESCE(
             (SELECT SUM(inventory_quantity) FROM product_variants WHERE product_id = $1 AND is_active = true), 0),
             updated_at = NOW() WHERE id = $1`,
          [productId]
        )
      } else {
        await client.query(
          `UPDATE products SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2`,
          [parseFloat(prodCount.rows[0]?.total ?? '0') || 0, productId]
        )
      }
    }

    // ── has_variants turned OFF: product became simple ───────────────────────
    // The product no longer has variants, but old variant/sub-variant rows (and
    // their orphaned batches/serials/shelf) linger. Product-grain inventory is the
    // source of truth, so we DISCARD variant stock: delete the variants' in-stock
    // serials + batches + shelf rows, then soft-deactivate the variants/sub-variants
    // (never hard-delete — order_items FK is SET NULL / purchase_order_items is
    // RESTRICT, so a delete would lose order provenance or throw). products.
    // inventory_quantity is left as the publish set it from the product-grain field.
    if (turnedOffVariants) {
      // Delete orphaned tracking rows keyed to any variant/sub-variant of this
      // product. Only in_stock serials (sold/reserved are order-FK'd history).
      await client.query(
        `DELETE FROM product_serials
         WHERE product_id = $1 AND status = 'in_stock'
           AND (variant_id IS NOT NULL OR sub_variant_id IS NOT NULL)`,
        [productId]
      )
      await client.query(
        `DELETE FROM product_batches
         WHERE product_id = $1 AND (variant_id IS NOT NULL OR sub_variant_id IS NOT NULL)`,
        [productId]
      )
      await client.query(
        `DELETE FROM shelf_stock
         WHERE product_id = $1 AND (variant_id IS NOT NULL OR sub_variant_id IS NOT NULL)`,
        [productId]
      )
      // Soft-deactivate the sub-variants then the variants (FK-safe).
      await client.query(
        `UPDATE product_sub_variants SET is_active = false, updated_at = NOW()
         WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
        [productId]
      )
      await client.query(
        `UPDATE product_variants SET is_active = false, updated_at = NOW()
         WHERE product_id = $1`,
        [productId]
      )
    }

    // If inventory_sync is ON for this product, derive stock_status from the final
    // quantities at every grain (backfill on flag flip + steady-state on each
    // publish). No-op when OFF, so the manual stock_status written above stands.
    await recomputeStockStatusForProduct(client, productId)

    await client.query(`DELETE FROM product_drafts WHERE product_id = $1`, [productId])
  })
}
