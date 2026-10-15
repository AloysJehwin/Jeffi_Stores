'use client'

import { useEffect, useState } from 'react'
import { Skeleton, SummaryCard, formatINR, thCls } from './shared'

interface SpendRow {
  channel: string
  month: string
  spent: number
}
interface Spend {
  rows: SpendRow[]
  total: number
  thisMonth: number
  byChannel: Record<string, number>
}

const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }

export function MessagingTab() {
  const [data, setData] = useState<Spend | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/financial/messaging-spend')
      .then(r => r.json())
      .then(j => setData(j?.error ? { rows: [], total: 0, thisMonth: 0, byChannel: {} } : j))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton />
  if (!data) return <p className="text-sm text-foreground-secondary">No data.</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total spent" value={formatINR(data.total)} />
        <SummaryCard label="This month" value={formatINR(data.thisMonth)} />
        <SummaryCard label="SMS" value={formatINR(data.byChannel.sms ?? 0)} />
        <SummaryCard label="WhatsApp" value={formatINR(data.byChannel.whatsapp ?? 0)} />
        <SummaryCard label="Email" value={formatINR(data.byChannel.email ?? 0)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-secondary">
            <tr>
              <th className={thCls}>Month</th>
              <th className={thCls}>Channel</th>
              <th className={`${thCls} text-right`}>Spent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-foreground-secondary">
                  No messaging spend yet.
                </td>
              </tr>
            ) : (
              data.rows.map((r, i) => (
                <tr key={`${r.month}-${r.channel}-${i}`}>
                  <td className="px-4 py-2.5 text-foreground">{r.month}</td>
                  <td className="px-4 py-2.5 text-foreground">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatINR(r.spent)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
