import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ kind: string }>
}

// POST — apply draft_fields to live campaign and clear draft
export async function POST(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const campaign = await queryOne<{ draft_fields: Record<string, unknown> | null }>(
    `SELECT draft_fields FROM campaigns WHERE kind = $1`,
    [kind]
  )
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (!campaign.draft_fields) return NextResponse.json({ error: 'No draft to publish' }, { status: 400 })

  const d = campaign.draft_fields as any
  await query(
    `UPDATE campaigns SET
       enabled = COALESCE($2::boolean, enabled),
       delay_hours = COALESCE($3::integer, delay_hours),
       discount_percent = COALESCE($4::integer, discount_percent),
       coupon_id = $5::uuid,
       scenario_kind = $6,
       subject_template = COALESCE($7, subject_template),
       body_template = COALESCE($8, body_template),
       parameters = COALESCE($9::jsonb, parameters),
       draft_fields = NULL,
       updated_at = NOW()
     WHERE kind = $1`,
    [
      kind,
      d.enabled != null ? d.enabled : null,
      d.delay_hours != null ? d.delay_hours : null,
      d.discount_percent != null ? d.discount_percent : null,
      d.coupon_id || null,
      d.scenario_kind || null,
      d.subject_template || null,
      d.body_template || null,
      d.parameters ? JSON.stringify(d.parameters) : null,
    ]
  )
  return NextResponse.json({ success: true })
}
