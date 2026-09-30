import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { generateVariantSku } from '@/lib/catalog/sku'
import { parseBody, zNonEmpty, zCurrency, zUuid } from '@/lib/shared/validate'

const PostSchema = z.object({
  sub_variant_name: zNonEmpty,
  sku: z.string().nullish(),
  price: z.optional(zCurrency),
  mrp: z.optional(zCurrency),
  price_ex_gst: z.optional(zCurrency),
  mrp_ex_gst: z.optional(zCurrency),
  discount_pct: z.number().min(0).max(100).nullish(),
  stock_status: z.enum(['In Stock', 'Low Stock', 'Out of Stock']).nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  weight_grams: z.number().int().positive().nullish(),
  length_cm: z.number().positive().nullish(),
  breadth_cm: z.number().positive().nullish(),
  height_cm: z.number().positive().nullish(),
  package_type: z.string().nullish(),
})

const PutSchema = z.object({
  id: zUuid,
  sub_variant_name: z.string().nullish(),
  sku: z.string().nullish(),
  price: z.optional(zCurrency),
  mrp: z.optional(zCurrency),
  price_ex_gst: z.optional(zCurrency),
  mrp_ex_gst: z.optional(zCurrency),
  discount_pct: z.number().min(0).max(100).nullish(),
  stock_status: z.enum(['In Stock', 'Low Stock', 'Out of Stock']).nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().nullish(),
  weight_grams: z.number().int().positive().nullish(),
  length_cm: z.number().positive().nullish(),
  breadth_cm: z.number().positive().nullish(),
  height_cm: z.number().positive().nullish(),
  package_type: z.string().nullish(),
})

const DeleteSchema = z.object({ id: zUuid })

type Params = { params: Promise<{ id: string; variantId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rows = await queryMany(`SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`, [
    variantId,
  ])
  return NextResponse.json({ sub_variants: rows })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const variant = await queryOne<{ id: string; sku: string }>(
    `SELECT id, sku FROM product_variants WHERE id = $1 AND product_id = $2`,
    [variantId, id]
  )
  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = parseBody(PostSchema, raw)
  if (!parsed.ok) return parsed.response
  const {
    sub_variant_name,
    sku: skuInput,
    price,
    mrp,
    price_ex_gst,
    mrp_ex_gst,
    discount_pct,
    stock_status,
    attributes,
    weight_grams,
    length_cm,
    breadth_cm,
    height_cm,
    package_type,
  } = parsed.data

  const productRow = await queryOne<{ sku: string }>(`SELECT sku FROM products WHERE id = $1`, [id])
  const parentSku = variant.sku || productRow?.sku || 'PRD'
  const sku = skuInput || generateVariantSku(parentSku, sub_variant_name)

  const row = await queryOne(
    `INSERT INTO product_sub_variants
       (variant_id, product_id, sku, sub_variant_name, price, mrp, price_ex_gst, mrp_ex_gst, discount_pct, stock_status, attributes, weight_grams, length_cm, breadth_cm, height_cm, package_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      variantId,
      id,
      sku,
      sub_variant_name,
      price ?? null,
      mrp ?? null,
      price_ex_gst ?? null,
      mrp_ex_gst ?? null,
      discount_pct ?? null,
      stock_status ?? 'In Stock',
      attributes ? JSON.stringify(attributes) : null,
      weight_grams ?? null,
      length_cm ?? null,
      breadth_cm ?? null,
      height_cm ?? null,
      package_type ?? null,
    ]
  )
  return NextResponse.json({ sub_variant: row }, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawPut = await request.json().catch(() => null)
  if (!rawPut) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedPut = parseBody(PutSchema, rawPut)
  if (!parsedPut.ok) return parsedPut.response
  const {
    id,
    sub_variant_name,
    sku: skuOverride,
    price,
    mrp,
    price_ex_gst,
    mrp_ex_gst,
    discount_pct,
    stock_status,
    attributes,
    is_active,
    weight_grams,
    length_cm,
    breadth_cm,
    height_cm,
    package_type,
  } = parsedPut.data

  let newSku: string | null = null
  if (skuOverride) {
    newSku = skuOverride.toUpperCase()
  } else if (sub_variant_name) {
    const variant = await queryOne<{ sku: string }>(`SELECT sku FROM product_variants WHERE id = $1`, [variantId])
    if (variant?.sku) {
      newSku = generateVariantSku(variant.sku, sub_variant_name)
    }
  }

  const row = await queryOne(
    `UPDATE product_sub_variants SET
       sub_variant_name = COALESCE($1, sub_variant_name),
       sku = COALESCE($2, sku),
       price = $3, mrp = $4, price_ex_gst = $5, mrp_ex_gst = $6,
       discount_pct = COALESCE($7, discount_pct),
       stock_status = COALESCE($8, stock_status),
       attributes = COALESCE($9, attributes),
       is_active = COALESCE($10, is_active),
       weight_grams = COALESCE($13, weight_grams),
       length_cm = COALESCE($14, length_cm),
       breadth_cm = COALESCE($15, breadth_cm),
       height_cm = COALESCE($16, height_cm),
       package_type = COALESCE($17, package_type),
       updated_at = NOW()
     WHERE id = $11 AND variant_id = $12
     RETURNING *`,
    [
      sub_variant_name,
      newSku,
      price ?? null,
      mrp ?? null,
      price_ex_gst ?? null,
      mrp_ex_gst ?? null,
      discount_pct ?? null,
      stock_status ?? null,
      attributes ? JSON.stringify(attributes) : null,
      is_active ?? null,
      id,
      variantId,
      weight_grams ?? null,
      length_cm ?? null,
      breadth_cm ?? null,
      height_cm ?? null,
      package_type ?? null,
    ]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ sub_variant: row })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawDel = await request.json().catch(() => null)
  if (!rawDel) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedDel = parseBody(DeleteSchema, rawDel)
  if (!parsedDel.ok) return parsedDel.response
  const { id } = parsedDel.data

  await query(`DELETE FROM product_sub_variants WHERE id = $1`, [id])
  return NextResponse.json({ success: true })
}
