import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { uploadGalleryImage } from '@/lib/shared/s3'

export const dynamic = 'force-dynamic'

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']
const MAX = 5 * 1024 * 1024

// POST /api/admin/product-offers/[id]/image — upload an offer card image.
// FormData: file, plus optional field=image_url|image_url_mobile (default image_url).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const field = (formData.get('field') as string) === 'image_url_mobile' ? 'image_url_mobile' : 'image_url'
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
    if (file.size > MAX) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url, blurhash } = await uploadGalleryImage(buffer, file.name)
    const hashField = field === 'image_url_mobile' ? 'blurhash_mobile' : 'blurhash'

    await query(`UPDATE product_offers SET ${field} = $1, ${hashField} = $2, updated_at = NOW() WHERE id = $3`, [
      url,
      blurhash,
      id,
    ])
    return NextResponse.json({ url, field, blurhash })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to upload image' }, { status: 500 })
  }
}
