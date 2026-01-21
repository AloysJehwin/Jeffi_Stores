import { redirect } from 'next/navigation'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import { supabaseAdmin } from '@/lib/supabase'
import ProductForm from '@/components/admin/ProductForm'

async function createProduct(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const sku = formData.get('sku') as string
  const description = formData.get('description') as string
  const categoryId = formData.get('category_id') as string
  const brandId = formData.get('brand_id') as string
  const basePrice = Math.round(parseFloat(formData.get('base_price') as string) * 100) / 100
  const salePrice = formData.get('sale_price') ? Math.round(parseFloat(formData.get('sale_price') as string) * 100) / 100 : null
  const wholesalePrice = formData.get('wholesale_price') ? Math.round(parseFloat(formData.get('wholesale_price') as string) * 100) / 100 : null
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
    const { data, error} = await supabaseAdmin
      .from('products')
      .insert({
        name,
        slug,
        sku,
        description,
        category_id: categoryId,
        brand_id: brandId || null,
        base_price: basePrice,
        sale_price: salePrice,
        wholesale_price: wholesalePrice,
        stock_quantity: stockQuantity,
        low_stock_threshold: lowStockThreshold,
        weight,
        dimensions,
        is_active: isActive,
        is_featured: isFeatured,
      })
      .select()
      .single()

    if (error) throw error

    // Upload images to S3 and save to database
    if (imageCount > 0) {
      const { uploadProductImage } = await import('@/lib/s3')

      for (let i = 0; i < imageCount; i++) {
        const file = formData.get(`image_${i}`) as File
        if (file) {
          const uploadResult = await uploadProductImage(file, data.id)

          await supabaseAdmin.from('product_images').insert({
            product_id: data.id,
            image_url: uploadResult.url,
            thumbnail_url: uploadResult.thumbnailUrl,
            s3_bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
            s3_key: uploadResult.s3Key,
            s3_thumbnail_key: uploadResult.s3ThumbnailKey,
            file_name: uploadResult.fileName,
            file_size: uploadResult.fileSize,
            mime_type: uploadResult.mimeType,
            width: uploadResult.width,
            height: uploadResult.height,
            display_order: i,
            is_primary: i === 0,
          })
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
