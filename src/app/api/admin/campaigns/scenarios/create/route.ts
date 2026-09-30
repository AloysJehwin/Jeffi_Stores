import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, withTransaction } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

export const dynamic = 'force-dynamic'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const aiPrompt = typeof body.ai_prompt === 'string' ? body.ai_prompt.trim() : ''
  const sql = typeof body.generated_sql === 'string' ? body.generated_sql.trim() : ''
  const productSqlRaw = typeof body.product_sql === 'string' ? body.product_sql.trim() : ''
  const dryRunCount = typeof body.dry_run_count === 'number' ? body.dry_run_count : null
  const parameters = body.parameters && typeof body.parameters === 'object' ? body.parameters : {}
  const kind = typeof body.kind === 'string' && body.kind.trim() ? slugify(body.kind) : slugify(name)

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 })
  if (!aiPrompt) return NextResponse.json({ error: 'ai_prompt is required' }, { status: 400 })
  if (!sql) return NextResponse.json({ error: 'generated_sql is required' }, { status: 400 })
  if (dryRunCount === null)
    return NextResponse.json({ error: 'dry_run_count is required — run a dry-run first' }, { status: 400 })

  const validation = validateScenarioSql(sql, 'audience')
  if (!validation.ok) {
    await query(
      `INSERT INTO scenario_audit_log (admin_id, scenario_kind, action, generated_sql, validation) VALUES ($1, $2, 'save_rejected', $3, $4::jsonb)`,
      [admin.id, kind, sql, JSON.stringify(validation)]
    ).catch(() => {})
    return NextResponse.json({ error: validation.reason, validation }, { status: 400 })
  }

  let productSqlNormalized: string | null = null
  if (productSqlRaw) {
    const pv = validateScenarioSql(productSqlRaw, 'products')
    if (!pv.ok) {
      return NextResponse.json({ error: `product_sql: ${pv.reason}`, productValidation: pv }, { status: 400 })
    }
    productSqlNormalized = pv.normalized
  }

  const existing = await queryOne(`SELECT kind FROM scenarios WHERE kind = $1`, [kind])
  if (existing) {
    return NextResponse.json({ error: `kind "${kind}" already exists — pick a different name` }, { status: 409 })
  }

  try {
    await withTransaction(async client => {
      await client.query(
        `INSERT INTO scenarios (kind, name, description, default_parameters)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [kind, name, description || null, JSON.stringify(parameters)]
      )
      await client.query(
        `INSERT INTO custom_scenarios (kind, name, description, ai_prompt, generated_sql, product_sql, dry_run_count, dry_run_at, approved_by, approved_at, enabled, parameters)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, NOW(), FALSE, $9::jsonb)`,
        [
          kind,
          name,
          description || null,
          aiPrompt,
          validation.normalized,
          productSqlNormalized,
          dryRunCount,
          admin.id,
          JSON.stringify(parameters),
        ]
      )
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to save scenario' }, { status: 500 })
  }

  await query(
    `INSERT INTO scenario_audit_log (admin_id, scenario_kind, action, ai_prompt, generated_sql, validation, result) VALUES ($1, $2, 'save', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      admin.id,
      kind,
      aiPrompt,
      validation.normalized,
      JSON.stringify(validation),
      JSON.stringify({ dry_run_count: dryRunCount }),
    ]
  ).catch(() => {})

  return NextResponse.json({ success: true, kind })
}
