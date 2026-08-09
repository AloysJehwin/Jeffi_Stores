import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import {
  decryptSecret,
  hashRecoveryCode,
  verifyMfaTicket,
  verifyTotp,
} from '@/lib/mfa'
import { issueAdminSession } from '@/lib/admin-session'
import { extractSessionSignals } from '@/lib/session-signals-request'

export async function POST(request: Request) {
  try {
    const { ticket, code } = await request.json()
    if (!ticket || !code) {
      return NextResponse.json({ error: 'ticket and code are required' }, { status: 400 })
    }

    const t = await verifyMfaTicket(ticket, 'verify')
    if (!t) return NextResponse.json({ error: 'Invalid or expired ticket' }, { status: 401 })

    const admin = await queryOne<{
      id: string
      email: string | null
      first_name: string | null
      last_name: string | null
      role: string
      scopes: string[] | null
      mfa_enabled: boolean
      mfa_secret_enc: string | null
    }>(
      `SELECT a.id, u.email, u.first_name, u.last_name, a.role, a.scopes, a.mfa_enabled, a.mfa_secret_enc
         FROM admins a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.id = $1 AND a.is_active = true`,
      [t.adminId]
    )
    if (!admin || !admin.mfa_enabled || !admin.mfa_secret_enc) {
      return NextResponse.json({ error: 'MFA not enrolled' }, { status: 400 })
    }

    let ok = false
    const trimmed = String(code).trim().toUpperCase()
    if (/^\d{6}$/.test(trimmed)) {
      const secret = decryptSecret(admin.mfa_secret_enc)
      ok = await verifyTotp(secret, trimmed)
    } else {
      const candidate = trimmed.replace(/\s+/g, '')
      const normalized = candidate.includes('-') ? candidate : candidate.replace(/^([A-Z0-9]{5})([A-Z0-9]{5})$/, '$1-$2')
      const hash = hashRecoveryCode(normalized)
      const used = await queryOne<{ id: string }>(
        `SELECT id FROM admin_mfa_recovery_codes
           WHERE admin_id = $1 AND code_hash = $2 AND used_at IS NULL
           LIMIT 1`,
        [admin.id, hash]
      )
      if (used) {
        await query(
          `UPDATE admin_mfa_recovery_codes SET used_at = now() WHERE id = $1`,
          [used.id]
        )
        ok = true
      }
    }

    if (!ok) return NextResponse.json({ error: 'Invalid code' }, { status: 401 })

    return await issueAdminSession(admin, t.certCN as string | undefined, undefined, extractSessionSignals(request))
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
