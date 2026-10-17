'use client'

import { useEffect, useState } from 'react'
import { Card, DataTable, type DataCol } from '@/components/admin/kit'
import { Skeleton, SummaryCard, formatINR } from './shared'

interface SpendRow {
  channel: string
  month: string
  spent: number
  _k?: string
}
interface Spend {
  rows: SpendRow[]
  total: number
  thisMonth: number
  byChannel: Record<string, number>
}

const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }

const COLS: DataCol<SpendRow>[] = [
  { key: 'month', label: 'Month', render: r => <span className="text-foreground">{r.month}</span>, sort: r => r.month },
  { key: 'channel', label: 'Channel', render: r => CHANNEL_LABEL[r.channel] ?? r.channel, sort: r => r.channel },
  { key: 'spent', label: 'Spent', num: true, render: r => <span className="text-foreground">{formatINR(r.spent)}</span>, sort: r => r.spent },
]

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
  if (!data) return <p className="text-sm text-foreground-muted">No data.</p>

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total spent" value={formatINR(data.total)} />
        <SummaryCard label="This month" value={formatINR(data.thisMonth)} />
        <SummaryCard label="SMS" value={formatINR(data.byChannel.sms ?? 0)} />
        <SummaryCard label="WhatsApp" value={formatINR(data.byChannel.whatsapp ?? 0)} />
        <SummaryCard label="Email" value={formatINR(data.byChannel.email ?? 0)} />
      </div>

      <Card title="Spend by month" flush>
        <DataTable<SpendRow> bare rows={data.rows.map((r, i) => ({ ...r, _k: `${r.month}-${r.channel}-${i}` }))} cols={COLS} rowKey={r => r._k!} empty="No messaging spend yet." />
      </Card>
    </div>
  )
}
