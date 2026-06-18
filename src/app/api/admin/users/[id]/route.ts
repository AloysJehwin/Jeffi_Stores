import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'
import { NextRequest } from 'next/server'
import { ALL_SCOPE_KEYS } from '@/lib/scopes'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { scopes, role, is_active, reset_mfa } = body

    if (reset_mfa === true) {
      if (id === admin.adminId) {
        return NextResponse.json({ error: 'Cannot reset your own MFA' }, { status: 400 })
      }
      const target = await queryOne('SELECT id FROM admins WHERE id = $1 AND is_active = true', [id])
      if (!target) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
      await query(
        `UPDATE admins SET mfa_secret_enc = NULL, mfa_enabled = false, mfa_enrolled_at = NULL WHERE id = $1`,
        [id]
      )
      await query(`DELETE FROM admin_mfa_recovery_codes WHERE admin_id = $1`, [id])
      return NextResponse.json({ success: true })
    }

    const updates: string[] = []
    const values: any[] = []
    let i = 1

    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.some((s: string) => !ALL_SCOPE_KEYS.includes(s))) {
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

    if (is_active === false) {
      await query(
        `UPDATE admin_certificates SET is_revoked = true, revoked_at = NOW() WHERE admin_id = $1 AND is_revoked = false`,
        [id]
      )
    }

    return NextResponse.json({ success: true, admin: updated })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await params

    if (id === admin.adminId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await query('DELETE FROM admin_certificates WHERE admin_id = $1', [id])

    const deleted = await queryOne('DELETE FROM admins WHERE id = $1 RETURNING id, username, user_id', [id])

    if (!deleted) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    if (deleted.user_id) {
      await query('DELETE FROM users WHERE id = $1', [deleted.user_id])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
