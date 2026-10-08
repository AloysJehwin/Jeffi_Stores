'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { publishProductDraft, openOrdersForProduct } from '@/lib/catalog/product-draft'
import { generateProductSku, generateVariantSku } from '@/lib/catalog/sku'
import { productsWriteError } from '@/lib/catalog/product-action-auth'
import {
  DRAFT_NAME_PLACEHOLDER,
  duplicateSkuError,
  gstError,
  parseJsonField,
  priceErrors,
  productErrorMessage,
  roundMoneyFields,
  publishShippingError,
  skuConflictError,
  toAmount,
  txDb,
  uniqueProductSlug,
  variantSkuCollisionError,
} from '@/lib/catalog/product-validation'
import { round2 } from '@/lib/catalog/gst'
import { normalizeDigitalProduct } from '@/lib/catalog/digital-units'
import { normalizeSubscriptionPrice, normalizeSubscriptionPrices } from '@/lib/subscriptions/sellable'
import { cycleLimitsError, normalizeCycleCount } from '@/lib/subscriptions/intervals'
import {
  applyDraftSubVariantPrices,
  applyLiveSubVariantPrices,
  parseSubVariantPriceEntries,
} from '@/lib/subscriptions/sub-variant-prices'
import { getAdminSession } from '@/lib/auth/admin-auth'

// Background AI enrichment after a save. Gated on catalog_enrichment:write, which the session
// holds only when the admin's role AND the tenant's plan include it, so a plan without AI never
// runs it. The descriptor is resolved here, inside the request, before the detached job starts.
async function triggerEnrichment(productId: string) {
  const session = await getAdminSession()
  const { hasScope } = await import('@/lib/auth/scopes')
  if (!session || !hasScope(session.role, session.scopes, 'catalog_enrichment:write')) return
  const { aiChat } = await import('@/lib/shared/ai-client')
  const { storeDescriptorForPrompt } = await import('@/lib/catalog/brand')
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  const cacheNamespace = (await resolveTenantId()) ?? 'platform'
  const SYSTEM_PROMPT = `You write product intelligence data for ${await storeDescriptorForPrompt()}.
Given a product name, category, brand, and description, produce ALL of the following fields:
1. ai_description: A clear 1-2 sentence customer-facing description. No marketing fluff.
2. ai_use_cases: 4-10 short buyer search-intent phrases describing what it is used for. Lowercase, 1-4 words.
3. ai_keywords: 5-12 synonyms and alternate names buyers use. Lowercase.
4. ai_who_uses_it: Short phrase on who buys this.
5. ai_application: One sentence on where/how it is used.
6. ai_product_type: Normalized product type in 1-3 words.
7. ai_features: 3-8 key features or specs as short phrases.
8. ai_search_tags: 5-15 broader semantic search tags.
Rules: Only use facts from input. Stay within this store's product category; do not assume an industry the input does not show. All arrays lowercase, no duplicates. Strict JSON only.
Schema: {"ai_description":"...","ai_use_cases":["..."],"ai_keywords":["..."],"ai_who_uses_it":"...","ai_application":"...","ai_product_type":"...","ai_features":["..."],"ai_search_tags":["..."]}`

  ;(async () => {
    try {
      const product = await queryOne<{
        name: string
        description: string | null
        sku: string | null
        category_name: string | null
        brand_name: string | null
        material: string | null
        size: string | null
      }>(
        `SELECT p.name, p.description, p.sku, p.material, p.size,
                c.name AS category_name, b.name AS brand_name
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.id = $1::uuid`,
        [productId]
      )
      if (!product) return

      const userPrompt = [
        `Name: ${product.name}`,
        product.category_name ? `Category: ${product.category_name}` : null,
        product.brand_name ? `Brand: ${product.brand_name}` : null,
        product.sku ? `SKU: ${product.sku}` : null,
        product.description ? `Existing description: ${product.description}` : 'Existing description: (empty)',
        product.material ? `Material: ${product.material}` : null,
        product.size ? `Size: ${product.size}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      const r = await aiChat({
        cacheNamespace,
        modelHint: 'copy',
        jsonMode: true,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      })
      const raw = r.content
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(raw)
      } catch {
        const m = raw.match(/\{[\s\S]*\}/)
        if (!m) return
        obj = JSON.parse(m[0])
      }
      const desc = String(obj.ai_description || '').trim()
      const cleanArr = (v: unknown, max = 40, n = 15) =>
        !Array.isArray(v)
          ? []
          : [
              ...new Set((v as unknown[]).map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= max)),
            ].slice(0, n)
      const use_cases = cleanArr(obj.ai_use_cases, 50, 12)
      if (!desc || desc.length < 20 || use_cases.length < 2) return

      await query(
        `INSERT INTO product_ai_enrichment_log
           (product_id, source_name, source_desc,
            ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
            ai_application, ai_product_type, ai_features, ai_search_tags,
            model, status)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed')`,
        [
          productId,
          product.name,
          product.description || null,
          desc,
          use_cases,
          cleanArr(obj.ai_keywords, 50, 15),
          String(obj.ai_who_uses_it || '')
            .trim()
            .slice(0, 300),
          String(obj.ai_application || '')
            .trim()
            .slice(0, 500),
          String(obj.ai_product_type || '')
            .trim()
            .slice(0, 100),
          cleanArr(obj.ai_features, 100, 10),
          cleanArr(obj.ai_search_tags, 50, 20),
          r.model,
        ]
      )
    } catch {
      void 0
    }
  })()
}

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

type ProductActionResult = { error?: string; details?: string[]; ok?: true; redirectTo?: string } | void

