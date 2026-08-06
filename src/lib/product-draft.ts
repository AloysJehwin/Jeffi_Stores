import { queryOne, queryMany, withTransaction } from '@/lib/db'

interface ProductDraft {
  product_id: string
  fields: Record<string, unknown>
  variants: Record<string, unknown>[]
  images: Record<string, unknown>[]
  sub_variants: Record<string, unknown>[]
  units: Record<string, unknown>[]
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

  // If draft variants/sub_variants are empty, fall back to live data
  const variants = Array.isArray(draft.variants) && draft.variants.length > 0
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
         base_price               = (($2::jsonb)->>'base_price')::numeric,
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
         extra_delivery_days      = NULLIF(($2::jsonb)->>'extra_delivery_days', '')::integer,
         inventory_quantity       = COALESCE(NULLIF(($2::jsonb)->>'inventory_quantity', '')::numeric, 0),
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
         price_ex_gst, mpn, gtin, asin, asin_match, pricing_type, unit, numeric_value,
         weight_grams, length_cm, breadth_cm, height_cm,
         package_type, cost_price, inventory_quantity, mrp_ex_gst,
         variant_type, sub_variant_type, sub_variant_type_on, use_own_images,
         discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
         created_at, updated_at
       )
       SELECT $1, v->>'sku', v->>'variant_name', (v->>'price')::numeric, v->'attributes',
         COALESCE((v->>'is_active')::boolean, true), NULLIF(v->>'mrp','')::numeric,
         NULLIF(v->>'price_ex_gst','')::numeric, v->>'mpn', v->>'gtin',
         NULLIF(v->>'asin',''), CASE WHEN NULLIF(v->>'asin','') IS NOT NULL THEN 'manual' ELSE NULL END,
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
         pricing_type = EXCLUDED.pricing_type,
         unit = EXCLUDED.unit, numeric_value = EXCLUDED.numeric_value,
         weight_grams = EXCLUDED.weight_grams, length_cm = EXCLUDED.length_cm,
         breadth_cm = EXCLUDED.breadth_cm, height_cm = EXCLUDED.height_cm,
         package_type = EXCLUDED.package_type, cost_price = EXCLUDED.cost_price,
         inventory_quantity = EXCLUDED.inventory_quantity, mrp_ex_gst = EXCLUDED.mrp_ex_gst,
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

    // Apply staged sub-variants — only if admin actually made changes in draft mode
    // (draft.sub_variants either has _cleared sentinels or draft-sv- prefixed IDs)
    const hasSubVariantChanges = (subVariants as any[]).some(
      (sv: any) => sv._cleared || (sv.id && String(sv.id).startsWith('draft-sv-'))
    )
    if (hasSubVariantChanges) {
      const stagedSubVariants = (subVariants as any[]).filter((sv: any) => !sv._cleared && sv.sub_variant_name && sv.variant_id)
      const clearedVariantIds = new Set(
        (subVariants as any[]).filter((sv: any) => sv._cleared).map((sv: any) => sv.variant_id)
      )
      const stagedVariantIds = new Set([
        ...stagedSubVariants.map((sv: any) => sv.variant_id),
        ...Array.from(clearedVariantIds),
      ])
      for (const vid of stagedVariantIds) {
        const refs = await client.query(
          `SELECT COUNT(*) FROM order_items WHERE sub_variant_id IN (SELECT id FROM product_sub_variants WHERE variant_id = $1)`,
          [vid]
        )
        if (parseInt(refs.rows[0].count) === 0) {
          await client.query(`DELETE FROM product_sub_variants WHERE variant_id = $1`, [vid])
        }
        const svsForVariant = stagedSubVariants.filter((sv: any) => sv.variant_id === vid)
        for (const sv of svsForVariant) {
          await client.query(
            `INSERT INTO product_sub_variants (variant_id, product_id, sku, sub_variant_name, price, mrp,
               price_ex_gst, mrp_ex_gst, attributes, is_active, inventory_quantity, discount_pct, stock_status,
               created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
            [
              vid, productId, sv.sku || null, sv.sub_variant_name,
              sv.price != null ? sv.price : null,
              sv.mrp != null ? sv.mrp : null,
              sv.price_ex_gst != null ? sv.price_ex_gst : null,
              sv.mrp_ex_gst != null ? sv.mrp_ex_gst : null,
              sv.attributes || null,
              sv.is_active != null ? sv.is_active : true,
              sv.inventory_quantity != null ? sv.inventory_quantity : 0,
              sv.discount_pct != null ? sv.discount_pct : 0,
              sv.stock_status || 'In Stock',
            ]
          )
        }
      }
    }

    // Units: UPSERT all scopes — product-level, variant-level, sub-variant-level
    // Delete only product-level units first (safe — variant-level kept to avoid FK issues)
    await client.query(`DELETE FROM product_units WHERE product_id = $1 AND variant_id IS NULL AND sub_variant_id IS NULL`, [productId])

    // Insert product-level units from draft
    const productUnits = (units as any[]).filter((u: any) => !u._cleared && (!u.variant_id || u.variant_id === 'null'))
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

    await client.query(`DELETE FROM product_drafts WHERE product_id = $1`, [productId])
  })
}
