import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'service_accounts:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const sa = await queryOne<{ name: string; p12_data: Buffer | null; p12_downloaded: boolean }>(
    `SELECT name, p12_data, p12_downloaded FROM service_accounts WHERE id = $1 AND is_revoked = false`,
    [id]
  )

  if (!sa) return NextResponse.json({ error: 'Not found or revoked' }, { status: 404 })
  if (sa.p12_downloaded || !sa.p12_data) {
    return NextResponse.json({ error: 'Certificate already downloaded or unavailable' }, { status: 410 })
  }

  // Mark downloaded and clear stored p12 (one-time only)
  await query(`UPDATE service_accounts SET p12_downloaded = true, p12_data = NULL, p12_password = NULL WHERE id = $1`, [
    id,
  ])

  return new NextResponse(new Uint8Array(sa.p12_data), {
    headers: {
      'Content-Type': 'application/x-pkcs12',
      'Content-Disposition': `attachment; filename="${sa.name}.p12"`,
      'Cache-Control': 'no-store',
    },
  })
}
