import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { WA_TEMPLATE_REGISTRY, sendTemplateByKey, sendFreeTextWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

function last10(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const user = await queryOne<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [id])
  const phone = user?.phone ?? null
  const digits = last10(phone)

  let thread: any[] = []
  if (digits) {
    thread = await queryMany(
      `SELECT id, direction, to_number, from_number, body, kind, status, error, provider_sid, sent_at
       FROM message_logs
       WHERE channel = 'whatsapp'
         AND (regexp_replace(to_number, '\\D', '', 'g') LIKE '%' || $1
              OR regexp_replace(from_number, '\\D', '', 'g') LIKE '%' || $1)
       ORDER BY sent_at ASC
       LIMIT 200`,
      [digits]
    )
  }

  return NextResponse.json({ phone, thread, templates: WA_TEMPLATE_REGISTRY })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { templateKey, variables, text } = await req.json()

  const user = await queryOne<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [id])
  const phone = user?.phone ?? null
  if (!phone) return NextResponse.json({ error: 'Customer has no phone number' }, { status: 400 })

  let ok = false
  if (templateKey) {
    ok = await sendTemplateByKey(phone, String(templateKey), variables || {})
  } else if (text && String(text).trim()) {
    ok = await sendFreeTextWhatsApp({ phone, body: String(text).trim() })
  } else {
    return NextResponse.json({ error: 'templateKey or text is required' }, { status: 400 })
  }

  if (ok) {
    logActivity({
      userId: id,
      actorId: admin.adminId,
      kind: 'whatsapp_sent',
      summary: 'WhatsApp message sent',
      metadata: { templateKey: templateKey ?? null },
    }).catch(() => {})
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({
    success: false,
    error: 'Send failed (may require an approved template or 24h window)',
  })
}
