import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string; unitId: string } }

const SUPPORTED = ['tiered_price', 'bonus_qty'] as const

async function ensureUnit(productId: string, unitId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM product_units WHERE id = $1 AND product_id = $2 AND variant_id IS NULL`,
    [unitId, productId]
  )
  return !!row
}

function validateConfig(ruleType: string, config: any): string | null {
  if (ruleType === 'tiered_price') {
    if (!Array.isArray(config?.tiers)) return 'tiers array required'
    for (const t of config.tiers) {
      if (typeof t.min_qty !== 'number' || t.min_qty <= 0) return 'each tier needs min_qty > 0'
      if (typeof t.price !== 'number' || t.price < 0) return 'each tier needs price >= 0'
    }
    return null
  }
  if (ruleType === 'bonus_qty') {
    if (typeof config?.buy !== 'number' || config.buy <= 0) return 'buy must be > 0'
    if (typeof config?.get_extra !== 'number' || config.get_extra <= 0) return 'get_extra must be > 0'
    return null
  }
  return 'rule_type not yet supported'
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureUnit(params.id, params.unitId))) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const ruleType = String(body.rule_type || '')
  if (!(SUPPORTED as readonly string[]).includes(ruleType)) {
    return NextResponse.json({ error: `rule_type must be one of: ${SUPPORTED.join(', ')}` }, { status: 400 })
  }
  const validationError = validateConfig(ruleType, body.config)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100
  const isActive = body.is_active !== false

  const inserted = await queryOne(
    `INSERT INTO product_unit_rules (product_unit_id, rule_type, config, is_active, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.unitId, ruleType, JSON.stringify(body.config), isActive, priority]
  )
  return NextResponse.json({ rule: inserted })
}
