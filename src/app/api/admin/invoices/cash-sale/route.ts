import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction, queryOne } from '@/lib/db'
import { calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'

export const dynamic = 'force-dynamic'

type UnitRow = { unit: string; dimension: string; min_qty: string; max_qty: string | null; qty_step: string }

async function validateLineItemQty(
  productId: string | null | undefined,
  variantId: string | null | undefined,
  qty: number
): Promise<string | null> {
  if (!productId && !variantId) return null
  let unit: UnitRow | null = null
  if (variantId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE variant_id = $1 AND is_sell_default = TRUE LIMIT 1`,
      [variantId]
    ) ?? null
  }
  if (!unit && productId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE product_id = $1 AND variant_id IS NULL AND is_sell_default = TRUE LIMIT 1`,
      [productId]
    ) ?? null
  }
  if (!unit) return null
  const min = Number(unit.min_qty ?? 1)
  const max = unit.max_qty != null ? Number(unit.max_qty) : null
  const step = Number(unit.qty_step ?? 1)
  if (qty < min) return `Quantity must be at least ${min} ${unit.unit}`
  if (max !== null && qty > max) return `Quantity cannot exceed ${max} ${unit.unit}`
  if (unit.dimension !== 'count' && step > 0) {
    const steps = Math.round((qty - min) / step)
    const snapped = Math.round((min + steps * step) * 1e6) / 1e6
    if (Math.abs(snapped - qty) > 1e-9) return `Quantity must be in steps of ${step} from ${min}`
  }
  return null
}

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
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const parsed = parseBody(cashSaleSchema, body, 'POST /api/admin/invoices/cash-sale')
    if (!parsed.ok) return parsed.response

    const { paymentMode: rawPaymentMode, notes, items } = parsed.data
    const paymentMode = rawPaymentMode ?? 'cash'

    if (!VALID_PAYMENT_MODES.includes(paymentMode)) {
      return NextResponse.json({ error: 'Invalid payment mode for cash sale' }, { status: 400 })
    }

    const orderIsIgst = false

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    for (const item of items) {
      const qtyErr = await validateLineItemQty(item.product_id, item.variant_id, parseFloat(item.quantity as any) || 0)
      if (qtyErr) return NextResponse.json({ error: qtyErr }, { status: 400 })
    }

    const processedItems = items.map((item: any) => {
      const unitPrice = parseFloat(item.unit_price) || 0
      const qty = parseFloat(item.quantity) || 0
      const discPct = parseFloat(item.discount_pct || '0') || 0
      const gstRate = parseFloat(item.gst_rate || '18')
      const lineTotal = Math.round(lineItemFromMrpIncl(qty, unitPrice, discPct, gstRate) * 100) / 100
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      return {
        product_id: item.product_id || null,
        product_name: item.product_name || '',
        product_sku: item.product_sku || '',
        variant_id: item.variant_id || null,
        sub_variant_id: item.sub_variant_id || null,
        variant_name: item.variant_name || null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit_price: unitPrice,
        total_price: lineTotal,
        taxable_amount: Math.round(gst.taxableAmount * 100) / 100,
        cgst_amount: Math.round(gst.cgst * 100) / 100,
        sgst_amount: Math.round(gst.sgst * 100) / 100,
        igst_amount: Math.round(gst.igst * 100) / 100,
        tax_amount: Math.round((gst.cgst + gst.sgst + gst.igst) * 100) / 100,
      }
    })

    const taxAmount = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100
    const totalAmount = Math.round(subtotal * 100) / 100

    const result = await withTransaction(async (client) => {
      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const saleNumber = `CS-${ts}-${rand}`

      const isGSTEnabled = process.env.ENABLE_GST === 'true'
      let invoiceNumber: string | null = null
      let fy: string | null = null
      let seq: number | null = null

      if (isGSTEnabled) {
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
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100,
          Math.round(totalSgst * 100) / 100,
          Math.round(totalIgst * 100) / 100,
          notes || null,
        ]
      )
      const saleId = saleResult.rows[0].id

      if (isGSTEnabled && invoiceNumber && fy && seq !== null) {
        await client.query(
          `INSERT INTO invoices (order_id, sale_id, invoice_number, financial_year, sequence_number) VALUES (NULL, $1, $2, $3, $4)`,
          [saleId, invoiceNumber, fy, seq]
        )
      }

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO cash_sale_items (
            sale_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$17)`,
          [
            saleId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name,
            item.hsn_code, item.gst_rate, item.quantity, item.unit_price,
            item.tax_amount, item.total_price, item.taxable_amount,
            item.cgst_amount, item.sgst_amount, item.igst_amount,
          ]
        )
      }

      for (const item of processedItems) {
        if (!item.product_id) continue
        const qty = item.quantity
        let stockBefore = 0

        if (item.sub_variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
            [item.sub_variant_id]
          )
          stockBefore = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stockBefore < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stockBefore}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [qty, item.sub_variant_id]
          )
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          stockBefore = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stockBefore < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stockBefore}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [qty, item.variant_id]
          )
        } else {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          stockBefore = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stockBefore < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}" — available: ${stockBefore}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [qty, item.product_id]
          )
        }

        await logStockMovement(client, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          subVariantId: item.sub_variant_id || null,
          transactionType: 'sale',
          quantityChange: -qty,
          referenceType: 'cash_sale',
          referenceId: saleId,
          currentStock: stockBefore,
        })
      }

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
