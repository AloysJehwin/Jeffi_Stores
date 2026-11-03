import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'
import { fileFor } from '@/lib/drive/listing'
import { listShares, addShare, removeShare } from '@/lib/drive/folders'
import { logDriveAccess } from '@/lib/drive/files'
import { driveActor, denied } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ adminId: z.string().uuid().optional(), role: z.string().max(50).optional(), level: z.enum(['view', 'edit', 'manage']) }).refine(b => !!b.adminId !== !!b.role, { message: 'Share with one person or one role' })

async function manageable(request: NextRequest, id: string) {
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const f = await fileFor(actor, id)
  if (!f) return denied()
  if (f.level !== 'manage') return NextResponse.json({ error: 'Only the owner can share this file' }, { status: 403 })
  return actor
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await manageable(request, id)
  if (actor instanceof NextResponse) return actor
  return NextResponse.json({ shares: await listShares({ fileId: id }) })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await manageable(request, id)
  if (actor instanceof NextResponse) return actor
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  await addShare({ fileId: id }, { adminId: parsed.data.adminId, role: parsed.data.role }, parsed.data.level, actor.adminId)
  logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'share' }).catch(() => {})
  return NextResponse.json({ shares: await listShares({ fileId: id }) })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await manageable(request, id)
  if (actor instanceof NextResponse) return actor
  const shareId = request.nextUrl.searchParams.get('shareId') || ''
  const share = await queryOne<{ file_id: string | null }>(`SELECT file_id FROM drive_shares WHERE id = $1`, [shareId]).catch(() => null)
  if (!share || share.file_id !== id) return denied()
  await removeShare(shareId)
  return NextResponse.json({ shares: await listShares({ fileId: id }) })
}
