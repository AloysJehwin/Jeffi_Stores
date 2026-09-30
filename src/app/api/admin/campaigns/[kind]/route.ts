import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = 20
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

  const campaign = await queryOne(`SELECT * FROM campaigns WHERE kind = $1`, [kind])
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const [recentSends, countRow, whatsappLogs] = await Promise.all([
    queryMany(
      `
      SELECT
        ecs.id, ecs.user_id, ecs.reference_id, ecs.sent_at, ecs.opened_at, ecs.clicked_at,
        ecs.converted_at, ecs.unsubscribed_at, ecs.bounced_at,
        u.email AS user_email,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS user_name,
        COALESCE(csc.send_count, 1)::integer AS send_count
      FROM email_campaigns_sent ecs
      LEFT JOIN users u ON u.id = ecs.user_id
      LEFT JOIN campaign_send_counts csc ON csc.campaign_kind = ecs.campaign_kind AND csc.user_id = ecs.user_id
      WHERE ecs.campaign_kind = $1
      ORDER BY ecs.sent_at DESC
      LIMIT $2 OFFSET $3
    `,
      [kind, limit, offset]
    ),
    queryOne<{ total: string }>(`SELECT COUNT(*) AS total FROM email_campaigns_sent WHERE campaign_kind = $1`, [kind]),
    queryMany(
      `
      SELECT to_number, body, status, error, sent_at
      FROM message_logs
      WHERE channel = 'whatsapp' AND entity_type = 'campaign' AND entity_id = $1
      ORDER BY sent_at DESC
      LIMIT 50
    `,
      [kind]
    ),
  ])

  return NextResponse.json({
    campaign,
    recentSends,
    whatsappLogs,
    total: parseInt(countRow?.total || '0', 10),
    limit,
    offset,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()
  const updates: string[] = ['updated_at = NOW()']
  const vals: any[] = []
  let i = 1

  if (body.enabled !== undefined) {
    updates.push(`enabled = $${i++}`)
    vals.push(!!body.enabled)
  }
  if (body.delay_hours !== undefined) {
    const n = parseInt(body.delay_hours, 10)
    if (n >= 0 && n <= 720) {
      updates.push(`delay_hours = $${i++}`)
      vals.push(n)
    }
  }
  if (body.discount_percent !== undefined) {
    const n = parseInt(body.discount_percent, 10)
    if (n >= 0 && n <= 100) {
      updates.push(`discount_percent = $${i++}`)
      vals.push(n)
    }
  }
  if ('coupon_id' in body) {
    updates.push(`coupon_id = $${i++}`)
    vals.push(body.coupon_id || null)
  }
  if (typeof body.subject_template === 'string' && body.subject_template.trim()) {
    updates.push(`subject_template = $${i++}`)
    vals.push(body.subject_template.slice(0, 500))
  }
  if (typeof body.body_template === 'string' && body.body_template.trim()) {
    const incoming = body.body_template.slice(0, 50000)
    const cur = await queryOne<{ scenario_kind: string | null }>(
      `SELECT scenario_kind FROM campaigns WHERE kind = $1`,
      [kind]
    )
    const refKind = (typeof body.scenario_kind === 'string' && body.scenario_kind.trim()) || cur?.scenario_kind || kind
    const tplCheck = validateCampaignBodyTemplate(incoming, { kind: kind, scenarioKind: refKind })
    if (!tplCheck.ok) {
      return NextResponse.json({ error: tplCheck.reason, hint: tplCheck.hint }, { status: 400 })
    }
    updates.push(`body_template = $${i++}`)
    vals.push(incoming)
  }
  if ('scenario_kind' in body) {
    const current = await queryOne<{ scenario_kind: string | null }>(
      `SELECT scenario_kind FROM campaigns WHERE kind = $1`,
      [kind]
    )
    const nextKind = body.scenario_kind || null
    if ((current?.scenario_kind || null) !== nextKind) {
      const seeded = await queryOne<{ kind: string }>(`SELECT kind FROM scenarios WHERE kind = $1`, [kind])
      if (seeded) {
        return NextResponse.json({ error: 'Cannot change scenario on a seeded campaign' }, { status: 400 })
      }
      if (nextKind) {
        const exists = await queryOne(`SELECT kind FROM scenarios WHERE kind = $1`, [nextKind])
        if (!exists) return NextResponse.json({ error: 'Unknown scenario_kind' }, { status: 400 })
      }
      updates.push(`scenario_kind = $${i++}`)
      vals.push(nextKind)
    }
  }
  if ('parameters' in body && body.parameters && typeof body.parameters === 'object') {
    updates.push(`parameters = $${i++}::jsonb`)
    vals.push(JSON.stringify(body.parameters))
  }

  vals.push(kind)
  await query(`UPDATE campaigns SET ${updates.join(', ')} WHERE kind = $${i}`, vals)

  return NextResponse.json({ success: true })
}
