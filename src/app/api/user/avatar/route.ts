import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { uploadAvatarImage } from '@/lib/s3'
import { query } from '@/lib/db'

const MAX_SIZE = 2 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'Only JPEG, PNG or WebP allowed' }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File must be under 2 MB' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url, s3Key } = await uploadAvatarImage(buffer, authUser.userId)

    await query(
      'UPDATE users SET avatar_url = $1, avatar_s3_key = $2, avatar_is_custom = true, updated_at = NOW() WHERE id = $3',
      [url, s3Key, authUser.userId]
    )

    return NextResponse.json({ avatarUrl: url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}
