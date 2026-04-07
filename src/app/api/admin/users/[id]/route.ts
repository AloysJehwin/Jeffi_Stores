import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = params
    const body = await request.json()
    const { scopes, role, is_active } = body

    // Build update query dynamically
    const updates: string[] = []
    const values: any[] = []
    let i = 1

    if (scopes !== undefined) {
      const validScopes = ['dashboard', 'products', 'categories', 'orders', 'reviews', 'settings']
      if (!Array.isArray(scopes) || scopes.some((s: string) => !validScopes.includes(s))) {
        return NextResponse.json({ error: 'Invalid scopes' }, { status: 400 })
      }
      updates.push(`scopes = $${i++}`)
      values.push(JSON.stringify(scopes))
    }

    if (role !== undefined) {
      const validRoles = ['admin', 'moderator']
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      updates.push(`role = $${i++}`)
      values.push(role)
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${i++}`)
      values.push(is_active)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    values.push(id)
    const updated = await queryOne(
      `UPDATE admins SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, username, role, scopes, is_active`,
      values
    )

    if (!updated) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    // If deactivating, revoke their certificates
    if (is_active === false) {
      await query(
        `UPDATE admin_certificates SET is_revoked = true, revoked_at = NOW() WHERE admin_id = $1 AND is_revoked = false`,
        [id]
      )
    }

    return NextResponse.json({ success: true, admin: updated })
  } catch (error) {
    console.error('Update admin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = params

    // Prevent self-deletion
    if (id === admin.adminId) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    // Soft-delete: deactivate
    await query('UPDATE admins SET is_active = false WHERE id = $1', [id])

    // Revoke all certificates
    await query(
      'UPDATE admin_certificates SET is_revoked = true, revoked_at = NOW() WHERE admin_id = $1 AND is_revoked = false',
      [id]
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete admin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
