import { queryOne, getClient } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import type { AgentAction, ActionResult } from './shared'

export async function createCoupon(action: AgentAction): Promise<ActionResult> {
  const { code, discountType, discountValue, validUntil, minPurchaseAmount, usageLimit, description } =
    action.payload as {
      code: string
      discountType: string
      discountValue: number
      validUntil: string | null
      minPurchaseAmount: number | null
      usageLimit: number | null
      description: string | null
    }
  if (!code || !discountType || !discountValue)
    return { result: null, error: 'Missing required coupon fields in payload' }
  try {
    const inserted = await queryOne<{ id: string; code: string }>(
      `INSERT INTO coupons (code, description, discount_type, discount_value,
                            min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user,
                            valid_from, valid_until, is_active, auto_generated)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, NOW(), $7, TRUE, FALSE)
       RETURNING id::text, code`,
      [code, description, discountType, discountValue, minPurchaseAmount, usageLimit, validUntil]
    )
    if (!inserted) return { result: null, error: 'Insert returned no row' }
    return { result: { id: inserted.id, code: inserted.code }, error: null }
  } catch (err: any) {
    if (err?.code === '23505') return { result: null, error: 'Coupon code already exists' }
    return { result: null, error: String(err?.message || 'Insert failed') }
  }
}

export async function generatePersonalizedCoupon(action: AgentAction): Promise<ActionResult> {
  const { userId, customerEmail, discountType, discountValue, daysValid, campaign, validUntil } =
    action.payload as {
      userId: string
      customerEmail: string
      discountType: string
      discountValue: number
      daysValid: number
      campaign: string
      validUntil: string
    }
  if (!userId || !discountType || !discountValue)
    return { result: null, error: 'Missing required fields in payload' }
  const prefix =
    (campaign || 'OFFER')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'OFFER'
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  const code = `${prefix}-${random}`
  try {
    const inserted = await queryOne<{ id: string; code: string }>(
      `INSERT INTO coupons (code, description, discount_type, discount_value,
                            min_purchase_amount, max_discount_amount,
                            usage_limit, usage_limit_per_user, valid_from, valid_until, is_active,
                            auto_generated, generated_for_user_id, generated_for_campaign)
       VALUES ($1, $2, $3, $4, 0, NULL, 1, 1, NOW(), $5, TRUE, TRUE, $6::uuid, $7)
       RETURNING id::text, code`,
      [code, `Auto-generated for ${campaign}`, discountType, discountValue, validUntil, userId, campaign]
    )
    if (!inserted) return { result: null, error: 'Insert returned no row' }
    return {
      result: {
        id: inserted.id,
        code: inserted.code,
        userId,
        customerEmail,
        discountType,
        discountValue,
        daysValid,
      },
      error: null,
    }
  } catch (err: any) {
    if (err?.code === '23505') return { result: null, error: 'Coupon code collision (rare) — retry the action' }
    return { result: null, error: String(err?.message || 'Insert failed') }
  }
}

export async function createProduct(action: AgentAction): Promise<ActionResult> {
  const { name, sku, slug, basePrice, brandId, categoryId, shortDescription, weightGrams, gstPercentage } =
    action.payload as {
      name: string
      sku: string
      slug: string
      basePrice: number
      brandId: string | null
      categoryId: string | null
      shortDescription: string | null
      weightGrams: number
      gstPercentage: number
    }
  if (!name || !sku || !slug || !Number.isFinite(basePrice) || basePrice < 0)
    return { result: null, error: 'Invalid product payload' }
  const dup = await queryOne<{ id: string }>(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [sku])
  if (dup) return { result: null, error: `SKU "${sku}" already exists` }
  const created = await queryOne<{ id: string; name: string; sku: string }>(
    `INSERT INTO products (name, slug, sku, base_price, mrp, gst_percentage, short_description,
                           brand_id, category_id, weight_grams, inventory_quantity,
                           is_active, is_featured, has_variants)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7::uuid, $8::uuid, $9, 0, TRUE, FALSE, FALSE)
     RETURNING id::text, name, sku`,
    [name, slug, sku, basePrice, gstPercentage, shortDescription, brandId, categoryId, weightGrams]
  )
  if (!created) return { result: null, error: 'Insert failed' }
  return { result: created, error: null }
}

