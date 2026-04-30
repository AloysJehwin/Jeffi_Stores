import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query } from '@/lib/db'

// PATCH /api/categories/reorder
// Body: { updates: Array<{ id: string, display_order: number, parent_category_id: string | null }> }
export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { updates } = await request.json() as {
      updates: { id: string; display_order: number; parent_category_id: string | null }[]
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    // Run all updates in one transaction
    const cases = updates.map((_, i) => `WHEN id = $${i * 3 + 1} THEN $${i * 3 + 2}`).join(' ')
    const parentCases = updates.map((_, i) => `WHEN id = $${i * 3 + 1} THEN $${i * 3 + 3}::uuid`).join(' ')
    const ids = updates.map((_, i) => `$${i * 3 + 1}`).join(', ')
    const params = updates.flatMap(u => [u.id, u.display_order, u.parent_category_id])

    await query(
      `UPDATE categories SET
        display_order = CASE ${cases} ELSE display_order END,
        parent_category_id = CASE ${parentCases} ELSE parent_category_id END,
        updated_at = NOW()
       WHERE id IN (${ids})`,
      params
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to reorder' }, { status: 500 })
  }
}
