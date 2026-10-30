import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { generateRecoveryCodes } from '@/lib/auth/mfa'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ mfa_enabled: boolean; mfa_enrolled_at: string | null }>(
    `SELECT mfa_enabled, mfa_enrolled_at FROM admins WHERE id = $1`,
    [admin.adminId]
  )
  const codes = await queryOne<{ remaining: string }>(
    `SELECT COUNT(*)::text AS remaining FROM admin_mfa_recovery_codes
       WHERE admin_id = $1 AND used_at IS NULL`,
    [admin.adminId]
  )
  return NextResponse.json({
    mfa_enabled: !!row?.mfa_enabled,
    mfa_enrolled_at: row?.mfa_enrolled_at || null,
    recovery_codes_remaining: Number(codes?.remaining || 0),
  })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ mfa_enabled: boolean }>(`SELECT mfa_enabled FROM admins WHERE id = $1`, [admin.adminId])
  if (!row?.mfa_enabled) {
    return NextResponse.json({ error: 'MFA is not enabled on this account' }, { status: 400 })
  }

  const codes = generateRecoveryCodes(10)
  await query(`DELETE FROM admin_mfa_recovery_codes WHERE admin_id = $1`, [admin.adminId])
  for (const c of codes) {
    await query(`INSERT INTO admin_mfa_recovery_codes (admin_id, code_hash) VALUES ($1, $2)`, [admin.adminId, c.hash])
  }
  return NextResponse.json({ recovery_codes: codes.map(c => c.plain) })
}
