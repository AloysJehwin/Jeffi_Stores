import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'

export interface ProposedToolRow {
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
}

/** One page of the agent's proposed tools (`status` or 'all'), newest first, with the total: the Proposed tools page, its API and its export. */
export async function pageProposedTools(status: string, pageSize: number, page: number): Promise<{ items: ProposedToolRow[]; total: number }> {
  const offset = (page - 1) * pageSize

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM admin_agent_proposed_tools
      WHERE ($1 = 'all' OR status = $1)`,
    [status]
  )
  const total = parseInt(countRow?.total || '0', 10)

  const items = await queryMany<ProposedToolRow>(
    `SELECT id::text, name, description, kind, args_schema, sql_template, email_template,
            status, source_prompt, created_at, decided_at, rejection_reason,
            invocation_count, last_invoked_at
       FROM admin_agent_proposed_tools
      WHERE ($1 = 'all' OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, pageSize, offset]
  )
  return { items, total }
}