export async function updateProduct(action: AgentAction): Promise<ActionResult> {
  const { productId, changes } = action.payload as { productId: string; changes: Record<string, unknown> }
  const ALLOWED = new Set([
    'name',
    'base_price',
    'short_description',
    'is_featured',
    'is_active',
    'brand_id',
    'category_id',
    'gst_percentage',
  ])
  const sets: string[] = []
  const params: unknown[] = []
  for (const [k, v] of Object.entries(changes || {})) {
    if (!ALLOWED.has(k)) continue
    params.push(v === '' ? null : v)
    sets.push(
      k === 'brand_id' || k === 'category_id' ? `${k} = $${params.length}::uuid` : `${k} = $${params.length}`
    )
  }
  if (sets.length === 0) return { result: null, error: 'No valid fields to update' }
  params.push(productId)
  const updated = await queryOne(
    `UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}::uuid
     RETURNING id::text, name, is_active, is_featured`,
    params
  )
  if (!updated) return { result: null, error: 'Product not found' }
  return { result: updated, error: null }
}

export async function adjustInventory(action: AgentAction): Promise<ActionResult> {
  const { productId, delta, reason } = action.payload as { productId: string; delta: number; reason: string }
  if (!Number.isInteger(delta) || delta === 0) return { result: null, error: 'Invalid delta' }
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const cur = await client.query<{ inventory_quantity: number }>(
      `SELECT inventory_quantity FROM products WHERE id = $1::uuid FOR UPDATE`,
      [productId]
    )
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK')
      return { result: null, error: 'Product not found' }
    }
    const current = Number(cur.rows[0].inventory_quantity || 0)
    const computed = current + delta
    if (computed < 0) {
      await client.query('ROLLBACK')
      return { result: null, error: `Adjustment would drop stock to ${computed}` }
    }
    await client.query(`UPDATE products SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2::uuid`, [
      computed,
      productId,
    ])
    await logStockMovement(client, {
      productId,
      variantId: null,
      transactionType: 'adjustment',
      quantityChange: delta,
      referenceType: 'manual',
      referenceId: productId,
      notes: `Agent adjustment: ${reason}`,
    })
    await client.query('COMMIT')
    return { result: { productId, previous: current, delta, current: computed }, error: null }
  } catch (e: any) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    return { result: null, error: e?.message || 'Adjustment failed' }
  } finally {
    client.release()
  }
}

export async function setProductFeatured(action: AgentAction): Promise<ActionResult> {
  const { productId, featured, limit } = action.payload as { productId: string; featured: boolean; limit: number }
  const lim = typeof limit === 'number' && limit > 0 ? limit : 6
  if (featured) {
    const cur = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products WHERE is_featured = TRUE AND id <> $1::uuid`,
      [productId]
    )
    if ((cur?.n || 0) >= lim) return { result: null, error: `Featured limit (${lim}) reached. Unfeature one first.` }
  }
  const updated = await queryOne(
    `UPDATE products SET is_featured = $1, updated_at = NOW() WHERE id = $2::uuid
     RETURNING id::text, name, is_featured`,
    [!!featured, productId]
  )
  if (!updated) return { result: null, error: 'Product not found' }
  return { result: updated, error: null }
}

export async function createBrand(action: AgentAction): Promise<ActionResult> {
  const { name, slug, logoUrl } = action.payload as { name: string; slug: string; logoUrl: string | null }
  if (!name || !slug) return { result: null, error: 'name and slug required' }
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM brands WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
    [slug, name]
  )
  if (dup) return { result: null, error: `Brand with slug "${slug}" or matching name already exists` }
  const created = await queryOne(
    `INSERT INTO brands (name, slug, logo_url, is_active) VALUES ($1, $2, $3, TRUE)
     RETURNING id::text, name, slug, logo_url, is_active`,
    [name, slug, logoUrl]
  )
  if (!created) return { result: null, error: 'Insert failed' }
  return { result: created, error: null }
}

export async function createCategory(action: AgentAction): Promise<ActionResult> {
  const { name, slug, parentId } = action.payload as { name: string; slug: string; parentId: string | null }
  if (!name || !slug) return { result: null, error: 'name and slug required' }
  if (parentId) {
    const parent = await queryOne(`SELECT id FROM categories WHERE id = $1::uuid`, [parentId])
    if (!parent) return { result: null, error: 'Parent category not found' }
  }
  const dup = await queryOne<{ id: string }>(`SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [slug])
  if (dup) return { result: null, error: `Category slug "${slug}" already exists` }
  const created = await queryOne(
    `INSERT INTO categories (name, slug, parent_category_id, is_active, display_order)
     VALUES ($1, $2, $3::uuid, TRUE, 0)
     RETURNING id::text, name, slug, parent_category_id::text AS parent_id, is_active`,
    [name, slug, parentId]
  )
  if (!created) return { result: null, error: 'Insert failed' }
  return { result: created, error: null }
}
