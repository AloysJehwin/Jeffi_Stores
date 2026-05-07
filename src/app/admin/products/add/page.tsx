import { redirect } from 'next/navigation'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import { generateProductSku, generateVariantSku } from '@/lib/sku'
import ProductForm from '@/components/admin/ProductForm'

async function createProduct(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const categoryId = formData.get('category_id') as string
  const brandId = formData.get('brand_id') as string
  const hasVariants = formData.get('has_variants') === 'true'
  const variantType = formData.get('variant_type') as string || null
  const basePrice = hasVariants ? 0 : Math.round(parseFloat(formData.get('base_price') as string) * 100) / 100
  const mrp = formData.get('mrp') ? Math.round(parseFloat(formData.get('mrp') as string) * 100) / 100 : null
  const salePrice = formData.get('sale_price') ? Math.round(parseFloat(formData.get('sale_price') as string) * 100) / 100 : null
  const wholesalePrice = formData.get('wholesale_price') ? Math.round(parseFloat(formData.get('wholesale_price') as string) * 100) / 100 : null
  const gstPercentage = parseFloat(formData.get('gst_percentage') as string || '18')
  const hsnCode = formData.get('hsn_code') as string || null
  const mpn = formData.get('mpn') as string || null
  const gtin = formData.get('gtin') as string || null
  const stockQuantity = hasVariants ? 0 : parseInt(formData.get('stock_quantity') as string)
  const lowStockThreshold = hasVariants ? 0 : parseInt(formData.get('low_stock_threshold') as string)
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const dimensions = formData.get('dimensions') as string || null
  const weightGrams = formData.get('weight_grams') ? parseInt(formData.get('weight_grams') as string) : null
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
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson ? JSON.parse(galleryImageIdsJson) : []
  const imageOrderJson = formData.get('image_order') as string
  const imageOrder: string[] = imageOrderJson ? JSON.parse(imageOrderJson) : []

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  let sku: string
  try {
    sku = (await generateProductSku(categoryId || null)).toUpperCase()
  } catch {
    sku = `PRD-${Date.now().toString(36).toUpperCase()}`
  }

  try {
    const data = await queryOne(
      `INSERT INTO products (
        name, slug, sku, description, category_id, brand_id,
        base_price, mrp, sale_price, wholesale_price, gst_percentage, hsn_code, mpn, gtin,
        stock_quantity, low_stock_threshold, weight, dimensions, is_active, is_featured,
        has_variants, variant_type, weight_rate, weight_unit, length_rate, length_unit,
        weight_grams, length_cm, breadth_cm, height_cm
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      RETURNING *`,
      [
        name, slug, sku, description, categoryId, brandId || null,
        basePrice, mrp, salePrice, wholesalePrice, gstPercentage, hsnCode, mpn, gtin,
        stockQuantity, lowStockThreshold, weight, dimensions, isActive, isFeatured,
        hasVariants, variantType, weightRate, weightUnit, lengthRate, lengthUnit,
        weightGrams, lengthCm, breadthCm, heightCm,
      ]
    )

    if (!data) throw new Error('Failed to create product')

    if (imageCount > 0 || galleryImageRefs.length > 0) {
      const { uploadProductImage } = await import('@/lib/s3')
      const newFileIds: Record<number, string> = {}

      for (let i = 0; i < imageCount; i++) {
        const file = formData.get(`image_${i}`) as File
        if (file) {
          const uploadResult = await uploadProductImage(file, data.id)
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              data.id, uploadResult.url, uploadResult.thumbnailUrl,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              uploadResult.s3Key, uploadResult.s3ThumbnailKey,
              uploadResult.fileName, uploadResult.fileSize, uploadResult.mimeType,
              uploadResult.width, uploadResult.height, 999, false,
            ]
          )
          if (inserted) newFileIds[i] = inserted.id
        }
      }

      const newGalleryIds: Record<string, string> = {}
      if (galleryImageRefs.length > 0) {
        const galleryImages = await queryMany(
          `SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`,
          [galleryImageRefs.map(r => r.id)]
        )
        for (const gimg of (galleryImages || [])) {
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              data.id, gimg.image_url, gimg.thumbnail_url,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              gimg.s3_key, gimg.s3_thumbnail_key,
              gimg.custom_name || gimg.file_name, gimg.file_size, gimg.mime_type,
              gimg.width, gimg.height, 999, false,
            ]
          )
          if (inserted) newGalleryIds[gimg.id] = inserted.id
        }
      }

      const keys = imageOrder.length > 0 ? imageOrder : [
        ...Object.keys(newFileIds).map(i => `file:${i}`),
        ...galleryImageRefs.map(r => `gallery:${r.id}`),
      ]
      const primaryKey = keys.find(k => {
        if (k.startsWith('gallery:')) return galleryImageRefs.find(r => r.id === k.slice(8))?.isPrimary
        return false
      }) || keys[0]

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const isPrimary = key === primaryKey
        if (key.startsWith('file:')) {
          const pid = newFileIds[parseInt(key.slice(5))]
          if (pid) await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, isPrimary, pid])
        } else if (key.startsWith('gallery:')) {
          const pid = newGalleryIds[key.slice(8)]
          if (pid) await query('UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3', [i, isPrimary, pid])
        }
      }
    }

    if (hasVariants) {
      const variantsJson = formData.get('variants_json') as string
      if (variantsJson) {
        const variants = JSON.parse(variantsJson)
        for (const variant of variants) {
          if (variant._isDeleted) continue
          const isWeightOrLength = variant.pricing_type === 'weight' || variant.pricing_type === 'length'
          if (isWeightOrLength && !variant.numeric_value) continue
          if (!isWeightOrLength && !variant.variant_name) continue
          const variantSku = generateVariantSku(sku, variant.variant_name)
          await query(
            `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, sale_price, wholesale_price, stock_quantity, mpn, gtin, pricing_type, unit, numeric_value, weight_rate, weight_unit, length_rate, length_unit, weight_grams, length_cm, breadth_cm, height_cm, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, true)`,
            [
              data.id,
              variantSku,
              variant.variant_name,
              variant.price ? Math.round(parseFloat(variant.price) * 100) / 100 : null,
              variant.mrp ? Math.round(parseFloat(variant.mrp) * 100) / 100 : null,
              variant.sale_price ? Math.round(parseFloat(variant.sale_price) * 100) / 100 : null,
              variant.wholesale_price ? Math.round(parseFloat(variant.wholesale_price) * 100) / 100 : null,
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
              variant.length_cm ? parseFloat(variant.length_cm) : null,
              variant.breadth_cm ? parseFloat(variant.breadth_cm) : null,
              variant.height_cm ? parseFloat(variant.height_cm) : null,
            ]
          )
        }
      }
    }

    const { syncProductToSheet } = await import('@/lib/google-sheets')
    syncProductToSheet(data.id).catch(() => {})

    redirect('/admin/products')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error(err?.message || 'Failed to create product')
  }
}
export default async function AddProductPage() {
  const categories = await getAllCategories()
  const brands = await getAllBrands()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Product</h1>
        <p className="text-foreground-secondary mt-1">Create a new product in your inventory</p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        action={createProduct}
      />
    </div>
  )
}
