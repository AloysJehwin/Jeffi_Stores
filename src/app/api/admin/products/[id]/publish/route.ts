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
      // b. Update the live product with all fields from draft (except id, is_active, draft_of_id, created_at)
      await client.query(
        `UPDATE products SET
          category_id = $1, brand_id = $2, sku = $3, name = $4, slug = $5,
          description = $6, short_description = $7, base_price = $8, price_ex_gst = $9,
          currency = $10, weight = $11, dimensions = $12, material = $13, finish = $14,
          size = $15, is_featured = $16, mrp = $17, gst_percentage = $18, hsn_code = $19,
          has_variants = $20, variant_type = $21, mpn = $22, gtin = $23,
          weight_grams = $24, length_cm = $25, breadth_cm = $26, height_cm = $27,
          package_type = $28, cost_price = $29, extra_delivery_days = $30,
          inventory_quantity = $31, mrp_ex_gst = $32, sub_variant_type = $33,
          ai_description = $34, ai_use_cases = $35, ai_enriched_at = $36,
          ai_keywords = $37, ai_who_uses_it = $38, ai_application = $39,
          ai_product_type = $40, ai_features = $41, ai_search_tags = $42,
          discount_pct = $43, sell_unit_id = $44, stock_status = $45,
          barcode = $46, isbn = $47, asin = $48, brand_part_number = $49,
          country_of_origin = $50, shelf_life_days = $51, color = $52, color_hex = $53,
          volume_ml = $54, net_weight_grams = $55, fragile = $56, hazardous = $57,
          flammable = $58, perishable = $59, certifications = $60,
          compliance_standard = $61, safety_rating = $62, warranty_months = $63,
          warranty_type = $64, condition = $65, is_cod_allowed = $66,
          launch_date = $67, discontinue_date = $68, sort_order = $69,
          handling_days = $70, shipping_class = $71, is_oversized = $72,
          is_digital = $73, download_url = $74, license_type = $75, file_format = $76,
          platform_compatibility = $77, is_subscription = $78,
          subscription_interval = $79, subscription_price = $80,
          is_bundle = $81, bundle_items = $82, meta_title = $83, meta_description = $84,
          is_searchable = $85, tax_class = $86, inclusive_tax = $87,
          age_min = $88, age_max = $89, target_gender = $90, target_audience = $91,
          serialized = $92, grade = $93, specifications = $94,
          updated_at = NOW()
        WHERE id = $95`,
        [
          draft.category_id, draft.brand_id, draft.sku, draft.name, draft.slug,
          draft.description, draft.short_description, draft.base_price, draft.price_ex_gst,
          draft.currency, draft.weight, draft.dimensions, draft.material, draft.finish,
          draft.size, draft.is_featured, draft.mrp, draft.gst_percentage, draft.hsn_code,
          draft.has_variants, draft.variant_type, draft.mpn, draft.gtin,
          draft.weight_grams, draft.length_cm, draft.breadth_cm, draft.height_cm,
          draft.package_type, draft.cost_price, draft.extra_delivery_days,
          draft.inventory_quantity, draft.mrp_ex_gst, draft.sub_variant_type,
          draft.ai_description, draft.ai_use_cases, draft.ai_enriched_at,
          draft.ai_keywords, draft.ai_who_uses_it, draft.ai_application,
          draft.ai_product_type, draft.ai_features, draft.ai_search_tags,
          draft.discount_pct, draft.sell_unit_id, draft.stock_status,
          draft.barcode, draft.isbn, draft.asin, draft.brand_part_number,
          draft.country_of_origin, draft.shelf_life_days, draft.color, draft.color_hex,
          draft.volume_ml, draft.net_weight_grams, draft.fragile, draft.hazardous,
          draft.flammable, draft.perishable, draft.certifications,
          draft.compliance_standard, draft.safety_rating, draft.warranty_months,
          draft.warranty_type, draft.condition, draft.is_cod_allowed,
          draft.launch_date, draft.discontinue_date, draft.sort_order,
          draft.handling_days, draft.shipping_class, draft.is_oversized,
          draft.is_digital, draft.download_url, draft.license_type, draft.file_format,
          draft.platform_compatibility, draft.is_subscription,
          draft.subscription_interval, draft.subscription_price,
          draft.is_bundle, draft.bundle_items, draft.meta_title, draft.meta_description,
          draft.is_searchable, draft.tax_class, draft.inclusive_tax,
          draft.age_min, draft.age_max, draft.target_gender, draft.target_audience,
          draft.serialized, draft.grade, draft.specifications,
          originalId,
        ]
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
