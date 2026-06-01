# Catalog Approve-Route Cases

Drop these into the `switch (action.kind)` block in
`src/app/api/admin/agent/actions/[id]/approve/route.ts` inside `executeAction()`.

All cases follow the existing `{ result, error }` contract.
Helpers used (already imported in the route file): `query`, `queryOne`, `queryMany`.
You will additionally need `getClient` from `@/lib/db` and `logStockMovement` from
`@/lib/inventory` for the `adjust_inventory` case.

```ts
import { getClient } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
```

---

## `create_product`

```ts
case 'create_product': {
  const { name, sku, slug, basePrice, brandId, categoryId, shortDescription, weightGrams, gstPercentage } = action.payload as {
    name: string; sku: string; slug: string; basePrice: number;
    brandId: string | null; categoryId: string | null;
    shortDescription: string | null; weightGrams: number; gstPercentage: number;
  }
  if (!name || !sku || !slug || !Number.isFinite(basePrice) || basePrice < 0) {
    return { result: null, error: 'Invalid product payload' }
  }
  const dup = await queryOne<{ id: string }>(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [sku])
  if (dup) return { result: null, error: `SKU "${sku}" already exists` }
  const created = await queryOne<{ id: string; name: string; sku: string }>(
    `INSERT INTO products
       (name, slug, sku, base_price, mrp, gst_percentage, short_description,
        brand_id, category_id, weight_grams, inventory_quantity, low_stock_threshold,
        is_active, is_featured, has_variants)
     VALUES ($1, $2, $3, $4, $4, $5, $6,
             $7::uuid, $8::uuid, $9, 0, 10,
             TRUE, FALSE, FALSE)
     RETURNING id::text, name, sku`,
    [name, slug, sku, basePrice, gstPercentage, shortDescription,
     brandId, categoryId, weightGrams]
  )
  if (!created) return { result: null, error: 'Insert failed' }
  return { result: created, error: null }
}
```

---

## `update_product`

```ts
case 'update_product': {
  const { productId, changes } = action.payload as {
    productId: string; changes: Record<string, unknown>
  }
  const ALLOWED = new Set([
    'name', 'base_price', 'short_description', 'is_featured', 'is_active',
    'brand_id', 'category_id', 'gst_percentage',
  ])
  const sets: string[] = []
  const params: unknown[] = []
  for (const [k, v] of Object.entries(changes || {})) {
    if (!ALLOWED.has(k)) continue
    params.push(v === '' ? null : v)
    if (k === 'brand_id' || k === 'category_id') {
      sets.push(`${k} = $${params.length}::uuid`)
    } else {
      sets.push(`${k} = $${params.length}`)
    }
  }
  if (sets.length === 0) return { result: null, error: 'No valid fields to update' }
  params.push(productId)
  const updated = await queryOne(
    `UPDATE products SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}::uuid
       RETURNING id::text, name, is_active, is_featured`,
    params
  )
  if (!updated) return { result: null, error: 'Product not found' }
  return { result: updated, error: null }
}
```

---

## `adjust_inventory`

```ts
case 'adjust_inventory': {
  const { productId, delta, reason, newStock } = action.payload as {
    productId: string; delta: number; reason: string; newStock: number
  }
  if (!Number.isInteger(delta) || delta === 0) {
    return { result: null, error: 'Invalid delta' }
  }
  if (newStock < 0) return { result: null, error: 'Resulting stock would be negative' }
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
    await client.query(
      `UPDATE products SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2::uuid`,
      [computed, productId]
    )
    await logStockMovement(client, {
      productId, variantId: null,
      transactionType: 'adjustment',
      quantityChange: delta,
      referenceType: 'manual',
      referenceId: productId,
      notes: `Agent adjustment: ${reason}`,
    })
    await client.query('COMMIT')
    return { result: { productId, previous: current, delta, current: computed }, error: null }
  } catch (e: any) {
    try { await client.query('ROLLBACK') } catch {}
    return { result: null, error: e?.message || 'Adjustment failed' }
  } finally {
    client.release()
  }
}
```

---

## `set_product_featured`

```ts
case 'set_product_featured': {
  const { productId, featured, limit } = action.payload as {
    productId: string; featured: boolean; limit: number
  }
  const lim = typeof limit === 'number' && limit > 0 ? limit : 6
  if (featured) {
    const cur = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products WHERE is_featured = TRUE AND id <> $1::uuid`,
      [productId]
    )
    if ((cur?.n || 0) >= lim) {
      return { result: null, error: `Featured limit (${lim}) reached. Unfeature one first.` }
    }
  }
  const updated = await queryOne(
    `UPDATE products SET is_featured = $1, updated_at = NOW()
       WHERE id = $2::uuid
       RETURNING id::text, name, is_featured`,
    [!!featured, productId]
  )
  if (!updated) return { result: null, error: 'Product not found' }
  return { result: updated, error: null }
}
```

---

## `create_brand`

```ts
case 'create_brand': {
  const { name, slug, logoUrl } = action.payload as {
    name: string; slug: string; logoUrl: string | null
  }
  if (!name || !slug) return { result: null, error: 'name and slug required' }
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM brands WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
    [slug, name]
  )
  if (dup) return { result: null, error: `Brand with slug "${slug}" or matching name already exists` }
  const created = await queryOne(
    `INSERT INTO brands (name, slug, logo_url, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id::text, name, slug, logo_url, is_active`,
    [name, slug, logoUrl]
  )
  if (!created) return { result: null, error: 'Insert failed' }
  return { result: created, error: null }
}
```

---

## `create_category`

```ts
case 'create_category': {
  const { name, slug, parentId } = action.payload as {
    name: string; slug: string; parentId: string | null
  }
  if (!name || !slug) return { result: null, error: 'name and slug required' }
  if (parentId) {
    const parent = await queryOne(`SELECT id FROM categories WHERE id = $1::uuid`, [parentId])
    if (!parent) return { result: null, error: 'Parent category not found' }
  }
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [slug]
  )
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
```

---

## Wiring note

`CATALOG_TOOLS` lives in `src/lib/admin-agent/tools/catalog.ts`. To register them
with the existing tool registry, append at the bottom of `src/lib/admin-agent/tools.ts`
(or wherever the registry is consumed):

```ts
import { CATALOG_TOOLS } from './tools/catalog'
TOOLS.push(...CATALOG_TOOLS)
```

That edit is intentionally **not** included here — the brief says do not modify
`tools.ts`. The orchestrator that integrates the 5 subagent outputs should do it.
