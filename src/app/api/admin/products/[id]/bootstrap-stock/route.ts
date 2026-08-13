import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getClient, queryOne } from '@/lib/db'
import { syncPerishableStock, upsertShelfStock, syncCentralInventory } from '@/lib/shelf'
import { logStockMovement } from '@/lib/inventory'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

const assignmentSchema = z.object({
  variant_id: z.string().uuid().nullable().optional(),
  sub_variant_id: z.string().uuid().nullable().optional(),
  // Explicit quantity the client chose for this grain. This is the SOURCE OF TRUTH
  // for how many units to bootstrap — the route must NOT re-derive it from the live
  // inventory_quantity, which publish/sync may already have zeroed by this point.
  quantity: z.number().nonnegative().optional(),
  lot_number: z.string().nullable().optional(),
  manufacture_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  serial_numbers: z.array(z.string()).optional(),
})

const bodySchema = z.object({
  // New multi-grain shape: one assignment per variant/sub-variant that has stock.
  assignments: z.array(assignmentSchema).optional(),
  // Legacy single-grain shape (kept for back-compat).
  variant_id: z.string().uuid().nullable().optional(),
  sub_variant_id: z.string().uuid().nullable().optional(),
  lot_number: z.string().nullable().optional(),
  manufacture_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  serial_numbers: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params

  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const raw = await req.json()
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }
  const body = parsed.data

  const product = await queryOne<{ id: string; perishable: boolean; serialized: boolean; inventory_quantity: string }>(
    `SELECT id, perishable, serialized, inventory_quantity FROM products WHERE id = $1`,
    [productId]
  )
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!product.perishable && !product.serialized) {
    return NextResponse.json({ error: 'Product is neither perishable nor serialized' }, { status: 400 })
  }

  // Normalise to a list of assignments (legacy single-grain → one-element array).
  const assignments = (body.assignments && body.assignments.length)
    ? body.assignments
    : [{
        variant_id: body.variant_id ?? null,
        sub_variant_id: body.sub_variant_id ?? null,
        lot_number: body.lot_number ?? null,
        manufacture_date: body.manufacture_date ?? null,
        expiry_date: body.expiry_date ?? null,
        location_id: body.location_id ?? null,
        serial_numbers: body.serial_numbers ?? [],
      }]

  // --- Duplicate serial-number validation (mirrors the client-side check) ------
  // 1) No serial may repeat within this request (across every grain).
  if (product.serialized) {
    const seen = new Set<string>()
    const dupsInRequest = new Set<string>()
    for (const a of assignments) {
      for (const raw of (a.serial_numbers ?? [])) {
        const sn = (raw ?? '').trim()
        if (!sn) continue
        if (seen.has(sn)) dupsInRequest.add(sn)
        seen.add(sn)
      }
    }
    if (dupsInRequest.size > 0) {
      return NextResponse.json(
        { error: `Duplicate serial number(s) in submission: ${[...dupsInRequest].join(', ')}. Serial numbers must be unique.` },
        { status: 400 }
      )
    }
    // 2) None of these serials may already exist in stock anywhere.
    const allSerials = [...seen]
    if (allSerials.length > 0) {
      const clash = await queryOne<{ serial_number: string }>(
        `SELECT serial_number FROM product_serials
         WHERE serial_number = ANY($1::text[]) AND status = 'in_stock'
         LIMIT 1`,
        [allSerials]
      )
      if (clash) {
        return NextResponse.json(
          { error: `Serial number "${clash.serial_number}" already exists in stock. Serial numbers must be unique.` },
          { status: 409 }
        )
      }
    }
  }

  // --- Up-front per-grain validation ------------------------------------------
  // Validate EVERY assignment before writing anything, so the whole publish is
  // atomic and errors are precise. Previously a mid-loop throw rolled back all
  // grains with a vague message; here we reject with the exact offending grain and
  // never start a partial write. Only assignments with an explicit positive
  // quantity are treated as intended writes (legacy no-quantity shape is skipped).
  for (const a of assignments) {
    const grainLabel = a.sub_variant_id || a.variant_id || 'product'
    // Explicit quantity is the source of truth. 0/undefined → nothing to assign.
    const hasExplicitQty = typeof a.quantity === 'number'
    if (hasExplicitQty && (a.quantity as number) <= 0) continue
    const qty = hasExplicitQty ? (a.quantity as number) : null

    // Serialized/perishable stock must land on a shelf; require a location so the
    // batch never gets a NULL location_id (which would silently skip shelf sync).
    if (!a.location_id) {
      return NextResponse.json(
        { error: `A shelf location is required for grain "${grainLabel}".` },
        { status: 400 }
      )
    }
    if (product.perishable && !a.expiry_date) {
      return NextResponse.json(
        { error: `Expiry date is required for grain "${grainLabel}".` },
        { status: 400 }
      )
    }
    if (product.serialized) {
      const serials = (a.serial_numbers ?? []).map(s => (s ?? '').trim()).filter(Boolean)
      // needed comes from the explicit qty when present; else defer to live qty in
      // the write loop (legacy shape) — only enforce the count when qty is explicit.
      if (qty !== null) {
        const needed = Math.round(qty)
        if (serials.length !== needed) {
          return NextResponse.json(
            { error: `Grain "${grainLabel}" needs ${needed} serial number${needed !== 1 ? 's' : ''}, but ${serials.length} were provided.` },
            { status: 400 }
          )
        }
      }
    }
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    // Collected for the label-printing popup shown after conversion.
    const createdBatchIds: string[] = []
    const createdSerials: string[] = []

    for (const a of assignments) {
      const variantId = a.variant_id ?? null
      const subVariantId = a.sub_variant_id ?? null

      // Quantity to bootstrap for this grain. Prefer the client's EXPLICIT quantity
      // (the source of truth). Only fall back to reading the live inventory_quantity
      // for the legacy single-grain shape that omits it — never override the explicit
      // value, because by publish time syncPerishableStock/syncCentralInventory may
      // have already recomputed the live inventory to 0 (which would skip the grain).
      let inventoryQty: number
      if (typeof a.quantity === 'number' && a.quantity > 0) {
        inventoryQty = a.quantity
      } else if (typeof a.quantity === 'number') {
        // Explicit zero → nothing to assign for this grain.
        continue
      } else if (subVariantId) {
        const sv = await queryOne<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1`, [subVariantId])
        inventoryQty = parseFloat(sv?.inventory_quantity ?? '0') || 0
      } else if (variantId) {
        const v = await queryOne<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM product_variants WHERE id = $1 AND product_id = $2`, [variantId, productId])
        inventoryQty = parseFloat(v?.inventory_quantity ?? '0') || 0
      } else {
        inventoryQty = parseFloat(product.inventory_quantity) || 0
      }
      if (inventoryQty <= 0) continue

      if (product.perishable && !a.expiry_date) {
        throw new Error(`Expiry date required for grain ${subVariantId || variantId || 'product'}`)
      }
      if (product.serialized) {
        const needed = Math.round(inventoryQty)
        const serials = (a.serial_numbers ?? []).filter(Boolean)
        if (serials.length !== needed) {
          throw new Error(`${needed} serial(s) required for a grain, got ${serials.length}`)
        }
      }

      // Grains already bootstrapped (idempotent per grain). Count only ACTIVE stock —
      // batches with quantity_remaining > 0 and in-stock serials — so a grain whose
      // earlier stock was fully consumed can be re-bootstrapped with new stock.
      // NOTE: when already bootstrapped we skip CREATING new batches/serials, but we
      // still re-sync the shelf + central inventory below. This is critical because
      // publishProductDraft overwrites product_variants.inventory_quantity from the
      // draft snapshot (often 0 for a converted product) on EVERY save — so without a
      // re-sync here, a second save would leave the variant reading 0 despite stock.
      const existing = await queryOne<{ total: number }>(
        `SELECT (
           (SELECT COUNT(*) FROM product_batches WHERE product_id = $1 AND quantity_remaining > 0
              AND (variant_id = $2 OR ($2::uuid IS NULL AND variant_id IS NULL))
              AND (sub_variant_id = $3 OR ($3::uuid IS NULL AND sub_variant_id IS NULL)))
         + (SELECT COUNT(*) FROM product_serials WHERE product_id = $1 AND status='in_stock'
              AND (variant_id = $2 OR ($2::uuid IS NULL AND variant_id IS NULL))
              AND (sub_variant_id = $3 OR ($3::uuid IS NULL AND sub_variant_id IS NULL)))
         )::int AS total`,
        [productId, variantId, subVariantId]
      )
      const alreadyBootstrapped = (existing?.total ?? 0) > 0

      if (!alreadyBootstrapped) {
        let newBatchId: string | null = null
        const batchRes = await client.query<{ id: string }>(
          `INSERT INTO product_batches
             (product_id, variant_id, sub_variant_id, grn_id, lot_number, manufacture_date, expiry_date, quantity, quantity_remaining, location_id)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$7,$8) RETURNING id`,
          [productId, variantId, subVariantId, a.lot_number || null, a.manufacture_date || null, a.expiry_date || null, inventoryQty, a.location_id || null]
        )
        newBatchId = batchRes.rows[0].id
        createdBatchIds.push(newBatchId)

        if (product.serialized) {
          const serials = (a.serial_numbers ?? []).filter(Boolean)
          for (let i = 0; i < serials.length; i++) {
            createdSerials.push(serials[i])
            await client.query(
              `INSERT INTO product_serials
                 (product_id, variant_id, sub_variant_id, batch_id, grn_id, serial_number, receive_seq, status)
               VALUES ($1,$2,$3,$4,NULL,$5,$6,'in_stock')`,
              [productId, variantId, subVariantId, newBatchId, serials[i], i]
            )
          }
        }

        await logStockMovement(client, {
          productId, variantId, subVariantId,
          transactionType: 'adjustment', quantityChange: 0,
          referenceType: 'manual', referenceId: productId,
          notes: 'Bootstrap: assigned existing stock to batch/serials',
          currentStock: inventoryQty,
        })
      }

      // Place the stock on the shelf + refresh central inventory — ALWAYS, even when
      // the grain was already bootstrapped, so a re-save that zeroed inventory_quantity
      // (via publishProductDraft) is reconciled back to the shelf truth.
      //  • Perishable (incl. perishable+serialized): syncPerishableStock recomputes
      //    shelf_stock from the batch location(s) and syncs central inventory.
      //  • Serialized-only (not perishable): write the shelf row directly, then sync
      //    central inventory from the shelf total.
      if (product.perishable) {
        await syncPerishableStock(client, productId, variantId, subVariantId)
      } else if (product.serialized && a.location_id) {
        if (!alreadyBootstrapped) {
          await upsertShelfStock(client, {
            locationId: a.location_id, productId, variantId, subVariantId,
            quantity: Math.round(inventoryQty), mode: 'add',
          })
        }
        await syncCentralInventory(client, productId, variantId, subVariantId)
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true, batch_ids: createdBatchIds, serial_numbers: createdSerials })
  } catch (err: any) {
    await client.query('ROLLBACK')
    // Unique-violation on a serial (e.g. a concurrent bootstrap that raced past the
    // pre-check) → clean 409, never leak the raw Postgres constraint message.
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: 'One or more serial numbers already exist in stock. Serial numbers must be unique.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: err.message || 'Failed to bootstrap stock' }, { status: 500 })
  } finally {
    client.release()
  }
}
