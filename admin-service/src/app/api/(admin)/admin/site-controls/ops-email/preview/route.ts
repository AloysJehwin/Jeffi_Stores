import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { applyMailTheme } from '@/lib/shared/mail-template'
import { storeMailTheme } from '@/lib/catalog/brand'
import { parseOpsEmailInput } from '@/lib/shared/ops-email-config'
import { buildOpsEmail, loadOpsEmail } from '@/lib/shared/ops-email'

export const dynamic = 'force-dynamic'

// The daily email as the unsaved settings would send it now. Attachments are only counted; the AI
// headline is a placeholder unless ?ai=1.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  const body = await request.json().catch(() => null)
  const parsed = parseOpsEmailInput(body?.config)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { planHas } = await loadOpsEmail()
  const ai = request.nextUrl.searchParams.get('ai') === '1' && planHas('agent:read')
  const mail = await buildOpsEmail({ cfg: parsed.value, planHas }, { ai: ai || 'placeholder', attachments: 'summary' })
  return NextResponse.json({ subject: mail.subject, html: applyMailTheme(mail.html, await storeMailTheme()), note: mail.note })
}
