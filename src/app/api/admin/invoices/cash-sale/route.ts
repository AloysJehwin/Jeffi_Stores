import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction, queryMany } from '@/lib/db'
import { calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence, round2 } from '@/lib/gst'
import { getFeatureFlags } from '@/lib/site-controls'
import { lineItemFromMrpIncl, lineItemExGst } from '@/lib/pricing'
import { deductStockForLines, type LineItem } from '@/lib/inventory-deduct'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const VALID_PAYMENT_MODES = ['cash', 'upi', 'upi_qr']

const cashSaleItemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name: z.string().default(''),
  product_sku: z.string().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  sub_variant_id: z.string().uuid().nullable().optional(),
  variant_name: z.string().optional(),
  hsn_code: z.string().optional(),
  gst_rate: z.coerce.number().optional(),
  unit_price: z.coerce.number().min(0),
  quantity: z.coerce.number().positive(),
  buy_unit: z.string().nullable().optional(),
  buy_mode: z.string().optional(),
  discount_pct: z.coerce.number().optional(),
  temp_id: z.string().optional(),
})

const cashSaleSchema = z.object({
  items: z.array(cashSaleItemSchema).min(1),
  paymentMode: z.string().nullish(),
  notes: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const batchAssignments: { order_item_id: string; batch_id: string; qty: number }[] = Array.isArray(body?.batch_assignments) ? body.batch_assignments : []
    const serialAssignments: { order_item_id: string; serial_number: string }[] = Array.isArray(body?.serial_assignments) ? body.serial_assignments : []

    const parsed = parseBody(cashSaleSchema, body, 'POST /api/admin/invoices/cash-sale')
    if (!parsed.ok) return parsed.response

    const { paymentMode: rawPaymentMode, notes, items } = parsed.data
    const paymentMode = rawPaymentMode ?? 'cash'

    if (!VALID_PAYMENT_MODES.includes(paymentMode)) {
      return NextResponse.json({ error: 'Invalid payment mode for cash sale' }, { status: 400 })
    }

    const orderIsIgst = false

    // Fetch unit factors for all items that have a product_id + buy_unit
    const itemsWithUnits = items.filter((i: any) => i.product_id && i.buy_unit)
    type UnitInfo = { factor: number; dimension: string }
    const unitFactorMap = new Map<string, UnitInfo>()
    if (itemsWithUnits.length) {
      const unitRows = await queryMany<any>(
        `SELECT
           inp.product_id, inp.variant_id, inp.buy_unit,
           COALESCE(puv.factor, pup.factor, 1)::numeric AS factor,
           COALESCE(puv.dimension, pup.dimension, 'count') AS dimension
         FROM (VALUES ${itemsWithUnits.map((_: any, i: number) => `($${i * 3 + 1}::uuid, $${i * 3 + 2}::uuid, $${i * 3 + 3})`).join(',')}) AS inp(product_id, variant_id, buy_unit)
         LEFT JOIN product_units puv ON puv.unit = inp.buy_unit AND puv.product_id = inp.product_id AND puv.variant_id = inp.variant_id
         LEFT JOIN product_units pup ON pup.unit = inp.buy_unit AND pup.product_id = inp.product_id AND pup.variant_id IS NULL
           AND (inp.variant_id IS NULL OR puv.id IS NULL)`,
        itemsWithUnits.flatMap((i: any) => [i.product_id, i.variant_id || null, i.buy_unit])
      )
      for (const r of (unitRows || [])) {
        unitFactorMap.set(`${r.product_id}:${r.variant_id ?? ''}:${r.buy_unit}`, { factor: parseFloat(r.factor) || 1, dimension: r.dimension })
      }
    }

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    // GST off ⇒ charge the ex-GST equivalent of the admin-entered incl price and
    // write zero tax columns. GST on ⇒ existing MRP-incl behaviour.
    const gstEnabled = (await getFeatureFlags()).gstEnabled

    const processedItems = items.map((item: any) => {
      const unitPrice = parseFloat(item.unit_price) || 0
      const rawQty = parseFloat(item.quantity) || 0
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const unitInfo = unitFactorMap.get(`${item.product_id}:${item.variant_id ?? ''}:${item.buy_unit}`)
      const effectiveQty = (unitInfo?.dimension === 'count' && unitInfo.factor > 1) ? rawQty * unitInfo.factor : rawQty

      if (!gstEnabled) {
        // Strip GST out of the entered incl price, apply discount, no tax added.
        const exUnit = gstRate > 0 ? unitPrice / (1 + gstRate / 100) : unitPrice
        const lineTotal = round2(lineItemExGst(effectiveQty, exUnit, discPct))
        subtotal += lineTotal
        const mrpLineTotal = round2(effectiveQty * unitPrice)
        const discountAmount = discPct > 0 ? round2(mrpLineTotal - lineTotal) : 0
        return {
          product_id: item.product_id || null,
          product_name: item.product_name || '',
          product_sku: item.product_sku || '',
          variant_id: item.variant_id || null,
          sub_variant_id: item.sub_variant_id || null,
          variant_name: item.variant_name || null,
          hsn_code: item.hsn_code || null,
          gst_rate: 0,
          quantity: rawQty,
          buy_unit: item.buy_unit || null,
          buy_mode: item.buy_mode || 'unit',
          unit_price: unitPrice,
          total_price: lineTotal,
          discount_amount: discountAmount,
          taxable_amount: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          tax_amount: 0,
          temp_id: item.temp_id || null,
        }
      }

      const lineTotal = round2(lineItemFromMrpIncl(effectiveQty, unitPrice, discPct, gstRate))
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      const mrpLineTotal = round2(effectiveQty * unitPrice)
      const discountAmount = discPct > 0 ? round2(mrpLineTotal - lineTotal) : 0

      return {
        product_id: item.product_id || null,
        product_name: item.product_name || '',
        product_sku: item.product_sku || '',
        variant_id: item.variant_id || null,
        sub_variant_id: item.sub_variant_id || null,
        variant_name: item.variant_name || null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: rawQty,
        buy_unit: item.buy_unit || null,
        buy_mode: item.buy_mode || 'unit',
        unit_price: unitPrice,
        total_price: lineTotal,
        discount_amount: discountAmount,
        taxable_amount: round2(gst.taxableAmount),
        cgst_amount: round2(gst.cgst),
        sgst_amount: round2(gst.sgst),
        igst_amount: round2(gst.igst),
        tax_amount: round2(gst.cgst + gst.sgst + gst.igst),
        temp_id: item.temp_id || null,
      }
    })

    const taxAmount = round2(totalCgst + totalSgst + totalIgst)
    const totalAmount = round2(subtotal)

    const result = await withTransaction(async (client) => {
      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const saleNumber = `CS-${ts}-${rand}`

      let invoiceNumber: string | null = null
      let fy: string | null = null
      let seq: number | null = null

      // Number every cash sale regardless of GST — GST-off is just a tax-free invoice,
      // but it must still be numbered so it shows on the invoice list.
      {
        const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
        const prefix = settingsResult.rows[0]?.value || 'JS'
        fy = getFinancialYear(new Date())
        seq = await getNextInvoiceSequence(client, fy)
        invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
      }

      const saleResult = await client.query(
        `INSERT INTO cash_sales (
          sale_number, invoice_number, invoice_date, financial_year, sequence_number,
          customer_name, payment_mode, payment_status,
          subtotal, tax_amount, total_amount,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
          notes
        ) VALUES (
          $1, $2, now(), $3, $4,
          'Walk-in Customer', $5, 'paid',
          $6, $7, $8,
          $9, $10, $11, $12, false,
          $13
        ) RETURNING id, sale_number`,
        [
          saleNumber, invoiceNumber, fy, seq,
          paymentMode,
          subtotal, taxAmount, totalAmount,
          round2(totalTaxable),
          round2(totalCgst),
          round2(totalSgst),
          round2(totalIgst),
          notes || null,
        ]
      )
      const saleId = saleResult.rows[0].id

      if (invoiceNumber && fy && seq !== null) {
        await client.query(
          `INSERT INTO invoices (order_id, sale_id, invoice_number, financial_year, sequence_number) VALUES (NULL, $1, $2, $3, $4)`,
          [saleId, invoiceNumber, fy, seq]
        )
      }

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO cash_sale_items (
            sale_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name,
            hsn_code, gst_rate, quantity, buy_unit, buy_mode, unit_price, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            saleId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name,
            item.hsn_code, item.gst_rate, item.quantity, item.buy_unit || null, item.buy_mode || 'unit',
            item.unit_price, item.discount_amount,
            item.tax_amount, item.total_price, item.taxable_amount,
            item.cgst_amount, item.sgst_amount, item.igst_amount,
          ]
        )
      }

      // Deduct stock via the shared helper. Cash sale has no order_items, so we
      // pass the in-memory processed lines directly. Each line's `id` is its
      // temp_id — the same key the batch/serial assignments reference. The
      // sale id is recorded on the ledger and product_serials.order_id.
      const lines: LineItem[] = processedItems
        .filter(item => item.product_id)
        .map(item => ({
          id: item.temp_id ?? '',
          product_id: item.product_id as string,
          variant_id: item.variant_id,
          sub_variant_id: item.sub_variant_id,
          product_name: item.product_name,
          variant_name: item.variant_name,
          quantity: item.quantity,
          buy_unit: item.buy_unit,
        }))

      await deductStockForLines(client, saleId, lines, {
        batchAssignments,
        serialAssignments,
        requireSerialAssignments: true,
      })

      return { invoiceNumber, saleId, saleNumber }
    })

    return NextResponse.json({
      success: true,
      invoiceNumber: result.invoiceNumber,
      saleId: result.saleId,
      invoiceUrl: `/api/admin/cash-sale/${result.saleId}/receipt`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
