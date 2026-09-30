import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = (url.searchParams.get('status') || 'proposed').toLowerCase()
  const pageSize = Math.min(
    parseInt(url.searchParams.get('pageSize') || url.searchParams.get('limit') || '25', 10),
    200
  )
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const offset = (page - 1) * pageSize

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM admin_agent_proposed_tools
      WHERE ($1 = 'all' OR status = $1)`,
    [status]
  )
  const total = parseInt(countRow?.total || '0', 10)

  const rows = await queryMany<{
    id: string
    name: string
    description: string
    kind: string
    args_schema: any
    sql_template: string | null
    email_template: any
    status: string
    source_prompt: string
    created_at: string
    decided_at: string | null
    rejection_reason: string | null
    invocation_count: number
    last_invoked_at: string | null
  }>(
    `SELECT id::text, name, description, kind, args_schema, sql_template, email_template,
            status, source_prompt, created_at, decided_at, rejection_reason,
            invocation_count, last_invoked_at
       FROM admin_agent_proposed_tools
      WHERE ($1 = 'all' OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, pageSize, offset]
  )

  return NextResponse.json({ items: rows, total, page, pageSize })
}
