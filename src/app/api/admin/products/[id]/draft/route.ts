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
    // Get the source live product
    const product = await queryOne<Record<string, unknown>>(
      `SELECT * FROM products WHERE id = $1 AND is_active = true AND draft_of_id IS NULL`,
      [id]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found or not a live product' }, { status: 404 })
    }

    // Check no existing draft
    const existingDraft = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE draft_of_id = $1`,
      [id]
    )
    if (existingDraft) {
      return NextResponse.json({ error: 'A draft already exists for this product', draftId: existingDraft.id }, { status: 409 })
    }

    const draftId = await withTransaction(async (client) => {
      // a. INSERT draft product row
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
          barcode, isbn, asin, brand_part_number, country_of_origin, shelf_life_days,
          color, color_hex, volume_ml, net_weight_grams, fragile, hazardous, flammable,
          perishable, certifications, compliance_standard, safety_rating, warranty_months,
          warranty_type, condition, is_cod_allowed, launch_date, discontinue_date,
          sort_order, handling_days, shipping_class, is_oversized, is_digital,
          download_url, license_type, file_format, platform_compatibility,
          is_subscription, subscription_interval, subscription_price, is_bundle,
          bundle_items, meta_title, meta_description, is_searchable, tax_class,
          inclusive_tax, age_min, age_max, target_gender, target_audience,
          serialized, grade, specifications,
          draft_of_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, false, 0, 0, $17, $18,
          $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35,
          $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45,
          $46, $47, $48, $49, $50,
          $51, $52, $53, $54, $55,
          $56, $57, $58, $59, $60,
          $61, $62, $63, $64, $65,
          $66, $67, $68, $69, $70,
          $71, $72, $73, $74, $75,
          $76, $77, $78, $79, $80,
          $81, $82, $83,
          $84, NOW(), NOW()
        ) RETURNING id`,
        [
          product.category_id, product.brand_id, product.sku, product.name, product.slug,
          product.description, product.short_description,
          product.base_price, product.price_ex_gst, product.currency, product.weight,
          product.dimensions, product.material, product.finish,
          product.size, product.is_featured, product.mrp, product.gst_percentage,
          product.hsn_code, product.has_variants, product.variant_type, product.mpn,
          product.gtin, product.weight_grams, product.length_cm,
          product.breadth_cm, product.height_cm, product.package_type, product.cost_price,
          product.extra_delivery_days,
          product.inventory_quantity, product.mrp_ex_gst, product.sub_variant_type,
          product.ai_description, product.ai_use_cases,
          product.ai_enriched_at, product.ai_keywords, product.ai_who_uses_it,
          product.ai_application, product.ai_product_type,
          product.ai_features, product.ai_search_tags, product.discount_pct,
          product.sell_unit_id, product.stock_status,
          product.barcode, product.isbn, product.asin, product.brand_part_number,
          product.country_of_origin, product.shelf_life_days,
          product.color, product.color_hex, product.volume_ml, product.net_weight_grams,
          product.fragile, product.hazardous, product.flammable,
          product.perishable, product.certifications, product.compliance_standard,
          product.safety_rating, product.warranty_months,
          product.warranty_type, product.condition, product.is_cod_allowed,
          product.launch_date, product.discontinue_date,
          product.sort_order, product.handling_days, product.shipping_class,
          product.is_oversized, product.is_digital,
          product.download_url, product.license_type, product.file_format,
          product.platform_compatibility,
          product.is_subscription, product.subscription_interval, product.subscription_price,
          product.is_bundle,
          product.bundle_items, product.meta_title, product.meta_description,
          product.is_searchable, product.tax_class,
          product.inclusive_tax, product.age_min, product.age_max,
          product.target_gender, product.target_audience,
          product.serialized, product.grade, product.specifications,
          id,
        ]
      )
      const newDraftId = draftRes.rows[0].id as string

      // b. Copy product_variants
      const variants = await client.query(
        `SELECT * FROM product_variants WHERE product_id = $1`,
        [id]
      )
      const variantIdMap = new Map<string, string>()
      for (const v of variants.rows) {
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
            newDraftId, v.sku, v.variant_name, v.price, v.attributes, v.is_active,
            v.mrp, v.price_ex_gst, v.mpn, v.gtin, v.pricing_type, v.unit, v.numeric_value,
            v.weight_grams, v.length_cm, v.breadth_cm, v.height_cm,
            v.package_type, v.cost_price, v.inventory_quantity, v.mrp_ex_gst,
            v.variant_type, v.sub_variant_type, v.sub_variant_type_on, v.use_own_images,
            v.discount_pct, v.stock_decimal_precision, v.sell_unit_id, v.stock_status,
          ]
        )
        variantIdMap.set(v.id as string, vRes.rows[0].id as string)
      }

      // c. Copy product_images
      const images = await client.query(
        `SELECT * FROM product_images WHERE product_id = $1`,
        [id]
      )
      for (const img of images.rows) {
        await client.query(
          `INSERT INTO product_images (
            product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
            file_name, file_size, mime_type, width, height, alt_text,
            display_order, is_primary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
          [
            newDraftId, img.image_url, img.thumbnail_url, img.s3_bucket, img.s3_key,
            img.s3_thumbnail_key, img.file_name, img.file_size, img.mime_type,
            img.width, img.height, img.alt_text, img.display_order, img.is_primary,
          ]
        )
      }

      // d. Copy product_sub_variants (map old variant_id -> new draft variant_id)
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
            inventory_quantity, discount_pct, stock_status,
            created_at, updated_at
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

      // e. Copy product_units (map variant_id and sub_variant_id to draft ids)
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
            sub_variant_id, min_qty, max_qty, qty_step,
            created_at, updated_at
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
