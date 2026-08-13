import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

// POST /api/admin/mailer/draft — upsert a draft (partial data allowed)
// Body: { draft_id?, template_key, title?, subject?, template_data? }
// Returns: { id }
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { draft_id, template_key, title, subject, template_data } = body

  if (draft_id) {
    // Update existing draft — only touch provided fields
    await query(
      `UPDATE email_campaigns SET
        template_key  = COALESCE($1, template_key),
        title         = COALESCE(NULLIF($2,''), title),
        subject       = COALESCE(NULLIF($3,''), subject),
        template_data = COALESCE($4, template_data)
       WHERE id = $5 AND status = 'draft'`,
      [
        template_key || null,
        title || null,
        subject || null,
        template_data ? JSON.stringify(template_data) : null,
        draft_id,
      ]
    )
    return NextResponse.json({ id: draft_id })
  }

  // Create new draft — title and subject must be non-empty strings (NOT NULL columns)
  const result = await query(
    `INSERT INTO email_campaigns
       (template_key, title, subject, template_data, audience_type, audience_filter, status, created_by)
     VALUES ($1, $2, $3, $4, 'all', '{}', 'draft', $5)
     RETURNING id`,
    [
      template_key || 'custom',
      title || 'Draft',
      subject || '',
      JSON.stringify(template_data || {}),
      admin.adminId,
    ]
  )

  return NextResponse.json({ id: result.rows[0].id }, { status: 201 })
}
