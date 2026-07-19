import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getClient, queryOne } from '@/lib/db'
import { syncPerishableStock, upsertShelfStock } from '@/lib/shelf'
import { logStockMovement } from '@/lib/inventory'

const bodySchema = z.object({
  variant_id: z.string().uuid().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  manufacture_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  serial_numbers: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params

  const raw = await req.json()
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }
  const body = parsed.data
  const variantId = body.variant_id ?? null

  const product = await queryOne<{
    id: string
    perishable: boolean
    serialized: boolean
    inventory_quantity: string
  }>(
    `SELECT id, perishable, serialized, inventory_quantity FROM products WHERE id = $1`,
    [productId]
  )
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  if (!product.perishable && !product.serialized) {
    return NextResponse.json({ error: 'Product is neither perishable nor serialized' }, { status: 400 })
  }

  // For variant products, read stock from the variant row
  let inventoryQty: number
  let subVariantId: string | null = null
  if (variantId) {
    const variant = await queryOne<{ inventory_quantity: string; sub_variant_id: string | null }>(
      `SELECT inventory_quantity, NULL::uuid AS sub_variant_id FROM product_variants WHERE id = $1 AND product_id = $2`,
      [variantId, productId]
    )
    if (!variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
    }
    inventoryQty = parseFloat(variant.inventory_quantity) || 0
    subVariantId = variant.sub_variant_id
  } else {
    inventoryQty = parseFloat(product.inventory_quantity) || 0
  }

  if (inventoryQty <= 0) {
    return NextResponse.json({ error: 'No existing stock to bootstrap' }, { status: 400 })
  }

  if (product.perishable && !body.expiry_date) {
    return NextResponse.json({ error: 'Expiry date is required for perishable products' }, { status: 400 })
  }

  if (product.serialized) {
    const needed = Math.round(inventoryQty)
    const serials = body.serial_numbers ?? []
    if (serials.length !== needed) {
      return NextResponse.json({ error: `${needed} serial number(s) required, got ${serials.length}` }, { status: 400 })
    }
  }

  // Guard: check if already bootstrapped
  const existingBatch = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM product_batches WHERE product_id = $1 AND ($2::uuid IS NULL OR variant_id = $2)`,
    [productId, variantId]
  )
  const existingSerial = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM product_serials WHERE product_id = $1 AND ($2::uuid IS NULL OR variant_id = $2) AND status = 'in_stock'`,
    [productId, variantId]
  )
  if ((existingBatch?.total ?? 0) > 0 || (existingSerial?.total ?? 0) > 0) {
    return NextResponse.json({ error: 'Stock already bootstrapped' }, { status: 409 })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    let newBatchId: string | null = null

    if (product.perishable || product.serialized) {
      const batchRes = await client.query<{ id: string }>(
        `INSERT INTO product_batches
           (product_id, variant_id, sub_variant_id, grn_id, lot_number,
            manufacture_date, expiry_date, quantity, quantity_remaining, location_id)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$7,$8) RETURNING id`,
        [
          productId,
          variantId,
          subVariantId,
          body.lot_number || null,
          body.manufacture_date || null,
          body.expiry_date || null,
          inventoryQty,
          body.location_id || null,
        ]
      )
      newBatchId = batchRes.rows[0].id
    }

    if (product.serialized) {
      const serials = body.serial_numbers ?? []
      for (const sn of serials) {
        await client.query(
          `INSERT INTO product_serials
             (product_id, variant_id, sub_variant_id, batch_id, grn_id, serial_number, status)
           VALUES ($1,$2,$3,$4,NULL,$5,'in_stock')`,
          [productId, variantId, subVariantId, newBatchId, sn]
        )
      }
    }

    await logStockMovement(client, {
      productId,
      variantId,
      subVariantId,
      transactionType: 'adjustment',
      quantityChange: 0,
      referenceType: 'manual',
      referenceId: productId,
      notes: 'Bootstrap: assigned existing stock to batch/serials',
      currentStock: inventoryQty,
    })

    if (product.perishable) {
      await syncPerishableStock(client, productId, variantId, subVariantId)
    } else if (product.serialized && body.location_id) {
      await upsertShelfStock(client, {
        locationId: body.location_id,
        productId,
        variantId,
        subVariantId,
        quantity: Math.round(inventoryQty),
        mode: 'add',
      })
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: err.message || 'Failed to bootstrap stock' }, { status: 500 })
  } finally {
    client.release()
  }
}
