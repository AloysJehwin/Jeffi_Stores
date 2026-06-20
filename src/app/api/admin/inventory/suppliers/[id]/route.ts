import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const PatchSchema = z.object({
  name: z.string().nullish(),
  gstin: z.string().nullish(),
  contact_name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish(),
  address: z.string().nullish(),
  payment_terms: z.string().nullish(),
  notes: z.string().nullish(),
  is_active: z.boolean().optional(),
  bank_name: z.string().nullish(),
  account_number: z.string().nullish(),
  ifsc: z.string().nullish(),
  upi_id: z.string().nullish(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'At least one field required' }
)

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const supplier = await queryOne<any>(
      `SELECT s.*, COUNT(po.id)::int AS po_count
       FROM suppliers s
       LEFT JOIN purchase_orders po ON po.supplier_id = s.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [id]
    )

    if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ supplier })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(PatchSchema, raw)
    if (!parsed.ok) return parsed.response
    const { name, gstin, contact_name, phone, email, address, payment_terms, notes, is_active, bank_name, account_number, ifsc, upi_id } = parsed.data

    const updates: string[] = []
    const values: any[] = []
    let i = 1

    if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name) }
    if (gstin !== undefined) { updates.push(`gstin = $${i++}`); values.push(gstin || null) }
    if (contact_name !== undefined) { updates.push(`contact_name = $${i++}`); values.push(contact_name || null) }
    if (phone !== undefined) { updates.push(`phone = $${i++}`); values.push(phone || null) }
    if (email !== undefined) { updates.push(`email = $${i++}`); values.push(email || null) }
    if (address !== undefined) { updates.push(`address = $${i++}`); values.push(address || null) }
    if (payment_terms !== undefined) { updates.push(`payment_terms = $${i++}`); values.push(parseInt(payment_terms ?? '') || 30) }
    if (notes !== undefined) { updates.push(`notes = $${i++}`); values.push(notes || null) }
    if (is_active !== undefined) { updates.push(`is_active = $${i++}`); values.push(is_active) }
    if (bank_name !== undefined) { updates.push(`bank_name = $${i++}`); values.push(bank_name || null) }
    if (account_number !== undefined) { updates.push(`account_number = $${i++}`); values.push(account_number || null) }
    if (ifsc !== undefined) { updates.push(`ifsc = $${i++}`); values.push(ifsc || null) }
    if (upi_id !== undefined) { updates.push(`upi_id = $${i++}`); values.push(upi_id || null) }

    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    updates.push(`updated_at = NOW()`)
    values.push(id)

    await query(
      `UPDATE suppliers SET ${updates.join(', ')} WHERE id = $${i}`,
      values
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
