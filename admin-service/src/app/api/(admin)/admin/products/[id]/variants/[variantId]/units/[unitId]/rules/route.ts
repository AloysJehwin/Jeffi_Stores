import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; variantId: string; unitId: string }>
}

const SUPPORTED_RULE_TYPES = ['tiered_price', 'bonus_qty'] as const

async function ensureUnit(productId: string, variantId: string, unitId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT pu.id
     FROM product_units pu
     JOIN product_variants pv ON pv.id = pu.variant_id
     WHERE pu.id = $1 AND pv.id = $2 AND pv.product_id = $3`,
    [unitId, variantId, productId]
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
  return 'rule_type not yet supported (Phase 5+)'
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id, variantId, unitId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureUnit(id, variantId, unitId))) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const ruleType = String(body.rule_type || '')
  if (!(SUPPORTED_RULE_TYPES as readonly string[]).includes(ruleType)) {
    return NextResponse.json({ error: `rule_type must be one of: ${SUPPORTED_RULE_TYPES.join(', ')}` }, { status: 400 })
  }
  const validationError = validateConfig(ruleType, body.config)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100
  const isActive = body.is_active !== false

  const inserted = await queryOne(
    `INSERT INTO product_unit_rules (product_unit_id, rule_type, config, is_active, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [unitId, ruleType, JSON.stringify(body.config), isActive, priority]
  )
  return NextResponse.json({ rule: inserted })
}
