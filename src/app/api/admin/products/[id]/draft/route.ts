import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const product = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 AND is_active = true AND draft_of_id IS NULL`,
      [id]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found or not a live product' }, { status: 404 })
    }

    const existingDraft = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE draft_of_id = $1`,
      [id]
    )
    if (existingDraft) {
      return NextResponse.json({ error: 'A draft already exists for this product', draftId: existingDraft.id }, { status: 409 })
    }

    const draftId = await withTransaction(async (client) => {
      // Use INSERT...SELECT to preserve all column types exactly — no JS type coercion.
      // Only override: is_active=false, draft_of_id=original, timestamps=NOW(), views/sales=0.
      const draftRes = await client.query(
        `INSERT INTO products (
           category_id, brand_id, sku, name, slug, description, short_description,
           base_price, price_ex_gst, currency, weight, dimensions, material, finish,
           size, is_featured, is_active, views_count, sales_count, mrp, gst_percentage,
           hsn_code, has_variants, variant_type, mpn, gtin, weight_grams, length_cm,
           breadth_cm, height_cm, package_type, cost_price, extra_delivery_days,
           inventory_quantity, mrp_ex_gst, sub_variant_type, ai_description, ai_use_cases,
           ai_enriched_at, ai_keywords, ai_who_uses_it, ai_application, ai_product_type,
           ai_features, ai_search_tags, discount_pct, sell_unit_id, stock_status,
           image_url, barcode, isbn, asin, brand_part_number, country_of_origin, shelf_life_days,
           color, color_hex, volume_ml, net_weight_grams, fragile, hazardous, flammable,
           perishable, certifications, compliance_standard, safety_rating, warranty_months,
           warranty_type, condition, is_cod_allowed, launch_date, discontinue_date,
           sort_order, handling_days, shipping_class, is_oversized, volumetric_weight_grams,
           is_digital, download_url, license_type, file_format, platform_compatibility,
           is_subscription, subscription_interval, subscription_price, is_bundle,
           bundle_items, meta_title, meta_description, meta_keywords, is_searchable, tax_class,
           inclusive_tax, age_min, age_max, target_gender, target_audience,
           serialized, grade, specifications,
           draft_of_id, created_at, updated_at
         )
         SELECT
           category_id, brand_id, sku || '-DRAFT' AS sku, name, slug || '-draft' AS slug, description, short_description,
           base_price, price_ex_gst, currency, weight, dimensions, material, finish,
           size, is_featured, false, 0, 0, mrp, gst_percentage,
           hsn_code, has_variants, variant_type, mpn, gtin, weight_grams, length_cm,
           breadth_cm, height_cm, package_type, cost_price, extra_delivery_days,
           inventory_quantity, mrp_ex_gst, sub_variant_type, ai_description, ai_use_cases,
           ai_enriched_at, ai_keywords, ai_who_uses_it, ai_application, ai_product_type,
           ai_features, ai_search_tags, discount_pct, sell_unit_id, stock_status,
           image_url, barcode, isbn, asin, brand_part_number, country_of_origin, shelf_life_days,
           color, color_hex, volume_ml, net_weight_grams, fragile, hazardous, flammable,
           perishable, certifications, compliance_standard, safety_rating, warranty_months,
           warranty_type, condition, is_cod_allowed, launch_date, discontinue_date,
           sort_order, handling_days, shipping_class, is_oversized, volumetric_weight_grams,
           is_digital, download_url, license_type, file_format, platform_compatibility,
           is_subscription, subscription_interval, subscription_price, is_bundle,
           bundle_items, meta_title, meta_description, meta_keywords, is_searchable, tax_class,
           inclusive_tax, age_min, age_max, target_gender, target_audience,
           serialized, grade, specifications,
           id, NOW(), NOW()
         FROM products WHERE id = $1
         RETURNING id`,
        [id]
      )
      const newDraftId = draftRes.rows[0].id as string

      // Copy product_variants using INSERT...SELECT
      await client.query(
        `INSERT INTO product_variants (
           product_id, sku, variant_name, price, attributes, is_active, mrp,
           price_ex_gst, mpn, gtin, pricing_type, unit, numeric_value,
           weight_grams, length_cm, breadth_cm, height_cm, package_type,
           cost_price, inventory_quantity, mrp_ex_gst, variant_type,
           sub_variant_type, sub_variant_type_on, use_own_images,
           discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
           created_at, updated_at
         )
         SELECT
           $2, sku, variant_name, price, attributes, is_active, mrp,
           price_ex_gst, mpn, gtin, pricing_type, unit, numeric_value,
           weight_grams, length_cm, breadth_cm, height_cm, package_type,
           cost_price, inventory_quantity, mrp_ex_gst, variant_type,
           sub_variant_type, sub_variant_type_on, use_own_images,
           discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
           NOW(), NOW()
         FROM product_variants WHERE product_id = $1`,
        [id, newDraftId]
      )

      // Build variant id map: old → new (needed for sub_variants and units)
      const variantMap = await client.query<{ old_id: string; new_id: string }>(
        `SELECT ov.id AS old_id, nv.id AS new_id
         FROM product_variants ov
         JOIN product_variants nv
           ON nv.product_id = $2 AND nv.sku = ov.sku AND nv.variant_name = ov.variant_name
         WHERE ov.product_id = $1`,
        [id, newDraftId]
      )
      const variantIdMap = new Map(variantMap.rows.map(r => [r.old_id, r.new_id]))

      // Copy product_images
      await client.query(
        `INSERT INTO product_images (
           product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
           file_name, file_size, mime_type, width, height, alt_text,
           display_order, is_primary, created_at, updated_at
         )
         SELECT
           $2, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
           file_name, file_size, mime_type, width, height, alt_text,
           display_order, is_primary, NOW(), NOW()
         FROM product_images WHERE product_id = $1`,
        [id, newDraftId]
      )

      // Copy product_sub_variants (with remapped variant_id)
      const subVariants = await client.query(
        `SELECT * FROM product_sub_variants WHERE product_id = $1`,
        [id]
      )
      const subVariantIdMap = new Map<string, string>()
      for (const sv of subVariants.rows) {
        const newVariantId = variantIdMap.get(sv.variant_id as string) ?? sv.variant_id
        const svRes = await client.query(
          `INSERT INTO product_sub_variants (
             variant_id, product_id, sku, sub_variant_name, price, mrp,
             price_ex_gst, mrp_ex_gst, attributes, is_active,
             inventory_quantity, discount_pct, stock_status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
           RETURNING id`,
          [
            newVariantId, newDraftId, sv.sku, sv.sub_variant_name, sv.price, sv.mrp,
            sv.price_ex_gst, sv.mrp_ex_gst, sv.attributes, sv.is_active,
            sv.inventory_quantity, sv.discount_pct, sv.stock_status,
          ]
        )
        subVariantIdMap.set(sv.id as string, svRes.rows[0].id as string)
      }

      // Copy product_units (with remapped variant_id and sub_variant_id)
      const units = await client.query(
        `SELECT * FROM product_units WHERE product_id = $1`,
        [id]
      )
      for (const u of units.rows) {
        const newVariantId = u.variant_id ? (variantIdMap.get(u.variant_id as string) ?? u.variant_id) : null
        const newSubVariantId = u.sub_variant_id ? (subVariantIdMap.get(u.sub_variant_id as string) ?? u.sub_variant_id) : null
        await client.query(
          `INSERT INTO product_units (
             product_id, variant_id, unit, factor, is_base, is_purchase_default,
             price_override, display_label, notes, dimension, conversion_meta,
             sub_variant_id, min_qty, max_qty, qty_step, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
          [
            newDraftId, newVariantId, u.unit, u.factor, u.is_base, u.is_purchase_default,
            u.price_override, u.display_label, u.notes, u.dimension, u.conversion_meta,
            newSubVariantId, u.min_qty, u.max_qty, u.qty_step,
          ]
        )
      }

      return newDraftId
    })

    return NextResponse.json({ draftId })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to create draft' }, { status: 500 })
  }
}
