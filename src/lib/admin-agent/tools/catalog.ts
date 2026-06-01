import { queryMany, queryOne } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import type { ToolDef } from '../tools'

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const FEATURED_LIMIT = 6

const UPDATABLE_PRODUCT_FIELDS = [
  'name', 'base_price', 'short_description', 'is_featured', 'is_active',
  'brand_id', 'category_id', 'gst_percentage',
] as const
type UpdatableField = typeof UPDATABLE_PRODUCT_FIELDS[number]

export const CATALOG_TOOLS: ToolDef[] = [
  {
    name: 'list_brands',
    description: 'List brands with their product counts. Use to find a brand id before creating products.',
    inputSchema: {
      type: 'object',
      properties: {
        activeOnly: { type: 'boolean', default: true, description: 'Only active brands.' },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ activeOnly, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 50, 1, 200)
      const onlyActive = activeOnly !== false
      const rows = await queryMany(
        `SELECT b.id::text, b.name, b.slug, b.is_active, b.logo_url,
                (SELECT COUNT(*)::int FROM products p WHERE p.brand_id = b.id AND p.is_active = TRUE) AS product_count
           FROM brands b
          WHERE ($1::boolean = FALSE OR b.is_active = TRUE)
          ORDER BY b.name ASC LIMIT $2`,
        [onlyActive, lim]
      )
      return { brands: rows, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_brand',
    description: 'Fetch a brand by id including total active product count.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    mutating: false,
    handler: async ({ id }) => {
      const row = await queryOne(
        `SELECT b.id::text, b.name, b.slug, b.description, b.website, b.logo_url, b.is_active, b.created_at,
                (SELECT COUNT(*)::int FROM products p WHERE p.brand_id = b.id) AS total_products,
                (SELECT COUNT(*)::int FROM products p WHERE p.brand_id = b.id AND p.is_active = TRUE) AS active_products
           FROM brands b WHERE b.id = $1::uuid LIMIT 1`,
        [id]
      )
      return row || { error: 'Brand not found' }
    },
  },
  {
    name: 'list_categories',
    description: 'List categories. parentOnly=true returns only top-level categories.',
    inputSchema: {
      type: 'object',
      properties: {
        parentOnly: { type: 'boolean', default: false, description: 'Only top-level (no parent).' },
        limit: { type: 'integer', default: 100, minimum: 1, maximum: 300 },
      },
    },
    mutating: false,
    handler: async ({ parentOnly, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 100, 1, 300)
      const where = parentOnly === true ? 'WHERE c.parent_category_id IS NULL' : ''
      const rows = await queryMany(
        `SELECT c.id::text, c.name, c.slug, c.parent_category_id::text, c.is_active, c.display_order, c.icon_name,
                (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.is_active = TRUE) AS product_count
           FROM categories c ${where}
          ORDER BY c.display_order ASC, c.name ASC LIMIT $1`,
        [lim]
      )
      return { categories: rows, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_category',
    description: 'Fetch a category with its subcategories and product count.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    mutating: false,
    handler: async ({ id }) => {
      const cat = await queryOne<any>(
        `SELECT c.id::text, c.name, c.slug, c.description, c.parent_category_id::text AS parent_id,
                c.is_active, c.icon_name, c.sku_prefix, c.display_order,
                (SELECT name FROM categories WHERE id = c.parent_category_id) AS parent_name
           FROM categories c WHERE c.id = $1::uuid LIMIT 1`,
        [id]
      )
      if (!cat) return { error: 'Category not found' }
      const subs = await queryMany(
        `SELECT id::text, name, slug, is_active FROM categories
          WHERE parent_category_id = $1::uuid ORDER BY display_order, name`,
        [id]
      )
      const productCount = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM products WHERE category_id = $1::uuid AND is_active = TRUE`,
        [id]
      )
      return { ...cat, subcategories: subs, product_count: productCount?.n || 0 }
    },
  },
  {
    name: 'list_inventory_low',
    description: 'Low-stock products (≤ threshold) with brand and best variant detail. Use for restock decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'integer', default: 10, minimum: 0, maximum: 1000 },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ threshold, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 50, 1, 200)
      const t = clamp(typeof threshold === 'number' ? threshold : 10, 0, 1000)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.sku, p.inventory_quantity AS stock, p.has_variants,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                b.name AS brand,
                (SELECT COUNT(*)::int FROM product_variants pv
                  WHERE pv.product_id = p.id AND pv.is_active = TRUE
                    AND pv.inventory_quantity <= $1) AS low_variant_count,
                (SELECT json_agg(json_build_object(
                          'id', pv.id::text,
                          'variant_name', pv.variant_name,
                          'sku', pv.sku,
                          'stock', pv.inventory_quantity))
                   FROM (SELECT * FROM product_variants pv2
                          WHERE pv2.product_id = p.id AND pv2.is_active = TRUE
                            AND pv2.inventory_quantity <= $1
                          ORDER BY pv2.inventory_quantity ASC LIMIT 5) pv) AS low_variants
           FROM products p LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.is_active = TRUE
            AND (p.inventory_quantity <= $1
                 OR EXISTS (SELECT 1 FROM product_variants pv
                              WHERE pv.product_id = p.id AND pv.is_active = TRUE
                                AND pv.inventory_quantity <= $1))
          ORDER BY p.inventory_quantity ASC, p.name ASC LIMIT $2`,
        [t, lim]
      )
      return { products: rows, threshold: t, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_product_full',
    description: 'Full product detail with all variants, sub-variants, and images. Use this (vs get_product) when you need the complete picture for editing or audits.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    mutating: false,
    handler: async ({ id }) => {
      const product = await queryOne<any>(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.short_description, p.description,
                p.base_price::text, p.mrp::text, p.gst_percentage, p.hsn_code,
                p.inventory_quantity AS stock, p.is_active, p.is_featured, p.has_variants,
                p.brand_id::text, p.category_id::text,
                b.name AS brand_name, c.name AS category_name,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS effective_price
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1::uuid LIMIT 1`,
        [id]
      )
      if (!product) return { error: 'Product not found' }
      const variants = await queryMany<any>(
        `SELECT id::text, variant_name, sku, price::text, mrp::text,
                inventory_quantity AS stock, is_active, attributes
           FROM product_variants WHERE product_id = $1::uuid ORDER BY variant_name`,
        [id]
      )
      const variantIds = variants.map((v: any) => v.id)
      const subVariants = variantIds.length
        ? await queryMany(
            `SELECT id::text, variant_id::text, sku, sub_variant_name, price::text, mrp::text,
                    stock_quantity AS stock, is_active
               FROM product_sub_variants
              WHERE variant_id = ANY($1::uuid[]) ORDER BY sub_variant_name`,
            [variantIds]
          )
        : []
      const images = await queryMany(
        `SELECT id::text, image_url, thumbnail_url, alt_text, display_order, is_primary
           FROM product_images WHERE product_id = $1::uuid ORDER BY display_order, created_at`,
        [id]
      )
      return { ...product, variants, sub_variants: subVariants, images }
    },
  },

  {
    name: 'propose_create_product',
    description: 'Propose creating a new product. Admin must approve. SKU must be unique. brandId / categoryId optional but recommended.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Product name (1-255 chars).' },
        sku: { type: 'string', description: 'Unique SKU.' },
        basePrice: { type: 'number', description: 'Base price (INR). Must be ≥ 0.' },
        brandId: { type: 'string' },
        categoryId: { type: 'string' },
        shortDescription: { type: 'string', description: 'Max 500 chars.' },
        weightGrams: { type: 'integer', minimum: 0, maximum: 100000 },
        gstPercentage: { type: 'number', minimum: 0, maximum: 50 },
      },
      required: ['name', 'sku', 'basePrice'],
    },
    mutating: true,
    handler: async (input) => {
      const name = String(input.name || '').trim()
      const sku = String(input.sku || '').trim()
      const basePrice = Number(input.basePrice)
      if (!name || name.length > 255) throw new Error('name required, max 255 chars')
      if (!sku || sku.length > 100) throw new Error('sku required, max 100 chars')
      if (!Number.isFinite(basePrice) || basePrice < 0) throw new Error('basePrice must be ≥ 0')
      const shortDesc = input.shortDescription ? String(input.shortDescription).slice(0, 500) : null
      const weight = input.weightGrams != null ? clamp(Number(input.weightGrams), 0, 100000) : 500
      const gst = input.gstPercentage != null ? clamp(Number(input.gstPercentage), 0, 50) : 18
      const brandId = input.brandId ? String(input.brandId) : null
      const categoryId = input.categoryId ? String(input.categoryId) : null

      const slug = slugify(name) + '-' + Date.now().toString(36)
      const existing = await queryOne<{ id: string; name: string }>(
        `SELECT id::text, name FROM products WHERE sku = $1 LIMIT 1`, [sku]
      )
      const brand = brandId ? await queryOne<{ name: string }>(
        `SELECT name FROM brands WHERE id = $1::uuid`, [brandId]) : null
      const cat = categoryId ? await queryOne<{ name: string }>(
        `SELECT name FROM categories WHERE id = $1::uuid`, [categoryId]) : null
      if (brandId && !brand) throw new Error(`Brand not found: ${brandId}`)
      if (categoryId && !cat) throw new Error(`Category not found: ${categoryId}`)

      const ui_blocks: any[] = [
        { type: 'heading', value: `Create product: ${name}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Name', value: name },
            { key: 'SKU', value: sku },
            { key: 'Base price', value: `₹${basePrice.toFixed(2)}` },
            { key: 'GST %', value: String(gst) },
            { key: 'Weight (g)', value: String(weight) },
            { key: 'Brand', value: brand?.name || '—' },
            { key: 'Category', value: cat?.name || '—' },
            { key: 'Short description', value: shortDesc || '—' },
          ],
        },
      ]
      if (existing) {
        ui_blocks.push({
          type: 'callout', tone: 'warn', title: 'SKU already exists',
          message: `SKU "${sku}" is already used by "${existing.name}". Insert will fail unless you change the SKU.`,
        })
      }

      return {
        proposed: true,
        kind: 'create_product',
        payload: { name, sku, slug, basePrice, brandId, categoryId, shortDescription: shortDesc, weightGrams: weight, gstPercentage: gst },
        confirmation: `Create product "${name}" (SKU ${sku}) at ₹${basePrice.toFixed(2)}?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_update_product',
    description: 'Propose a partial product update. fields may include name, base_price, short_description, is_featured, is_active, brand_id, category_id, gst_percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        fields: { type: 'object', description: 'Object of fields to change (partial).' },
      },
      required: ['productId', 'fields'],
    },
    mutating: true,
    handler: async ({ productId, fields }) => {
      const id = String(productId || '')
      const incoming = (fields && typeof fields === 'object') ? fields as Record<string, unknown> : {}
      const product = await queryOne<any>(
        `SELECT p.id::text, p.name, p.base_price::text, p.short_description, p.is_featured, p.is_active,
                p.brand_id::text, p.category_id::text, p.gst_percentage::text,
                b.name AS brand_name, c.name AS category_name
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1::uuid LIMIT 1`,
        [id]
      )
      if (!product) throw new Error('Product not found')

      const changes: { field: UpdatableField; before: string; after: string; rawAfter: unknown }[] = []
      for (const k of UPDATABLE_PRODUCT_FIELDS) {
        if (!(k in incoming)) continue
        const newVal = incoming[k]
        const before = product[k] == null ? '—' : String(product[k])
        const after = newVal == null ? '—' : String(newVal)
        if (before === after) continue
        if (k === 'name' && (!String(newVal).trim() || String(newVal).length > 255)) throw new Error('name 1-255 chars')
        if (k === 'base_price' && (!Number.isFinite(Number(newVal)) || Number(newVal) < 0)) throw new Error('base_price ≥ 0')
        if (k === 'short_description' && newVal != null && String(newVal).length > 500) throw new Error('short_description max 500')
        if (k === 'gst_percentage' && (!Number.isFinite(Number(newVal)) || Number(newVal) < 0 || Number(newVal) > 50)) throw new Error('gst_percentage 0-50')
        if (k === 'brand_id' && newVal) {
          const ok = await queryOne(`SELECT 1 FROM brands WHERE id = $1::uuid`, [String(newVal)])
          if (!ok) throw new Error(`Brand not found: ${newVal}`)
        }
        if (k === 'category_id' && newVal) {
          const ok = await queryOne(`SELECT 1 FROM categories WHERE id = $1::uuid`, [String(newVal)])
          if (!ok) throw new Error(`Category not found: ${newVal}`)
        }
        changes.push({ field: k, before, after, rawAfter: newVal })
      }
      if (changes.length === 0) return { proposed: false, info: 'No changes — provided fields match the current values.' }

      const ui_blocks: any[] = [
        { type: 'heading', value: `Update "${product.name}"`, level: 2 },
        {
          type: 'table',
          headers: ['Field', 'Before', 'After'],
          rows: changes.map(c => [c.field, c.before, c.after]),
        },
      ]
      const flippingInactive = changes.find(c => c.field === 'is_active' && String(c.rawAfter) === 'false')
      if (flippingInactive) {
        ui_blocks.push({
          type: 'callout', tone: 'warn', title: 'Product will be hidden',
          message: 'is_active=false soft-deletes this product — it will disappear from storefront listings and search.',
        })
      }

      return {
        proposed: true,
        kind: 'update_product',
        payload: { productId: id, productName: product.name, changes: Object.fromEntries(changes.map(c => [c.field, c.rawAfter])) },
        confirmation: `Update ${changes.length} field${changes.length === 1 ? '' : 's'} on "${product.name}"?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_adjust_inventory',
    description: 'Propose an inventory adjustment for a product. delta is a signed integer (negative = write-down). Logged in inventory_transactions.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        delta: { type: 'integer', description: 'Signed change. e.g. +50 to add stock, -3 to write off damaged.' },
        reason: { type: 'string', description: 'Required note (1-200 chars).' },
      },
      required: ['productId', 'delta', 'reason'],
    },
    mutating: true,
    handler: async ({ productId, delta, reason }) => {
      const id = String(productId || '')
      const d = Number(delta)
      const note = String(reason || '').trim()
      if (!Number.isInteger(d) || d === 0) throw new Error('delta must be a non-zero integer')
      if (Math.abs(d) > 100000) throw new Error('delta too large (|delta| ≤ 100000)')
      if (!note || note.length > 200) throw new Error('reason required, max 200 chars')

      const p = await queryOne<{ id: string; name: string; sku: string; inventory_quantity: number; has_variants: boolean }>(
        `SELECT id::text, name, sku, inventory_quantity, has_variants
           FROM products WHERE id = $1::uuid LIMIT 1`,
        [id]
      )
      if (!p) throw new Error('Product not found')
      const current = Number(p.inventory_quantity || 0)
      const newStock = current + d

      const ui_blocks: any[] = [
        { type: 'heading', value: `Adjust inventory: ${p.name}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Product', value: `${p.name} (${p.sku})` },
            { key: 'Current stock', value: String(current) },
            { key: 'Delta', value: (d > 0 ? '+' : '') + String(d) },
            { key: 'New stock', value: String(newStock) },
            { key: 'Reason', value: note },
          ],
        },
      ]
      if (newStock < 0) {
        ui_blocks.push({
          type: 'callout', tone: 'error', title: 'Negative stock',
          message: `New stock would be ${newStock}. Inventory cannot be negative; lower the |delta| or add stock first.`,
        })
      }
      if (p.has_variants) {
        ui_blocks.push({
          type: 'callout', tone: 'info', title: 'Product has variants',
          message: 'This adjusts the parent product row only. Variant-level stock is not changed.',
        })
      }

      return {
        proposed: true,
        kind: 'adjust_inventory',
        payload: { productId: p.id, productName: p.name, currentStock: current, delta: d, newStock, reason: note },
        confirmation: `Adjust stock of "${p.name}" by ${d > 0 ? '+' : ''}${d} (→ ${newStock})?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_set_product_featured',
    description: 'Propose toggling the is_featured flag for a product. Limit is 6 featured products at any time.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        featured: { type: 'boolean' },
      },
      required: ['productId', 'featured'],
    },
    mutating: true,
    handler: async ({ productId, featured }) => {
      const id = String(productId || '')
      const target = featured === true || String(featured).toLowerCase() === 'true'
      const p = await queryOne<{ id: string; name: string; is_featured: boolean }>(
        `SELECT id::text, name, is_featured FROM products WHERE id = $1::uuid LIMIT 1`,
        [id]
      )
      if (!p) throw new Error('Product not found')
      if (p.is_featured === target) {
        return { proposed: false, info: `"${p.name}" is already ${target ? 'featured' : 'not featured'}.` }
      }
      const cur = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM products WHERE is_featured = TRUE`
      )
      const currentCount = cur?.n || 0
      const projectedCount = target ? currentCount + 1 : currentCount - 1

      const ui_blocks: any[] = [
        { type: 'heading', value: target ? `Feature "${p.name}"` : `Unfeature "${p.name}"`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Product', value: p.name },
            { key: 'Current featured slots used', value: `${currentCount} / ${FEATURED_LIMIT}` },
            { key: 'After this change', value: `${projectedCount} / ${FEATURED_LIMIT}` },
            { key: 'New state', value: target ? 'Featured' : 'Not featured' },
          ],
        },
      ]
      if (target && currentCount >= FEATURED_LIMIT) {
        ui_blocks.push({
          type: 'callout', tone: 'error', title: 'Featured limit reached',
          message: `Already ${currentCount} of ${FEATURED_LIMIT} featured products. Unfeature one before adding "${p.name}".`,
        })
      }

      return {
        proposed: true,
        kind: 'set_product_featured',
        payload: { productId: p.id, productName: p.name, featured: target, currentCount, limit: FEATURED_LIMIT },
        confirmation: `${target ? 'Feature' : 'Unfeature'} "${p.name}"?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_create_brand',
    description: 'Propose creating a new brand. Slug auto-derived from name if omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Brand name (1-100 chars).' },
        slug: { type: 'string', description: 'Optional slug; auto-derived if omitted.' },
        logoUrl: { type: 'string' },
      },
      required: ['name'],
    },
    mutating: true,
    handler: async ({ name, slug, logoUrl }) => {
      const n = String(name || '').trim()
      if (!n || n.length > 100) throw new Error('name required, max 100 chars')
      const s = (slug ? String(slug).trim() : '') || slugify(n)
      if (!s || s.length > 100) throw new Error('slug invalid')
      const logo = logoUrl ? String(logoUrl).trim().slice(0, 500) : null
      if (logo && !/^https?:\/\//.test(logo)) throw new Error('logoUrl must be http(s) URL')
      const conflict = await queryOne<{ id: string; name: string }>(
        `SELECT id::text, name FROM brands WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
        [s, n]
      )
      const ui_blocks: any[] = [
        { type: 'heading', value: `Create brand: ${n}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Name', value: n },
            { key: 'Slug', value: s },
            { key: 'Logo URL', value: logo || '—' },
          ],
        },
      ]
      if (conflict) {
        ui_blocks.push({
          type: 'callout', tone: 'warn', title: 'Possible duplicate',
          message: `Brand "${conflict.name}" already exists with the same slug or name.`,
        })
      }
      return {
        proposed: true,
        kind: 'create_brand',
        payload: { name: n, slug: s, logoUrl: logo },
        confirmation: `Create brand "${n}"?`,
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_create_category',
    description: 'Propose creating a new category. Pass parentId to nest under another category.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name (1-100 chars).' },
        slug: { type: 'string', description: 'Optional; auto-derived if omitted.' },
        parentId: { type: 'string', description: 'Parent category UUID.' },
      },
      required: ['name'],
    },
    mutating: true,
    handler: async ({ name, slug, parentId }) => {
      const n = String(name || '').trim()
      if (!n || n.length > 100) throw new Error('name required, max 100 chars')
      const s = (slug ? String(slug).trim() : '') || slugify(n)
      if (!s || s.length > 100) throw new Error('slug invalid')
      const pid = parentId ? String(parentId) : null
      let pathLabel = n
      if (pid) {
        const parent = await queryOne<{ id: string; name: string; parent_name: string | null }>(
          `SELECT c.id::text, c.name,
                  (SELECT name FROM categories WHERE id = c.parent_category_id) AS parent_name
             FROM categories c WHERE c.id = $1::uuid LIMIT 1`,
          [pid]
        )
        if (!parent) throw new Error(`Parent category not found: ${pid}`)
        pathLabel = `${parent.parent_name ? parent.parent_name + ' / ' : ''}${parent.name} / ${n}`
      }
      const conflict = await queryOne<{ id: string; name: string }>(
        `SELECT id::text, name FROM categories WHERE slug = $1 LIMIT 1`, [s]
      )
      const ui_blocks: any[] = [
        { type: 'heading', value: `Create category: ${n}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Name', value: n },
            { key: 'Slug', value: s },
            { key: 'Parent', value: pid ? pathLabel.split(' / ').slice(0, -1).join(' / ') : '— (top-level)' },
          ],
        },
        { type: 'text', value: `Path: ${pathLabel}`, weight: 'muted' },
      ]
      if (conflict) {
        ui_blocks.push({
          type: 'callout', tone: 'warn', title: 'Slug already in use',
          message: `Category "${conflict.name}" already uses slug "${s}". Insert will fail.`,
        })
      }
      return {
        proposed: true,
        kind: 'create_category',
        payload: { name: n, slug: s, parentId: pid, pathLabel },
        confirmation: `Create category "${n}"${pid ? ` under "${pathLabel.split(' / ').slice(0, -1).join(' / ')}"` : ''}?`,
        ui_blocks,
      }
    },
  },
]
