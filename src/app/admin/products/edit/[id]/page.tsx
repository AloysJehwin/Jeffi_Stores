import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import { publishProductDraft } from '@/lib/product-draft'
import { generateVariantSku } from '@/lib/sku'
import ProductForm from '@/components/admin/ProductForm'
import { ChevronLeft } from 'lucide-react'
import { round2 } from '@/lib/gst'

function triggerEnrichment(productId: string) {
  const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
  const OLLAMA_MODEL = process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'
  const SYSTEM_PROMPT = `You write product intelligence data for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Given a product name, category, brand, and description, produce ALL of the following fields:
1. ai_description: A clear 1-2 sentence customer-facing description. No marketing fluff.
2. ai_use_cases: 4-10 short buyer search-intent phrases (e.g. "hang picture frame"). Lowercase, 1-4 words.
3. ai_keywords: 5-12 synonyms and alternate names buyers use. Lowercase.
4. ai_who_uses_it: Short phrase on who buys this (e.g. "electricians, contractors, DIY homeowners").
5. ai_application: One sentence on where/how it is used.
6. ai_product_type: Normalized product type in 1-3 words (e.g. "Wall Anchor").
7. ai_features: 3-8 key features or specs as short phrases.
8. ai_search_tags: 5-15 broader semantic search tags.
Rules: Only use facts from input. All arrays lowercase, no duplicates. Strict JSON only.
Schema: {"ai_description":"...","ai_use_cases":["..."],"ai_keywords":["..."],"ai_who_uses_it":"...","ai_application":"...","ai_product_type":"...","ai_features":["..."],"ai_search_tags":["..."]}`

  ;(async () => {
    try {
      const product = await queryOne<{
        name: string; description: string | null; sku: string | null
        category_name: string | null; brand_name: string | null
        material: string | null; size: string | null
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
      ].filter(Boolean).join('\n')

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL, stream: false, format: 'json',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          options: { temperature: 0.3 } }) })
      if (!res.ok) return
      const data = await res.json() as { message?: { content?: string } }
      const raw = data.message?.content || ''
      let obj: Record<string, unknown>
      try { obj = JSON.parse(raw) } catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) return; obj = JSON.parse(m[0]) }
      const desc = String(obj.ai_description || '').trim()
      const cleanArr = (v: unknown, max = 40, n = 15) => !Array.isArray(v) ? [] :
        [...new Set((v as unknown[]).map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= max))].slice(0, n)
      const use_cases = cleanArr(obj.ai_use_cases, 50, 12)
      if (!desc || desc.length < 20 || use_cases.length < 2) return

      await query(
        `INSERT INTO product_ai_enrichment_log
           (product_id, source_name, source_desc,
            ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
            ai_application, ai_product_type, ai_features, ai_search_tags,
            model, status)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed')`,
        [productId, product.name, product.description || null,
         desc, use_cases, cleanArr(obj.ai_keywords, 50, 15),
         String(obj.ai_who_uses_it || '').trim().slice(0, 300),
         String(obj.ai_application || '').trim().slice(0, 500),
         String(obj.ai_product_type || '').trim().slice(0, 100),
         cleanArr(obj.ai_features, 100, 10), cleanArr(obj.ai_search_tags, 50, 20),
         OLLAMA_MODEL]
      )
    } catch {
      void 0
    }
  })()
}

