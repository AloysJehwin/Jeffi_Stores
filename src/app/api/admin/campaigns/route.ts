import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

  const [campaigns, countRow] = await Promise.all([
    queryMany(`
      SELECT
        c.*,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind), 0) AS total_sent,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.opened_at IS NOT NULL), 0) AS total_opened,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.clicked_at IS NOT NULL), 0) AS total_clicked,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.converted_at IS NOT NULL), 0) AS total_converted,
        COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.unsubscribed_at IS NOT NULL), 0) AS total_unsubscribed,
        COALESCE((SELECT SUM(o.total_amount) FROM email_campaigns_sent ecs JOIN orders o ON o.id = ecs.conversion_order_id WHERE ecs.campaign_kind = c.kind), 0) AS revenue_attributed,
        (SELECT MAX(sent_at) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND sent_at > NOW() - INTERVAL '24 hours') AS sent_last_24h
      FROM campaigns c
      ORDER BY c.name
      LIMIT $1 OFFSET $2
    `, [limit, offset]),
    queryOne<{ total: string }>('SELECT COUNT(*) AS total FROM campaigns'),
  ])

  return NextResponse.json({ campaigns, total: parseInt(countRow?.total || '0', 10), limit, offset })
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const kind = typeof body.kind === 'string' ? body.kind.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : ''
  if (!name || !kind) return NextResponse.json({ error: 'name and kind are required' }, { status: 400 })

  const exists = await queryOne(`SELECT kind FROM campaigns WHERE kind = $1`, [kind])
  if (exists) return NextResponse.json({ error: 'A campaign with that kind already exists' }, { status: 409 })

  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const delay_hours = Math.max(0, Math.min(720, parseInt(body.delay_hours ?? '0', 10) || 0))
  const discount_percent = Math.max(0, Math.min(100, parseInt(body.discount_percent ?? '0', 10) || 0))
  const subject_template = typeof body.subject_template === 'string' ? body.subject_template.slice(0, 500) : `${name} — special offer for {firstName}`
  const body_template = typeof body.body_template === 'string' ? body.body_template.slice(0, 50000) : `<p>Hi {firstName},</p><p>${name}</p>`
  const scenario_kind = typeof body.scenario_kind === 'string' && body.scenario_kind.trim() ? body.scenario_kind.trim() : null
  const parameters = body.parameters && typeof body.parameters === 'object' ? body.parameters : {}

  if (scenario_kind) {
    const scenarioExists = await queryOne(`SELECT kind FROM scenarios WHERE kind = $1`, [scenario_kind])
    if (!scenarioExists) return NextResponse.json({ error: 'Unknown scenario_kind' }, { status: 400 })
  }

  await query(
    `INSERT INTO campaigns (kind, name, description, enabled, delay_hours, discount_percent, subject_template, body_template, scenario_kind, parameters)
     VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9)`,
    [kind, name, description, delay_hours, discount_percent, subject_template, body_template, scenario_kind, JSON.stringify(parameters)]
  )

  return NextResponse.json({ success: true, kind })
}
