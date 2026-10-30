import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { actorOf, draftLockResponse, epochFrom, withDraftCreate, withDraftWrite } from '@/lib/admin/draft-locks'

// POST /api/admin/mailer/draft — upsert a draft (partial data allowed)
// Body: { draft_id?, template_key, title?, subject?, template_data?,
//         audience_type?, audience_filter?, scheduled_at?, wizard_step? }
// Creating takes the draft lock; saving needs it (423 when another admin holds the draft).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const {
    draft_id,
    template_key,
    title,
    subject,
    template_data,
    audience_type,
    audience_filter,
    scheduled_at,
    wizard_step,
    channels,
  } = body

  const stepClamped =
    typeof wizard_step === 'number' ? Math.min(3, Math.max(1, Math.trunc(wizard_step))) : null

  const actor = actorOf(admin)
  try {
    if (draft_id) {
      await withDraftWrite(
        actor,
        'mailer',
        draft_id,
        db =>
          db.query(
            `UPDATE email_campaigns SET
              template_key    = COALESCE($1, template_key),
              title           = COALESCE(NULLIF($2,''), title),
              subject         = COALESCE(NULLIF($3,''), subject),
              template_data   = COALESCE($4, template_data),
              audience_type   = COALESCE(NULLIF($5,''), audience_type),
              audience_filter = COALESCE($6, audience_filter),
              scheduled_at    = COALESCE($7, scheduled_at),
              wizard_step     = COALESCE($8, wizard_step),
              channels        = COALESCE($10, channels),
              updated_at      = now()
             WHERE id = $9 AND status = 'draft'`,
            [
              template_key || null,
              title || null,
              subject || null,
              template_data ? JSON.stringify(template_data) : null,
              audience_type || null,
              audience_filter ? JSON.stringify(audience_filter) : null,
              scheduled_at || null,
              stepClamped,
              draft_id,
              channels ? JSON.stringify(channels) : null,
            ]
          ),
        { epoch: epochFrom(request) }
      )
      return NextResponse.json({ id: draft_id })
    }

    const id = randomUUID()
    await withDraftCreate(actor, 'mailer', id, db =>
      db.query(
        `INSERT INTO email_campaigns
           (id, template_key, title, subject, template_data, audience_type, audience_filter,
            scheduled_at, wizard_step, status, created_by, channels)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11)`,
        [
          id,
          template_key || 'custom',
          title || 'Draft',
          subject || '',
          JSON.stringify(template_data || {}),
          audience_type || 'all',
          JSON.stringify(audience_filter || {}),
          scheduled_at || null,
          stepClamped ?? 1,
          admin.adminId,
          JSON.stringify(channels || {}),
        ]
      )
    )
    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
}
