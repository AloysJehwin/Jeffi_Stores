import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { replyToInboxItem } from '@/lib/social/jobs'

export const dynamic = 'force-dynamic'

// Reply on the network to a comment or review.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > 4000) return NextResponse.json({ error: 'Write a reply (up to 4000 characters)' }, { status: 400 })
  try {
    await replyToInboxItem(await resolveTenantId(), (await params).id, text, admin.email ?? null)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    const status = Number(e?.status ?? e?.httpStatus) || 502
    return NextResponse.json({ error: String(e?.message ?? 'Reply failed') }, { status: status >= 400 && status < 600 ? status : 502 })
  }
}
