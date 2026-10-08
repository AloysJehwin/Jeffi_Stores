import { documentUrl } from '@/lib/shared/customer-links'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import {
  quotationLineSchema,
  quotationLineRow,
  quotationTotals,
  insertQuotationItem,
} from '@/lib/documents/invoice-line-items'

const zText = z.string().nullish()
const patchQuotationSchema = z
  .object({
    quote_date: z.string().nullish(),
    status: z.string().trim().max(20).nullish(),
    consignee_name: z.string().trim().max(255).nullish(),
    consignee_addr1: zText,
    consignee_addr2: zText,
    consignee_city: zText,
    consignee_state: zText,
    consignee_gstin: zText,
    consignee_phone: zText,
    consignee_pincode: zText,
    consignee_email: z.string().email('Enter a valid email').or(z.literal('')).nullish(),
    buyer_same: z.boolean().nullish(),
    buyer_name: zText,
    buyer_addr1: zText,
    buyer_addr2: zText,
    buyer_city: zText,
    buyer_state: zText,
    buyer_gstin: zText,
    buyer_phone: zText,
    buyer_pincode: zText,
    buyer_email: z.string().email('Enter a valid email').or(z.literal('')).nullish(),
    notes: zText,
    items: z.array(quotationLineSchema).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.status === 'final' && b.items && b.items.length === 0)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Add at least one line item before finalising' })
  })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(_req)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const qt = await queryOne<any>(
      `SELECT q.*, EXISTS(SELECT 1 FROM business_rfqs WHERE converted_quotation_id = q.id) AS from_rfq
       FROM quotations q WHERE q.id = $1`,
      [id]
    )
    if (!qt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany(
      `
      SELECT qi.*,
        COALESCE(sv.inventory_quantity, pv.inventory_quantity, p.inventory_quantity) AS inventory_quantity,
        COALESCE(
          puv.factor, pup.factor,
          puuv.factor, puup.factor,
          pu_sv.factor, pu_sp.factor,
          qi.sold_unit_factor
        ) AS sell_unit_factor,
        COALESCE(
          puv.dimension, pup.dimension,
          puuv.dimension, puup.dimension,
          pu_sv.dimension, pu_sp.dimension,
          CASE WHEN qi.sold_unit_factor IS NOT NULL THEN 'count' END
        ) AS sell_unit_dimension
      FROM quotation_items qi
      LEFT JOIN product_sub_variants sv   ON sv.id  = qi.sub_variant_id
      LEFT JOIN product_variants pv       ON pv.id  = qi.variant_id
      LEFT JOIN products p                ON p.id   = qi.product_id AND qi.variant_id IS NULL AND qi.sub_variant_id IS NULL
      LEFT JOIN product_variants pvar     ON pvar.id = qi.variant_id
      LEFT JOIN products prod             ON prod.id = qi.product_id
      -- buy_unit path (manually created quotations)
      LEFT JOIN product_units puv  ON puv.unit  = qi.buy_unit AND puv.product_id = qi.product_id AND puv.variant_id = qi.variant_id AND qi.buy_unit IS NOT NULL
      LEFT JOIN product_units pup  ON pup.unit  = qi.buy_unit AND pup.product_id = qi.product_id AND pup.variant_id IS NULL         AND qi.buy_unit IS NOT NULL
      -- qi.unit fallback (RFQ-converted items where buy_unit is NULL and sold_unit_factor is NULL)
      LEFT JOIN product_units puuv ON puuv.unit = qi.unit     AND puuv.product_id = qi.product_id AND puuv.variant_id = qi.variant_id AND qi.buy_unit IS NULL AND qi.sold_unit_factor IS NULL
      LEFT JOIN product_units puup ON puup.unit = qi.unit     AND puup.product_id = qi.product_id AND puup.variant_id IS NULL         AND qi.buy_unit IS NULL AND qi.sold_unit_factor IS NULL
      -- sell_unit_id fallback (default selling unit from variant/product)
      LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
      LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id  AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
      WHERE qi.quotation_id = $1
      ORDER BY qi.position
    `,
      [id]
    )
    return NextResponse.json({ quotation: qt, items: items || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const existing = await queryOne<any>(
      `SELECT id, status, subtotal, cgst_amount, sgst_amount, total_amount, converted_order_id
         FROM quotations WHERE id = $1`,
      [id]
    )
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const parsed = parseBody(patchQuotationSchema, await request.json(), `PATCH /api/admin/quotations/${id}`)
    if (!parsed.ok) return parsed.response
    const { items, ...fields } = parsed.data as Record<string, any> & { items?: z.infer<typeof quotationLineSchema>[] }
    if (existing.converted_order_id && Array.isArray(items))
      return NextResponse.json(
        { error: 'This quotation was already converted to an invoice — its line items can no longer change' },
        { status: 409 }
      )

    let totals = {
      subtotal: existing.subtotal,
      cgst_amount: existing.cgst_amount,
      sgst_amount: existing.sgst_amount,
      total_amount: existing.total_amount,
    }

    let rows: ReturnType<typeof quotationLineRow>[] | null = null
    if (Array.isArray(items)) {
      const { gstEnabled } = await getFeatureFlags()
      rows = items.map(item => quotationLineRow(item, gstEnabled))
      totals = quotationTotals(rows)
    } else if (Number(existing.total_amount) === 0) {
      // Stored totals are zero (e.g. legacy RFQ-converted quotation) — recompute from existing items
      const existingItems = await queryMany<any>(
        `SELECT amount, gst_rate FROM quotation_items WHERE quotation_id = $1`,
        [id]
      )
      if (existingItems?.length) totals = quotationTotals(existingItems)
    }

    const setClauses: string[] = ['updated_at = NOW()']
    const updateParams: any[] = []
    let pi = 1

    const textFields = [
      'quote_date',
      'status',
      'consignee_name',
      'consignee_addr1',
      'consignee_addr2',
      'consignee_city',
      'consignee_state',
      'consignee_gstin',
      'consignee_phone',
      'consignee_pincode',
      'consignee_email',
      'buyer_same',
      'buyer_name',
      'buyer_addr1',
      'buyer_addr2',
      'buyer_city',
      'buyer_state',
      'buyer_gstin',
      'buyer_phone',
      'buyer_pincode',
      'buyer_email',
      'notes',
    ]
    for (const field of textFields) {
      if (field in fields) {
        setClauses.push(`${field} = $${pi++}`)
        updateParams.push(fields[field])
      }
    }

    setClauses.push(
      `subtotal = $${pi++}`,
      `cgst_amount = $${pi++}`,
      `sgst_amount = $${pi++}`,
      `total_amount = $${pi++}`
    )
    updateParams.push(totals.subtotal, totals.cgst_amount, totals.sgst_amount, totals.total_amount)
    updateParams.push(id)

    // Header + line replace in one transaction so a failed insert never leaves an empty quote.
    const qt = await withTransaction(async client => {
      if (rows) {
        await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id])
        for (let idx = 0; idx < rows.length; idx++) await insertQuotationItem(client, id, idx, rows[idx])
      }
      const r = await client.query(
        `UPDATE quotations SET ${setClauses.join(', ')} WHERE id = $${pi} RETURNING *`,
        updateParams
      )
      return r.rows[0]
    })

    const savedItems = await queryMany(
      `
      SELECT qi.*,
        COALESCE(sv.inventory_quantity, pv.inventory_quantity, p.inventory_quantity) AS inventory_quantity,
        COALESCE(
          puv.factor, pup.factor,
          puuv.factor, puup.factor,
          pu_sv.factor, pu_sp.factor,
          qi.sold_unit_factor
        ) AS sell_unit_factor,
        COALESCE(
          puv.dimension, pup.dimension,
          puuv.dimension, puup.dimension,
          pu_sv.dimension, pu_sp.dimension,
          CASE WHEN qi.sold_unit_factor IS NOT NULL THEN 'count' END
        ) AS sell_unit_dimension
      FROM quotation_items qi
      LEFT JOIN product_sub_variants sv   ON sv.id  = qi.sub_variant_id
      LEFT JOIN product_variants pv       ON pv.id  = qi.variant_id
      LEFT JOIN products p                ON p.id   = qi.product_id AND qi.variant_id IS NULL AND qi.sub_variant_id IS NULL
      LEFT JOIN product_variants pvar     ON pvar.id = qi.variant_id
      LEFT JOIN products prod             ON prod.id = qi.product_id
      LEFT JOIN product_units puv  ON puv.unit  = qi.buy_unit AND puv.product_id = qi.product_id AND puv.variant_id = qi.variant_id AND qi.buy_unit IS NOT NULL
      LEFT JOIN product_units pup  ON pup.unit  = qi.buy_unit AND pup.product_id = qi.product_id AND pup.variant_id IS NULL         AND qi.buy_unit IS NOT NULL
      LEFT JOIN product_units puuv ON puuv.unit = qi.unit     AND puuv.product_id = qi.product_id AND puuv.variant_id = qi.variant_id AND qi.buy_unit IS NULL AND qi.sold_unit_factor IS NULL
      LEFT JOIN product_units puup ON puup.unit = qi.unit     AND puup.product_id = qi.product_id AND puup.variant_id IS NULL         AND qi.buy_unit IS NULL AND qi.sold_unit_factor IS NULL
      LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
      LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id  AND puv.id IS NULL AND pup.id IS NULL AND puuv.id IS NULL AND puup.id IS NULL
      WHERE qi.quotation_id = $1
      ORDER BY qi.position
    `,
      [id]
    )

    if (fields.status === 'final' && qt?.consignee_email) {
      try {
        const viewUrl = await documentUrl('quotation', qt.view_token)
        await sendQuotationFinalizedEmail(
          qt.consignee_email,
          qt.consignee_name || 'Customer',
          qt.quote_number,
          Number(qt.total_amount),
          viewUrl
        )
      } catch (emailErr) {
        console.error(`[admin/quotations/${id}] finalised email failed`, emailErr)
      }
    }

    return NextResponse.json({ quotation: qt, items: savedItems })
  } catch (e: any) {
    console.error(`[admin/quotations/${(await params).id} PATCH] failed`, e)
    return NextResponse.json({ error: e?.message || 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const existing = await queryOne<any>(`SELECT id, status FROM quotations WHERE id = $1`, [id])
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'draft')
      return NextResponse.json({ error: 'Only draft quotations can be deleted' }, { status: 400 })

    // Detach any RFQ that points to this quotation before deleting
    await query(
      `UPDATE business_rfqs SET converted_quotation_id = NULL, status = 'reviewed' WHERE converted_quotation_id = $1`,
      [id]
    )

    await query(`DELETE FROM quotations WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    // FK violation fallback (shouldn't reach here after the detach above, but just in case)
    if (e?.code === '23503') {
      return NextResponse.json(
        {
          error:
            'This quotation was created from a business RFQ and cannot be deleted while that link exists. Please handle the RFQ first.',
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: e?.message || 'Failed to delete' }, { status: 500 })
  }
}
