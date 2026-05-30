import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = 20
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

  const campaign = await queryOne(`SELECT * FROM campaigns WHERE kind = $1`, [params.kind])
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const [recentSends, countRow] = await Promise.all([
    queryMany(`
      SELECT
        ecs.id, ecs.user_id, ecs.reference_id, ecs.sent_at, ecs.opened_at, ecs.clicked_at,
        ecs.converted_at, ecs.unsubscribed_at, ecs.bounced_at,
        u.email AS user_email,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) AS user_name
      FROM email_campaigns_sent ecs
      LEFT JOIN users u ON u.id = ecs.user_id
      WHERE ecs.campaign_kind = $1
      ORDER BY ecs.sent_at DESC
      LIMIT $2 OFFSET $3
    `, [params.kind, limit, offset]),
    queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total FROM email_campaigns_sent WHERE campaign_kind = $1`,
      [params.kind]
    ),
  ])

  return NextResponse.json({
    campaign,
    recentSends,
    total: parseInt(countRow?.total || '0', 10),
    limit,
    offset,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { kind: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
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
    updates.push(`body_template = $${i++}`)
    vals.push(body.body_template.slice(0, 50000))
  }

  vals.push(params.kind)
  await query(`UPDATE campaigns SET ${updates.join(', ')} WHERE kind = $${i}`, vals)

  return NextResponse.json({ success: true })
}
