import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const qt = await queryOne<any>(`SELECT * FROM quotations WHERE view_token = $1`, [params.token])
    if (!qt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt.id])
    const settingsRows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
      []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    return NextResponse.json({ quotation: qt, items: items || [], settings: s })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
