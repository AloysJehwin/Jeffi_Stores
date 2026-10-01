'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { generateProductSku, generateVariantSku } from '@/lib/catalog/sku'
import { round2 } from '@/lib/catalog/gst'

export async function createProduct(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const categoryId = ((formData.get('category_id') as string) || '').trim() || null
  const brandId = formData.get('brand_id') as string
  const hasVariants = formData.get('has_variants') === 'true'
  const variantType = (formData.get('variant_type') as string) || null
  const subVariantType = (formData.get('sub_variant_type') as string) || null
  const basePrice = hasVariants ? 0 : round2(parseFloat(formData.get('base_price') as string))
  const mrp = formData.get('mrp') ? round2(parseFloat(formData.get('mrp') as string)) : null
  const mrpExGst = formData.get('mrp_ex_gst') ? round2(parseFloat(formData.get('mrp_ex_gst') as string)) : null
  const salePrice = formData.get('price_ex_gst') ? round2(parseFloat(formData.get('price_ex_gst') as string)) : null
  const costPrice = formData.get('cost_price') ? round2(parseFloat(formData.get('cost_price') as string)) : 0
  const supplierId = ((formData.get('supplier_id') as string) || '').trim() || null
  const discountPct = formData.get('discount_pct')
    ? parseFloat(parseFloat(formData.get('discount_pct') as string).toFixed(2))
    : 0
  const gstPercentage = parseFloat((formData.get('gst_percentage') as string) || '18')
  const hsnCode = (formData.get('hsn_code') as string) || null
  const mpn = (formData.get('mpn') as string) || null
  const gtin = (formData.get('gtin') as string) || null
  const stockStatus = hasVariants ? 'In Stock' : (formData.get('stock_status') as string)
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const dimensions = (formData.get('dimensions') as string) || null
  const weightGrams = formData.get('weight_grams') ? parseInt(formData.get('weight_grams') as string) : null
  const packageType = (formData.get('package_type') as string) || null
  const lengthCm = formData.get('length_cm') ? parseFloat(formData.get('length_cm') as string) : null
  const breadthCm = formData.get('breadth_cm') ? parseFloat(formData.get('breadth_cm') as string) : null
  const heightCm = formData.get('height_cm') ? parseFloat(formData.get('height_cm') as string) : null
  const intent = formData.get('intent') as string | null
  const isActive = intent === 'draft' ? false : intent === 'publish' ? true : formData.get('is_active') === 'true'
  // Create-as-draft: intent 'draft' (or an implicit save) makes a create-draft (is_draft = true,
  // is_active = false) that lives ONLY in the Drafts section and never the live list/storefront.
  // 'publish' clears is_draft and activates. Existing is_active=true storefront queries already
  // exclude drafts, so no storefront query changes are needed.
  const isDraft = intent !== 'publish'
  const isFeatured = formData.get('is_featured') === 'true'

  // Server-side weight & packaging validation — enforced on publish only, so a
  // partial draft can still be saved. Mirrors the client checks in ProductForm and
  // the edit page so a direct/programmatic submit can't publish a null/zero weight
  // or missing box dims. See src/lib/shipping.ts STORED_DIMS_REQUIRED.
  if (intent === 'publish') {
    const STORED_DIMS_TYPES = ['drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube']
    const errors: string[] = []
    if (!hasVariants) {
      if (weightGrams == null || !(weightGrams > 0)) {
        errors.push('Shipping weight is required and must be greater than 0.')
      }
      if (
        packageType &&
        STORED_DIMS_TYPES.includes(packageType) &&
        (lengthCm == null || breadthCm == null || heightCm == null)
      ) {
        errors.push('Dimensions required for this package type')
      }
    } else {
      const variantsJsonRaw = formData.get('variants_json') as string | null
      let parsedVariants: any[] = []
      try {
        parsedVariants = variantsJsonRaw ? JSON.parse(variantsJsonRaw) : []
      } catch {
        parsedVariants = []
      }
      for (const v of parsedVariants) {
        if (v?._isDeleted) continue
        const w = v?.weight_grams != null && v.weight_grams !== '' ? parseFloat(v.weight_grams) : null
        if (w == null || !(w > 0)) {
          errors.push(
            `Shipping weight is required for variant "${v?.variant_name || v?.sku || ''}" and must be greater than 0.`
          )
          break
        }
        const pt = v?.package_type || 'flat_poly_auto'
        const blank = (x: any) => x == null || String(x).trim() === ''
        if (STORED_DIMS_TYPES.includes(pt) && (blank(v?.length_cm) || blank(v?.breadth_cm) || blank(v?.height_cm))) {
          errors.push(`Dimensions required for this package type (variant "${v?.variant_name || v?.sku || ''}")`)
          break
        }
      }
    }
    if (errors.length > 0) {
      return { error: errors[0] }
    }
  }
  const productId = (formData.get('product_id') as string) || null
  const uploadedImagesJson = formData.get('uploaded_images') as string
  const uploadedImages: any[] = uploadedImagesJson ? JSON.parse(uploadedImagesJson) : []
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson
    ? JSON.parse(galleryImageIdsJson)
    : []
  const imageOrderJson = formData.get('image_order') as string
  const imageOrder: string[] = imageOrderJson ? JSON.parse(imageOrderJson) : []

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const skuFromForm = ((formData.get('sku') as string) || '').trim().toUpperCase()
  let sku: string
  if (skuFromForm) {
    sku = skuFromForm
  } else {
    try {
      sku = (await generateProductSku(categoryId || null)).toUpperCase()
    } catch {
      sku = `PRD-${Date.now().toString(36).toUpperCase()}`
    }
  }

  try {
    const data = await queryOne(
      `INSERT INTO products (
        ${productId ? 'id, ' : ''}name, slug, sku, description, category_id, brand_id,
        base_price, mrp, mrp_ex_gst, price_ex_gst, gst_percentage, hsn_code, mpn, gtin,
        stock_status, weight, dimensions, is_active, is_draft, is_featured,
        has_variants, variant_type, sub_variant_type,
        weight_grams, package_type, length_cm, breadth_cm, height_cm, cost_price, discount_pct, supplier_id
      ) VALUES (${productId ? '$1, ' : ''}${(productId ? [...Array(31)].map((_, i) => `$${i + 2}`) : [...Array(31)].map((_, i) => `$${i + 1}`)).join(', ')})
      RETURNING *`,
      [
        ...(productId ? [productId] : []),
        name,
        slug,
        sku,
        description,
        categoryId,
        brandId || null,
        basePrice,
        mrp,
        mrpExGst,
        salePrice,
        gstPercentage,
        hsnCode,
        mpn,
        gtin,
        stockStatus,
        weight,
        dimensions,
        isActive,
        isDraft,
        isFeatured,
        hasVariants,
        variantType,
        subVariantType,
        weightGrams,
        packageType,
        lengthCm,
        breadthCm,
        heightCm,
        costPrice,
        discountPct,
        supplierId,
      ]
    )

    if (!data) throw new Error('Failed to create product')

    if (uploadedImages.length > 0 || galleryImageRefs.length > 0) {
      const newFileIds: Record<number, string> = {}

      for (let i = 0; i < uploadedImages.length; i++) {
        const img = uploadedImages[i]
        if (!img) continue
        const inserted = await queryOne<{ id: string }>(
          `INSERT INTO product_images (
            product_id, image_url, thumbnail_url, s3_bucket, s3_key,
            s3_thumbnail_key, file_name, file_size, mime_type, width,
            height, display_order, is_primary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [
            data.id,
            img.url,
            img.thumbnailUrl,
            img.s3Bucket,
            img.s3Key,
            img.s3ThumbnailKey,
            img.fileName,
            img.fileSize,
            img.mimeType,
            img.width,
            img.height,
            999,
            false,
          ]
        )
        if (inserted) newFileIds[i] = inserted.id
      }

      const newGalleryIds: Record<string, string> = {}
      if (galleryImageRefs.length > 0) {
        const { copyGalleryImageToProduct } = await import('@/lib/shared/s3')
        const galleryImages = await queryMany(`SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`, [
          galleryImageRefs.map(r => r.id),
        ])
        for (const gimg of galleryImages || []) {
          let copied
          try {
            copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, data.id)
          } catch (e) {
            // Gallery source object is missing — skip this image rather than storing a
            // gallery/ path on the product (or aborting the whole save).
            continue
          }
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              data.id,
              copied.url,
              copied.thumbnailUrl,
              copied.s3Bucket,
              copied.s3Key,
              copied.s3ThumbnailKey,
              gimg.custom_name || gimg.file_name,
              gimg.file_size,
              gimg.mime_type,
              gimg.width,
              gimg.height,
              999,
              false,
            ]
          )
          if (inserted) newGalleryIds[gimg.id] = inserted.id
        }
      }

      const keys =
        imageOrder.length > 0
          ? imageOrder
          : [...Object.keys(newFileIds).map(i => `file:${i}`), ...galleryImageRefs.map(r => `gallery:${r.id}`)]
      const primaryKey =
        keys.find(k => {
          if (k.startsWith('gallery:')) return galleryImageRefs.find(r => r.id === k.slice(8))?.isPrimary
          return false
        }) || keys[0]

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const isPrimary = key === primaryKey
        if (key.startsWith('file:')) {
          const pid = newFileIds[parseInt(key.slice(5))]
          if (pid)
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
              i,
              isPrimary,
              pid,
            ])
        } else if (key.startsWith('gallery:')) {
          const pid = newGalleryIds[key.slice(8)]
          if (pid)
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
              i,
              isPrimary,
              pid,
            ])
        }
      }
    }

    if (hasVariants) {
      const variantsJson = formData.get('variants_json') as string
      if (variantsJson) {
        const variants = JSON.parse(variantsJson)
        for (const variant of variants) {
          if (variant._isDeleted) continue
          if (!variant.variant_name) continue
          const variantSku = generateVariantSku(sku, variant.variant_name)
          await query(
            `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, stock_status, mpn, gtin, pricing_type, unit, numeric_value, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, discount_pct, asin, isbn, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, true)`,
            [
              data.id,
              variantSku,
              variant.variant_name,
              variant.price ? round2(parseFloat(variant.price)) : null,
              variant.mrp ? round2(parseFloat(variant.mrp)) : null,
              variant.mrp_ex_gst ? round2(parseFloat(variant.mrp_ex_gst)) : null,
              variant.price_ex_gst
                ? round2(parseFloat(variant.price_ex_gst))
                : variant.price
                  ? round2(parseFloat(variant.price) / (1 + gstPercentage / 100))
                  : null,
              variant.stock_status || 'In Stock',
              variant.mpn || null,
              variant.gtin || null,
              variant.pricing_type || 'unit',
              variant.unit || null,
              variant.numeric_value ? parseFloat(variant.numeric_value) : null,
              variant.weight_grams ? parseInt(variant.weight_grams) : null,
              variant.package_type || null,
              variant.length_cm ? parseFloat(variant.length_cm) : null,
              variant.breadth_cm ? parseFloat(variant.breadth_cm) : null,
              variant.height_cm ? parseFloat(variant.height_cm) : null,
              variant.sub_variant_type || null,
              variant.variant_type || null,
              variant.discount_pct ? parseFloat(parseFloat(variant.discount_pct).toFixed(2)) : 0,
              variant.asin || null,
              variant.isbn || null,
            ]
          )
        }
      }
    }

    const { syncProductToSheet } = await import('@/lib/shared/google-sheets')
    syncProductToSheet(data.id).catch(() => {})
    const { syncProductToMerchant } = await import('@/lib/merchant/sync')
    syncProductToMerchant(data.id).catch(() => {})
    const { syncProductToAmazon } = await import('@/lib/amazon/sync')
    syncProductToAmazon(data.id).catch(() => {})

    const host = await getHost()
    redirect(ap('/admin/products', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const raw = err?.message || ''
    let message = raw || 'Failed to create product'
    if (err?.code === '23505' || /duplicate key/i.test(raw)) {
      if (/products_sku_key/.test(raw)) message = 'A product with this SKU already exists. Use a different SKU.'
      else if (/products_slug_key/.test(raw)) message = 'A product with this name already exists. Use a different name.'
      else message = 'A product with these details already exists.'
    } else if (/invalid input syntax for type uuid/i.test(raw)) {
      message = 'Please select a valid category before saving.'
    }
    return { error: message }
  }
}
