import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getClient, query } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

export const dynamic = 'force-dynamic'

const DRY_RUN_KIND = '__dry_run__'
const DRY_RUN_COOLDOWN_DAYS = 0
const DRY_RUN_LIMIT = 10000
const STATEMENT_TIMEOUT_MS = 5000

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const sql = typeof body.sql === 'string' ? body.sql : ''
  const productSql = typeof body.product_sql === 'string' ? body.product_sql.trim() : ''
  if (!sql.trim()) return NextResponse.json({ error: 'sql is required' }, { status: 400 })

  const validation = validateScenarioSql(sql, 'audience')
  if (!validation.ok) {
    await query(
      `INSERT INTO scenario_audit_log (admin_id, action, generated_sql, validation) VALUES ($1, 'dry_run_rejected', $2, $3::jsonb)`,
      [admin.id, sql, JSON.stringify(validation)]
    ).catch(() => {})
    return NextResponse.json({ error: validation.reason, validation }, { status: 400 })
  }

  let productValidation = null as ReturnType<typeof validateScenarioSql> | null
  if (productSql) {
    productValidation = validateScenarioSql(productSql, 'products')
    if (!productValidation.ok) {
      return NextResponse.json({ error: `product_sql: ${productValidation.reason}`, productValidation }, { status: 400 })
    }
  }

  const client = await getClient()
  let count = 0
  let sample: string[] = []
  let productCount = 0
  let productSample: Array<{ name: string; price: number | null; image_url: string | null }> = []
  let elapsedMs = 0
  const start = Date.now()

  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
    await client.query('SET LOCAL lock_timeout = \'1s\'')
    await client.query('SET LOCAL idle_in_transaction_session_timeout = \'10s\'')

    const result = await client.query<{ id: string }>(validation.normalized, [DRY_RUN_KIND, DRY_RUN_COOLDOWN_DAYS, DRY_RUN_LIMIT])
    count = result.rowCount || 0
    sample = result.rows.slice(0, 5).map(r => r.id)

    if (productValidation && productValidation.ok) {
      const pr = await client.query<{ name: string; price: number | null; image_url: string | null }>(productValidation.normalized)
      productCount = pr.rowCount || 0
      productSample = pr.rows.slice(0, 5).map(r => ({ name: r.name, price: r.price, image_url: r.image_url }))
    }

    await client.query('ROLLBACK')
  } catch (err: any) {
    try { await client.query('ROLLBACK') } catch {}
    await query(
      `INSERT INTO scenario_audit_log (admin_id, action, generated_sql, validation, result) VALUES ($1, 'dry_run_failed', $2, $3::jsonb, $4::jsonb)`,
      [admin.id, sql, JSON.stringify(validation), JSON.stringify({ error: String(err?.message || err), code: err?.code })]
    ).catch(() => {})
    const msg = String(err?.message || err)
    const friendly = err?.code === '57014'
      ? `Query timed out after ${STATEMENT_TIMEOUT_MS}ms — too expensive to run`
      : msg
    return NextResponse.json({ error: friendly, code: err?.code }, { status: 400 })
  } finally {
    elapsedMs = Date.now() - start
    client.release()
  }

  await query(
    `INSERT INTO scenario_audit_log (admin_id, action, generated_sql, validation, result) VALUES ($1, 'dry_run', $2, $3::jsonb, $4::jsonb)`,
    [admin.id, sql, JSON.stringify({ audience: validation, products: productValidation }), JSON.stringify({ count, sample, productCount, productSample, elapsedMs })]
  ).catch(() => {})

  return NextResponse.json({ count, sample, productCount, productSample, elapsedMs })
}
