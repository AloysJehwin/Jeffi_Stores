import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteProductImage } from '@/lib/s3'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const productId = params.id

    // Get all images for the product
    const { data: images } = await supabaseAdmin
      .from('product_images')
      .select('*')
      .eq('product_id', productId)

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
    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete product' },
      { status: 500 }
    )
  }
}
