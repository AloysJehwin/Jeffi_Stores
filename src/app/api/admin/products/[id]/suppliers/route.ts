import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

async function ensureProduct(productId: string) {
  const row = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId])
  return !!row
}

// Nil-uuid sentinel so a NULL leaf participates in equality with the unique index.
const NIL = '00000000-0000-0000-0000-000000000000'

// Current supplier price list for a product. Returns the latest dated row per
// (leaf, supplier) — each row carries variant_id/sub_variant_id so the caller can
// group by leaf. bestByLeaf maps a leaf key -> the cheapest supplier_id at that leaf.
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureProduct(id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const suppliers = await queryMany<any>(
    `SELECT DISTINCT ON (ps.variant_id, ps.sub_variant_id, ps.supplier_id)
       ps.id, ps.supplier_id, s.name AS supplier_name,
       ps.variant_id, ps.sub_variant_id,
       ps.unit_cost, ps.currency, ps.gst_inclusive, ps.moq,
       ps.lead_time_days, ps.is_preferred, ps.effective_date, ps.notes
     FROM product_suppliers ps
     JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id = $1 AND ps.is_active = true
     ORDER BY ps.variant_id, ps.sub_variant_id, ps.supplier_id, ps.effective_date DESC, ps.created_at DESC`,
    [id]
  )
  suppliers.sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost))

  // Cheapest supplier per leaf.
  const bestByLeaf: Record<string, string> = {}
  const leafKey = (r: any) => `${r.variant_id || NIL}:${r.sub_variant_id || NIL}`
  for (const r of suppliers) {
    const k = leafKey(r)
    if (!(k in bestByLeaf)) bestByLeaf[k] = r.supplier_id // suppliers already price-sorted asc
  }

  return NextResponse.json({ suppliers, bestByLeaf })
}

// Add a supplier price at a leaf (product / variant / sub-variant). Exactly one of
// variant_id / sub_variant_id may be set. If is_preferred, clears the flag on other
// rows AT THE SAME LEAF (also enforced by the per-leaf partial-unique index).
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const supplierId = String(body.supplier_id || '').trim()
  const unitCost = Number(body.unit_cost)
  const variantId = body.variant_id ? String(body.variant_id) : null
  const subVariantId = body.sub_variant_id ? String(body.sub_variant_id) : null
  if (!supplierId) return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })
  if (variantId && subVariantId) {
    return NextResponse.json(
      { error: 'A supplier attaches at one leaf: set variant_id OR sub_variant_id, not both' },
      { status: 400 }
    )
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return NextResponse.json({ error: 'unit_cost must be a non-negative number' }, { status: 400 })
  }
  if (!(await ensureProduct(id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const isPreferred = !!body.is_preferred
  const currency = body.currency ? String(body.currency).slice(0, 3) : 'INR'
  const gstInclusive = !!body.gst_inclusive
  const moq = body.moq != null && Number.isFinite(Number(body.moq)) ? Number(body.moq) : null
  const leadTime =
    body.lead_time_days != null && Number.isInteger(Number(body.lead_time_days)) ? Number(body.lead_time_days) : null
  const notes = body.notes ? String(body.notes).slice(0, 500) : null

  try {
    const inserted = await withTransaction(async client => {
      if (isPreferred) {
        await client.query(
          `UPDATE product_suppliers SET is_preferred = false, updated_at = NOW()
           WHERE product_id = $1 AND is_preferred = true
             AND COALESCE(variant_id, $2::uuid) IS NOT DISTINCT FROM COALESCE($3::uuid, $2::uuid)
             AND COALESCE(sub_variant_id, $2::uuid) IS NOT DISTINCT FROM COALESCE($4::uuid, $2::uuid)`,
          [id, NIL, variantId, subVariantId]
        )
      }
      const res = await client.query(
        `INSERT INTO product_suppliers
           (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, moq, lead_time_days, is_preferred, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [id, variantId, subVariantId, supplierId, unitCost, currency, gstInclusive, moq, leadTime, isPreferred, notes]
      )
      return res.rows[0]
    })
    return NextResponse.json({ success: true, id: inserted.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add supplier' }, { status: 500 })
  }
}
