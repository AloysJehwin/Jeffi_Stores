import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryCount } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Outbound SMS / WhatsApp log. `channel` query param scopes to 'sms' or 'whatsapp'.
// OTP is never stored, so it never appears here.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)))
  const channel = url.searchParams.get('channel') || ''
  const kind = url.searchParams.get('kind') || ''
  const status = url.searchParams.get('status') || ''
  const search = url.searchParams.get('q') || ''

  const where: string[] = []
  const params: unknown[] = []
  if (channel === 'sms' || channel === 'whatsapp') {
    params.push(channel)
    where.push(`channel = $${params.length}`)
  }
  if (kind && kind !== 'all') {
    params.push(kind)
    where.push(`kind = $${params.length}`)
  }
  if (status && status !== 'all') {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    where.push(`(to_number ILIKE $${params.length} OR body ILIKE $${params.length})`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  params.push(pageSize)
  params.push((page - 1) * pageSize)

  const [rows, total] = await Promise.all([
    queryMany(
      `SELECT id, channel, to_number, from_number, body, kind, entity_type, entity_id,
              status, error, provider_sid, sent_at
       FROM message_logs
       ${whereSql}
       ORDER BY sent_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    queryCount(`SELECT COUNT(*) FROM message_logs ${whereSql}`, params.slice(0, params.length - 2)),
  ])

  return NextResponse.json({ rows, total, page, pageSize })
}
