import { NextRequest, NextResponse } from 'next/server'
import { queryOne, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

const VARIANT_FIELD_MAP: Record<string, string> = {
  base_price: 'price',
  mrp: 'mrp',
  sale_price: 'sale_price',
  wholesale_price: 'wholesale_price',
  weight_rate: 'weight_rate',
  length_rate: 'length_rate',
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { log_id } = await request.json()
  if (!log_id) return NextResponse.json({ error: 'log_id required' }, { status: 400 })

  const log = await queryOne(
    `SELECT id, category_id, category_name, percentage, applied_fields, snapshot, is_rollback, rolled_back_at
     FROM price_inflation_log WHERE id = $1`,
    [log_id]
  )

  if (!log) return NextResponse.json({ error: 'Log entry not found' }, { status: 404 })
  if (!log.snapshot || log.snapshot.length === 0) return NextResponse.json({ error: 'No snapshot available for this entry' }, { status: 400 })
  if (log.rolled_back_at) return NextResponse.json({ error: 'This inflation has already been rolled back' }, { status: 400 })
  if (log.is_rollback) return NextResponse.json({ error: 'Cannot roll back a rollback entry' }, { status: 400 })

  const snapshot: any[] = log.snapshot

  try {
    await withTransaction(async (client) => {
      for (const p of snapshot) {
        const setClauses: string[] = []
        const values: any[] = []
        let i = 1

        for (const f of log.applied_fields) {
          const before = p.before[f]
          if (before != null) {
            setClauses.push(`${f} = $${i++}`)
            values.push(before)
          }
        }

        if (setClauses.length > 0) {
          values.push(p.id)
          await client.query(`UPDATE products SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${i}`, values)
        }

        for (const v of (p.variants || [])) {
          const vClauses: string[] = []
          const vValues: any[] = []
          let vi = 1

          for (const f of log.applied_fields) {
            const col = VARIANT_FIELD_MAP[f]
            const before = v.before[f]
            if (before != null) {
              vClauses.push(`${col} = $${vi++}`)
              vValues.push(before)
            }
          }

          if (vClauses.length > 0) {
            vValues.push(v.id)
            await client.query(`UPDATE product_variants SET ${vClauses.join(', ')}, updated_at = NOW() WHERE id = $${vi}`, vValues)
          }
        }
      }

      await client.query(
        `UPDATE price_inflation_log SET rolled_back_at = NOW(), rolled_back_by = $1 WHERE id = $2`,
        [admin.username || 'admin', log_id]
      )

      await client.query(
        `INSERT INTO price_inflation_log (category_id, category_name, percentage, applied_fields, product_count, applied_by, is_rollback)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [log.category_id, log.category_name, log.percentage, log.applied_fields, snapshot.length, admin.username || 'admin']
      )
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to rollback' }, { status: 500 })
  }

  return NextResponse.json({ success: true, product_count: snapshot.length })
}
