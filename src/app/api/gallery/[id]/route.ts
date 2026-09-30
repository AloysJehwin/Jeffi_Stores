import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { deleteGalleryImage } from '@/lib/shared/s3'
import { queryOne, query } from '@/lib/shared/db'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await queryOne('SELECT * FROM gallery_images WHERE id = $1', [id])
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await deleteGalleryImage(record.s3_key, record.s3_thumbnail_key)
  await query('DELETE FROM gallery_images WHERE id = $1', [id])

  return NextResponse.json({ success: true })
}
