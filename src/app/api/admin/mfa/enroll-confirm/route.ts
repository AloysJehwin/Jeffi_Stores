import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import {
  encryptSecret,
  generateRecoveryCodes,
  verifyMfaTicket,
  verifyTotp,
} from '@/lib/mfa'
import { issueAdminSession } from '@/lib/admin-session'

export async function POST(request: Request) {
  try {
    const { ticket, secret, code } = await request.json()
    if (!ticket || !secret || !code) {
      return NextResponse.json({ error: 'ticket, secret and code are required' }, { status: 400 })
    }

    const t = await verifyMfaTicket(ticket, 'enroll')
    if (!t) return NextResponse.json({ error: 'Invalid or expired ticket' }, { status: 401 })

    if (!await verifyTotp(secret, code)) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 })
    }

    const admin = await queryOne<{
      id: string
      username: string
      first_name: string | null
      last_name: string | null
      role: string
      scopes: string[] | null
      mfa_enabled: boolean
    }>(
      `SELECT id, username, first_name, last_name, role, scopes, mfa_enabled
         FROM admins WHERE id = $1 AND is_active = true`,
      [t.adminId]
    )
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    if (admin.mfa_enabled) return NextResponse.json({ error: 'Already enrolled' }, { status: 400 })

    const enc = encryptSecret(secret)
    const codes = generateRecoveryCodes(10)

    await query(
      `UPDATE admins SET mfa_secret_enc = $1, mfa_enabled = true, mfa_enrolled_at = now() WHERE id = $2`,
      [enc, admin.id]
    )
    await query(
      `DELETE FROM admin_mfa_recovery_codes WHERE admin_id = $1`,
      [admin.id]
    )
    for (const c of codes) {
      await query(
        `INSERT INTO admin_mfa_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`,
        [admin.id, c.hash]
      )
    }

    return await issueAdminSession(
      admin,
      t.certCN as string | undefined,
      { recovery_codes: codes.map(c => c.plain) },
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
