import { redirect } from 'next/navigation'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import { query, queryOne } from '@/lib/db'
import ProductForm from '@/components/admin/ProductForm'

async function createProduct(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const sku = formData.get('sku') as string
  const description = formData.get('description') as string
  const categoryId = formData.get('category_id') as string
  const brandId = formData.get('brand_id') as string
  const basePrice = Math.round(parseFloat(formData.get('base_price') as string) * 100) / 100
  const mrp = formData.get('mrp') ? Math.round(parseFloat(formData.get('mrp') as string) * 100) / 100 : null
  const salePrice = formData.get('sale_price') ? Math.round(parseFloat(formData.get('sale_price') as string) * 100) / 100 : null
  const wholesalePrice = formData.get('wholesale_price') ? Math.round(parseFloat(formData.get('wholesale_price') as string) * 100) / 100 : null
  const gstPercentage = parseFloat(formData.get('gst_percentage') as string || '18')
  const hsnCode = formData.get('hsn_code') as string || null
  const stockQuantity = parseInt(formData.get('stock_quantity') as string)
  const lowStockThreshold = parseInt(formData.get('low_stock_threshold') as string)
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const dimensions = formData.get('dimensions') as string || null
  const isActive = formData.get('is_active') === 'true'
  const isFeatured = formData.get('is_featured') === 'true'
  const imageCount = parseInt(formData.get('image_count') as string || '0')

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    const data = await queryOne(
      `INSERT INTO products (
        name, slug, sku, description, category_id, brand_id,
        base_price, mrp, sale_price, wholesale_price, gst_percentage, hsn_code,
        stock_quantity, low_stock_threshold, weight, dimensions, is_active, is_featured
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        name, slug, sku, description, categoryId, brandId || null,
        basePrice, mrp, salePrice, wholesalePrice, gstPercentage, hsnCode,
        stockQuantity, lowStockThreshold, weight, dimensions, isActive, isFeatured,
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
