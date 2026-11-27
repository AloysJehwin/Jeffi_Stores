import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, query, queryOne } from '@/lib/shared/db'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'
import { loadCampaignList } from '@/lib/campaigns/list'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { draftLockChips } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

const createCampaignSchema = z.object({
  name: zNonEmpty,
  kind: zNonEmpty,
})

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

  const { campaigns, total } = await loadCampaignList(limit, offset)
  const locks = await draftLockChips(
    'campaign',
    campaigns.filter(c => c.draft_fields != null).map(c => c.draft_lock_id),
    admin.adminId
  )

  return NextResponse.json({
    campaigns: campaigns.map(c => (c.draft_lock_id && locks[c.draft_lock_id] ? { ...c, draft_lock: locks[c.draft_lock_id] } : c)),
    total,
    limit,
    offset,
  })
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()

  const parsed = parseBody(createCampaignSchema, body)
  if (!parsed.ok) return parsed.response

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const kind =
    typeof body.kind === 'string'
      ? body.kind
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
      : ''
  if (!name || !kind) return NextResponse.json({ error: 'name and kind are required' }, { status: 400 })

  const exists = await queryOne(`SELECT kind FROM campaigns WHERE kind = $1`, [kind])
  if (exists) return NextResponse.json({ error: 'A campaign with that kind already exists' }, { status: 409 })

  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const delay_hours = Math.max(0, Math.min(720, parseInt(body.delay_hours ?? '0', 10) || 0))
  const discount_percent = Math.max(0, Math.min(100, parseInt(body.discount_percent ?? '0', 10) || 0))
  const subject_template =
    typeof body.subject_template === 'string'
      ? body.subject_template.slice(0, 500)
      : `${name} — special offer for {firstName}`
  const body_template =
    typeof body.body_template === 'string' ? body.body_template.slice(0, 50000) : `<p>Hi {firstName},</p><p>${name}</p>`
  const scenario_kind =
    typeof body.scenario_kind === 'string' && body.scenario_kind.trim() ? body.scenario_kind.trim() : null
  const parameters = body.parameters && typeof body.parameters === 'object' ? body.parameters : {}

  if (scenario_kind) {
    const scenarioExists = await queryOne(`SELECT kind FROM scenarios WHERE kind = $1`, [scenario_kind])
    if (!scenarioExists) return NextResponse.json({ error: 'Unknown scenario_kind' }, { status: 400 })
  }

  const tplCheck = validateCampaignBodyTemplate(body_template, { kind, scenarioKind: scenario_kind })
  if (!tplCheck.ok) {
    return NextResponse.json({ error: tplCheck.reason, hint: tplCheck.hint }, { status: 400 })
  }

  await query(
    `INSERT INTO campaigns (kind, name, description, enabled, delay_hours, discount_percent, subject_template, body_template, scenario_kind, parameters)
     VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9)`,
    [
      kind,
      name,
      description,
      delay_hours,
      discount_percent,
      subject_template,
      body_template,
      scenario_kind,
      JSON.stringify(parameters),
    ]
  )

  return NextResponse.json({ success: true, kind })
}
