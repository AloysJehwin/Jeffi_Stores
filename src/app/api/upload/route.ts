import { NextRequest, NextResponse } from 'next/server'
import { uploadProductImage } from '@/lib/s3'
import { requireAdminScope } from '@/lib/jwt'

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminScope(request, 'products:write')
    if (admin instanceof NextResponse) return admin

    const formData = await request.formData()
    const file = formData.get('file') as File
    const productId = formData.get('productId') as string

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!productId) {
      return NextResponse.json({ error: 'No product ID provided' }, { status: 400 })
    }

    const result = await uploadProductImage(file, productId)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: error.message || 'Failed to upload image' }, { status: 500 })
  }
}
