import { Pool } from 'pg'
import { query, queryMany, queryOne } from '@/lib/db'

const FORBIDDEN_RE = /\b(admins|admin_agent_messages|admin_agent_actions|admin_sessions|payment_methods|razorpay_webhooks|webhook_events|password_hash|password|totp_secret|reset_token)\b/i
const DML_RE = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum|analyze|reindex|comment|cluster|lock|listen|notify|set\s+role|reset\s+role)\b/i

let _pool: Pool | null = null
function getReadonlyPool(): Pool {
  if (!_pool) {
    const conn = process.env.DATABASE_URL
    if (!conn) throw new Error('DATABASE_URL not configured')
    _pool = new Pool({
      connectionString: conn,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: /amazonaws|sslmode=require/.test(conn) ? { rejectUnauthorized: false } : undefined,
    })
    _pool.on('error', () => {})
  }
  return _pool
}

export interface ApprovedDynamicTool {
  id: string
  name: string
  description: string
  args_schema: Record<string, any>
  kind: 'readonly_sql' | 'templated_email'
  sql_template: string | null
  email_template: { subject: string; body: string; recipientArg: string } | null
}

export async function loadApprovedDynamicTool(name: string): Promise<ApprovedDynamicTool | null> {
  return queryOne<ApprovedDynamicTool>(
    `SELECT id::text, name, description, args_schema, kind,
            sql_template, email_template
       FROM admin_agent_proposed_tools
      WHERE name = $1 AND status = 'approved'
      LIMIT 1`,
    [name]
  )
}

export async function listApprovedDynamicTools(): Promise<ApprovedDynamicTool[]> {
  return queryMany<ApprovedDynamicTool>(
    `SELECT id::text, name, description, args_schema, kind,
            sql_template, email_template
       FROM admin_agent_proposed_tools
      WHERE status = 'approved'
      ORDER BY name ASC`
  )
}

function fillArgs(template: string, args: Record<string, any>): { positional: any[]; rendered: string } {
  const argNames: string[] = []
  const rendered = template.replace(/\$([a-z][a-z0-9_]*)/gi, (_match, name) => {
    if (!(name in args)) throw new Error(`Missing arg: ${name}`)
    if (!argNames.includes(name)) argNames.push(name)
    return `$${argNames.indexOf(name) + 1}`
  })
  const positional = argNames.map(n => args[n])
  return { positional, rendered }
}

function applyMustache(template: string, args: Record<string, any>): string {
  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (_match, key) => {
    return args[key] != null ? String(args[key]) : ''
  })
}

export async function runReadonlySql(tool: ApprovedDynamicTool, args: Record<string, any>) {
  if (tool.kind !== 'readonly_sql') throw new Error('Tool kind mismatch')
  if (!tool.sql_template) throw new Error('No sql_template')
  if (FORBIDDEN_RE.test(tool.sql_template)) throw new Error('SQL references forbidden table/column')
  if (DML_RE.test(tool.sql_template)) throw new Error('SQL contains DML/DDL')

  let positional: any[]
  let rendered: string
  try {
    ;({ positional, rendered } = fillArgs(tool.sql_template, args))
  } catch (err: any) {
    throw new Error(`Arg substitution failed: ${err.message}`)
  }

  const guarded = `${rendered} LIMIT 100`
  const pool = getReadonlyPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '5s'")
    const result = await client.query(guarded, positional)
    await client.query('ROLLBACK')
    return {
      rowCount: result.rowCount ?? result.rows.length,
      fields: result.fields?.map(f => f.name) || [],
      rows: result.rows.slice(0, 100),
      truncated: (result.rowCount ?? result.rows.length) >= 100,
    }
  } catch (err: any) {
    try { await client.query('ROLLBACK') } catch {}
    throw new Error(`SQL error: ${err?.message || err}`)
  } finally {
    client.release()
  }
}

export interface DynamicEmailProposal {
  proposed: true
  kind: 'send_dynamic_email'
  payload: {
    toolId: string
    toolName: string
    toEmail: string
    subject: string
    body: string
    args: Record<string, any>
  }
  confirmation: string
}

export async function buildDynamicEmailProposal(tool: ApprovedDynamicTool, args: Record<string, any>): Promise<DynamicEmailProposal> {
  if (tool.kind !== 'templated_email') throw new Error('Tool kind mismatch')
  if (!tool.email_template) throw new Error('No email_template')
  const { subject: subjectT, body: bodyT, recipientArg } = tool.email_template
  const toEmail = String(args[recipientArg] || '').trim()
  if (!toEmail.includes('@')) throw new Error(`Recipient arg "${recipientArg}" must be a valid email`)
  const subject = applyMustache(subjectT, args)
  const body = applyMustache(bodyT, args)
  return {
    proposed: true,
    kind: 'send_dynamic_email',
    payload: { toolId: tool.id, toolName: tool.name, toEmail, subject, body, args },
    confirmation: `Send "${subject.slice(0, 60)}..." via the "${tool.name}" tool to ${toEmail}?`,
  }
}

export async function bumpInvocationCount(toolId: string) {
  await query(
    `UPDATE admin_agent_proposed_tools
        SET invocation_count = invocation_count + 1, last_invoked_at = NOW()
      WHERE id = $1::uuid`,
    [toolId]
  )
}
