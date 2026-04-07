import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { deleteProductImage } from '@/lib/s3'
import { authenticateAdmin } from '@/lib/jwt'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const productId = params.id

    // Get all images for the product
    const images = await queryMany(
      'SELECT * FROM product_images WHERE product_id = $1',
      [productId]
    )

    // Delete images from S3
    if (images && images.length > 0) {
      for (const image of images) {
        try {
          await deleteProductImage(image.s3_key, image.s3_thumbnail_key)
        } catch (err) {
          console.error('Error deleting image from S3:', err)
        }
      }
    }

    // Delete product (images will be cascade deleted due to ON DELETE CASCADE)
    await query('DELETE FROM products WHERE id = $1', [productId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete product' },
      { status: 500 }
    )
  }
}
