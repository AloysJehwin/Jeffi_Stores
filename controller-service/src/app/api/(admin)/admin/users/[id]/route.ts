import { NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { NextRequest } from 'next/server'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { assignableScopeKeys } from '@/lib/auth/scopes-server'
import { resolveRequestTenantId } from '@/lib/tenancy/request-tenant'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { revokePortalCerts } from '@/lib/tenancy/portal-certs'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !isPlatformOwner(admin.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { scopes, role, is_active, reset_mfa, idle_timeout_minutes } = body

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
      const allowed = await assignableScopeKeys(await resolveRequestTenantId())
      if (!Array.isArray(scopes) || scopes.some((s: string) => !allowed.includes(s))) {
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

    if (idle_timeout_minutes !== undefined) {
      // null clears the per-admin override (falls back to the default); otherwise must be one of
      // the allowed choices.
      const { ADMIN_IDLE_TIMEOUT_CHOICES } = await import('@/lib/auth/auth-sessions')
      if (idle_timeout_minutes !== null && !ADMIN_IDLE_TIMEOUT_CHOICES.includes(idle_timeout_minutes)) {
        return NextResponse.json({ error: 'Invalid idle timeout' }, { status: 400 })
      }
      updates.push(`idle_timeout_minutes = $${i++}`)
      values.push(idle_timeout_minutes)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    values.push(id)
    const updated = await queryOne(
      `UPDATE admins SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, role, scopes, is_active`,
      values
    )

    if (!updated) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    // Role/scopes are snapshotted onto auth_sessions at login; if they changed here the
    // live sessions are stale. Revoke them so the admin re-logs-in with a fresh snapshot.
    // Best-effort: never let a revoke failure break the update response.
    if (role !== undefined || scopes !== undefined) {
      await revokeAllForPrincipal('admin', id).catch(() => {})
    }

    if (is_active === false) {
      const revoked = await query<{ serial_number: string }>(
        `UPDATE admin_certificates SET is_revoked = true, revoked_at = NOW()
          WHERE admin_id = $1 AND is_revoked = false RETURNING serial_number`,
        [id]
      )
      // Mirror into the central portal registry so certificate.jeffistores.in refuses these serials.
      await revokePortalCerts((revoked.rows || []).map(r => r.serial_number))
    }

    return NextResponse.json({ success: true, admin: updated })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !isPlatformOwner(admin.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await params

    if (id === admin.adminId) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    // Read the serials before the hard delete so the central registry can be revoked for them —
    // otherwise a deleted admin's cert stays downloadable from the portal.
    const certRows = await query<{ serial_number: string }>(
      'SELECT serial_number FROM admin_certificates WHERE admin_id = $1',
      [id]
    )
    await query('DELETE FROM admin_certificates WHERE admin_id = $1', [id])
    await revokePortalCerts((certRows.rows || []).map(r => r.serial_number))

    const deleted = await queryOne('DELETE FROM admins WHERE id = $1 RETURNING id, user_id', [id])

    if (!deleted) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    }

    if (deleted.user_id) {
      await query('DELETE FROM users WHERE id = $1', [deleted.user_id])
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
