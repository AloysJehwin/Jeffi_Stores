import { NextRequest, NextResponse } from 'next/server'
import { ensureTranslations } from '@/lib/support/translate'
import { adminChat, adminLanguage } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// Translate what arrived live into the agent's language (results arrive as `translation` events).
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:read', { passive: true })
  if (ctx instanceof NextResponse) return ctx
  const translated = await ensureTranslations(sessionId, await adminLanguage(ctx.admin.adminId), 20)
  return NextResponse.json({ translated })
}
