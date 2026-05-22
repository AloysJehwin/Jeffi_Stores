import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryOne, queryMany } from '@/lib/db'
import { generateVariantSku } from '@/lib/sku'

type Params = { params: { id: string; variantId: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await queryMany(
    `SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`,
    [params.variantId]
  )
  return NextResponse.json({ sub_variants: rows })
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const variant = await queryOne(
    `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
    [params.variantId, params.id]
  )
  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  const body = await request.json()
  const { sub_variant_name, price, mrp, price_ex_gst, mrp_ex_gst, wholeprice_ex_gst, stock_quantity, attributes } = body
  if (!sub_variant_name) return NextResponse.json({ error: 'sub_variant_name required' }, { status: 400 })

  const productRow = await queryOne<{ sku: string }>(`SELECT sku FROM products WHERE id = $1`, [params.id])
  const sku = body.sku || generateVariantSku(productRow?.sku || 'PRD', sub_variant_name)

  const row = await queryOne(
    `INSERT INTO product_sub_variants
       (variant_id, product_id, sku, sub_variant_name, price, mrp, price_ex_gst, mrp_ex_gst, wholeprice_ex_gst, stock_quantity, attributes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [params.variantId, params.id, sku, sub_variant_name, price ?? null, mrp ?? null,
     price_ex_gst ?? null, mrp_ex_gst ?? null, wholeprice_ex_gst ?? null,
     stock_quantity ?? 0, attributes ? JSON.stringify(attributes) : null]
  )
  return NextResponse.json({ sub_variant: row }, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, sub_variant_name, price, mrp, price_ex_gst, mrp_ex_gst, wholeprice_ex_gst, stock_quantity, attributes, is_active } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const row = await queryOne(
    `UPDATE product_sub_variants SET
       sub_variant_name = COALESCE($1, sub_variant_name),
       price = $2, mrp = $3, price_ex_gst = $4, mrp_ex_gst = $5, wholeprice_ex_gst = $6,
       stock_quantity = COALESCE($7, stock_quantity),
       attributes = COALESCE($8, attributes),
       is_active = COALESCE($9, is_active),
       updated_at = NOW()
     WHERE id = $10 AND variant_id = $11
     RETURNING *`,
    [sub_variant_name, price ?? null, mrp ?? null, price_ex_gst ?? null,
     mrp_ex_gst ?? null, wholeprice_ex_gst ?? null, stock_quantity ?? null,
     attributes ? JSON.stringify(attributes) : null, is_active ?? null,
     id, params.variantId]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ sub_variant: row })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await query(`DELETE FROM product_sub_variants WHERE id = $1 AND variant_id = $2`, [id, params.variantId])
  return NextResponse.json({ success: true })
}
