import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { query, queryOne, queryMany } from '@/lib/db'
import { generateVariantSku } from '@/lib/sku'
import ProductForm from '@/components/admin/ProductForm'

async function updateProduct(productId: string, formData: FormData) {
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
  const existingImagesToKeepJson = formData.get('existing_images_to_keep') as string
  const existingImagesToKeep = existingImagesToKeepJson ? JSON.parse(existingImagesToKeepJson) : []
  const galleryImageIdsJson = formData.get('gallery_image_ids') as string
  const galleryImageRefs: { id: string; isPrimary: boolean }[] = galleryImageIdsJson ? JSON.parse(galleryImageIdsJson) : []

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    await query(
      `UPDATE products SET
        name = $1, slug = $2, description = $3, category_id = $4,
        brand_id = $5, base_price = $6, mrp = $7, sale_price = $8, wholesale_price = $9,
        gst_percentage = $10, hsn_code = $11, mpn = $12, gtin = $13,
        stock_quantity = $14, low_stock_threshold = $15, weight = $16,
        dimensions = $17, is_active = $18, is_featured = $19, has_variants = $20, variant_type = $21,
        updated_at = $22
      WHERE id = $23`,
      [
        name, slug, description, categoryId,
        brandId || null, basePrice, mrp, salePrice, wholesalePrice,
        gstPercentage, hsnCode, mpn, gtin,
        stockQuantity, lowStockThreshold, weight,
        dimensions, isActive, isFeatured, hasVariants, variantType,
        new Date().toISOString(),
        productId,
      ]
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

          await query('DELETE FROM product_images WHERE id = $1', [img.id])
        }
      }

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

      for (let i = 0; i < existingImagesToKeep.length; i++) {
        const img = existingImagesToKeep[i]
        await query(
          'UPDATE product_images SET display_order = $1, is_primary = $2 WHERE id = $3',
          [i, img.is_primary || false, img.id]
        )
      }

      const hasPrimaryExisting = existingImagesToKeep.some((img: any) => img.is_primary)

      if (!hasPrimaryExisting && imageCount > 0) {
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
        await query(
          'UPDATE product_images SET is_primary = true WHERE id = $1',
          [existingImagesToKeep[0].id]
        )
      }

      if (galleryImageRefs.length > 0) {
        const galleryImages = await queryMany(
          `SELECT * FROM gallery_images WHERE id = ANY($1::uuid[])`,
          [galleryImageRefs.map(r => r.id)]
        )
        for (let i = 0; i < (galleryImages || []).length; i++) {
          const gimg = galleryImages![i]
          const ref = galleryImageRefs.find(r => r.id === gimg.id)
          const displayOrder = existingImagesToKeep.length + imageCount + i
          const isPrimary = ref?.isPrimary ?? (existingImagesToKeep.length === 0 && imageCount === 0 && i === 0)
          await query(
            `INSERT INTO product_images (
              product_id, image_url, thumbnail_url, s3_bucket, s3_key,
              s3_thumbnail_key, file_name, file_size, mime_type, width,
              height, display_order, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              productId, gimg.image_url, gimg.thumbnail_url,
              process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
              gimg.s3_key, gimg.s3_thumbnail_key,
              gimg.custom_name || gimg.file_name, gimg.file_size, gimg.mime_type,
              gimg.width, gimg.height, displayOrder, isPrimary,
            ]
          )
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
          if (variant._isDeleted && variant.id) {
            await query('DELETE FROM product_variants WHERE id = $1 AND product_id = $2', [variant.id, productId])
          } else if (variant.id && !variant._isDeleted) {
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `UPDATE product_variants SET sku = $1, variant_name = $2, price = $3, mrp = $4, sale_price = $5, wholesale_price = $6, stock_quantity = $7, mpn = $8, gtin = $9
               WHERE id = $10 AND product_id = $11`,
              [
                variantSku, variant.variant_name,
                variant.price ? Math.round(parseFloat(variant.price) * 100) / 100 : null,
                variant.mrp ? Math.round(parseFloat(variant.mrp) * 100) / 100 : null,
                variant.sale_price ? Math.round(parseFloat(variant.sale_price) * 100) / 100 : null,
                variant.wholesale_price ? Math.round(parseFloat(variant.wholesale_price) * 100) / 100 : null,
                parseInt(variant.stock_quantity) || 0,
                variant.mpn || null,
                variant.gtin || null,
                variant.id, productId,
              ]
            )
          } else if (!variant.id && !variant._isDeleted && variant.variant_name) {
            const variantSku = generateVariantSku(productSku, variant.variant_name)
            await query(
              `INSERT INTO product_variants (product_id, sku, variant_name, price, mrp, sale_price, wholesale_price, stock_quantity, mpn, gtin, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
              [
                productId, variantSku, variant.variant_name,
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
    } else {
      await query('DELETE FROM product_variants WHERE product_id = $1', [productId])
    }

    const { syncProductToSheet } = await import('@/lib/google-sheets')
    syncProductToSheet(productId).catch(() => {})

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/edit/${productId}`)
    redirect('/admin/products')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to update product')
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
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500">Edit Product</h1>
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
