import { redirect } from 'next/navigation'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import { query, queryOne } from '@/lib/db'
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
  const isActive = formData.get('is_active') === 'true'
  const isFeatured = formData.get('is_featured') === 'true'
  const imageCount = parseInt(formData.get('image_count') as string || '0')

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  // Auto-generate race-safe SKU
  let sku: string
  try {
    sku = await generateProductSku(categoryId || null)
  } catch {
    sku = `PRD-${Date.now().toString(36).toUpperCase()}`
  }

  try {
    const data = await queryOne(
      `INSERT INTO products (
        name, slug, sku, description, category_id, brand_id,
        base_price, mrp, sale_price, wholesale_price, gst_percentage, hsn_code, mpn, gtin,
        stock_quantity, low_stock_threshold, weight, dimensions, is_active, is_featured,
        has_variants, variant_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        name, slug, sku, description, categoryId, brandId || null,
        basePrice, mrp, salePrice, wholesalePrice, gstPercentage, hsnCode, mpn, gtin,
        stockQuantity, lowStockThreshold, weight, dimensions, isActive, isFeatured,
        hasVariants, variantType,
      ]
    )

    if (!data) throw new Error('Failed to create product')

    // Upload images to S3 and save to database
    if (imageCount > 0) {
      const { uploadProductImage } = await import('@/lib/s3')

      for (let i = 0; i < imageCount; i++) {
        const file = formData.get(`image_${i}`) as File
        if (file) {
          const uploadResult = await uploadProductImage(file, data.id)

          await query(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              data.id, uploadResult.url, uploadResult.thumbnailUrl,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              uploadResult.s3Key, uploadResult.s3ThumbnailKey,
              uploadResult.fileName, uploadResult.fileSize, uploadResult.mimeType,
              uploadResult.width, uploadResult.height, i, i === 0,
            ]
          )
        }
      }
    }

    // Create variants if product has variants
    if (hasVariants) {
      const variantsJson = formData.get('variants_json') as string
      if (variantsJson) {
        const variants = JSON.parse(variantsJson)
        for (const variant of variants) {
          if (variant._isDeleted || !variant.variant_name) continue
          const variantSku = generateVariantSku(sku, variant.variant_name)
          await query(
            `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, sale_price, wholesale_price, stock_quantity, mpn, gtin, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
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
            ]
          )
        }
      }
    }

    // Sync to Google Merchant Sheet (fire-and-forget, must be before redirect)
    const { syncProductToSheet } = await import('@/lib/google-sheets')
    syncProductToSheet(data.id).catch(err => console.error('Sheet sync error:', err))

    redirect('/admin/products')
  } catch (error) {
    console.error('Error creating product:', error)
    throw error
  }
}
export default async function AddProductPage() {
  const categories = await getAllCategories()
  const brands = await getAllBrands()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-secondary-500">Add New Product</h1>
        <p className="text-gray-600 mt-1">Create a new product in your inventory</p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        action={createProduct}
      />
    </div>
  )
}
