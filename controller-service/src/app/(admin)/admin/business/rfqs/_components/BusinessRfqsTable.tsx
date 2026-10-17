'use client'

import Link from 'next/link'
import { DataTable, StatusBadge, type DataCol } from '@/components/admin/kit'
import { RFQ_STATUS, fmtDay } from '../../_status'
import BusinessRfqsMobileList from './BusinessRfqsMobileList'

export interface RfqListRow {
  id: string
  rfq_number: string
  status: string
  item_count: string
  created_at: string
  company_name: string | null
  first_name: string
  last_name: string | null
  email: string
  href: string
}

// Page links fall back to the current URL with ?page set, which carries tab/status/search as before.
export default function BusinessRfqsTable({ rfqs, total, page, pageSize }: { rfqs: RfqListRow[]; total: number; page: number; pageSize: number }) {
  const cols: DataCol<RfqListRow>[] = [
    {
      key: 'rfq',
      label: 'RFQ #',
      render: r => (
        <Link href={r.href} className="font-mono text-xs font-semibold text-foreground hover:text-accent-500 hover:underline">
          {r.rfq_number}
        </Link>
      ),
    },
    { key: 'company', label: 'Company', render: r => <span className="font-medium text-foreground">{r.company_name || '-'}</span> },
    {
      key: 'contact',
      label: 'Contact',
      hideBelow: 'lg',
      render: r => (
        <div className="min-w-0">
          <p className="text-foreground">
            {r.first_name} {r.last_name || ''}
          </p>
          <p className="text-xs text-foreground-muted">{r.email}</p>
        </div>
      ),
    },
    { key: 'items', label: 'Items', num: true, render: r => <span className="text-foreground-secondary">{r.item_count}</span> },
    { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} map={RFQ_STATUS} /> },
    { key: 'submitted', label: 'Submitted', render: r => <span className="text-xs text-foreground-secondary">{fmtDay(r.created_at)}</span> },
  ]

  return (
    <DataTable<RfqListRow>
      mode="server"
      rows={rfqs}
      cols={cols}
      rowKey={r => r.id}
      total={total}
      page={page}
      pageSize={pageSize}
      mobile={<BusinessRfqsMobileList rfqs={rfqs} />}
      empty={{ title: 'No RFQs found.' }}
      rowActions={r => [{ key: 'view', kind: 'view', label: 'View RFQ', href: r.href }]}
    />
  )
}
