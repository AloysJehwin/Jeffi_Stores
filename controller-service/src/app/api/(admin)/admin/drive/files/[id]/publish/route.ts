import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { fileFor } from '@/lib/drive/listing'
import { publishToGallery } from '@/lib/drive/gallery'
import { logDriveAccess } from '@/lib/drive/files'
import { driveActor, driveFailure, denied } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Copy a private Drive file into the public gallery, for places that need a public URL (product
// images, templates). The caller has already told the user it becomes public.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const admin = await authenticateAdmin(request)
  if (!admin || !['products:write', 'settings:write', 'coupons:write', 'social:write'].some(s => hasScope(admin.role, admin.scopes, s))) {
    return NextResponse.json({ error: 'You cannot add to the gallery' }, { status: 403 })
  }
  const f = await fileFor(actor, id)
  if (!f) return denied()
  try {
    const out = await publishToGallery(f.row, actor.adminId)
    logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'share' }).catch(() => {})
    return NextResponse.json(out)
  } catch (err) {
    return driveFailure(err, 'Publishing')
  }
}
