import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { readJson } from '@/lib/channels/route'
import { suggestHashtags } from '@/lib/social/hashtags'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Write a caption or pick a product first' }, { status: 400 })
  try {
    return NextResponse.json({ hashtags: await suggestHashtags(text) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? 'Suggestion failed') }, { status: e?.status === 403 ? 403 : 502 })
  }
}
