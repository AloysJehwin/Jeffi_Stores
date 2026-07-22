import { queryOne, withTransaction } from '@/lib/db'

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

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE products SET
         category_id              = NULLIF($2->>'category_id', '')::uuid,
         brand_id                 = NULLIF($2->>'brand_id', '')::uuid,
         sku                      = $2->>'sku',
         name                     = $2->>'name',
         slug                     = $2->>'slug',
         description              = $2->>'description',
         short_description        = $2->>'short_description',
         base_price               = ($2->>'base_price')::numeric,
         price_ex_gst             = NULLIF($2->>'price_ex_gst', '')::numeric,
         currency                 = $2->>'currency',
         weight                   = NULLIF($2->>'weight', '')::numeric,
         dimensions               = $2->>'dimensions',
         material                 = $2->>'material',
         finish                   = $2->>'finish',
         size                     = $2->>'size',
         is_featured              = ($2->>'is_featured')::boolean,
         mrp                      = NULLIF($2->>'mrp', '')::numeric,
         gst_percentage           = NULLIF($2->>'gst_percentage', '')::numeric,
         hsn_code                 = $2->>'hsn_code',
         has_variants             = ($2->>'has_variants')::boolean,
         variant_type             = $2->>'variant_type',
         mpn                      = $2->>'mpn',
         gtin                     = $2->>'gtin',
         weight_grams             = NULLIF($2->>'weight_grams', '')::integer,
         length_cm                = NULLIF($2->>'length_cm', '')::numeric,
         breadth_cm               = NULLIF($2->>'breadth_cm', '')::numeric,
         height_cm                = NULLIF($2->>'height_cm', '')::numeric,
         package_type             = $2->>'package_type',
         cost_price               = NULLIF($2->>'cost_price', '')::numeric,
         extra_delivery_days      = NULLIF($2->>'extra_delivery_days', '')::integer,
         inventory_quantity       = COALESCE(NULLIF($2->>'inventory_quantity', '')::numeric, 0),
         mrp_ex_gst               = NULLIF($2->>'mrp_ex_gst', '')::numeric,
         sub_variant_type         = $2->>'sub_variant_type',
         ai_description           = $2->>'ai_description',
         ai_use_cases             = CASE WHEN jsonb_typeof($2->'ai_use_cases') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'ai_use_cases')) ELSE NULL END,
         ai_enriched_at           = NULLIF($2->>'ai_enriched_at', '')::timestamptz,
         ai_keywords              = CASE WHEN jsonb_typeof($2->'ai_keywords') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'ai_keywords')) ELSE NULL END,
         ai_who_uses_it           = $2->>'ai_who_uses_it',
         ai_application           = $2->>'ai_application',
         ai_product_type          = $2->>'ai_product_type',
         ai_features              = CASE WHEN jsonb_typeof($2->'ai_features') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'ai_features')) ELSE NULL END,
         ai_search_tags           = CASE WHEN jsonb_typeof($2->'ai_search_tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'ai_search_tags')) ELSE NULL END,
         discount_pct             = NULLIF($2->>'discount_pct', '')::numeric,
         sell_unit_id             = NULLIF($2->>'sell_unit_id', '')::uuid,
         stock_status             = $2->>'stock_status',
         image_url                = $2->>'image_url',
         barcode                  = $2->>'barcode',
         isbn                     = $2->>'isbn',
         asin                     = $2->>'asin',
         brand_part_number        = $2->>'brand_part_number',
         country_of_origin        = $2->>'country_of_origin',
         shelf_life_days          = NULLIF($2->>'shelf_life_days', '')::integer,
         color                    = $2->>'color',
         color_hex                = $2->>'color_hex',
         volume_ml                = NULLIF($2->>'volume_ml', '')::numeric,
         net_weight_grams         = NULLIF($2->>'net_weight_grams', '')::integer,
         fragile                  = ($2->>'fragile')::boolean,
         hazardous                = ($2->>'hazardous')::boolean,
         flammable                = ($2->>'flammable')::boolean,
         perishable               = ($2->>'perishable')::boolean,
         certifications           = CASE WHEN jsonb_typeof($2->'certifications') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'certifications')) ELSE NULL END,
         compliance_standard      = $2->>'compliance_standard',
         safety_rating            = $2->>'safety_rating',
         warranty_months          = NULLIF($2->>'warranty_months', '')::integer,
         warranty_type            = $2->>'warranty_type',
         condition                = $2->>'condition',
         is_cod_allowed           = ($2->>'is_cod_allowed')::boolean,
         launch_date              = NULLIF($2->>'launch_date', '')::date,
         discontinue_date         = NULLIF($2->>'discontinue_date', '')::date,
         sort_order               = NULLIF($2->>'sort_order', '')::integer,
         handling_days            = NULLIF($2->>'handling_days', '')::integer,
         shipping_class           = $2->>'shipping_class',
         is_oversized             = ($2->>'is_oversized')::boolean,
         volumetric_weight_grams  = NULLIF($2->>'volumetric_weight_grams', '')::integer,
         is_digital               = ($2->>'is_digital')::boolean,
         download_url             = $2->>'download_url',
         license_type             = $2->>'license_type',
         file_format              = $2->>'file_format',
         platform_compatibility   = CASE WHEN jsonb_typeof($2->'platform_compatibility') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'platform_compatibility')) ELSE NULL END,
         is_subscription          = ($2->>'is_subscription')::boolean,
         subscription_interval    = $2->>'subscription_interval',
         subscription_price       = NULLIF($2->>'subscription_price', '')::numeric,
         is_bundle                = ($2->>'is_bundle')::boolean,
         bundle_items             = $2->'bundle_items',
         meta_title               = $2->>'meta_title',
         meta_description         = $2->>'meta_description',
         meta_keywords            = CASE WHEN jsonb_typeof($2->'meta_keywords') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'meta_keywords')) ELSE NULL END,
         is_searchable            = ($2->>'is_searchable')::boolean,
         tax_class                = $2->>'tax_class',
         inclusive_tax            = ($2->>'inclusive_tax')::boolean,
         age_min                  = NULLIF($2->>'age_min', '')::integer,
         age_max                  = NULLIF($2->>'age_max', '')::integer,
         target_gender            = $2->>'target_gender',
         target_audience          = CASE WHEN jsonb_typeof($2->'target_audience') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text($2->'target_audience')) ELSE NULL END,
         serialized               = ($2->>'serialized')::boolean,
         grade                    = $2->>'grade',
         specifications           = $2->'specifications',
         updated_at               = NOW()
       WHERE id = $1`,
      [productId, draft.fields]
    )

    await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId])
    await client.query(
      `INSERT INTO product_variants (
         product_id, sku, variant_name, price, attributes, is_active, mrp,
         price_ex_gst, mpn, gtin, pricing_type, unit, numeric_value,
         weight_grams, length_cm, breadth_cm, height_cm,
         package_type, cost_price, inventory_quantity, mrp_ex_gst,
         variant_type, sub_variant_type, sub_variant_type_on, use_own_images,
         discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
         created_at, updated_at
       )
       SELECT $1, v->>'sku', v->>'variant_name', (v->>'price')::numeric, v->'attributes',
         (v->>'is_active')::boolean, NULLIF(v->>'mrp','')::numeric,
         NULLIF(v->>'price_ex_gst','')::numeric, v->>'mpn', v->>'gtin', v->>'pricing_type',
         v->>'unit', NULLIF(v->>'numeric_value','')::numeric,
         NULLIF(v->>'weight_grams','')::integer, NULLIF(v->>'length_cm','')::numeric,
         NULLIF(v->>'breadth_cm','')::numeric, NULLIF(v->>'height_cm','')::numeric,
         v->>'package_type', NULLIF(v->>'cost_price','')::numeric,
         NULLIF(v->>'inventory_quantity','')::numeric, NULLIF(v->>'mrp_ex_gst','')::numeric,
         v->>'variant_type', v->>'sub_variant_type', (v->>'sub_variant_type_on')::boolean,
         (v->>'use_own_images')::boolean, NULLIF(v->>'discount_pct','')::numeric,
         NULLIF(v->>'stock_decimal_precision','')::integer, NULLIF(v->>'sell_unit_id','')::uuid,
         v->>'stock_status', NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS v`,
      [productId, JSON.stringify(draft.variants)]
    )

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

    await client.query(`DELETE FROM product_sub_variants WHERE product_id = $1`, [productId])
    await client.query(
      `INSERT INTO product_sub_variants (
         variant_id, product_id, sku, sub_variant_name, price, mrp,
         price_ex_gst, mrp_ex_gst, attributes, is_active,
         inventory_quantity, discount_pct, stock_status, created_at, updated_at
       )
       SELECT pv.id, $1, sv->>'sku', sv->>'sub_variant_name',
         (sv->>'price')::numeric, NULLIF(sv->>'mrp','')::numeric,
         NULLIF(sv->>'price_ex_gst','')::numeric, NULLIF(sv->>'mrp_ex_gst','')::numeric,
         sv->'attributes', (sv->>'is_active')::boolean,
         NULLIF(sv->>'inventory_quantity','')::integer,
         NULLIF(sv->>'discount_pct','')::numeric, sv->>'stock_status', NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS sv
       JOIN product_variants pv ON pv.product_id = $1 AND pv.sku = sv->>'variant_sku'`,
      [productId, JSON.stringify(draft.sub_variants)]
    )

    await client.query(`DELETE FROM product_units WHERE product_id = $1`, [productId])
    await client.query(
      `INSERT INTO product_units (
         product_id, variant_id, unit, factor, is_base, is_purchase_default,
         price_override, display_label, notes, dimension, conversion_meta,
         sub_variant_id, min_qty, max_qty, qty_step, created_at, updated_at
       )
       SELECT $1, pv.id, u->>'unit', (u->>'factor')::numeric,
         (u->>'is_base')::boolean, (u->>'is_purchase_default')::boolean,
         NULLIF(u->>'price_override','')::numeric, u->>'display_label',
         u->>'notes', u->>'dimension', u->'conversion_meta', psv.id,
         NULLIF(u->>'min_qty','')::numeric, NULLIF(u->>'max_qty','')::numeric,
         NULLIF(u->>'qty_step','')::numeric, NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS u
       LEFT JOIN product_variants pv ON pv.product_id = $1 AND pv.sku = u->>'variant_sku'
       LEFT JOIN product_sub_variants psv ON psv.product_id = $1 AND psv.sku = u->>'sub_variant_sku'`,
      [productId, JSON.stringify(draft.units)]
    )

    await client.query(`DELETE FROM product_drafts WHERE product_id = $1`, [productId])
  })
}
