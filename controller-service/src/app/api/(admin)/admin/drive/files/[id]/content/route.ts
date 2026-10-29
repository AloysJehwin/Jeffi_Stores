import { NextRequest, NextResponse } from 'next/server'
import { fileFor } from '@/lib/drive/listing'
import { logDriveAccess, signFile } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

// View or download: a short-lived signed link after the access check (thumbnails are not logged).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:read')
  if (actor instanceof NextResponse) return actor
  const f = await fileFor(actor, id)
  if (!f) return denied()
  const sp = request.nextUrl.searchParams
  const thumb = sp.get('thumb') === '1'
  const download = sp.get('download') === '1'
  if (!thumb) logDriveAccess({ fileId: id, adminId: actor.adminId, action: download ? 'download' : 'view', ...reqMeta(request) }).catch(() => {})
  const url = await signFile(f.row, { thumb, download })
  return NextResponse.redirect(new URL(url, request.url), { status: 302, headers: { 'Cache-Control': 'private, max-age=60' } })
}
