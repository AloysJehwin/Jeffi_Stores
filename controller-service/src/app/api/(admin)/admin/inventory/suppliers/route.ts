import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, query } from '@/lib/shared/db'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { SUPPLIERS_ENTITY } from '@/lib/filters/entities/suppliers'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { draftLockChips } from '@/lib/admin/draft-locks'

const PostSchema = z.object({
  name: zNonEmpty,
  gstin: z.string().nullish(),
  contact_name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish(),
  address: z.string().nullish(),
  payment_terms: z.string().nullish(),
  notes: z.string().nullish(),
  bank_name: z.string().nullish(),
  account_number: z.string().nullish(),
  ifsc: z.string().nullish(),
  upi_id: z.string().nullish(),
})

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    // The list's filters; without ?all=true or a Status choice only active suppliers (PO pickers).
    const sp = new URLSearchParams(searchParams)
    if (sp.get('all') !== 'true' && !sp.has('active')) sp.set('active', 'true')
    const w = buildWhere(SUPPLIERS_ENTITY, normalizeQuery(SUPPLIERS_ENTITY, sp))

    const countRow = await queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total FROM suppliers s ${w.where}`, w.params)
    const total = countRow?.total || 0

    const rows = await queryMany(
      `SELECT s.*, (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id) AS po_count
       FROM suppliers s
       ${w.where}
       ORDER BY s.name
       LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, limit, offset]
    )
    const locks = await draftLockChips('supplier', (rows || []).map(r => r.id), admin.adminId)

    return NextResponse.json({ suppliers: (rows || []).map(r => (locks[r.id] ? { ...r, draft_lock: locks[r.id] } : r)), total, page, limit })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PostSchema, raw)
    if (!parsed.ok) return parsed.response
    const {
      name,
      gstin,
      contact_name,
      phone,
      email,
      address,
      payment_terms,
      notes,
      bank_name,
      account_number,
      ifsc,
      upi_id,
    } = parsed.data

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO suppliers (name, gstin, contact_name, phone, email, address, payment_terms, notes, bank_name, account_number, ifsc, upi_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        name,
        gstin || null,
        contact_name || null,
        phone || null,
        email || null,
        address || null,
        parseInt(payment_terms || '30'),
        notes || null,
        bank_name || null,
        account_number || null,
        ifsc || null,
        upi_id || null,
      ]
    )

    return NextResponse.json({ success: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
