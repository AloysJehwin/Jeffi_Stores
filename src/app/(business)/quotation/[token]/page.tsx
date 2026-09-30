import { notFound } from 'next/navigation'
import { queryMany, queryOne } from '@/lib/shared/db'
import QuotationViewClient from './QuotationViewClient'

export const dynamic = 'force-dynamic'

export default async function QuotationViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const qt = await queryOne<any>(`SELECT * FROM quotations WHERE view_token = $1`, [token])
  if (!qt) notFound()

  const items = await queryMany<any>(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt.id])
  const settingsRows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
    []
  )
  const s: Record<string, string> = {}
  for (const row of settingsRows) s[row.key] = row.value || ''

  return <QuotationViewClient qt={qt} items={items || []} settings={s} token={token} />
}
