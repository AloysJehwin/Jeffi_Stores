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
         stock_status             = ($2::jsonb)->>'stock_status',
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
       SELECT $1,
         CASE WHEN u->>'variant_id' IS NOT NULL AND u->>'variant_id' != 'null'
              THEN (u->>'variant_id')::uuid ELSE NULL END,
         u->>'unit', (u->>'factor')::numeric,
         (u->>'is_base')::boolean, (u->>'is_purchase_default')::boolean,
         NULLIF(u->>'price_override','')::numeric, u->>'display_label',
         u->>'notes', u->>'dimension', u->'conversion_meta',
         CASE WHEN u->>'sub_variant_id' IS NOT NULL AND u->>'sub_variant_id' != 'null'
              THEN (u->>'sub_variant_id')::uuid ELSE NULL END,
         NULLIF(u->>'min_qty','')::numeric, NULLIF(u->>'max_qty','')::numeric,
         NULLIF(u->>'qty_step','')::numeric, NOW(), NOW()
       FROM jsonb_array_elements($2::jsonb) AS u`,
      [productId, JSON.stringify(draft.units)]
    )

    await client.query(`DELETE FROM product_drafts WHERE product_id = $1`, [productId])
  })
}
