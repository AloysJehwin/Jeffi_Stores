'use server'

import { randomUUID } from 'crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query, queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { generateProductSku, generateVariantSku } from '@/lib/catalog/sku'
import { round2 } from '@/lib/catalog/gst'
import { normalizeSubscriptionPrice, normalizeSubscriptionPrices } from '@/lib/subscriptions/sellable'
import { cycleLimitsError, normalizeCycleCount } from '@/lib/subscriptions/intervals'
import { productsWriteError } from '@/lib/catalog/product-action-auth'
import {
  DRAFT_NAME_PLACEHOLDER,
  gstError,
  parseJsonField,
  priceErrors,
  productErrorMessage,
  publishShippingError,
  skuConflictError,
  toAmount,
  txDb,
  uniqueProductSlug,
  variantSkuCollisionError,
} from '@/lib/catalog/product-validation'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const money = (v: unknown): number | null => {
  const n = toAmount(v as string)
  return n == null || Number.isNaN(n) ? null : round2(n)
}
const floatOrNull = (v: unknown): number | null => {
  const n = toAmount(v as string)
  return n == null || Number.isNaN(n) ? null : n
}
const intOrNull = (v: unknown): number | null => {
  const n = floatOrNull(v)
  return n == null ? null : Math.round(n)
}

export type ProductActionResult = { error?: string; details?: string[]; ok?: true; redirectTo?: string } | void

