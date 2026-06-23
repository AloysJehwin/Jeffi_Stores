import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await queryOne(
    `SELECT id, email, from_email, cc, bcc, subject, template_name, kind,
            entity_type, entity_id, status, error, sent_at, message_id,
            body_html, body_text, metadata
     FROM email_logs WHERE id = $1`,
    [id]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ row })
}
