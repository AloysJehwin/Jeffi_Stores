import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'
import { generateClientCertificate } from '@/lib/certificates'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'service_accounts:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const rows = await queryMany(
    `SELECT id, name, common_name, allowed_scopes, is_revoked, revoked_at,
            p12_downloaded, created_at, last_used_at
     FROM service_accounts
     ORDER BY created_at DESC`
  )
  return NextResponse.json({ service_accounts: rows })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'service_accounts:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: { name?: string; allowed_scopes?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  if (!name || name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: 'name must be 2–80 characters' }, { status: 400 })
  }
  if (!/^[a-z0-9-_]+$/.test(name)) {
    return NextResponse.json({ error: 'name may only contain lowercase letters, digits, hyphens and underscores' }, { status: 400 })
  }

  const allowedScopes: string[] = Array.isArray(body.allowed_scopes) ? body.allowed_scopes : []

  const cn = `svc-${name}`

  let cert: Awaited<ReturnType<typeof generateClientCertificate>>
  try {
    cert = await generateClientCertificate(cn, 'service-account')
  } catch {
    return NextResponse.json({ error: 'Certificate generation failed' }, { status: 500 })
  }

  const { rows } = await query(
    `INSERT INTO service_accounts
       (name, serial_number, common_name, allowed_scopes, p12_data, p12_password, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, common_name, allowed_scopes, created_at`,
    [
      name,
      cert.serialNumber,
      cn,
      allowedScopes,
      cert.p12Buffer,
      cert.p12Password,
      admin.adminId,
    ]
  )

  const created = rows[0]
  return NextResponse.json({
    id: created.id,
    name: created.name,
    common_name: created.common_name,
    allowed_scopes: created.allowed_scopes,
    created_at: created.created_at,
    p12_password: cert.p12Password,
    download_url: `/api/admin/service-accounts/${created.id}/download`,
  }, { status: 201 })
}
