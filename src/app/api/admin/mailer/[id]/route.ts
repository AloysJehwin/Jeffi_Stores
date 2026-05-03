import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany, queryCount, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaign = await queryOne(
    'SELECT * FROM email_campaigns WHERE id = $1',
    [params.id]
  )
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const logPage = Math.max(1, parseInt(searchParams.get('logPage') || '1', 10))
  const logPageSize = 50
  const [logs, logTotal] = await Promise.all([
    queryMany(
      'SELECT email, status, error, sent_at FROM email_campaign_logs WHERE campaign_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3',
      [params.id, logPageSize, (logPage - 1) * logPageSize]
    ),
    queryCount('SELECT COUNT(*) FROM email_campaign_logs WHERE campaign_id = $1', [params.id]),
  ])

  return NextResponse.json({ campaign, logs, logTotal, logPage, logPageSize })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaign = await queryOne<{ status: string }>('SELECT status FROM email_campaigns WHERE id = $1', [params.id])
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (campaign.status === 'sent' || campaign.status === 'sending') {
    return NextResponse.json({ error: 'Cannot edit a campaign that has been sent or is sending' }, { status: 400 })
  }

  const body = await request.json()
  const { title, template_key, subject, template_data, audience_type, audience_filter, scheduled_at } = body

  await query(
    `UPDATE email_campaigns SET
      title = COALESCE($1, title),
      template_key = COALESCE($2, template_key),
      subject = COALESCE($3, subject),
      template_data = COALESCE($4, template_data),
      audience_type = COALESCE($5, audience_type),
      audience_filter = COALESCE($6, audience_filter),
      scheduled_at = $7
     WHERE id = $8`,
    [title, template_key, subject, template_data ? JSON.stringify(template_data) : null, audience_type, audience_filter ? JSON.stringify(audience_filter) : null, scheduled_at || null, params.id]
  )

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaign = await queryOne<{ status: string }>('SELECT status FROM email_campaigns WHERE id = $1', [params.id])
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (campaign.status === 'sending') {
    return NextResponse.json({ error: 'Cannot delete a campaign while it is sending' }, { status: 400 })
  }

  await query('DELETE FROM email_campaigns WHERE id = $1', [params.id])
  return NextResponse.json({ success: true })
}
