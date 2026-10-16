import { NextRequest, NextResponse } from 'next/server'
import { verifyLink } from '@jeffi/tenancy'
import { controlPlanePool } from '@/lib/tenant-registry/shared'

export const dynamic = 'force-dynamic'

// First-party short links (WhatsApp buttons, SMS links): img.<domain>/<code> → the destination.
// messaging-service writes every link to the main DB, so no tenant context is needed here.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const pool = controlPlanePool()
  const signed = verifyLink(code)
  if (signed) {
    pool.query(`UPDATE short_link SET click_count=click_count+1 WHERE code=$1`, [signed.id]).catch(() => {})
    return NextResponse.redirect(signed.destination, 302)
  }
  const row = (await pool.query<{ destination_url: string }>(
    `SELECT destination_url FROM short_link WHERE code=$1 AND (expires_at IS NULL OR expires_at > now())`, [code]
  ).catch(() => ({ rows: [] as { destination_url: string }[] }))).rows[0]
  if (!row || !/^https?:\/\//i.test(row.destination_url)) return new NextResponse('Link not found or expired', { status: 404 })
  pool.query(`UPDATE short_link SET click_count=click_count+1 WHERE code=$1`, [code]).catch(() => {})
  return NextResponse.redirect(row.destination_url, 302)
}
