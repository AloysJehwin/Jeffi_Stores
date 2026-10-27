import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryMany, queryOne, withTransaction } from '@jeffi/tenancy'
import { round2 } from '../../lib/gst'
import { PO_OPEN_SQL, PURCHASE_ORDERS_ENTITY, buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { z } from 'zod'
import { parseBody, zUuid, zCurrency } from '../../lib/validate'
import { announceLock, assertHolder, closeLock, draftLockResponse, epochFrom, lockBadges, lockNewDraft } from '../../lib/draft-locks'


const poItemSchema = z
  .object({
    product_id: zUuid,
    variant_id: zUuid.nullish(),
    sub_variant_id: zUuid.nullish(),
    quantity: z.coerce.number().positive(),
    unit_cost: zCurrency.optional(),
    tax_rate: z.coerce.number().min(0).default(0),
    product_name: z.string().nullish(),
    sku: z.string().nullish(),
    // purchase unit conversion (optional)
    purchase_unit: z.string().max(50).nullish(),
    purchase_unit_factor: z.coerce.number().positive().default(1),
    line_total_incl_gst: zCurrency.nullish(),
    gst_inclusive: z.boolean().default(true),
  })
  .refine(d => d.unit_cost != null || d.line_total_incl_gst != null, {
    message: 'Either unit_cost or line_total_incl_gst is required',
  })

const createPOSchema = z.object({
  supplier_id: zUuid,
  items: z.array(poItemSchema).min(1),
})

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    const w = buildWhere(PURCHASE_ORDERS_ENTITY, normalizeQuery(PURCHASE_ORDERS_ENTITY, searchParams))
    const where = w.conditions.length ? w.conditions.join(' AND ') : '1=1'
    const { params, nextIdx: i } = w

    // Total and the KPI strip (open POs, their value) over every matching PO, not just this page.
    const countRow = await queryOne<{ total: number; open: number; open_value: string }>(
      `SELECT COUNT(DISTINCT po.id)::int AS total,
              COUNT(DISTINCT po.id) FILTER (WHERE ${PO_OPEN_SQL})::int AS open,
              COALESCE(SUM(po.total_amount) FILTER (WHERE ${PO_OPEN_SQL}), 0) AS open_value
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${where}`,
      params
    )
    const total = countRow?.total || 0
    const summary = { open: countRow?.open || 0, open_value: Number(countRow?.open_value || 0) }

    const rows = await queryMany<any>(
      `SELECT
         po.id, po.po_number, po.status, po.order_date, po.expected_date,
         po.subtotal, po.tax_amount, po.total_amount, po.notes, po.created_at,
         s.id AS supplier_id, s.name AS supplier_name, s.email AS supplier_email,
         COUNT(poi.id)::int AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
       WHERE ${where}
       GROUP BY po.id, s.id
       ORDER BY po.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    )

    // Owner badge: the draft PO's editor, or whoever is mid-receipt.
    const all = rows || []
    const draftLocks = await lockBadges(admin, 'purchase_order', all.filter(r => r.status === 'draft').map(r => r.id))
    const receiveLocks = await lockBadges(admin, 'po_receive', all.filter(r => r.status !== 'draft').map(r => r.id))
    const withLocks = all.map(r => {
      const lock = draftLocks[r.id] ?? receiveLocks[r.id]
      return lock ? { ...r, lock } : r
    })
    return NextResponse.json({ purchase_orders: withLocks, total, page, limit, summary })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

// Sync a supplier's quoted buy-price (product_suppliers) from a PO line's cost.
// Leaf: sub-variant if the line has a sub_variant_id, else the variant resolved by SKU
// (or the line variant_id), else the product. Records price history by inserting a new
// dated row on change, creates the link if none exists. Never flips is_preferred.
// Also denormalizes the price's leaf supplier_id cache. Runs in the PO-create transaction.
async function syncSupplierPriceFromPO(
  client: import('pg').PoolClient,
  args: {
    productId: string
    sku: string | null
    variantIdFromLine: string | null
    subVariantIdFromLine: string | null
    supplierId: string
    unitCost: number
    poNumber: string
    purchaseUnit: string | null
    purchaseUnitFactor: number
  }
) {
  const {
    productId,
    sku,
    variantIdFromLine,
    subVariantIdFromLine,
    supplierId,
    unitCost,
    poNumber,
    purchaseUnit,
    purchaseUnitFactor,
  } = args
  if (!productId || !supplierId) return
  if (!Number.isFinite(unitCost) || unitCost < 0) return

  // Resolve the leaf. Sub-variant wins (one-leaf rule: sub_variant_id set, variant_id NULL).
  // Else try to resolve the SKU: first against product_variants, then against
  // product_sub_variants (a sub-variant SKU like TAP-HTJ15-RED never matches a variant row).
  // Else fall back to the line's explicit variant_id. Else product leaf.
  let variantId: string | null = null
  let subVariantId: string | null = subVariantIdFromLine || null
  if (!subVariantId) {
    if (sku) {
      // Try variant first.
      const vr = await client.query<{ id: string }>(
        `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 LIMIT 1`,
        [sku, productId]
      )
      if (vr.rows[0]) {
        variantId = vr.rows[0].id
      } else {
        // Try sub-variant — SKU may belong to a sub-variant (variant_id stays NULL per one-leaf rule).
        const svr = await client.query<{ id: string }>(
          `SELECT id FROM product_sub_variants WHERE sku = $1 AND product_id = $2 LIMIT 1`,
          [sku, productId]
        )
        if (svr.rows[0]) {
          subVariantId = svr.rows[0].id
          variantId = null
        } else {
          variantId = variantIdFromLine ?? null
        }
      }
    } else {
      variantId = variantIdFromLine ?? null
    }
  }

  const cost = Math.round(unitCost * 100) / 100 // product_suppliers.unit_cost is numeric(12,2)

  const cur = await client.query<{ id: string; unit_cost: string }>(
    `SELECT id, unit_cost FROM product_suppliers
     WHERE product_id = $1
       AND variant_id IS NOT DISTINCT FROM $2::uuid
       AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
       AND supplier_id = $4 AND is_active = true
     ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
    [productId, variantId, subVariantId, supplierId]
  )
  const existing = cur.rows[0]
  const note = `Auto-synced from PO ${poNumber}`
  const pUnit = purchaseUnit || null
  const pFactor = Number.isFinite(purchaseUnitFactor) && purchaseUnitFactor > 0 ? purchaseUnitFactor : 1

  if (!existing) {
    await client.query(
      `INSERT INTO product_suppliers
         (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, is_preferred, notes, purchase_unit, purchase_unit_factor)
       VALUES ($1, $2, $3, $4, $5, 'INR', false, false, $6, $7, $8)`,
      [productId, variantId, subVariantId, supplierId, cost, note, pUnit, pFactor]
    )
  } else if (Number(existing.unit_cost) !== cost) {
    // Price changed → deactivate old, insert a new dated row (preserve history).
    await client.query(
      `UPDATE product_suppliers SET is_active = false, is_preferred = false, updated_at = NOW() WHERE id = $1`,
      [existing.id]
    )
    await client.query(
      `INSERT INTO product_suppliers
         (product_id, variant_id, sub_variant_id, supplier_id, unit_cost, currency, gst_inclusive, is_preferred, notes, purchase_unit, purchase_unit_factor)
       VALUES ($1, $2, $3, $4, $5, 'INR', false, false, $6, $7, $8)`,
      [productId, variantId, subVariantId, supplierId, cost, note, pUnit, pFactor]
    )
  } else {
    // Cost unchanged, but keep the remembered purchase unit/factor current so the
    // next PO for this supplier+product prefills the latest conversion.
    await client.query(
      `UPDATE product_suppliers SET purchase_unit = $2, purchase_unit_factor = $3, updated_at = NOW()
       WHERE id = $1 AND (purchase_unit IS DISTINCT FROM $2 OR purchase_unit_factor IS DISTINCT FROM $3)`,
      [existing.id, pUnit, pFactor]
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const parsed = parseBody(createPOSchema, body, 'POST /api/admin/inventory/po')
    if (!parsed.ok) return parsed.response

    const { supplier_id, items } = parsed.data
    const { order_date, expected_date, notes, status = 'draft' } = body
    // The new-PO draft this was built from (promoted in the same transaction).
    const draftId: string | null = typeof body.draft_id === 'string' && body.draft_id ? body.draft_id : null

    if (!supplier_id) return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countRow = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM purchase_orders WHERE po_number LIKE $1`,
      [`PO-${datePart}-%`]
    )
    const seq = String((countRow?.cnt || 0) + 1).padStart(4, '0')
    const poNumber = `PO-${datePart}-${seq}`

    let subtotal = 0
    let taxAmount = 0
    const resolvedItems = items.map(item => {
      const factor = item.purchase_unit_factor ?? 1
      const baseQty = item.quantity * factor
      const gstRate = item.tax_rate ?? 0

      let unitCost: number
      const lineTotalInclGst: number | null = item.line_total_incl_gst ?? null

      if (lineTotalInclGst != null) {
        const totalExGst = item.gst_inclusive ? lineTotalInclGst / (1 + gstRate / 100) : lineTotalInclGst
        unitCost = totalExGst / baseQty
      } else {
        unitCost = item.unit_cost!
      }

      const lineExGst = unitCost * baseQty
      const lineTax = lineExGst * (gstRate / 100)
      subtotal += lineExGst
      taxAmount += lineTax

      return { ...item, resolvedUnitCost: unitCost, baseQty, factor }
    })
    const totalAmount = subtotal + taxAmount

    const po = await withTransaction(async client => {
      const poRow = await client.query<{ id: string }>(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, subtotal, tax_amount, total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          poNumber,
          supplier_id,
          status,
          order_date || new Date().toISOString().slice(0, 10),
          expected_date || null,
          notes || null,
          round2(subtotal),
          round2(taxAmount),
          round2(totalAmount),
        ]
      )
      const poId = poRow.rows[0]?.id

      for (const item of resolvedItems) {
        const { resolvedUnitCost, baseQty, factor } = item
        const tax = item.tax_rate ?? 0
        const total = round2(baseQty * resolvedUnitCost * (1 + tax / 100))

        // Validate variant_id against product_variants (guards against stale/mismatched
        // ids from the line picker, which would otherwise violate the FK). If it doesn't
        // resolve to a real variant of this product, treat the line as product-level.
        let safeVariantId: string | null = item.variant_id || null
        if (safeVariantId) {
          const vchk = await client.query<{ id: string }>(
            `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2 LIMIT 1`,
            [safeVariantId, item.product_id]
          )
          if (!vchk.rows[0]) safeVariantId = null
        }

        // Validate sub_variant_id against product_sub_variants (same product). If valid,
        // also pin its parent variant so variant_id + sub_variant_id are consistent.
        let safeSubVariantId: string | null = (item as any).sub_variant_id || null
        if (safeSubVariantId) {
          const svchk = await client.query<{ id: string; variant_id: string }>(
            `SELECT id, variant_id FROM product_sub_variants WHERE id = $1 AND product_id = $2 LIMIT 1`,
            [safeSubVariantId, item.product_id]
          )
          if (!svchk.rows[0]) safeSubVariantId = null
          else safeVariantId = svchk.rows[0].variant_id
        }

        await client.query(
          `INSERT INTO purchase_order_items
             (po_id, product_id, variant_id, sub_variant_id, product_name, sku, quantity, unit_cost, tax_rate, total_cost,
              purchase_unit, purchase_unit_factor, line_total_incl_gst, gst_inclusive)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            poId,
            item.product_id,
            safeVariantId,
            safeSubVariantId,
            item.product_name,
            item.sku || null,
            baseQty,
            Math.round(resolvedUnitCost * 1000000) / 1000000,
            tax,
            total,
            item.purchase_unit || null,
            factor,
            item.line_total_incl_gst ?? null,
            item.gst_inclusive ?? true,
          ]
        )

        // Auto-sync the supplier's quoted buy-price for this leaf from the PO line cost.
        await syncSupplierPriceFromPO(client, {
          productId: item.product_id,
          sku: item.sku || null,
          variantIdFromLine: safeVariantId,
          subVariantIdFromLine: safeSubVariantId,
          supplierId: supplier_id,
          unitCost: resolvedUnitCost,
          poNumber,
          purchaseUnit: item.purchase_unit || null,
          purchaseUnitFactor: factor,
        })
      }
      // Creating the PO publishes the caller's new-PO draft; a draft PO is the creator's to edit.
      let draftLock = null
      if (draftId) {
        draftLock = await assertHolder(client, admin, 'po_new', draftId, { epoch: epochFrom(request) })
        await client.query(`DELETE FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`, [draftId])
        await closeLock(client, admin, 'po_new', draftId, 'published')
      }
      return { id: poId, draftLock }
    })
    if (draftId) await announceLock(admin, 'po_new', draftId, po?.draftLock)
    if (status === 'draft' && po?.id) await lockNewDraft(admin, 'purchase_order', po.id)

    return NextResponse.json({ success: true, id: po?.id, po_number: poNumber })
  } catch (err: any) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
