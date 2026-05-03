import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryCount, query } from '@/lib/db'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = 20
  const offset = (page - 1) * pageSize

  const [campaigns, total] = await Promise.all([
    queryMany(
      `SELECT id, title, template_key, subject, audience_type, recipient_count, status, scheduled_at, sent_at, created_at
       FROM email_campaigns ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
    queryCount('SELECT COUNT(*) FROM email_campaigns', []),
  ])

  return NextResponse.json({ campaigns, total, page, pageSize })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, template_key, subject, template_data, audience_type, audience_filter } = body

  if (!title || !template_key || !subject || !audience_type) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const result = await query(
    `INSERT INTO email_campaigns (title, template_key, subject, template_data, audience_type, audience_filter, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [title, template_key, subject, JSON.stringify(template_data || {}), audience_type, JSON.stringify(audience_filter || {}), admin.adminId]
  )

  return NextResponse.json({ id: result.rows[0].id }, { status: 201 })
}
