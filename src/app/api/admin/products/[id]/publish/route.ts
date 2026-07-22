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
    // Get the draft product
    const draft = await queryOne<Record<string, unknown>>(
      `SELECT * FROM products WHERE id = $1 AND is_active = false AND draft_of_id IS NOT NULL`,
      [id]
    )
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    const originalId = draft.draft_of_id as string

    await withTransaction(async (client) => {
      // Update the live product with ALL fields from the draft using a single
      // UPDATE...FROM so types are preserved natively (no JS param coercion).
      // Excluded: id, is_active, draft_of_id, created_at — those stay on the original.
      await client.query(
        `UPDATE products AS live SET
           category_id = d.category_id,
           brand_id = d.brand_id,
           sku = d.sku,
           name = d.name,
           slug = d.slug,
           description = d.description,
           short_description = d.short_description,
           base_price = d.base_price,
           price_ex_gst = d.price_ex_gst,
           currency = d.currency,
           weight = d.weight,
           dimensions = d.dimensions,
           material = d.material,
           finish = d.finish,
           size = d.size,
           is_featured = d.is_featured,
           mrp = d.mrp,
           gst_percentage = d.gst_percentage,
           hsn_code = d.hsn_code,
           has_variants = d.has_variants,
           variant_type = d.variant_type,
           mpn = d.mpn,
           gtin = d.gtin,
           weight_grams = d.weight_grams,
           length_cm = d.length_cm,
           breadth_cm = d.breadth_cm,
           height_cm = d.height_cm,
           package_type = d.package_type,
           cost_price = d.cost_price,
           extra_delivery_days = d.extra_delivery_days,
           inventory_quantity = d.inventory_quantity,
           mrp_ex_gst = d.mrp_ex_gst,
           sub_variant_type = d.sub_variant_type,
           ai_description = d.ai_description,
           ai_use_cases = d.ai_use_cases,
           ai_enriched_at = d.ai_enriched_at,
           ai_keywords = d.ai_keywords,
           ai_who_uses_it = d.ai_who_uses_it,
           ai_application = d.ai_application,
           ai_product_type = d.ai_product_type,
           ai_features = d.ai_features,
           ai_search_tags = d.ai_search_tags,
           discount_pct = d.discount_pct,
           sell_unit_id = d.sell_unit_id,
           stock_status = d.stock_status,
           image_url = d.image_url,
           barcode = d.barcode,
           isbn = d.isbn,
           asin = d.asin,
           brand_part_number = d.brand_part_number,
           country_of_origin = d.country_of_origin,
           shelf_life_days = d.shelf_life_days,
           color = d.color,
           color_hex = d.color_hex,
           volume_ml = d.volume_ml,
           net_weight_grams = d.net_weight_grams,
           fragile = d.fragile,
           hazardous = d.hazardous,
           flammable = d.flammable,
           perishable = d.perishable,
           certifications = d.certifications,
           compliance_standard = d.compliance_standard,
           safety_rating = d.safety_rating,
           warranty_months = d.warranty_months,
           warranty_type = d.warranty_type,
           condition = d.condition,
           is_cod_allowed = d.is_cod_allowed,
           launch_date = d.launch_date,
           discontinue_date = d.discontinue_date,
           sort_order = d.sort_order,
           handling_days = d.handling_days,
           shipping_class = d.shipping_class,
           is_oversized = d.is_oversized,
           volumetric_weight_grams = d.volumetric_weight_grams,
           is_digital = d.is_digital,
           download_url = d.download_url,
           license_type = d.license_type,
           file_format = d.file_format,
           platform_compatibility = d.platform_compatibility,
           is_subscription = d.is_subscription,
           subscription_interval = d.subscription_interval,
           subscription_price = d.subscription_price,
           is_bundle = d.is_bundle,
           bundle_items = d.bundle_items,
           meta_title = d.meta_title,
           meta_description = d.meta_description,
           meta_keywords = d.meta_keywords,
           is_searchable = d.is_searchable,
           tax_class = d.tax_class,
           inclusive_tax = d.inclusive_tax,
           age_min = d.age_min,
           age_max = d.age_max,
           target_gender = d.target_gender,
           target_audience = d.target_audience,
           serialized = d.serialized,
           grade = d.grade,
           specifications = d.specifications,
           updated_at = NOW()
         FROM products d
         WHERE live.id = $2 AND d.id = $1`,
        [id, originalId]
      )

      // c. Replace variants
      await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [originalId])
      const draftVariants = await client.query(
        `SELECT * FROM product_variants WHERE product_id = $1`,
        [id]
      )
      const variantIdMap = new Map<string, string>()
      for (const v of draftVariants.rows) {
        const vRes = await client.query(
          `INSERT INTO product_variants (
            product_id, sku, variant_name, price, attributes, is_active, mrp,
            price_ex_gst, mpn, gtin, pricing_type, unit, numeric_value,
            updated_at, weight_grams, length_cm, breadth_cm, height_cm,
            package_type, cost_price, inventory_quantity, mrp_ex_gst,
            variant_type, sub_variant_type, sub_variant_type_on, use_own_images,
            discount_pct, stock_decimal_precision, sell_unit_id, stock_status,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13,
            NOW(), $14, $15, $16, $17,
            $18, $19, $20, $21,
            $22, $23, $24, $25,
            $26, $27, $28, $29,
            NOW()
          ) RETURNING id`,
          [
            originalId, v.sku, v.variant_name, v.price, v.attributes, v.is_active,
            v.mrp, v.price_ex_gst, v.mpn, v.gtin, v.pricing_type, v.unit, v.numeric_value,
            v.weight_grams, v.length_cm, v.breadth_cm, v.height_cm,
            v.package_type, v.cost_price, v.inventory_quantity, v.mrp_ex_gst,
            v.variant_type, v.sub_variant_type, v.sub_variant_type_on, v.use_own_images,
            v.discount_pct, v.stock_decimal_precision, v.sell_unit_id, v.stock_status,
          ]
        )
        variantIdMap.set(v.id as string, vRes.rows[0].id as string)
      }

      // e. Replace images
      await client.query(`DELETE FROM product_images WHERE product_id = $1`, [originalId])
      const draftImages = await client.query(
        `SELECT * FROM product_images WHERE product_id = $1`,
        [id]
      )
      for (const img of draftImages.rows) {
        await client.query(
          `INSERT INTO product_images (
            product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
            file_name, file_size, mime_type, width, height, alt_text,
            display_order, is_primary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
          [
            originalId, img.image_url, img.thumbnail_url, img.s3_bucket, img.s3_key,
            img.s3_thumbnail_key, img.file_name, img.file_size, img.mime_type,
            img.width, img.height, img.alt_text, img.display_order, img.is_primary,
          ]
        )
      }

      // g. Replace sub_variants
      await client.query(`DELETE FROM product_sub_variants WHERE product_id = $1`, [originalId])
      const draftSubVariants = await client.query(
        `SELECT * FROM product_sub_variants WHERE product_id = $1`,
        [id]
      )
      const subVariantIdMap = new Map<string, string>()
      for (const sv of draftSubVariants.rows) {
        const newVariantId = variantIdMap.get(sv.variant_id as string) ?? sv.variant_id
        const svRes = await client.query(
          `INSERT INTO product_sub_variants (
            variant_id, product_id, sku, sub_variant_name, price, mrp,
            price_ex_gst, mrp_ex_gst, attributes, is_active,
            inventory_quantity, discount_pct, stock_status,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
          RETURNING id`,
          [
            newVariantId, originalId, sv.sku, sv.sub_variant_name, sv.price, sv.mrp,
            sv.price_ex_gst, sv.mrp_ex_gst, sv.attributes, sv.is_active,
            sv.inventory_quantity, sv.discount_pct, sv.stock_status,
          ]
        )
        subVariantIdMap.set(sv.id as string, svRes.rows[0].id as string)
      }

      // i. Replace units
      await client.query(`DELETE FROM product_units WHERE product_id = $1`, [originalId])
      const draftUnits = await client.query(
        `SELECT * FROM product_units WHERE product_id = $1`,
        [id]
      )
      for (const u of draftUnits.rows) {
        const newVariantId = u.variant_id ? (variantIdMap.get(u.variant_id as string) ?? u.variant_id) : null
        const newSubVariantId = u.sub_variant_id ? (subVariantIdMap.get(u.sub_variant_id as string) ?? u.sub_variant_id) : null
        await client.query(
          `INSERT INTO product_units (
            product_id, variant_id, unit, factor, is_base, is_purchase_default,
            price_override, display_label, notes, dimension, conversion_meta,
            sub_variant_id, min_qty, max_qty, qty_step,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
          [
            originalId, newVariantId, u.unit, u.factor, u.is_base, u.is_purchase_default,
            u.price_override, u.display_label, u.notes, u.dimension, u.conversion_meta,
            newSubVariantId, u.min_qty, u.max_qty, u.qty_step,
          ]
        )
      }

      // k. Delete the draft product (cascades draft variants/images/etc via FK if any,
      //    but we've already replaced them above so delete draft's own child rows first)
      await client.query(`DELETE FROM product_units WHERE product_id = $1`, [id])
      await client.query(`DELETE FROM product_sub_variants WHERE product_id = $1`, [id])
      await client.query(`DELETE FROM product_images WHERE product_id = $1`, [id])
      await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [id])
      await client.query(`DELETE FROM products WHERE id = $1`, [id])
    })

    return NextResponse.json({ success: true, productId: originalId })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to publish draft' }, { status: 500 })
  }
}