export async function updateProduct(productId: string, formData: FormData): Promise<ProductActionResult> {
  const denied = await productsWriteError()
  if (denied) return { error: denied }

  const intent = formData.get('intent') as string | null
  const isPublish = intent === 'publish'
  const noRedirect = formData.get('_no_redirect') === '1'
  const rawName = ((formData.get('name') as string) || '').trim()
  const name = rawName || DRAFT_NAME_PLACEHOLDER
  const description = formData.get('description') as string
  const categoryId = ((formData.get('category_id') as string) || '').trim() || null
  const brandId = ((formData.get('brand_id') as string) || '').trim() || null
  const isDigitalProduct = formData.get('is_digital') === 'true'
  const hasVariants = formData.get('has_variants') === 'true' && !isDigitalProduct
  const variantType = (formData.get('variant_type') as string) || null
  const subVariantType = (formData.get('sub_variant_type') as string) || null
  const basePrice = hasVariants ? 0 : (money(formData.get('base_price')) ?? 0)
  const mrp = money(formData.get('mrp'))
  const mrpExGst = money(formData.get('mrp_ex_gst'))
  const salePrice = money(formData.get('price_ex_gst'))
  const costPrice = money(formData.get('cost_price')) ?? 0
  const supplierId = ((formData.get('supplier_id') as string) || '').trim() || null
  const discountPct = money(formData.get('discount_pct')) ?? 0
  const gstRaw = (formData.get('gst_percentage') as string) || '18'
  const gstPercentage = parseFloat(gstRaw)
  const hsnCode = (formData.get('hsn_code') as string) || null
  const mpn = (formData.get('mpn') as string) || null
  const gtin = (formData.get('gtin') as string) || null
  // Digital stock is never tracked: always In Stock.
  const stockStatus =
    hasVariants || isDigitalProduct ? 'In Stock' : (formData.get('stock_status') as string) || 'In Stock'
  const weight = floatOrNull(formData.get('weight'))
  const dimensions = (formData.get('dimensions') as string) || null
  const weightGrams = intOrNull(formData.get('weight_grams'))
  const packageType = (formData.get('package_type') as string) || null
  const lengthCm = floatOrNull(formData.get('length_cm'))
  const breadthCm = floatOrNull(formData.get('breadth_cm'))
  const heightCm = floatOrNull(formData.get('height_cm'))
  // Publish always activates; any draft save keeps the product off the storefront.
  const isActive = isPublish
  const isFeatured = formData.get('is_featured') === 'true'

  // Multi-supplier: product-level supplier price list. The preferred row's supplier
  // is denormalized onto products.supplier_id (legacy field) on publish.
  let productSuppliers: any[]
  let rawVariants: any[] | null
  let uploadedImages: any[]
  let existingImagesToKeep: any[]
  let galleryImageRefs: { id: string; isPrimary: boolean }[]
  let imageOrder: string[]
  let specifications: unknown
  let bsEntriesFromForm: unknown
  try {
    productSuppliers = parseJsonField(formData.get('product_suppliers_json'), 'suppliers', [])
    const variantsRaw = formData.get('variants_json')
    rawVariants = variantsRaw ? parseJsonField<any[]>(variantsRaw, 'variants', []) : null
    uploadedImages = parseJsonField(formData.get('uploaded_images'), 'uploaded images', [])
    existingImagesToKeep = parseJsonField(formData.get('existing_images_to_keep'), 'images to keep', [])
    galleryImageRefs = parseJsonField(formData.get('gallery_image_ids'), 'gallery images', [])
    imageOrder = parseJsonField(formData.get('image_order'), 'image order', [])
    specifications = parseJsonField(formData.get('specifications'), 'specifications', null)
    // Bootstrap "assign existing stock" capture: optional, never blocks a save.
    try {
      bsEntriesFromForm = parseJsonField(formData.get('bs_entries_json'), 'stock assignment', undefined)
    } catch {
      bsEntriesFromForm = undefined
    }
  } catch (e: any) {
    console.error('[product-edit] malformed form data for', productId, e)
    return { error: e.message }
  }
  const preferredSupplierId = productSuppliers.find((s: any) => s?.is_preferred)?.supplier_id || supplierId || null
  const activeVariants = (Array.isArray(rawVariants) ? rawVariants : []).filter(v => v && !v._isDeleted)

  // Drafts accept partial data; publish needs the full product.
  const errors: string[] = []
  if (isPublish) {
    if (!rawName || rawName === DRAFT_NAME_PLACEHOLDER) errors.push('Product name is required.')
    if (!categoryId) errors.push('Category is required.')
    if (hasVariants && rawVariants && activeVariants.length === 0)
      errors.push('Add at least one variant, or turn off variants.')
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
  if (hasVariants) {
    for (const v of activeVariants) {
      if (!String(v.variant_name ?? '').trim()) {
        if (isPublish) errors.push('Every variant needs a name.')
        continue
      }
      // A variant with sub-variants is priced per sub-variant.
      const subsOn = v.sub_variant_type_on === true || v.sub_variant_type_on === 'true'
      errors.push(
        ...priceErrors(
          `Variant "${v.variant_name}"`,
          { price: v.price, mrp: v.mrp, priceExGst: v.price_ex_gst, mrpExGst: v.mrp_ex_gst, cost: v.cost_price },
          { requirePrice: isPublish && !subsOn }
        )
      )
    }
  }
  if (errors.length > 0) return { error: errors[0], details: [...new Set(errors)] }

  // Server-side weight & packaging validation — enforced on publish only (shared with the
  // form and the publish route). Skipped for digital.
  if (isPublish && !isDigitalProduct) {
    const subsOn = (v: any) => v?.sub_variant_type_on === true || v?.sub_variant_type_on === 'true'
    let draftSubs: any[] = []
    let liveSubs: any[] = []
    if (hasVariants && activeVariants.some(subsOn)) {
      const draftSubRow = await queryOne<{ sub_variants: any[] | null }>(
        'SELECT sub_variants FROM product_drafts WHERE product_id = $1',
        [productId]
      )
      draftSubs = Array.isArray(draftSubRow?.sub_variants) ? draftSubRow!.sub_variants : []
      liveSubs = await queryMany<any>(
        'SELECT variant_id, sub_variant_name, weight_grams, length_cm, breadth_cm, height_cm, package_type FROM product_sub_variants WHERE product_id = $1 AND is_active = true',
        [productId]
      )
    }
    const shipErr = publishShippingError({
      isDigital: false,
      hasVariants,
      product: {
        weight_grams: weightGrams,
        package_type: packageType,
        length_cm: lengthCm,
        breadth_cm: breadthCm,
        height_cm: heightCm,
      },
      variants: activeVariants.map(v => {
        const label = v?.variant_name || v?.sku || ''
        if (!subsOn(v)) return { ...v, label }
        const staged = draftSubs.filter(sv => sv?.variant_id === v?.id)
        const effective =
          staged.length > 0
            ? staged.filter(sv => !sv._cleared && sv.sub_variant_name)
            : liveSubs.filter(sv => sv.variant_id === v?.id)
        return { ...v, label, subVariants: effective.map(sv => ({ ...sv, label: sv.sub_variant_name })) }
      }),
    })
    if (shipErr) return { error: shipErr }

    // Block publish while open (pending/confirmed) orders reference this product —
    // publishing could remove variants / rename SKUs and break their committed stock.
    const blockingOrders = await openOrdersForProduct(productId)
    if (blockingOrders.length > 0) {
      return {
        error: `Cannot publish: ${blockingOrders.length} open order(s) (${blockingOrders.join(', ')}) are pending/confirmed. Move them past 'confirmed' or cancel them before publishing.`,
      }
    }
  }

  const skuFromForm = ((formData.get('sku') as string) || '').trim().toUpperCase() || null

  // Extra fields collected for draft fields JSONB (mirrors all SET clauses below)
  const extraDeliveryDays = intOrNull(formData.get('extra_delivery_days')) ?? 0
  const barcode = (formData.get('barcode') as string) || null
  const isbn = (formData.get('isbn') as string) || null
  const asin = (formData.get('asin') as string) || null
  const brandPartNumber = (formData.get('brand_part_number') as string) || null
  const countryOfOrigin = ((formData.get('country_of_origin') as string) || '').slice(0, 2).toUpperCase() || null
  const shelfLifeDays = intOrNull(formData.get('shelf_life_days'))
  const grade = (formData.get('grade') as string) || null
  const color = (formData.get('color') as string) || null
  const colorHex = (formData.get('color_hex') as string) || null
  const volumeMl = floatOrNull(formData.get('volume_ml'))
  const netWeightGrams = intOrNull(formData.get('net_weight_grams'))
  const fragile = formData.get('fragile') === 'true'
  const hazardous = formData.get('hazardous') === 'true'
  const flammable = formData.get('flammable') === 'true'
  const perishable = !isDigitalProduct && formData.get('perishable') === 'true'
  const serialized = !isDigitalProduct && formData.get('serialized') === 'true'
  const certifications = (formData.get('certifications') as string)
    ? (formData.get('certifications') as string)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null
  const complianceStandard = (formData.get('compliance_standard') as string) || null
  const safetyRating = (formData.get('safety_rating') as string) || null
  const warrantyMonths = intOrNull(formData.get('warranty_months'))
  const warrantyType = (formData.get('warranty_type') as string) || null
  const condition = (formData.get('condition') as string) || 'new'
  const isCodAllowed = formData.get('is_cod_allowed') !== 'false'
  const launchDate = (formData.get('launch_date') as string) || null
  const discontinueDate = (formData.get('discontinue_date') as string) || null
  const sortOrderVal = intOrNull(formData.get('sort_order')) ?? 0
  const handlingDays = intOrNull(formData.get('handling_days')) ?? 1
  const shippingClass = (formData.get('shipping_class') as string) || 'standard'
  const isOversized = formData.get('is_oversized') === 'true'
  const isDigital = formData.get('is_digital') === 'true'
  const licenseType = (formData.get('license_type') as string) || null
  const fileFormat = (formData.get('file_format') as string) || null
  const platformCompatibility = (formData.get('platform_compatibility') as string)
    ? (formData.get('platform_compatibility') as string)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null
  const isSubscription = formData.get('is_subscription') === 'true'
  const subscriptionIntervals = (formData.get('subscription_intervals') as string)
    ? (formData.get('subscription_intervals') as string)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []
  const subscriptionInterval = subscriptionIntervals[0] ?? null
  const subscriptionPrice = hasVariants ? null : normalizeSubscriptionPrice(formData.get('subscription_price'))
  const subscriptionPrices = hasVariants ? {} : normalizeSubscriptionPrices(formData.get('subscription_prices'))
  const subVariantPrices = hasVariants
    ? parseSubVariantPriceEntries(formData.get('sub_variant_subscription_prices'))
    : []
  const subscriptionTotalCycles = normalizeCycleCount(formData.get('subscription_total_cycles'))
  const subscriptionMinCycles = normalizeCycleCount(formData.get('subscription_min_cycles'))
  const cyclesError = isSubscription ? cycleLimitsError(subscriptionTotalCycles, subscriptionMinCycles) : null
  if (cyclesError) return { error: cyclesError }
  const isBundle = formData.get('is_bundle') === 'true'
  const metaTitle = (formData.get('meta_title') as string) || null
  const metaDescription = (formData.get('meta_description') as string) || null
  const isSearchable = formData.get('is_searchable') !== 'false'
  const inventorySync = !isDigitalProduct && formData.get('inventory_sync') === 'true'
  const lowStockThreshold = floatOrNull(formData.get('low_stock_threshold'))
  const taxClass = (formData.get('tax_class') as string) || 'standard'
  const inclusiveTax = formData.get('inclusive_tax') === 'true'
  const ageMin = intOrNull(formData.get('age_min'))
  const ageMax = intOrNull(formData.get('age_max'))
  const targetGender = (formData.get('target_gender') as string) || null
  const targetAudience = (formData.get('target_audience') as string)
    ? (formData.get('target_audience') as string)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null

  const host = await getHost()
  const back = formData.get('_back') as string | null
  const listDest = back && back.startsWith('/admin/products') ? back : '/admin/products'
  const stayDest = () => {
    const popupVariantId = formData.get('popup_variant_id') as string | null
    return popupVariantId
      ? `/admin/products/edit/${productId}?popup=${encodeURIComponent(popupVariantId)}`
      : `/admin/products/edit/${productId}`
  }
  const finish = (dest: string): ProductActionResult => {
    const url = ap(dest, host)
    if (noRedirect) return { ok: true, redirectTo: url }
    redirect(url)
  }

  // Gallery copies made by this attempt; removed again if the save fails.
  const copiedS3: { key: string; thumb: string }[] = []
  const removeS3 = async (keys: { key: string; thumb: string }[], why: string) => {
    if (keys.length === 0) return
    const { deleteProductImage } = await import('@/lib/shared/s3')
    for (const k of keys) {
      await deleteProductImage(k.key, k.thumb).catch(e =>
        console.error('[product-edit]', why, 'S3 delete failed for', productId, k.key, e)
      )
    }
  }

  try {
    const draftRow = await queryOne<{ product_id: string; fields: Record<string, unknown> }>(
      `SELECT product_id, fields FROM product_drafts WHERE product_id = $1`,
      [productId]
    )
    const hasDraft = !!draftRow
    const live = await queryOne<{ sku: string | null; is_draft: boolean }>(
      'SELECT sku, is_draft FROM products WHERE id = $1',
      [productId]
    )
    if (!live) return { error: 'This product no longer exists. It may have been deleted in another tab.' }
    // A live product is only ever edited through a draft. No draft here means it was published or
    // discarded elsewhere; a draft save must not write straight to the live row.
    if (!hasDraft && !live.is_draft && !isPublish) {
      return {
        error:
          'This product is live and has no pending draft (it may have been published or discarded in another tab). Reload the page before saving.',
      }
    }

    // Empty SKU keeps the current one; a product never has a NULL SKU.
    let productSku = skuFromForm || live.sku || ''
    if (!productSku) {
      productSku = await generateProductSku(categoryId).catch(() => `PRD-${Date.now().toString(36).toUpperCase()}`)
    }
    const slug = await uniqueProductSlug({ query }, name, productId)

    if (hasDraft) {
      const draftVariants = rawVariants
        ? activeVariants.map((v: any) => ({
            ...roundMoneyFields(v),
            sku:
              String(v.sku || '').trim() ||
              (String(v.variant_name ?? '').trim() ? generateVariantSku(productSku, String(v.variant_name)) : ''),
            subscription_price: normalizeSubscriptionPrice(v.subscription_price),
            subscription_prices: normalizeSubscriptionPrices(v.subscription_prices),
          }))
        : null
      if (draftVariants) {
        const dup = duplicateSkuError(
          draftVariants.filter(v => v.sku).map(v => ({ label: String(v.variant_name || v.sku), sku: v.sku }))
        )
        if (dup) return { error: dup }
      }
      const conflict = await skuConflictError(
        { query },
        {
          productSku,
          variantSkus: (draftVariants || []).map(v => v.sku).filter(Boolean),
          productId,
        }
      )
      if (conflict) return { error: conflict }

      const draftFields = {
        name,
        slug,
        description,
        category_id: categoryId,
        brand_id: brandId,
        base_price: basePrice,
        mrp,
        mrp_ex_gst: mrpExGst,
        price_ex_gst: salePrice,
        gst_percentage: gstPercentage,
        hsn_code: hsnCode,
        stock_status: stockStatus,
        weight,
        dimensions,
        is_active: isActive,
        is_featured: isFeatured,
        has_variants: hasVariants,
        variant_type: variantType,
        sub_variant_type: subVariantType,
        weight_grams: weightGrams,
        package_type: packageType,
        length_cm: lengthCm,
        breadth_cm: breadthCm,
        height_cm: heightCm,
        cost_price: costPrice,
        discount_pct: discountPct,
        supplier_id: preferredSupplierId,
        product_suppliers: productSuppliers,
        sku: productSku,
        mpn: hasVariants ? null : mpn,
        gtin: hasVariants ? null : gtin,
        extra_delivery_days: extraDeliveryDays,
        barcode,
        isbn,
        asin,
        brand_part_number: brandPartNumber,
        country_of_origin: countryOfOrigin,
        shelf_life_days: shelfLifeDays,
        grade,
        specifications,
        color,
        color_hex: colorHex,
        volume_ml: volumeMl,
        net_weight_grams: netWeightGrams,
        fragile,
        hazardous,
        flammable,
        perishable,
        serialized,
        certifications,
        compliance_standard: complianceStandard,
        safety_rating: safetyRating,
        warranty_months: warrantyMonths,
        warranty_type: warrantyType,
        condition,
        is_cod_allowed: isCodAllowed,
        launch_date: launchDate,
        discontinue_date: discontinueDate,
        sort_order: sortOrderVal,
        handling_days: handlingDays,
        shipping_class: shippingClass,
        is_oversized: isOversized,
        is_digital: isDigital,
        license_type: licenseType,
        file_format: fileFormat,
        platform_compatibility: platformCompatibility,
        is_subscription: isSubscription,
        subscription_intervals: subscriptionIntervals,
        subscription_interval: subscriptionInterval,
        subscription_price: subscriptionPrice,
        subscription_prices: subscriptionPrices,
        subscription_total_cycles: subscriptionTotalCycles,
        subscription_min_cycles: subscriptionMinCycles,
        is_bundle: isBundle,
        meta_title: metaTitle,
        meta_description: metaDescription,
        is_searchable: isSearchable,
        tax_class: taxClass,
        inclusive_tax: inclusiveTax,
        age_min: ageMin,
        age_max: ageMax,
        target_gender: targetGender,
        target_audience: targetAudience,
        inventory_sync: inventorySync,
        low_stock_threshold: lowStockThreshold,
        // Preserve the bootstrap capture across explicit saves. Fall back to the
        // existing draft value when the form didn't send one (so we never wipe it).
        _bsEntries: bsEntriesFromForm ?? (draftRow as any)?.fields?._bsEntries ?? undefined,
      }

      await query(
        `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units, updated_at)
         VALUES (
           $1, $2::jsonb,
           COALESCE($3::jsonb, (SELECT variants FROM product_drafts WHERE product_id = $1)),
           COALESCE((SELECT json_agg(to_jsonb(i) - 'id' ORDER BY i.display_order) FROM product_images i WHERE i.product_id = $1)::jsonb, '[]'::jsonb),
           COALESCE((SELECT sub_variants FROM product_drafts WHERE product_id = $1), '[]'::jsonb),
           COALESCE((SELECT units FROM product_drafts WHERE product_id = $1), (SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = $1)::jsonb, '[]'::jsonb),
           NOW()
         )
         ON CONFLICT (product_id) DO UPDATE SET
           fields = EXCLUDED.fields,
           variants = COALESCE(EXCLUDED.variants, product_drafts.variants),
           images = product_drafts.images,
           sub_variants = product_drafts.sub_variants,
           units = product_drafts.units,
           updated_at = NOW()`,
        [productId, JSON.stringify(draftFields), draftVariants ? JSON.stringify(draftVariants) : null]
      )
      await applyDraftSubVariantPrices(productId, subVariantPrices)
      revalidatePath(`/admin/products/edit/${productId}`)

      // Publish: draft fields just saved — call publishProductDraft directly (no HTTP roundtrip)
      if (isPublish) {
        try {
          await publishProductDraft(productId, { activate: true })
        } catch (err: any) {
          console.error('[product-edit] publishProductDraft failed for', productId, err)
          return { error: `Draft saved, but publishing failed: ${productErrorMessage(err, 'unknown error')}` }
        }
        revalidatePath('/admin/products')
        revalidatePath(`/admin/products/${productId}`)
        return finish(`/admin/products/${productId}`)
      }
      return finish(intent === 'draft-stay' ? stayDest() : listDest)
    }

    // No edit-draft: a create-draft (is_draft = true) edited in place, or a stale live form publishing.
    const persistedNames = activeVariants
      .filter(v => String(v.variant_name ?? '').trim())
      .map(v => String(v.variant_name))
    if (hasVariants) {
      const collision = variantSkuCollisionError(persistedNames, n => generateVariantSku(productSku, n))
      if (collision) return { error: collision }
    }
    const conflict = await skuConflictError(
      { query },
      {
        productSku,
        variantSkus: hasVariants ? persistedNames.map(n => generateVariantSku(productSku, n)) : [],
        productId,
      }
    )
    if (conflict) return { error: conflict }

    // S3 work stays outside the transaction: gallery copies happen first, deletes after commit.
    const copiedGallery = new Map<string, any>()
    if (galleryImageRefs.length > 0) {
      const { copyGalleryImageToProduct } = await import('@/lib/shared/s3')
      const galleryImages = await queryMany(`SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`, [
        galleryImageRefs.map(r => r.id),
      ])
      for (const gimg of galleryImages || []) {
        try {
          const copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, productId)
          copiedGallery.set(gimg.id, { ...copied, gimg })
          copiedS3.push({ key: copied.s3Key, thumb: copied.s3ThumbnailKey || '' })
        } catch (e) {
          // Gallery source missing — skip rather than store a gallery/ path or abort.
          console.error('[product-edit] gallery copy failed for', productId, gimg.id, e)
        }
      }
    }
    const s3Deletes: { key: string; thumb: string }[] = []

    await withTransaction(async client => {
      const { query, queryOne, queryMany } = txDb(client)
      const setClauses: string[] = [
        'name = $1',
        'slug = $2',
        'description = $3',
        'category_id = $4',
        'brand_id = $5',
        'base_price = $6',
        'mrp = $7',
        'mrp_ex_gst = $8',
        'price_ex_gst = $9',
        'gst_percentage = $10',
        'hsn_code = $11',
        'stock_status = $12',
        'weight = $13',
        'dimensions = $14',
        'is_active = $15',
        'is_featured = $16',
        'has_variants = $17',
        'variant_type = $18',
        'sub_variant_type = $19',
        'weight_grams = $20',
        'package_type = $21',
        'length_cm = $22',
        'breadth_cm = $23',
        'height_cm = $24',
        'cost_price = $25',
        'discount_pct = $26',
        'updated_at = $27',
      ]
      const params: any[] = [
        name,
        slug,
        description,
        categoryId,
        brandId || null,
        basePrice,
        mrp,
        mrpExGst,
        salePrice,
        gstPercentage,
        hsnCode,
        stockStatus,
        weight,
        dimensions,
        isActive,
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
        new Date().toISOString(),
      ]
      setClauses.push(`supplier_id = $${params.length + 1}`)
      params.push(preferredSupplierId)
      setClauses.push(`sku = $${params.length + 1}`)
      params.push(productSku)
      if (!hasVariants) {
        setClauses.push(`mpn = $${params.length + 1}`, `gtin = $${params.length + 2}`)
        params.push(mpn, gtin)
      }
      setClauses.push(`extra_delivery_days = $${params.length + 1}`)
      params.push(extraDeliveryDays)
      setClauses.push(
        `barcode = $${params.length + 1}`,
        `isbn = $${params.length + 2}`,
        `asin = $${params.length + 3}`,
        `brand_part_number = $${params.length + 4}`,
        `country_of_origin = $${params.length + 5}`,
        `shelf_life_days = $${params.length + 6}`
      )
      params.push(barcode, isbn, asin, brandPartNumber, countryOfOrigin, shelfLifeDays)
      setClauses.push(`grade = $${params.length + 1}`, `specifications = $${params.length + 2}`)
      params.push(grade, specifications)
      setClauses.push(
        `color = $${params.length + 1}`,
        `color_hex = $${params.length + 2}`,
        `volume_ml = $${params.length + 3}`,
        `net_weight_grams = $${params.length + 4}`,
        `fragile = $${params.length + 5}`,
        `hazardous = $${params.length + 6}`,
        `flammable = $${params.length + 7}`,
        `perishable = $${params.length + 8}`,
        `serialized = $${params.length + 9}`
      )
      params.push(color, colorHex, volumeMl, netWeightGrams, fragile, hazardous, flammable, perishable, serialized)
      setClauses.push(
        `certifications = $${params.length + 1}`,
        `compliance_standard = $${params.length + 2}`,
        `safety_rating = $${params.length + 3}`,
        `warranty_months = $${params.length + 4}`,
        `warranty_type = $${params.length + 5}`
      )
      params.push(certifications, complianceStandard, safetyRating, warrantyMonths, warrantyType)
      setClauses.push(
        `condition = $${params.length + 1}`,
        `is_cod_allowed = $${params.length + 2}`,
        `launch_date = $${params.length + 3}`,
        `discontinue_date = $${params.length + 4}`,
        `sort_order = $${params.length + 5}`
      )
      params.push(condition, isCodAllowed, launchDate, discontinueDate, sortOrderVal)
      setClauses.push(
        `handling_days = $${params.length + 1}`,
        `shipping_class = $${params.length + 2}`,
        `is_oversized = $${params.length + 3}`
      )
      params.push(handlingDays, shippingClass, isOversized)
      setClauses.push(
        `is_digital = $${params.length + 1}`,
        `license_type = $${params.length + 2}`,
        `file_format = $${params.length + 3}`,
        `platform_compatibility = $${params.length + 4}`
      )
      params.push(isDigital, licenseType, fileFormat, platformCompatibility)
      setClauses.push(
        `is_subscription = $${params.length + 1}`,
        `subscription_intervals = $${params.length + 2}`,
        `subscription_interval = $${params.length + 3}`,
        `subscription_price = $${params.length + 4}`,
        `subscription_total_cycles = $${params.length + 5}`,
        `subscription_min_cycles = $${params.length + 6}`,
        `subscription_prices = $${params.length + 7}::jsonb`
      )
      params.push(
        isSubscription,
        subscriptionIntervals,
        subscriptionInterval,
        subscriptionPrice,
        subscriptionTotalCycles,
        subscriptionMinCycles,
        JSON.stringify(subscriptionPrices)
      )
      setClauses.push(`is_bundle = $${params.length + 1}`)
      params.push(isBundle)
      setClauses.push(
        `meta_title = $${params.length + 1}`,
        `meta_description = $${params.length + 2}`,
        `is_searchable = $${params.length + 3}`
      )
      params.push(metaTitle, metaDescription, isSearchable)
      setClauses.push(`tax_class = $${params.length + 1}`, `inclusive_tax = $${params.length + 2}`)
      params.push(taxClass, inclusiveTax)
      setClauses.push(
        `age_min = $${params.length + 1}`,
        `age_max = $${params.length + 2}`,
        `target_gender = $${params.length + 3}`,
        `target_audience = $${params.length + 4}`
      )
      params.push(ageMin, ageMax, targetGender, targetAudience)

      // Create-draft edited in place: Publish clears is_draft (and is_active = true above); a draft
      // save keeps it a draft and inactive.
      setClauses.push(`is_draft = $${params.length + 1}`)
      params.push(!isPublish)

      params.push(productId)
      const prevRow = await queryOne<{ perishable: boolean; serialized: boolean }>(
        'SELECT perishable, serialized FROM products WHERE id = $1',
        [productId]
      )
      await query(`UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params)
      // If perishable was toggled OFF, roll up remaining batch qty into inventory_quantity then clean up batches
      if (prevRow?.perishable && !perishable) {
        // Capture per-grain batch totals BEFORE deleting.
        const batchSum = await queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(quantity_remaining), 0)::text AS total FROM product_batches WHERE product_id = $1`,
          [productId]
        )
        const converted = parseFloat(batchSum?.total ?? '0') || 0
        const variantBatch = await queryMany<{ variant_id: string | null; total: string }>(
          `SELECT variant_id, COALESCE(SUM(quantity_remaining),0)::text AS total FROM product_batches
         WHERE product_id = $1 AND variant_id IS NOT NULL GROUP BY variant_id`,
          [productId]
        )
        const subVariantBatch = await queryMany<{ sub_variant_id: string | null; total: string }>(
          `SELECT sub_variant_id, COALESCE(SUM(quantity_remaining),0)::text AS total FROM product_batches
         WHERE product_id = $1 AND sub_variant_id IS NOT NULL GROUP BY sub_variant_id`,
          [productId]
        )

        await query('DELETE FROM product_batches WHERE product_id = $1', [productId])

        // Write converted stock back at the correct grain.
        const hasVariantsRow = await queryOne<{ has_variants: boolean }>(
          'SELECT has_variants FROM products WHERE id = $1',
          [productId]
        )
        if (hasVariantsRow?.has_variants && (variantBatch.length || subVariantBatch.length)) {
          for (const sv of subVariantBatch) {
            await query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [
              parseFloat(sv.total) || 0,
              sv.sub_variant_id,
            ])
          }
          for (const v of variantBatch) {
            await query(
              `UPDATE product_variants pv SET inventory_quantity = CASE
               WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
               THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
               ELSE $1 END
             WHERE pv.id = $2`,
              [parseFloat(v.total) || 0, v.variant_id]
            )
          }
          await query(
            `UPDATE products SET inventory_quantity = COALESCE(
             (SELECT SUM(inventory_quantity) FROM product_variants WHERE product_id = $1 AND is_active = true), 0)
           WHERE id = $1`,
            [productId]
          )
        } else {
          await query('UPDATE products SET inventory_quantity = $1 WHERE id = $2', [converted, productId])
        }

        // Keep shelf_stock rows — update total quantity across locations to match converted qty
        const shelfRows = await queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM shelf_stock WHERE product_id = $1`,
          [productId]
        )
        const shelfCount = parseInt(shelfRows?.cnt ?? '0') || 0
        if (shelfCount === 1) {
          await query(`UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE product_id = $2`, [
            converted,
            productId,
          ])
        } else if (shelfCount > 1) {
          // Distribute proportionally; zero out if converted is 0
          await query(
            `UPDATE shelf_stock SET quantity = CASE WHEN $1::numeric = 0 THEN 0
             ELSE ROUND(quantity / NULLIF((SELECT SUM(quantity) FROM shelf_stock WHERE product_id = $2), 0) * $1::numeric, 4)
           END, updated_at = now() WHERE product_id = $2`,
            [converted, productId]
          )
        }
      }
      // If serialized was toggled OFF, count in-stock serials → set as inventory_quantity, clean up serials + batches + shelf_stock
      if (prevRow?.serialized && !serialized) {
        // Capture per-grain counts BEFORE deleting the serials (order matters:
        // deleting first would leave nothing to count and strand the stock).
        const serialCount = await queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`,
          [productId]
        )
        const converted = parseInt(serialCount?.total ?? '0') || 0
        const variantCounts = await queryMany<{ variant_id: string | null; cnt: string }>(
          `SELECT variant_id, COUNT(*)::text AS cnt FROM product_serials
         WHERE product_id = $1 AND status = 'in_stock' AND variant_id IS NOT NULL
         GROUP BY variant_id`,
          [productId]
        )
        const subVariantCounts = await queryMany<{ sub_variant_id: string | null; cnt: string }>(
          `SELECT sub_variant_id, COUNT(*)::text AS cnt FROM product_serials
         WHERE product_id = $1 AND status = 'in_stock' AND sub_variant_id IS NOT NULL
         GROUP BY sub_variant_id`,
          [productId]
        )

        await query(`DELETE FROM product_serials WHERE product_id = $1`, [productId])
        // Only delete batches if NOT still perishable (perishable cleanup above handles that case)
        if (!perishable) {
          await query('DELETE FROM product_batches WHERE product_id = $1', [productId])
          // Keep shelf_stock — update qty to match converted count
          const shelfRows = await queryOne<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM shelf_stock WHERE product_id = $1`,
            [productId]
          )
          const shelfCount = parseInt(shelfRows?.cnt ?? '0') || 0
          if (shelfCount === 1) {
            await query(`UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE product_id = $2`, [
              converted,
              productId,
            ])
          } else if (shelfCount > 1) {
            await query(
              `UPDATE shelf_stock SET quantity = CASE WHEN $1::numeric = 0 THEN 0
               ELSE ROUND(quantity / NULLIF((SELECT SUM(quantity) FROM shelf_stock WHERE product_id = $2), 0) * $1::numeric, 4)
             END, updated_at = now() WHERE product_id = $2`,
              [converted, productId]
            )
          }
        }

        // Write the converted stock back at the CORRECT grain so it shows in inventory.
        const hasVariantsRow = await queryOne<{ has_variants: boolean }>(
          'SELECT has_variants FROM products WHERE id = $1',
          [productId]
        )
        if (hasVariantsRow?.has_variants && (variantCounts.length || subVariantCounts.length)) {
          // Sub-variant-tracked stock
          for (const sv of subVariantCounts) {
            await query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [
              parseFloat(sv.cnt) || 0,
              sv.sub_variant_id,
            ])
          }
          // Variant-tracked stock (only for variants without sub-variants; those roll up separately)
          for (const v of variantCounts) {
            await query(
              `UPDATE product_variants pv SET inventory_quantity = CASE
               WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
               THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
               ELSE $1 END
             WHERE pv.id = $2`,
              [parseFloat(v.cnt) || 0, v.variant_id]
            )
          }
          // Product-level rollup = sum of variants
          await query(
            `UPDATE products SET inventory_quantity = COALESCE(
             (SELECT SUM(inventory_quantity) FROM product_variants WHERE product_id = $1 AND is_active = true), 0)
           WHERE id = $1`,
            [productId]
          )
        } else {
          // Simple product — serials were product-level
          await query(`UPDATE products SET inventory_quantity = $1 WHERE id = $2`, [converted, productId])
        }
      }

      // Runs after the tracking toggle-OFF cleanup above so nothing re-adds stock.
      if (isDigital) await normalizeDigitalProduct({ query }, productId)

      if (uploadedImages.length > 0 || existingImagesToKeep.length > 0 || galleryImageRefs.length > 0) {
        const allExistingImages = await queryMany('SELECT * FROM product_images WHERE product_id = $1', [productId])

        const existingIdsToKeep = new Set(existingImagesToKeep.map((img: any) => img.id))
        const imagesToDelete = (allExistingImages || []).filter(img => !existingIdsToKeep.has(img.id))

        for (const img of imagesToDelete) {
          await query('DELETE FROM product_images WHERE id = $1', [img.id])
          if (img.s3_key) s3Deletes.push({ key: img.s3_key, thumb: img.s3_thumbnail_key || '' })
        }

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
              999,
              false,
            ]
          )
          if (inserted) newFileIds[i] = inserted.id
        }

        const newGalleryIds: Record<string, string> = {}
        for (const [gid, copied] of copiedGallery) {
          const gimg = copied.gimg
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
            product_id, image_url, thumbnail_url, s3_bucket, s3_key,
            s3_thumbnail_key, file_name, file_size, mime_type, width,
            height, display_order, is_primary
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 999, false) RETURNING id`,
            [
              productId,
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
            ]
          )
          if (inserted) newGalleryIds[gid] = inserted.id
        }

        const applyOrder = async (keys: string[]) => {
          const primaryKey =
            keys.find(k => {
              if (k.startsWith('existing:')) {
                const id = k.slice(9)
                return existingImagesToKeep.find((img: any) => img.id === id)?.is_primary
              }
              if (k.startsWith('gallery:')) {
                const gid = k.slice(8)
                return galleryImageRefs.find(r => r.id === gid)?.isPrimary
              }
              return false
            }) || keys[0]

          await query('UPDATE product_images SET is_primary = false WHERE product_id = $1', [productId])

          for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            const isPrimary = key === primaryKey
            if (key.startsWith('existing:')) {
              const id = key.slice(9)
              await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
                i,
                isPrimary,
                id,
              ])
            } else if (key.startsWith('gallery:')) {
              const gid = key.slice(8)
              const pid = newGalleryIds[gid]
              if (pid)
                await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
                  i,
                  isPrimary,
                  pid,
                ])
            } else if (key.startsWith('file:')) {
              const fi = parseInt(key.slice(5))
              const pid = newFileIds[fi]
              if (pid)
                await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
                  i,
                  isPrimary,
                  pid,
                ])
            }
          }
        }

        if (imageOrder.length > 0) {
          await applyOrder(imageOrder)
        } else {
          await query('UPDATE product_images SET is_primary = false WHERE product_id = $1', [productId])
          for (let i = 0; i < existingImagesToKeep.length; i++) {
            const img = existingImagesToKeep[i]
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
              i,
              img.is_primary || false,
              img.id,
            ])
          }
          let offset = existingImagesToKeep.length
          for (const [fi, pid] of Object.entries(newFileIds)) {
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
              offset,
              offset === 0,
              pid,
            ])
            offset++
          }
          for (const [, pid] of Object.entries(newGalleryIds)) {
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [
              offset,
              offset === 0,
              pid,
            ])
            offset++
          }
        }
      }

      if (hasVariants) {
        if (rawVariants) {
          const variants = rawVariants

          for (const variant of variants) {
            const isPersisted = variant.id && !String(variant.id).startsWith('temp-')
            if (variant._isDeleted && isPersisted) {
              await query('DELETE FROM product_variants WHERE id = $1 AND product_id = $2', [variant.id, productId])
            } else if (isPersisted && !variant._isDeleted) {
              if (!String(variant.variant_name ?? '').trim()) continue
              const variantSku = generateVariantSku(productSku, variant.variant_name)
              await query(
                `UPDATE product_variants SET sku = $1, variant_name = $2, price = $3, mrp = $4, mrp_ex_gst = $5, price_ex_gst = $6, stock_status = $7, mpn = $8, gtin = $9, pricing_type = $10, unit = $11, numeric_value = $12, weight_grams = $13, package_type = $14, length_cm = $15, breadth_cm = $16, height_cm = $17, sub_variant_type = $18, variant_type = $19, discount_pct = $20,
                 asin = $21::text,
                 asin_match = CASE
                   WHEN $21::text IS NULL THEN NULL
                   WHEN asin_match IN ('gtin','listed') AND asin IS NOT DISTINCT FROM $21::text THEN asin_match
                   ELSE 'manual' END,
                 isbn = $22,
                 subscription_price = $25,
                 subscription_prices = $26::jsonb
               WHERE id = $23 AND product_id = $24`,
                [
                  variantSku,
                  variant.variant_name,
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
                  variant.id,
                  productId,
                  normalizeSubscriptionPrice(variant.subscription_price),
                  JSON.stringify(normalizeSubscriptionPrices(variant.subscription_prices)),
                ]
              )
              const subVariants = await queryMany<{ id: string; sub_variant_name: string }>(
                'SELECT id, sub_variant_name FROM product_sub_variants WHERE variant_id = $1',
                [variant.id]
              )
              for (const sv of subVariants || []) {
                if (!sv.sub_variant_name) continue
                const newSubSku = generateVariantSku(variantSku, sv.sub_variant_name)
                await query('UPDATE product_sub_variants SET sku = $1, discount_pct = $2 WHERE id = $3', [
                  newSubSku,
                  discountPct,
                  sv.id,
                ])
              }
            } else if (!isPersisted && !variant._isDeleted) {
              if (!variant.variant_name) continue
              const variantSku = generateVariantSku(productSku, variant.variant_name)
              await query(
                `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, stock_status, mpn, gtin, pricing_type, unit, numeric_value, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, discount_pct, asin, asin_match, isbn, is_active, subscription_price, subscription_prices)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::text, CASE WHEN $22::text IS NOT NULL THEN 'manual' ELSE NULL END, $23, true, $24, $25::jsonb)`,
                [
                  productId,
                  variantSku,
                  variant.variant_name,
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
          }
        }
      } else {
        await query('DELETE FROM product_variants WHERE product_id = $1', [productId])
      }
    })
    copiedS3.length = 0 // committed: the copies are referenced now
    await removeS3(s3Deletes, 'removed-image')
    if (hasVariants && subVariantPrices.length > 0) {
      try {
        await applyLiveSubVariantPrices(productId, subVariantPrices)
      } catch (err: any) {
        console.error('[product-edit] sub-variant subscription prices failed for', productId, err)
        return {
          error: `Product saved, but sub-variant subscription prices failed: ${productErrorMessage(err, 'unknown error')}`,
        }
      }
    }

    const { syncProductToSheet } = await import('@/lib/shared/google-sheets')
    syncProductToSheet(productId).catch(e => console.error('[product-edit] sheet sync failed for', productId, e))
    const { syncProductToMerchant } = await import('@/lib/merchant/sync')
    syncProductToMerchant(productId).catch(e => console.error('[product-edit] merchant sync failed for', productId, e))
    const { syncProductToAmazon } = await import('@/lib/amazon/sync')
    syncProductToAmazon(productId).catch(e => console.error('[product-edit] amazon sync failed for', productId, e))
    await triggerEnrichment(productId).catch(e => console.error('[product-edit] enrichment failed for', productId, e))

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/edit/${productId}`)
    return finish(intent === 'draft-stay' ? stayDest() : listDest)
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[product-edit] updateProduct failed for', productId, 'intent=', intent, err)
    await removeS3(copiedS3, 'rollback')
    return { error: productErrorMessage(err, 'Failed to update product. Please try again.') }
  }
}
