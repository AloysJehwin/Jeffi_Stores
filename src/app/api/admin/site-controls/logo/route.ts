import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { uploadStoreLogo } from '@/lib/s3'
import { invalidateSiteControlsCache } from '@/lib/site-controls'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported image type. Use PNG, JPEG, WebP or SVG.' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url } = await uploadStoreLogo(buffer)

    // Persist to site_settings so all consumers pick it up.
    await query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ('business_logo_url', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [url]
    )
    invalidateSiteControlsCache()

    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}
