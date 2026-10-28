import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { actorOf, draftLockChips, withDraftCreate } from '@/lib/admin/draft-locks'
import { parseScenarioDraft } from '@/lib/campaigns/scenario-drafts'

export const dynamic = 'force-dynamic'

const MAX_PER_ADMIN = 50

// GET — every unfinished new-scenario wizard, newest first.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'campaigns:read')
  if (admin instanceof NextResponse) return admin
  const rows = await query(
    `SELECT d.id, d.title, d.fields->>'name' AS name, d.fields->>'step' AS step, d.updated_at,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS admin_name
       FROM scenario_drafts d
       LEFT JOIN admins a ON a.id = d.admin_id
       LEFT JOIN users u ON u.id = a.user_id
      ORDER BY d.updated_at DESC LIMIT 200`
  )
  const locks = await draftLockChips('scenario', rows.rows.map(r => r.id), admin.adminId)
  return NextResponse.json({ drafts: rows.rows.map(r => ({ ...r, lock: locks[r.id] ?? null })) })
}

// POST { title?, fields } — start a draft; its creator holds the lock.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return admin
  const parsed = parseScenarioDraft(await request.json().catch(() => ({})))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const mine = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM scenario_drafts WHERE admin_id = $1`, [admin.adminId])
  if ((mine?.n ?? 0) >= MAX_PER_ADMIN)
    return NextResponse.json({ error: `You already have ${MAX_PER_ADMIN} scenario drafts — finish or discard some first` }, { status: 409 })
  const id = randomUUID()
  await withDraftCreate(actorOf(admin), 'scenario', id, db =>
    db.query(`INSERT INTO scenario_drafts (id, admin_id, title, fields) VALUES ($1, $2, $3, $4::jsonb)`, [
      id,
      admin.adminId,
      parsed.title ?? null,
      JSON.stringify(parsed.fields ?? {}),
    ])
  )
  return NextResponse.json({ id }, { status: 201 })
}