export async function createProduct(formData: FormData): Promise<ProductActionResult> {
  const denied = await productsWriteError()
  if (denied) return { error: denied }

  const intent = formData.get('intent') as string | null
  // Anything but an explicit publish (draft button, Enter-key submit) creates a create-draft:
  // is_draft = true, is_active = false — Drafts section only, never the live list/storefront.
  const isPublish = intent === 'publish'
  const noRedirect = formData.get('_no_redirect') === '1'

  const rawName = ((formData.get('name') as string) || '').trim()
  const name = rawName || DRAFT_NAME_PLACEHOLDER
  const description = (formData.get('description') as string) || null
  const categoryId = ((formData.get('category_id') as string) || '').trim() || null
  const brandId = ((formData.get('brand_id') as string) || '').trim() || null
  const isDigital = formData.get('is_digital') === 'true'
  const hasVariants = formData.get('has_variants') === 'true' && !isDigital
  const variantType = (formData.get('variant_type') as string) || null
  const subVariantType = (formData.get('sub_variant_type') as string) || null
  const gstRaw = (formData.get('gst_percentage') as string) || '18'
  const supplierId = ((formData.get('supplier_id') as string) || '').trim() || null
  const hsnCode = (formData.get('hsn_code') as string) || null
  const mpn = (formData.get('mpn') as string) || null
  const gtin = (formData.get('gtin') as string) || null
  const stockStatus = hasVariants || isDigital ? 'In Stock' : (formData.get('stock_status') as string) || 'In Stock'
  const weight = floatOrNull(formData.get('weight'))
  const dimensions = (formData.get('dimensions') as string) || null
  const weightGrams = intOrNull(formData.get('weight_grams'))
  const packageType = (formData.get('package_type') as string) || null
  const lengthCm = floatOrNull(formData.get('length_cm'))
  const breadthCm = floatOrNull(formData.get('breadth_cm'))
  const heightCm = floatOrNull(formData.get('height_cm'))
  const isFeatured = formData.get('is_featured') === 'true'

  let uploadedImages: any[]
  let galleryImageRefs: { id: string; isPrimary: boolean }[]
  let imageOrder: string[]
  let variants: any[]
  try {
    uploadedImages = parseJsonField(formData.get('uploaded_images'), 'uploaded images', [])
    galleryImageRefs = parseJsonField(formData.get('gallery_image_ids'), 'gallery images', [])
    imageOrder = parseJsonField(formData.get('image_order'), 'image order', [])
    const rawVariants: any[] = hasVariants ? parseJsonField(formData.get('variants_json'), 'variants', []) : []
    variants = (Array.isArray(rawVariants) ? rawVariants : []).filter(
      v => v && !v._isDeleted && String(v.variant_name ?? '').trim()
    )
  } catch (e: any) {
    console.error('[product-create] malformed form data', e)
    return { error: e.message }
  }

  // ── Validation: drafts accept partial data; publish needs the full product.
  const errors: string[] = []
  if (isPublish) {
    if (!rawName || rawName === DRAFT_NAME_PLACEHOLDER) errors.push('Product name is required.')
    if (!categoryId) errors.push('Category is required.')
    if (hasVariants && variants.length === 0) errors.push('Add at least one variant, or turn off variants.')
  }
  const gstErr = gstError(gstRaw)
  if (gstErr) errors.push(gstErr)
  errors.push(
    ...priceErrors(
      'Pricing',
      hasVariants
        ? { cost: formData.get('cost_price') as string, discountPct: formData.get('discount_pct') as string }
        : {
            price: formData.get('base_price') as string,
            mrp: formData.get('mrp') as string,
            priceExGst: formData.get('price_ex_gst') as string,
            mrpExGst: formData.get('mrp_ex_gst') as string,
            cost: formData.get('cost_price') as string,
            discountPct: formData.get('discount_pct') as string,
          },
      { requirePrice: isPublish && !hasVariants }
    )
  )
  for (const v of variants) {
    errors.push(
      ...priceErrors(
        `Variant "${v.variant_name}"`,
        { price: v.price, mrp: v.mrp, priceExGst: v.price_ex_gst, mrpExGst: v.mrp_ex_gst, cost: v.cost_price },
        { requirePrice: isPublish }
      )
    )
  }
  if (isPublish) {
    const shipErr = publishShippingError({
      isDigital,
      hasVariants,
      product: {
        weight_grams: weightGrams,
        package_type: packageType,
        length_cm: lengthCm,
        breadth_cm: breadthCm,
        height_cm: heightCm,
      },
      variants: variants.map(v => ({ ...v, label: v.variant_name || v.sku || '' })),
    })
    if (shipErr) errors.push(shipErr)
  }
  const totalCycles = normalizeCycleCount(formData.get('subscription_total_cycles'))
  const minCycles = normalizeCycleCount(formData.get('subscription_min_cycles'))
  const cyclesError = cycleLimitsError(totalCycles, minCycles)
  if (cyclesError) errors.push(cyclesError)
  if (errors.length > 0) return { error: errors[0], details: errors }

  const gstPercentage = parseFloat(gstRaw)
  const basePrice = hasVariants ? 0 : (money(formData.get('base_price')) ?? 0)
  const mrp = money(formData.get('mrp'))
  const mrpExGst = money(formData.get('mrp_ex_gst'))
  const salePrice = money(formData.get('price_ex_gst'))
  const costPrice = money(formData.get('cost_price')) ?? 0
  const discountPct = money(formData.get('discount_pct')) ?? 0

  const clientId = ((formData.get('product_id') as string) || '').trim()
  const productId = UUID_RE.test(clientId) ? clientId : randomUUID()
  const host = await getHost()
  const done = (): ProductActionResult => {
    revalidatePath('/admin/products')
    // "Save (draft)" from a variant popup continues in the new draft's edit page.
    const dest = ap(intent === 'draft-stay' ? `/admin/products/edit/${productId}` : '/admin/products', host)
    if (noRedirect) return { ok: true, redirectTo: dest }
    redirect(dest)
  }

  // Idempotent retry: the insert is all-or-nothing, so an existing row means a prior attempt
  // committed (e.g. the response was lost). Treat it as done instead of a duplicate-key error.
  const existing = await queryOne<{ id: string }>('SELECT id FROM products WHERE id = $1', [productId])
  if (existing) {
    console.warn('[product-create] retry for already-created product', productId)
    return done()
  }

  const skuFromForm = ((formData.get('sku') as string) || '').trim().toUpperCase()
  let sku = skuFromForm
  if (!sku) {
    try {
      sku = (await generateProductSku(categoryId)).toUpperCase()
    } catch (e) {
      console.error('[product-create] SKU generation failed for', productId, e)
      sku = `PRD-${Date.now().toString(36).toUpperCase()}`
    }
  }
  const variantSkuFor = (n: string) => generateVariantSku(sku, n)
  const collision = variantSkuCollisionError(
    variants.map(v => String(v.variant_name)),
    variantSkuFor
  )
  if (collision) return { error: collision }
  try {
    const conflict = await skuConflictError(
      { query },
      { productSku: sku, variantSkus: variants.map(v => variantSkuFor(String(v.variant_name))) }
    )
    if (conflict) return { error: conflict }
  } catch (e) {
    console.error('[product-create] SKU pre-check failed for', productId, e)
  }

  // S3 copies run before the transaction; on failure they (and this attempt's uploads) are removed.
  const copiedGallery: { galleryId: string; copied: any; gimg: any }[] = []
  const s3Keys: { key: string; thumb: string }[] = uploadedImages
    .filter(img => img?.s3Key)
    .map(img => ({ key: img.s3Key, thumb: img.s3ThumbnailKey || '' }))
  const cleanupS3 = async () => {
    if (s3Keys.length === 0) return
    const { deleteProductImage } = await import('@/lib/shared/s3')
    for (const k of s3Keys) await deleteProductImage(k.key, k.thumb).catch(() => {})
  }

  try {
    if (galleryImageRefs.length > 0) {
      const { copyGalleryImageToProduct } = await import('@/lib/shared/s3')
      const galleryImages = await queryMany(`SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`, [
        galleryImageRefs.map(r => r.id),
      ])
      for (const gimg of galleryImages || []) {
        try {
          const copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, productId)
          copiedGallery.push({ galleryId: gimg.id, copied, gimg })
          s3Keys.push({ key: copied.s3Key, thumb: copied.s3ThumbnailKey || '' })
        } catch (e) {
          // Gallery source object is missing — skip it rather than store a gallery/ path.
          console.error('[product-create] gallery copy failed for', productId, gimg.id, e)
        }
      }
    }

    await withTransaction(async client => {
      const db = txDb(client)
      const slug = await uniqueProductSlug(client, name)
      await db.query(
        `INSERT INTO products (
          id, name, slug, sku, description, category_id, brand_id,
          base_price, mrp, mrp_ex_gst, price_ex_gst, gst_percentage, hsn_code, mpn, gtin,
          stock_status, weight, dimensions, is_active, is_draft, is_featured,
          has_variants, variant_type, sub_variant_type,
          weight_grams, package_type, length_cm, breadth_cm, height_cm, cost_price, discount_pct, supplier_id,
          subscription_price, subscription_total_cycles, subscription_min_cycles, subscription_prices, is_digital
        ) VALUES (${[...Array(37)].map((_, i) => `$${i + 1}`).join(', ')})`,
        [
          productId,
          name,
          slug,
          sku,
          description,
          categoryId,
          brandId,
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
          isPublish,
          !isPublish,
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
          hasVariants ? null : normalizeSubscriptionPrice(formData.get('subscription_price')),
          totalCycles,
          minCycles,
          JSON.stringify(hasVariants ? {} : normalizeSubscriptionPrices(formData.get('subscription_prices'))),
          isDigital,
        ]
      )

      const insertImage = async (img: Record<string, unknown>) =>
        (
          await db.queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 999, false) RETURNING id`,
            [
              productId,
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
            ]
          )
        )?.id

      const newFileIds: Record<number, string> = {}
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!uploadedImages[i]) continue
        const id = await insertImage(uploadedImages[i])
        if (id) newFileIds[i] = id
      }
      const newGalleryIds: Record<string, string> = {}
      for (const { galleryId, copied, gimg } of copiedGallery) {
        const id = await insertImage({
          ...copied,
          fileName: gimg.custom_name || gimg.file_name,
          fileSize: gimg.file_size,
          mimeType: gimg.mime_type,
          width: gimg.width,
          height: gimg.height,
        })
        if (id) newGalleryIds[galleryId] = id
      }

      const keys =
        imageOrder.length > 0
          ? imageOrder
          : [...Object.keys(newFileIds).map(i => `file:${i}`), ...galleryImageRefs.map(r => `gallery:${r.id}`)]
      const resolved = keys
        .map(k =>
          k.startsWith('file:')
            ? { key: k, id: newFileIds[parseInt(k.slice(5))] }
            : k.startsWith('gallery:')
              ? { key: k, id: newGalleryIds[k.slice(8)] }
              : { key: k, id: undefined }
        )
        .filter(r => r.id)
      const primaryKey =
        resolved.find(
          r => r.key.startsWith('gallery:') && galleryImageRefs.find(g => g.id === r.key.slice(8))?.isPrimary
        )?.key || resolved[0]?.key
      for (let i = 0; i < resolved.length; i++) {
        await db.query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
          i,
          resolved[i].key === primaryKey,
          resolved[i].id,
        ])
      }

      for (const variant of variants) {
        await db.query(
          `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, stock_status, mpn, gtin, pricing_type, unit, numeric_value, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, discount_pct, asin, isbn, is_active, subscription_price, subscription_prices)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, true, $24, $25::jsonb)`,
          [
            productId,
            variantSkuFor(String(variant.variant_name)),
            String(variant.variant_name).trim(),
            money(variant.price),
            money(variant.mrp),
            money(variant.mrp_ex_gst),
            money(variant.price_ex_gst) ??
              (money(variant.price) != null ? round2(money(variant.price)! / (1 + gstPercentage / 100)) : null),
            variant.stock_status || 'In Stock',
            variant.mpn || null,
            variant.gtin || null,
            variant.pricing_type || 'unit',
            variant.unit || null,
            floatOrNull(variant.numeric_value),
            intOrNull(variant.weight_grams),
            variant.package_type || null,
            floatOrNull(variant.length_cm),
            floatOrNull(variant.breadth_cm),
            floatOrNull(variant.height_cm),
            variant.sub_variant_type || null,
            variant.variant_type || null,
            money(variant.discount_pct) ?? 0,
            variant.asin || null,
            variant.isbn || null,
            normalizeSubscriptionPrice(variant.subscription_price),
            JSON.stringify(normalizeSubscriptionPrices(variant.subscription_prices)),
          ]
        )
      }
    })
  } catch (err: any) {
    console.error('[product-create] createProduct failed for', productId, 'intent=', intent, err)
    await cleanupS3()
    return { error: productErrorMessage(err, 'Failed to create product. Please try again.') }
  }

  const { syncProductToSheet } = await import('@/lib/shared/google-sheets')
  syncProductToSheet(productId).catch(e => console.error('[product-create] sheet sync failed for', productId, e))
  const { syncProductToMerchant } = await import('@/lib/merchant/sync')
  syncProductToMerchant(productId).catch(e => console.error('[product-create] merchant sync failed for', productId, e))
  const { syncProductToAmazon } = await import('@/lib/amazon/sync')
  syncProductToAmazon(productId).catch(e => console.error('[product-create] amazon sync failed for', productId, e))

  return done()
}
