import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { deleteGalleryImage } from '@/lib/s3'
import { queryOne, query } from '@/lib/db'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await queryOne('SELECT * FROM gallery_images WHERE id = $1', [params.id])
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await deleteGalleryImage(record.s3_key, record.s3_thumbnail_key)
  await query('DELETE FROM gallery_images WHERE id = $1', [params.id])

  return NextResponse.json({ success: true })
}
