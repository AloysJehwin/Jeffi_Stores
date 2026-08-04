import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import { generateProductSku, generateVariantSku } from '@/lib/sku'
import ProductForm from '@/components/admin/ProductForm'
import { ChevronLeft } from 'lucide-react'
import { round2 } from '@/lib/gst'

async function createProduct(formData: FormData) {
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
  const isActive = intent === 'draft' ? false : (intent === 'publish' ? true : formData.get('is_active') === 'true')
  const isFeatured = formData.get('is_featured') === 'true'
  const imageCount = parseInt(formData.get('image_count') as string || '0')
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson ? JSON.parse(galleryImageIdsJson) : []
  const imageOrderJson = formData.get('image_order') as string
  const imageOrder: string[] = imageOrderJson ? JSON.parse(imageOrderJson) : []

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const skuFromForm = (formData.get('sku') as string || '').trim().toUpperCase()
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
        name, slug, sku, description, category_id, brand_id,
        base_price, mrp, mrp_ex_gst, price_ex_gst, gst_percentage, hsn_code, mpn, gtin,
        stock_status, weight, dimensions, is_active, is_featured,
        has_variants, variant_type, sub_variant_type,
        weight_grams, package_type, length_cm, breadth_cm, height_cm, cost_price, discount_pct, supplier_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      RETURNING *`,
      [
        name, slug, sku, description, categoryId, brandId || null,
        basePrice, mrp, mrpExGst, salePrice, gstPercentage, hsnCode, mpn, gtin,
        stockStatus, weight, dimensions, isActive, isFeatured,
        hasVariants, variantType, subVariantType,
        weightGrams, packageType, lengthCm, breadthCm, heightCm, costPrice, discountPct, supplierId,
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
        const { copyGalleryImageToProduct } = await import('@/lib/s3')
        const galleryImages = await queryMany(
          `SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`,
          [galleryImageRefs.map(r => r.id)]
        )
        for (const gimg of (galleryImages || [])) {
          const copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, data.id, gimg.image_url, gimg.thumbnail_url)
          const inserted = await queryOne<{ id: string }>(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              data.id, copied.url, copied.thumbnailUrl,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              copied.s3Key, copied.s3ThumbnailKey,
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
          if (!variant.variant_name) continue
          const variantSku = generateVariantSku(sku, variant.variant_name)
          await query(
            `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, mrp_ex_gst, price_ex_gst, stock_status, mpn, gtin, pricing_type, unit, numeric_value, weight_grams, package_type, length_cm, breadth_cm, height_cm, sub_variant_type, variant_type, discount_pct, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, true)`,
            [
              data.id,
              variantSku,
              variant.variant_name,
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
            ]
          )
        }
      }
    }

    const { syncProductToSheet } = await import('@/lib/google-sheets')
    syncProductToSheet(data.id).catch(() => {})
    const { syncProductToMerchant } = await import('@/lib/merchant/sync')
    syncProductToMerchant(data.id).catch(() => {})

    const host = await getHost()
  redirect(ap('/admin/products', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error(err?.message || 'Failed to create product')
  }
}
export default async function AddProductPage() {
  const host = await getHost()
  const categories = await getAllCategories()
  const brands = await getAllBrands()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap('/admin/products', host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Products
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Add Product</span>
      </div>

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
