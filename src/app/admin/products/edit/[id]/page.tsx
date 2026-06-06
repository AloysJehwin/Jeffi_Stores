import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import { generateVariantSku } from '@/lib/sku'
import ProductForm from '@/components/admin/ProductForm'
import { ChevronLeft } from 'lucide-react'

function triggerEnrichment(productId: string) {
  const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || 'http://100.110.153.68:11434').replace(/\/$/, '')
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL, stream: false, format: 'json',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          options: { temperature: 0.3 },
        }),
      })
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
  const basePrice = hasVariants ? 0 : Math.round(parseFloat(formData.get('base_price') as string) * 100) / 100
  const mrp = formData.get('mrp') ? Math.round(parseFloat(formData.get('mrp') as string) * 100) / 100 : null
  const mrpExGst = formData.get('mrp_ex_gst') ? Math.round(parseFloat(formData.get('mrp_ex_gst') as string) * 100) / 100 : null
  const salePrice = formData.get('price_ex_gst') ? Math.round(parseFloat(formData.get('price_ex_gst') as string) * 100) / 100 : null
  const wholesalePrice = formData.get('wholeprice_ex_gst') ? Math.round(parseFloat(formData.get('wholeprice_ex_gst') as string) * 100) / 100 : null
  const costPrice = formData.get('cost_price') ? Math.round(parseFloat(formData.get('cost_price') as string) * 100) / 100 : 0
  const gstPercentage = parseFloat(formData.get('gst_percentage') as string || '18')
  const hsnCode = formData.get('hsn_code') as string || null
  const mpn = formData.get('mpn') as string || null
  const gtin = formData.get('gtin') as string || null
  const stockQuantity = hasVariants ? 0 : parseInt(formData.get('stock_quantity') as string)
  const lowStockThreshold = hasVariants ? 0 : parseInt(formData.get('low_stock_threshold') as string)
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const dimensions = formData.get('dimensions') as string || null
  const weightGrams = formData.get('weight_grams') ? parseInt(formData.get('weight_grams') as string) : null
  const packageType = formData.get('package_type') as string || null
  const lengthCm = formData.get('length_cm') ? parseFloat(formData.get('length_cm') as string) : null
  const breadthCm = formData.get('breadth_cm') ? parseFloat(formData.get('breadth_cm') as string) : null
  const heightCm = formData.get('height_cm') ? parseFloat(formData.get('height_cm') as string) : null
  const intent = formData.get('intent') as string | null
  const isActive = intent === 'draft' ? false : (intent === 'publish' ? true : formData.get('is_active') === 'true')
  const isFeatured = formData.get('is_featured') === 'true'
  const weightRate = formData.get('weight_rate') ? Math.round(parseFloat(formData.get('weight_rate') as string) * 100) / 100 : null
  const weightUnit = formData.get('weight_unit') as string || null
  const lengthRate = formData.get('length_rate') ? Math.round(parseFloat(formData.get('length_rate') as string) * 100) / 100 : null
  const lengthUnit = formData.get('length_unit') as string || null
  const imageCount = parseInt(formData.get('image_count') as string || '0')
  const existingImagesToKeepJson = formData.get('existing_images_to_keep') as string
  const existingImagesToKeep = existingImagesToKeepJson ? JSON.parse(existingImagesToKeepJson) : []
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson ? JSON.parse(galleryImageIdsJson) : []
  const imageOrderJson = formData.get('image_order') as string
  const imageOrder: string[] = imageOrderJson ? JSON.parse(imageOrderJson) : []

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const skuFromForm = (formData.get('sku') as string || '').trim().toUpperCase() || null

  try {

    const setClauses: string[] = [
      'name = $1', 'slug = $2', 'description = $3', 'category_id = $4',
      'brand_id = $5', 'base_price = $6', 'mrp = $7', 'mrp_ex_gst = $8',
      'price_ex_gst = $9', 'wholeprice_ex_gst = $10',
      'gst_percentage = $11', 'hsn_code = $12',
      'stock_quantity = $13', 'low_stock_threshold = $14', 'weight = $15',
      'dimensions = $16', 'is_active = $17', 'is_featured = $18', 'has_variants = $19', 'variant_type = $20',
      'sub_variant_type = $21', 'weight_rate = $22', 'weight_unit = $23', 'length_rate = $24', 'length_unit = $25',
      'weight_grams = $26', 'package_type = $27', 'length_cm = $28', 'breadth_cm = $29', 'height_cm = $30',
      'cost_price = $31', 'updated_at = $32',
    ]
    const params: any[] = [
      name, slug, description, categoryId,
      brandId || null, basePrice, mrp, mrpExGst, salePrice, wholesalePrice,
      gstPercentage, hsnCode,
      stockQuantity, lowStockThreshold, weight,
      dimensions, isActive, isFeatured, hasVariants, variantType,
      subVariantType, weightRate, weightUnit, lengthRate, lengthUnit,
      weightGrams, packageType, lengthCm, breadthCm, heightCm,
      costPrice,
      new Date().toISOString(),
    ]
    if (skuFromForm) {
      setClauses.push(`sku = $${params.length + 1}`)
      params.push(skuFromForm)
    }
    if (!hasVariants) {
      setClauses.push(`mpn = $${params.length + 1}`, `gtin = $${params.length + 2}`)
      params.push(mpn, gtin)
    }
    params.push(productId)
    await query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params
    )

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
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          },
        })
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
          const copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, productId, gimg.image_url, gimg.thumbnail_url)
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
          const isWeightOrLength = variant.pricing_type === 'weight' || variant.pricing_type === 'length'
          const isPersisted = variant.id && !String(variant.id).startsWith('temp-')
          if (variant._isDeleted && isPersisted) {
            await query('DELETE FROM product_variants WHERE id = $1 AND product_id = $2', [variant.id, productId])
          } else if (isPersisted && !variant._isDeleted) {
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `UPDATE product_variants SET sku = $1, variant_name = $2, price = $3, mrp = $4, mrp_ex_gst = $5, price_ex_gst = $6, wholeprice_ex_gst = $7, stock_quantity = $8, mpn = $9, gtin = $10, pricing_type = $11, unit = $12, numeric_value = $13, weight_rate = $14, weight_unit = $15, length_rate = $16, length_unit = $17, weight_grams = $18, package_type = $19, length_cm = $20, breadth_cm = $21, height_cm = $22, sub_variant_type = $23, variant_type = $24
               WHERE id = $25 AND product_id = $26`,
              [
                variantSku, variant.variant_name,
                variant.price ? Math.round(parseFloat(variant.price) * 100) / 100 : null,
                variant.mrp ? Math.round(parseFloat(variant.mrp) * 100) / 100 : null,
                variant.mrp_ex_gst ? Math.round(parseFloat(variant.mrp_ex_gst) * 100) / 100 : null,
                variant.price_ex_gst ? Math.round(parseFloat(variant.price_ex_gst) * 100) / 100
                  : variant.price ? Math.round(parseFloat(variant.price) / (1 + gstPercentage / 100) * 100) / 100 : null,
                variant.wholeprice_ex_gst ? Math.round(parseFloat(variant.wholeprice_ex_gst) * 100) / 100 : null,
                parseInt(variant.stock_quantity) || 0,
                variant.mpn || null,
                variant.gtin || null,
                variant.pricing_type || 'unit',
                variant.unit || null,
                variant.numeric_value ? parseFloat(variant.numeric_value) : null,
                variant.weight_rate ? Math.round(parseFloat(variant.weight_rate) * 100) / 100 : null,
                variant.weight_rate ? (variant.weight_unit || null) : null,
                variant.length_rate ? Math.round(parseFloat(variant.length_rate) * 100) / 100 : null,
                variant.length_rate ? (variant.length_unit || null) : null,
                variant.weight_grams ? parseInt(variant.weight_grams) : null,
                variant.package_type || null,
                variant.length_cm ? parseFloat(variant.length_cm) : null,
                variant.breadth_cm ? parseFloat(variant.breadth_cm) : null,
                variant.height_cm ? parseFloat(variant.height_cm) : null,
                variant.sub_variant_type || null,
                variant.variant_type || null,
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
                'UPDATE product_sub_variants SET sku = $1 WHERE id = $2',
                [newSubSku, sv.id]
              )
            }
          } else if (!isPersisted && !variant._isDeleted) {
            if (isWeightOrLength && !variant.numeric_value) continue
            if (!isWeightOrLength && !variant.variant_name) continue
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, wholeprice_ex_gst, stock_quantity, mpn, gtin, pricing_type, unit, numeric_value, weight_rate, weight_unit, length_rate, length_unit, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, true)`,
              [
                productId, variantSku, variant.variant_name,
                variant.price ? Math.round(parseFloat(variant.price) * 100) / 100 : null,
                variant.mrp ? Math.round(parseFloat(variant.mrp) * 100) / 100 : null,
                variant.mrp_ex_gst ? Math.round(parseFloat(variant.mrp_ex_gst) * 100) / 100 : null,
                variant.price_ex_gst ? Math.round(parseFloat(variant.price_ex_gst) * 100) / 100
                  : variant.price ? Math.round(parseFloat(variant.price) / (1 + gstPercentage / 100) * 100) / 100 : null,
                variant.wholeprice_ex_gst ? Math.round(parseFloat(variant.wholeprice_ex_gst) * 100) / 100 : null,
                parseInt(variant.stock_quantity) || 0,
                variant.mpn || null,
                variant.gtin || null,
                variant.pricing_type || 'unit',
                variant.unit || null,
                variant.numeric_value ? parseFloat(variant.numeric_value) : null,
                variant.weight_rate ? Math.round(parseFloat(variant.weight_rate) * 100) / 100 : null,
                variant.weight_rate ? (variant.weight_unit || null) : null,
                variant.length_rate ? Math.round(parseFloat(variant.length_rate) * 100) / 100 : null,
                variant.length_rate ? (variant.length_unit || null) : null,
                variant.weight_grams ? parseInt(variant.weight_grams) : null,
                variant.package_type || null,
                variant.length_cm ? parseFloat(variant.length_cm) : null,
                variant.breadth_cm ? parseFloat(variant.breadth_cm) : null,
                variant.height_cm ? parseFloat(variant.height_cm) : null,
                variant.sub_variant_type || null,
                variant.variant_type || null,
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
    triggerEnrichment(productId)

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/edit/${productId}`)
    redirect('/admin/products')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error(err?.message || 'Failed to update product')
  }
}

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id).catch(() => null)

  if (!product) {
    notFound()
  }

  const categories = await getAllCategories()
  const brands = await getAllBrands()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href="/admin/products" className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Products
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Edit Product</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Edit Product</h1>
        <p className="text-foreground-secondary mt-1">Update product information</p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        product={product}
        productId={params.id}
        action={updateProduct.bind(null, params.id)}
      />
    </div>
  )
}
