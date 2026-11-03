import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { getRedisClient } from '@/lib/shared/redis'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { briefingFromAsync } from '@/lib/shared/daily-briefing'
import { parseOpsEmailInput } from '@/lib/shared/ops-email-config'
import { buildOpsEmail, loadOpsEmail } from '@/lib/shared/ops-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// Sends the daily email, as the unsaved settings would, to the admin trying it (with the real
// attachments and AI headline). Once a minute per admin; the daily send is not affected.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const body = await request.json().catch(() => null)
  const parsed = parseOpsEmailInput(body?.config)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const me = await queryOne<{ email: string | null }>(
    `SELECT u.email FROM admins a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [admin.adminId]
  )
  if (!me?.email) return NextResponse.json({ error: 'Your account has no email address' }, { status: 400 })
  const key = `opsemail:test:${getCurrentTenantId() ?? 'platform'}:${admin.adminId}`
  const free = await getRedisClient().set(key, '1', 'EX', 60, 'NX').catch(() => 'OK')
  if (!free) return NextResponse.json({ error: 'Wait a minute before sending another test.' }, { status: 429 })

  const { planHas } = await loadOpsEmail()
  const mail = await buildOpsEmail({ cfg: parsed.value, planHas }, { ai: planHas('agent:read'), attachments: true })
  try {
    await sendAuditedMail({
      from: await briefingFromAsync(),
      to: me.email,
      subject: `[Test] ${mail.subject}`,
      html: mail.html,
      attachments: mail.attachments,
      kind: 'daily_briefing',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not send the test' }, { status: 502 })
  }
  return NextResponse.json({ sentTo: me.email, note: mail.note })
}
