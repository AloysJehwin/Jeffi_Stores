import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { supabaseAdmin } from '@/lib/supabase'
import ProductForm from '@/components/admin/ProductForm'

async function updateProduct(productId: string, formData: FormData) {
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
  const existingImagesToKeepJson = formData.get('existing_images_to_keep') as string
  const existingImagesToKeep = existingImagesToKeepJson ? JSON.parse(existingImagesToKeepJson) : []

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    const { error } = await supabaseAdmin
      .from('products')
      .update({
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)

    if (error) throw error

    // Handle image changes - only if there are changes
    if (imageCount > 0 || existingImagesToKeep.length > 0) {
      // Get all existing images
      const { data: allExistingImages } = await supabaseAdmin
        .from('product_images')
        .select('*')
        .eq('product_id', productId)

      // Determine which images to delete (images not in existingImagesToKeep)
      const existingIdsToKeep = new Set(existingImagesToKeep.map((img: any) => img.id))
      const imagesToDelete = (allExistingImages || []).filter(img => !existingIdsToKeep.has(img.id))

      // Delete removed images from S3
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
          if (img.s3_key) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              Key: img.s3_key,
            }))
          }
          if (img.s3_thumbnail_key) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              Key: img.s3_thumbnail_key,
            }))
          }

          // Delete from database
          await supabaseAdmin
            .from('product_images')
            .delete()
            .eq('id', img.id)
        }
      }

      // Upload new images to S3 and save to database
      if (imageCount > 0) {
        const { uploadProductImage } = await import('@/lib/s3')

        for (let i = 0; i < imageCount; i++) {
          const file = formData.get(`image_${i}`) as File
          if (file) {
            const uploadResult = await uploadProductImage(file, productId)

            await supabaseAdmin.from('product_images').insert({
              product_id: productId,
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
              display_order: existingImagesToKeep.length + i,
              is_primary: existingImagesToKeep.length === 0 && i === 0,
            })
          }
        }
      }

      // Update display order and primary status for existing images that were kept
      for (let i = 0; i < existingImagesToKeep.length; i++) {
        const img = existingImagesToKeep[i]
        await supabaseAdmin
          .from('product_images')
          .update({
            display_order: i,
            is_primary: img.is_primary || false
          })
          .eq('id', img.id)
      }

      // Determine which image should be primary
      // Priority: 1) User-selected existing image, 2) First new image, 3) First existing image
      const hasPrimaryExisting = existingImagesToKeep.some((img: any) => img.is_primary)

      if (!hasPrimaryExisting && imageCount > 0) {
        // If no existing image is primary and we have new images, make first new image primary
        const { data: newImages } = await supabaseAdmin
          .from('product_images')
          .select('*')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(imageCount)

        if (newImages && newImages.length > 0) {
          await supabaseAdmin
            .from('product_images')
            .update({ is_primary: true })
            .eq('id', newImages[newImages.length - 1].id)
        }
      } else if (!hasPrimaryExisting && existingImagesToKeep.length > 0) {
        // If no primary was selected, make the first existing image primary
        await supabaseAdmin
          .from('product_images')
          .update({ is_primary: true })
          .eq('id', existingImagesToKeep[0].id)
      }
    }

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/edit/${productId}`)
    redirect('/admin/products')
  } catch (error) {
    console.error('Error updating product:', error)
    throw error
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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-secondary-500">Edit Product</h1>
        <p className="text-gray-600 mt-1">Update product information</p>
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
