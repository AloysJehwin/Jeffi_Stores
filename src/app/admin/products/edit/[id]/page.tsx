import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import ProductForm from '@/components/admin/ProductForm'

async function updateProduct(productId: string, formData: FormData) {
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
  const existingImagesToKeepJson = formData.get('existing_images_to_keep') as string
  const existingImagesToKeep = existingImagesToKeepJson ? JSON.parse(existingImagesToKeepJson) : []

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    await query(
      `UPDATE products SET
        name = $1, slug = $2, sku = $3, description = $4, category_id = $5,
        brand_id = $6, base_price = $7, mrp = $8, sale_price = $9, wholesale_price = $10,
        gst_percentage = $11, hsn_code = $12, stock_quantity = $13, low_stock_threshold = $14, weight = $15,
        dimensions = $16, is_active = $17, is_featured = $18, updated_at = $19
      WHERE id = $20`,
      [
        name, slug, sku, description, categoryId,
        brandId || null, basePrice, mrp, salePrice, wholesalePrice,
        gstPercentage, hsnCode, stockQuantity, lowStockThreshold, weight,
        dimensions, isActive, isFeatured, new Date().toISOString(),
        productId,
      ]
    )

    // Handle image changes - only if there are changes
    if (imageCount > 0 || existingImagesToKeep.length > 0) {
      // Get all existing images
      const allExistingImages = await queryMany(
        'SELECT * FROM product_images WHERE product_id = $1',
        [productId]
      )

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
          await query('DELETE FROM product_images WHERE id = $1', [img.id])
        }
      }

      // Upload new images to S3 and save to database
      if (imageCount > 0) {
        const { uploadProductImage } = await import('@/lib/s3')

        for (let i = 0; i < imageCount; i++) {
          const file = formData.get(`image_${i}`) as File
          if (file) {
            const uploadResult = await uploadProductImage(file, productId)

            await query(
              `INSERT INTO product_images (
                product_id, image_url, thumbnail_url, s3_bucket, s3_key,
                s3_thumbnail_key, file_name, file_size, mime_type, width,
                height, display_order, is_primary
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                productId, uploadResult.url, uploadResult.thumbnailUrl,
                process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
                uploadResult.s3Key, uploadResult.s3ThumbnailKey,
                uploadResult.fileName, uploadResult.fileSize, uploadResult.mimeType,
                uploadResult.width, uploadResult.height,
                existingImagesToKeep.length + i,
                existingImagesToKeep.length === 0 && i === 0,
              ]
            )
          }
        }
      }

      // Update display order and primary status for existing images that were kept
      for (let i = 0; i < existingImagesToKeep.length; i++) {
        const img = existingImagesToKeep[i]
        await query(
          'UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3',
          [i, img.is_primary || false, img.id]
        )
      }

      // Determine which image should be primary
      // Priority: 1) User-selected existing image, 2) First new image, 3) First existing image
      const hasPrimaryExisting = existingImagesToKeep.some((img: any) => img.is_primary)

      if (!hasPrimaryExisting && imageCount > 0) {
        // If no existing image is primary and we have new images, make first new image primary
        const newImages = await queryMany(
          'SELECT * FROM product_images WHERE product_id = $1 ORDER BY created_at DESC LIMIT $2',
          [productId, imageCount]
        )

        if (newImages && newImages.length > 0) {
          await query(
            'UPDATE product_images SET is_primary = true WHERE id = $1',
            [newImages[newImages.length - 1].id]
          )
        }
      } else if (!hasPrimaryExisting && existingImagesToKeep.length > 0) {
        // If no primary was selected, make the first existing image primary
        await query(
          'UPDATE product_images SET is_primary = true WHERE id = $1',
          [existingImagesToKeep[0].id]
        )
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