async function updateProduct(productId: string, formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const categoryId = formData.get('category_id') as string
  const brandId = formData.get('brand_id') as string
  const hasVariants = formData.get('has_variants') === 'true'
  const variantType = formData.get('variant_type') as string || null
  const subVariantType = formData.get('sub_variant_type') as string || null
  const basePrice = hasVariants ? 0 : round2(parseFloat(formData.get('base_price') as string))
  const mrp = formData.get('mrp') ? round2(parseFloat(formData.get('mrp') as string)) : null
  const mrpExGst = formData.get('mrp_ex_gst') ? round2(parseFloat(formData.get('mrp_ex_gst') as string)) : null
  const salePrice = formData.get('price_ex_gst') ? round2(parseFloat(formData.get('price_ex_gst') as string)) : null
  const costPrice = formData.get('cost_price') ? round2(parseFloat(formData.get('cost_price') as string)) : 0
  const supplierId = (formData.get('supplier_id') as string || '').trim() || null
  // Multi-supplier: product-level supplier price list. The preferred row's supplier
  // is denormalized onto products.supplier_id (legacy field) on publish.
  const productSuppliersRaw = formData.get('product_suppliers_json') as string | null
  let productSuppliers: any[] = []
  try { productSuppliers = productSuppliersRaw ? JSON.parse(productSuppliersRaw) : [] } catch { productSuppliers = [] }
  const preferredSupplierId =
    productSuppliers.find((s: any) => s.is_preferred)?.supplier_id || supplierId || null
  const discountPct = formData.get('discount_pct') ? parseFloat(parseFloat(formData.get('discount_pct') as string).toFixed(2)) : 0
  const gstPercentage = parseFloat(formData.get('gst_percentage') as string || '18')
  const hsnCode = formData.get('hsn_code') as string || null
  const mpn = formData.get('mpn') as string || null
  const gtin = formData.get('gtin') as string || null
  const stockStatus = hasVariants ? 'In Stock' : formData.get('stock_status') as string
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const dimensions = formData.get('dimensions') as string || null
  const weightGrams = formData.get('weight_grams') ? parseInt(formData.get('weight_grams') as string) : null
  const packageType = formData.get('package_type') as string || null
  const lengthCm = formData.get('length_cm') ? parseFloat(formData.get('length_cm') as string) : null
  const breadthCm = formData.get('breadth_cm') ? parseFloat(formData.get('breadth_cm') as string) : null
  const heightCm = formData.get('height_cm') ? parseFloat(formData.get('height_cm') as string) : null
  const intent = formData.get('intent') as string | null
  const isActive = (intent === 'draft' || intent === 'draft-stay') ? false : (formData.get('is_active') === 'true')
  const isFeatured = formData.get('is_featured') === 'true'

  // Server-side weight & packaging validation — enforced on publish only, so a
  // partial draft can still be saved. Mirrors the client checks in ProductForm so
  // a direct/programmatic submit can't slip a null/zero weight or missing box dims
  // past the UI. See src/lib/shipping.ts STORED_DIMS_REQUIRED.
  if (intent === 'publish') {
    const STORED_DIMS_TYPES = ['drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube']
    const errors: string[] = []
    if (!hasVariants) {
      if (weightGrams == null || !(weightGrams > 0)) {
        errors.push('Shipping weight is required and must be greater than 0.')
      }
      if (packageType && STORED_DIMS_TYPES.includes(packageType) && (lengthCm == null || breadthCm == null || heightCm == null)) {
        errors.push('Dimensions required for this package type')
      }
    } else {
      const variantsJsonRaw = formData.get('variants_json') as string | null
      let parsedVariants: any[] = []
      try { parsedVariants = variantsJsonRaw ? JSON.parse(variantsJsonRaw) : [] } catch { parsedVariants = [] }
      for (const v of parsedVariants) {
        if (v?._isDeleted) continue
        const w = v?.weight_grams != null && v.weight_grams !== '' ? parseFloat(v.weight_grams) : null
        if (w == null || !(w > 0)) {
          errors.push(`Shipping weight is required for variant "${v?.variant_name || v?.sku || ''}" and must be greater than 0.`)
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
      throw new Error(errors[0])
    }
  }
  const imageCount = parseInt(formData.get('image_count') as string || '0')
  const existingImagesToKeepJson = formData.get('existing_images_to_keep') as string
  const existingImagesToKeep = existingImagesToKeepJson ? JSON.parse(existingImagesToKeepJson) : []
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson ? JSON.parse(galleryImageIdsJson) : []
  const imageOrderJson = formData.get('image_order') as string
  const imageOrder: string[] = imageOrderJson ? JSON.parse(imageOrderJson) : []

  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const slug = baseSlug

  const rawSku = (formData.get('sku') as string || '').trim().toUpperCase()
  const skuFromForm = rawSku || null

  // Extra fields collected for draft fields JSONB (mirrors all SET clauses below)
  const extraDeliveryDays = parseInt(formData.get('extra_delivery_days') as string || '0') || 0
  const barcode = (formData.get('barcode') as string) || null
  const isbn = (formData.get('isbn') as string) || null
  const asin = (formData.get('asin') as string) || null
  const brandPartNumber = (formData.get('brand_part_number') as string) || null
  const countryOfOrigin = ((formData.get('country_of_origin') as string) || '').slice(0, 2).toUpperCase() || null
  const shelfLifeDays = formData.get('shelf_life_days') ? parseInt(formData.get('shelf_life_days') as string) : null
  const grade = (formData.get('grade') as string) || null
  const specificationsRaw = (formData.get('specifications') as string) || null
  const specifications = specificationsRaw ? JSON.parse(specificationsRaw) : null
  const color = (formData.get('color') as string) || null
  const colorHex = (formData.get('color_hex') as string) || null
  const volumeMl = formData.get('volume_ml') ? parseFloat(formData.get('volume_ml') as string) : null
  const netWeightGrams = formData.get('net_weight_grams') ? parseInt(formData.get('net_weight_grams') as string) : null
  const fragile = formData.get('fragile') === 'true'
  const hazardous = formData.get('hazardous') === 'true'
  const flammable = formData.get('flammable') === 'true'
  const perishable = formData.get('perishable') === 'true'
  const serialized = formData.get('serialized') === 'true'
  const certifications = (formData.get('certifications') as string) ? (formData.get('certifications') as string).split(',').map(s => s.trim()).filter(Boolean) : null
  const complianceStandard = (formData.get('compliance_standard') as string) || null
  const safetyRating = (formData.get('safety_rating') as string) || null
  const warrantyMonths = formData.get('warranty_months') ? parseInt(formData.get('warranty_months') as string) : null
  const warrantyType = (formData.get('warranty_type') as string) || null
  const condition = (formData.get('condition') as string) || 'new'
  const isCodAllowed = formData.get('is_cod_allowed') !== 'false'
  const launchDate = (formData.get('launch_date') as string) || null
  const discontinueDate = (formData.get('discontinue_date') as string) || null
  const sortOrderVal = formData.get('sort_order') ? parseInt(formData.get('sort_order') as string) : 0
  const handlingDays = formData.get('handling_days') ? parseInt(formData.get('handling_days') as string) : 1
  const shippingClass = (formData.get('shipping_class') as string) || 'standard'
  const isOversized = formData.get('is_oversized') === 'true'
  const isDigital = formData.get('is_digital') === 'true'
  const downloadUrl = (formData.get('download_url') as string) || null
  const licenseType = (formData.get('license_type') as string) || null
  const fileFormat = (formData.get('file_format') as string) || null
  const platformCompatibility = (formData.get('platform_compatibility') as string) ? (formData.get('platform_compatibility') as string).split(',').map(s => s.trim()).filter(Boolean) : null
  const isSubscription = formData.get('is_subscription') === 'true'
  const subscriptionInterval = (formData.get('subscription_interval') as string) || null
  const subscriptionPrice = formData.get('subscription_price') ? round2(parseFloat(formData.get('subscription_price') as string)) : null
  const isBundle = formData.get('is_bundle') === 'true'
  const metaTitle = (formData.get('meta_title') as string) || null
  const metaDescription = (formData.get('meta_description') as string) || null
  const isSearchable = formData.get('is_searchable') !== 'false'
  const inventorySync = formData.get('inventory_sync') === 'true'
  const lowStockThreshold = formData.get('low_stock_threshold') ? parseFloat(formData.get('low_stock_threshold') as string) : null
  const taxClass = (formData.get('tax_class') as string) || 'standard'
  const inclusiveTax = formData.get('inclusive_tax') === 'true'
  const ageMin = formData.get('age_min') ? parseInt(formData.get('age_min') as string) : null
  const ageMax = formData.get('age_max') ? parseInt(formData.get('age_max') as string) : null
  const targetGender = (formData.get('target_gender') as string) || null
  const targetAudience = (formData.get('target_audience') as string) ? (formData.get('target_audience') as string).split(',').map(s => s.trim()).filter(Boolean) : null

  try {
    // Check if a product_drafts row exists for this product
    const draftRow = await queryOne<{ product_id: string; fields: Record<string, unknown> }>(
      `SELECT product_id, fields FROM product_drafts WHERE product_id = $1`,
      [productId]
    )
    const hasDraft = !!draftRow

    // If draft exists: save form fields to product_drafts.fields first
    if (hasDraft) {
      // Bootstrap "assign existing stock" capture (per-grain lot/expiry/serials).
      // The form emits it as a hidden JSON field; carry it through so an explicit
      // Save-as-Draft/Publish through this action does not wipe what autosave stored.
      let bsEntriesFromForm: unknown = undefined
      const bsEntriesRaw = formData.get('bs_entries_json') as string | null
      if (bsEntriesRaw) { try { bsEntriesFromForm = JSON.parse(bsEntriesRaw) } catch { /* ignore malformed */ } }
      const draftFields = {
        name, slug, description, category_id: categoryId,
        brand_id: brandId || null, base_price: basePrice, mrp, mrp_ex_gst: mrpExGst,
        price_ex_gst: salePrice, gst_percentage: gstPercentage, hsn_code: hsnCode,
        stock_status: stockStatus, weight, dimensions, is_active: isActive,
        is_featured: isFeatured, has_variants: hasVariants, variant_type: variantType,
        sub_variant_type: subVariantType, weight_grams: weightGrams, package_type: packageType,
        length_cm: lengthCm, breadth_cm: breadthCm, height_cm: heightCm,
        cost_price: costPrice, discount_pct: discountPct, supplier_id: preferredSupplierId,
        product_suppliers: productSuppliers,
        sku: skuFromForm,
        mpn: hasVariants ? null : mpn, gtin: hasVariants ? null : gtin,
        extra_delivery_days: extraDeliveryDays,
        barcode, isbn, asin, brand_part_number: brandPartNumber,
        country_of_origin: countryOfOrigin, shelf_life_days: shelfLifeDays,
        grade, specifications, color, color_hex: colorHex, volume_ml: volumeMl,
        net_weight_grams: netWeightGrams, fragile, hazardous, flammable, perishable, serialized,
        certifications, compliance_standard: complianceStandard, safety_rating: safetyRating,
        warranty_months: warrantyMonths, warranty_type: warrantyType,
        condition, is_cod_allowed: isCodAllowed, launch_date: launchDate,
        discontinue_date: discontinueDate, sort_order: sortOrderVal,
        handling_days: handlingDays, shipping_class: shippingClass, is_oversized: isOversized,
        is_digital: isDigital, download_url: downloadUrl, license_type: licenseType,
        file_format: fileFormat, platform_compatibility: platformCompatibility,
        is_subscription: isSubscription, subscription_interval: subscriptionInterval,
        subscription_price: subscriptionPrice, is_bundle: isBundle,
        meta_title: metaTitle, meta_description: metaDescription, is_searchable: isSearchable,
        tax_class: taxClass, inclusive_tax: inclusiveTax,
        age_min: ageMin, age_max: ageMax, target_gender: targetGender, target_audience: targetAudience,
        inventory_sync: inventorySync, low_stock_threshold: lowStockThreshold,
        // Preserve the bootstrap capture across explicit saves. Fall back to the
        // existing draft value when the form didn't send one (so we never wipe it).
        _bsEntries: bsEntriesFromForm ?? (draftRow as any)?.fields?._bsEntries ?? undefined,
      }
      // Snapshot variants from form and images/sub_variants/units from live DB
      const variantsJsonRaw = formData.get('variants_json') as string | null
      const draftVariants = variantsJsonRaw ? JSON.parse(variantsJsonRaw).filter((v: any) => !v._isDeleted) : null

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
           images = EXCLUDED.images,
           sub_variants = product_drafts.sub_variants,
           units = product_drafts.units,
           updated_at = NOW()`,
        [productId, JSON.stringify(draftFields), draftVariants ? JSON.stringify(draftVariants) : null]
      )
      revalidatePath(`/admin/products/edit/${productId}`)
      const host = await getHost()

      // Publish: draft fields just saved — call publishProductDraft directly (no HTTP roundtrip)
      if (intent === 'publish') {
        await publishProductDraft(productId)
        revalidatePath('/admin/products')
        revalidatePath(`/admin/products/${productId}`)
        redirect(ap(`/admin/products/${productId}`, host))
      }

      if (intent === 'draft-stay') {
        const popupVariantId = formData.get('popup_variant_id') as string | null
        const dest = popupVariantId
          ? `/admin/products/edit/${productId}?popup=${encodeURIComponent(popupVariantId)}`
          : `/admin/products/edit/${productId}`
        redirect(ap(dest, host))
      }
      const back = formData.get('_back') as string | null
      redirect(ap(back && back.startsWith('/admin/products') ? back : '/admin/products', host))
    }

    // No draft — live product direct edit path
    const setClauses: string[] = [
      'name = $1', 'slug = $2', 'description = $3', 'category_id = $4',
      'brand_id = $5', 'base_price = $6', 'mrp = $7', 'mrp_ex_gst = $8',
      'price_ex_gst = $9',
      'gst_percentage = $10', 'hsn_code = $11',
      'stock_status = $12', 'weight = $13',
      'dimensions = $14', 'is_active = $15', 'is_featured = $16', 'has_variants = $17', 'variant_type = $18',
      'sub_variant_type = $19',
      'weight_grams = $20', 'package_type = $21', 'length_cm = $22', 'breadth_cm = $23', 'height_cm = $24',
      'cost_price = $25', 'discount_pct = $26', 'updated_at = $27',
    ]
    const params: any[] = [
      name, slug, description, categoryId,
      brandId || null, basePrice, mrp, mrpExGst, salePrice,
      gstPercentage, hsnCode,
      stockStatus, weight,
      dimensions, isActive, isFeatured, hasVariants, variantType,
      subVariantType,
      weightGrams, packageType, lengthCm, breadthCm, heightCm,
      costPrice, discountPct,
      new Date().toISOString(),
    ]
    setClauses.push(`supplier_id = $${params.length + 1}`)
    params.push(preferredSupplierId)
    if (skuFromForm) {
      setClauses.push(`sku = $${params.length + 1}`)
      params.push(skuFromForm)
    }
    if (!hasVariants) {
      setClauses.push(`mpn = $${params.length + 1}`, `gtin = $${params.length + 2}`)
      params.push(mpn, gtin)
    }
    setClauses.push(`extra_delivery_days = $${params.length + 1}`)
    params.push(extraDeliveryDays)
    setClauses.push(`barcode = $${params.length + 1}`, `isbn = $${params.length + 2}`, `asin = $${params.length + 3}`, `brand_part_number = $${params.length + 4}`, `country_of_origin = $${params.length + 5}`, `shelf_life_days = $${params.length + 6}`)
    params.push(barcode, isbn, asin, brandPartNumber, countryOfOrigin, shelfLifeDays)
    setClauses.push(`grade = $${params.length + 1}`, `specifications = $${params.length + 2}`)
    params.push(grade, specifications)
    setClauses.push(`color = $${params.length + 1}`, `color_hex = $${params.length + 2}`, `volume_ml = $${params.length + 3}`, `net_weight_grams = $${params.length + 4}`, `fragile = $${params.length + 5}`, `hazardous = $${params.length + 6}`, `flammable = $${params.length + 7}`, `perishable = $${params.length + 8}`, `serialized = $${params.length + 9}`)
    params.push(color, colorHex, volumeMl, netWeightGrams, fragile, hazardous, flammable, perishable, serialized)
    setClauses.push(`certifications = $${params.length + 1}`, `compliance_standard = $${params.length + 2}`, `safety_rating = $${params.length + 3}`, `warranty_months = $${params.length + 4}`, `warranty_type = $${params.length + 5}`)
    params.push(certifications, complianceStandard, safetyRating, warrantyMonths, warrantyType)
    setClauses.push(`condition = $${params.length + 1}`, `is_cod_allowed = $${params.length + 2}`, `launch_date = $${params.length + 3}`, `discontinue_date = $${params.length + 4}`, `sort_order = $${params.length + 5}`)
    params.push(condition, isCodAllowed, launchDate, discontinueDate, sortOrderVal)
    setClauses.push(`handling_days = $${params.length + 1}`, `shipping_class = $${params.length + 2}`, `is_oversized = $${params.length + 3}`)
    params.push(handlingDays, shippingClass, isOversized)
    setClauses.push(`is_digital = $${params.length + 1}`, `download_url = $${params.length + 2}`, `license_type = $${params.length + 3}`, `file_format = $${params.length + 4}`, `platform_compatibility = $${params.length + 5}`)
    params.push(isDigital, downloadUrl, licenseType, fileFormat, platformCompatibility)
    setClauses.push(`is_subscription = $${params.length + 1}`, `subscription_interval = $${params.length + 2}`, `subscription_price = $${params.length + 3}`)
    params.push(isSubscription, subscriptionInterval, subscriptionPrice)
    setClauses.push(`is_bundle = $${params.length + 1}`)
    params.push(isBundle)
    setClauses.push(`meta_title = $${params.length + 1}`, `meta_description = $${params.length + 2}`, `is_searchable = $${params.length + 3}`)
    params.push(metaTitle, metaDescription, isSearchable)
    setClauses.push(`tax_class = $${params.length + 1}`, `inclusive_tax = $${params.length + 2}`)
    params.push(taxClass, inclusiveTax)
    setClauses.push(`age_min = $${params.length + 1}`, `age_max = $${params.length + 2}`, `target_gender = $${params.length + 3}`, `target_audience = $${params.length + 4}`)
    params.push(ageMin, ageMax, targetGender, targetAudience)

    params.push(productId)
    const prevRow = await queryOne<{ perishable: boolean; serialized: boolean }>('SELECT perishable, serialized FROM products WHERE id = $1', [productId])
    await query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params
    )
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
      const hasVariantsRow = await queryOne<{ has_variants: boolean }>('SELECT has_variants FROM products WHERE id = $1', [productId])
      if (hasVariantsRow?.has_variants && (variantBatch.length || subVariantBatch.length)) {
        for (const sv of subVariantBatch) {
          await query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [parseFloat(sv.total) || 0, sv.sub_variant_id])
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
        `SELECT COUNT(*)::text AS cnt FROM shelf_stock WHERE product_id = $1`, [productId]
      )
      const shelfCount = parseInt(shelfRows?.cnt ?? '0') || 0
      if (shelfCount === 1) {
        await query(`UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE product_id = $2`, [converted, productId])
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
          `SELECT COUNT(*)::text AS cnt FROM shelf_stock WHERE product_id = $1`, [productId]
        )
        const shelfCount = parseInt(shelfRows?.cnt ?? '0') || 0
        if (shelfCount === 1) {
          await query(`UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE product_id = $2`, [converted, productId])
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
      const hasVariantsRow = await queryOne<{ has_variants: boolean }>('SELECT has_variants FROM products WHERE id = $1', [productId])
      if (hasVariantsRow?.has_variants && (variantCounts.length || subVariantCounts.length)) {
        // Sub-variant-tracked stock
        for (const sv of subVariantCounts) {
          await query('UPDATE product_sub_variants SET inventory_quantity = $1 WHERE id = $2', [parseFloat(sv.cnt) || 0, sv.sub_variant_id])
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

    if (imageCount > 0 || existingImagesToKeep.length > 0 || galleryImageRefs.length > 0) {
      const allExistingImages = await queryMany(
        'SELECT * FROM product_images WHERE product_id = $1',
        [productId]
      )

      const existingIdsToKeep = new Set(existingImagesToKeep.map((img: any) => img.id))
      const imagesToDelete = (allExistingImages || []).filter(img => !existingIdsToKeep.has(img.id))

      if (imagesToDelete.length > 0) {
        const { DeleteObjectCommand, S3Client } = await import('@aws-sdk/client-s3')
        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } })
        for (const img of imagesToDelete) {
          if (img.s3_key) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket', Key: img.s3_key }))
          if (img.s3_thumbnail_key) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket', Key: img.s3_thumbnail_key }))
          await query('DELETE FROM product_images WHERE id = $1', [img.id])
        }
      }

      const newFileIds: Record<number, string> = {}
      if (imageCount > 0) {
        const { uploadProductImage } = await import('@/lib/s3')
        for (let i = 0; i < imageCount; i++) {
          const file = formData.get(`image_${i}`) as File
          if (file) {
            const uploadResult = await uploadProductImage(file, productId)
            const inserted = await queryOne<{ id: string }>(
              `INSERT INTO product_images (
                product_id, image_url, thumbnail_url, s3_bucket, s3_key,
                s3_thumbnail_key, file_name, file_size, mime_type, width,
                height, display_order, is_primary
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
              [
                productId, uploadResult.url, uploadResult.thumbnailUrl,
                process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
                uploadResult.s3Key, uploadResult.s3ThumbnailKey,
                uploadResult.fileName, uploadResult.fileSize, uploadResult.mimeType,
                uploadResult.width, uploadResult.height, 999, false,
              ]
            )
            if (inserted) newFileIds[i] = inserted.id
          }
        }
      }

      const newGalleryIds: Record<string, string> = {}
      if (galleryImageRefs.length > 0) {
        const { copyGalleryImageToProduct } = await import('@/lib/s3')
        const galleryImages = await queryMany(
          `SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`,
          [galleryImageRefs.map(r => r.id)]
        )
        for (const gimg of (galleryImages || [])) {
          let copied
          try {
            copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, productId)
          } catch (e) {
            // Gallery source missing — skip rather than store a gallery/ path or abort.
            continue
          }
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              productId, copied.url, copied.thumbnailUrl,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              copied.s3Key, copied.s3ThumbnailKey,
              gimg.custom_name || gimg.file_name, gimg.file_size, gimg.mime_type,
              gimg.width, gimg.height, 999, false,
            ]
          )
          if (inserted) newGalleryIds[gimg.id] = inserted.id
        }
      }

      const applyOrder = async (keys: string[]) => {
        const primaryKey = keys.find(k => {
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
            await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, isPrimary, id])
          } else if (key.startsWith('gallery:')) {
            const gid = key.slice(8)
            const pid = newGalleryIds[gid]
            if (pid) await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, isPrimary, pid])
          } else if (key.startsWith('file:')) {
            const fi = parseInt(key.slice(5))
            const pid = newFileIds[fi]
            if (pid) await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, isPrimary, pid])
          }
        }
      }

      if (imageOrder.length > 0) {
        await applyOrder(imageOrder)
      } else {
        await query('UPDATE product_images SET is_primary = false WHERE product_id = $1', [productId])
        for (let i = 0; i < existingImagesToKeep.length; i++) {
          const img = existingImagesToKeep[i]
          await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, img.is_primary || false, img.id])
        }
        let offset = existingImagesToKeep.length
        for (const [fi, pid] of Object.entries(newFileIds)) {
          await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [offset, offset === 0, pid])
          offset++
        }
        for (const [, pid] of Object.entries(newGalleryIds)) {
          await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [offset, offset === 0, pid])
          offset++
        }
      }
    }

    if (hasVariants) {
      const variantsJson = formData.get('variants_json') as string
      if (variantsJson) {
        const productData = await queryOne<{ sku: string }>('SELECT sku FROM products WHERE id = $1', [productId])
        const productSku = productData?.sku || 'PRD-000'
        const variants = JSON.parse(variantsJson)

        for (const variant of variants) {
          const isPersisted = variant.id && !String(variant.id).startsWith('temp-')
          if (variant._isDeleted && isPersisted) {
            await query('DELETE FROM product_variants WHERE id = $1 AND product_id = $2', [variant.id, productId])
          } else if (isPersisted && !variant._isDeleted) {
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `UPDATE product_variants SET sku = $1, variant_name = $2, price = $3, mrp = $4, mrp_ex_gst = $5, price_ex_gst = $6, stock_status = $7, mpn = $8, gtin = $9, pricing_type = $10, unit = $11, numeric_value = $12, weight_grams = $13, package_type = $14, length_cm = $15, breadth_cm = $16, height_cm = $17, sub_variant_type = $18, variant_type = $19, discount_pct = $20,
                 asin = $21,
                 asin_match = CASE
                   WHEN $21::text IS NULL THEN NULL
                   WHEN asin_match IN ('gtin','listed') AND asin IS NOT DISTINCT FROM $21::text THEN asin_match
                   ELSE 'manual' END,
                 isbn = $22
               WHERE id = $23 AND product_id = $24`,
              [
                variantSku, variant.variant_name,
                variant.price ? round2(parseFloat(variant.price)) : null,
                variant.mrp ? round2(parseFloat(variant.mrp)) : null,
                variant.mrp_ex_gst ? round2(parseFloat(variant.mrp_ex_gst)) : null,
                variant.price_ex_gst ? round2(parseFloat(variant.price_ex_gst))
                  : variant.price ? round2(parseFloat(variant.price) / (1 + gstPercentage / 100)) : null,
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
                variant.id, productId,
              ]
            )
            const subVariants = await queryMany<{ id: string; sub_variant_name: string }>(
              'SELECT id, sub_variant_name FROM product_sub_variants WHERE variant_id = $1',
              [variant.id]
            )
            for (const sv of (subVariants || [])) {
              if (!sv.sub_variant_name) continue
              const newSubSku = generateVariantSku(variantSku, sv.sub_variant_name)
              await query(
                'UPDATE product_sub_variants SET sku = $1, discount_pct = $2 WHERE id = $3',
                [newSubSku, discountPct, sv.id]
              )
            }
          } else if (!isPersisted && !variant._isDeleted) {
            if (!variant.variant_name) continue
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, stock_status, mpn, gtin, pricing_type, unit, numeric_value, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, discount_pct, asin, asin_match, isbn, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, CASE WHEN $22::text IS NOT NULL THEN 'manual' ELSE NULL END, $23, true)`,
              [
                productId, variantSku, variant.variant_name,
                variant.price ? round2(parseFloat(variant.price)) : null,
                variant.mrp ? round2(parseFloat(variant.mrp)) : null,
                variant.mrp_ex_gst ? round2(parseFloat(variant.mrp_ex_gst)) : null,
                variant.price_ex_gst ? round2(parseFloat(variant.price_ex_gst))
                  : variant.price ? round2(parseFloat(variant.price) / (1 + gstPercentage / 100)) : null,
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
    } else {
      await query('DELETE FROM product_variants WHERE product_id = $1', [productId])
    }

    const { syncProductToSheet } = await import('@/lib/google-sheets')
    syncProductToSheet(productId).catch(() => {})
    const { syncProductToMerchant } = await import('@/lib/merchant/sync')
    syncProductToMerchant(productId).catch(() => {})
    const { syncProductToAmazon } = await import('@/lib/amazon/sync')
    syncProductToAmazon(productId).catch(() => {})
    triggerEnrichment(productId)

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/edit/${productId}`)
    const host = await getHost()

    if (intent === 'draft-stay') {
      const popupVariantId = formData.get('popup_variant_id') as string | null
      const dest = popupVariantId
        ? `/admin/products/edit/${productId}?popup=${encodeURIComponent(popupVariantId)}`
        : `/admin/products/edit/${productId}`
      redirect(ap(dest, host))
    }
    const back = formData.get('_back') as string | null
    redirect(ap(back && back.startsWith('/admin/products') ? back : '/admin/products', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error(err?.message || 'Failed to update product')
  }
}

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const product = await getProduct(id).catch(() => null)

  if (!product) {
    notFound()
  }

  const categories = await getAllCategories()
  const brands = await getAllBrands()
  const backUrl = back && back.startsWith('/admin/products') ? back : '/admin/products'

  const batchSumRow = product.perishable
    ? await queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(quantity_remaining), 0)::text AS total FROM product_batches WHERE product_id = $1`,
        [id]
      )
    : null
  const perishableBatchTotal = parseFloat(batchSumRow?.total ?? '0') || 0

  const serialCountRow = product.serialized
    ? await queryOne<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`,
        [id]
      )
    : null
  const serializedStockTotal = serialCountRow?.total ?? 0

  const draftRow = await queryOne<{ product_id: string; fields: Record<string, unknown>; variants: Record<string, unknown>[] }>(
    `SELECT product_id, fields, variants FROM product_drafts WHERE product_id = $1`,
    [id]
  )
  const isDraft = !!draftRow

  // Editing ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // product with no draft (active or inactive) is blocked — redirect to the detail
  // page, where the Edit button creates a draft first. This guarantees the live
  // product is never mutated directly and every edit flows through the draft system.
  if (!isDraft) {
    const host = await getHost()
    redirect(ap(`/admin/products/${id}`, host))
  }

  // In draft mode, merge saved draft fields over the live product so the form
  // shows the admin's last saved changes (not the original live values).
  // Only use draft variants if they have both id and sku (autosaved from popup).
  const draftVariants = isDraft && Array.isArray(draftRow?.variants) &&
    draftRow!.variants.some((v: any) => v.sku && v.id)
    ? draftRow!.variants
    : null
  const productForForm = isDraft && draftRow?.fields
    ? { ...product, ...draftRow.fields, ...(draftVariants ? { product_variants: draftVariants } : {}) }
    : product

  // On-hand stock grains for the "assign existing stock" bootstrap. These MUST be
  // read from the LIVE product (getProduct), never from the draft merge above: the
  // draft's variant snapshot (autosaved from the form) has no inventory_quantity, so
  // deriving grains from productForForm would collapse every qty to 0 and hide the
  // bootstrap capture after the first autosave. Stock is intrinsic to the live
  // product and is not edited by the draft, so compute it here once.
  const liveStockGrains: { variant_id: string | null; sub_variant_id: string | null; label: string; qty: number }[] = []
  {
    const p: any = product
    if (p?.has_variants && Array.isArray(p?.product_variants)) {
      for (const v of p.product_variants) {
        const subs = Array.isArray(v?.sub_variants) ? v.sub_variants : []
        if (subs.length > 0) {
          for (const sv of subs) {
            const qty = parseFloat(sv?.inventory_quantity) || 0
            if (qty > 0) liveStockGrains.push({ variant_id: v.id, sub_variant_id: sv.id, label: `${v.variant_name} / ${sv.sub_variant_name}`, qty })
          }
        } else {
          const qty = parseFloat(v?.inventory_quantity) || 0
          if (qty > 0) liveStockGrains.push({ variant_id: v.id, sub_variant_id: null, label: v.variant_name, qty })
        }
      }
    } else {
      const qty = parseFloat(p?.inventory_quantity ?? '0') || 0
      if (qty > 0) liveStockGrains.push({ variant_id: null, sub_variant_id: null, label: 'Product', qty })
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap(backUrl, host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Products
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">{isDraft ? 'Edit Draft' : 'Edit Product'}</span>
      </div>

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Edits are saved to draft. The live product stays unchanged until you publish.
          </p>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">{isDraft ? 'Edit Draft' : 'Edit Product'}</h1>
        <p className="text-foreground-secondary mt-1">{isDraft ? 'Changes are saved to the draft only' : 'Update product information'}</p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        product={productForForm}
        productId={id}
        action={updateProduct.bind(null, id)}
        backUrl={backUrl}
        perishableBatchTotal={perishableBatchTotal}
        serializedStockTotal={serializedStockTotal}
        isDraft={isDraft}
        liveStockGrains={liveStockGrains}
        initialBsEntries={(draftRow?.fields as any)?._bsEntries ?? null}
      />
    </div>
  )
}
