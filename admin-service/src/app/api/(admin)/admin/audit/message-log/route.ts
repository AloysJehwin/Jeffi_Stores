import { NextRequest, NextResponse } from 'next/server'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { SMS_LOG_ENTITY, WHATSAPP_LOG_ENTITY, messageLogEntity } from '@/lib/filters/entities/audit'
import { LOG_COUNT_CAP } from '@/lib/filters/fields/audit'
import { cappedCount } from '@/lib/filters/run'
import { listWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

const ANY_CHANNEL = messageLogEntity()

// Outbound SMS / WhatsApp log. `channel` query param scopes to 'sms' or 'whatsapp'.
// OTP codes are redacted before they are stored.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)))
  const channel = url.searchParams.get('channel') || ''
  const entity = channel === 'sms' ? SMS_LOG_ENTITY : channel === 'whatsapp' ? WHATSAPP_LOG_ENTITY : ANY_CHANNEL

  // The list filters (old ?q= and 'all' sentinels included); without dates, the last 7 days.
  const sp = new URLSearchParams(url.searchParams)
  if (sp.get('kind') === 'all') sp.delete('kind')
  const { q, window } = listWindow(entity, normalizeQuery(entity, sp))
  const w = buildWhere(entity, q)
  const params = [...w.params, pageSize, (page - 1) * pageSize]

  const [rows, counted] = await Promise.all([
    queryMany(
      `SELECT m.id, m.channel, m.to_number, m.from_number, m.body, m.kind, m.entity_type, m.entity_id,
              m.status, m.error, m.provider_sid, m.sent_at, m.direction, m.provider, m.delivery_status
       FROM message_logs m
       ${w.where}
       ORDER BY m.sent_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    cappedCount(entity, q, LOG_COUNT_CAP),
  ])

  return NextResponse.json({ rows, total: counted.count, capped: counted.capped, window, page, pageSize })
}
