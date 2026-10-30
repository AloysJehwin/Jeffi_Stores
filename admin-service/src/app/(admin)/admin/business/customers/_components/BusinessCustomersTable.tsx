'use client'

import Link from 'next/link'
import { DataTable, StatusBadge, type DataCol } from '@/components/admin/kit'
import { APPROVAL_STATUS, fmtDay } from '../../_status'
import BusinessCustomersMobileList from './BusinessCustomersMobileList'

export interface BusinessCustomerRow {
  user_id: string
  email: string
  first_name: string
  last_name: string | null
  company_name: string
  gst_number: string
  industry: string
  approval_status: string
  created_at: string
  href: string
}

// Page links fall back to the current URL with ?page set, which carries tab/status/search as before.
export default function BusinessCustomersTable({ customers, total, page, pageSize }: { customers: BusinessCustomerRow[]; total: number; page: number; pageSize: number }) {
  const cols: DataCol<BusinessCustomerRow>[] = [
    {
      key: 'company',
      label: 'Company',
      sortParam: 'company',
      render: c => (
        <Link href={c.href} className="font-medium text-foreground hover:text-accent-500 transition-colors">
          {c.company_name}
        </Link>
      ),
    },
    {
      key: 'contact',
      label: 'Contact',
      sortParam: 'contact',
      render: c => (
        <div className="min-w-0">
          <p className="text-foreground">
            {c.first_name} {c.last_name || ''}
          </p>
          <p className="text-xs text-foreground-muted">{c.email}</p>
        </div>
      ),
    },
    { key: 'gst', label: 'GST', sortParam: 'gst', hideBelow: 'lg', render: c => <span className="font-mono text-xs text-foreground-secondary">{c.gst_number}</span> },
    { key: 'industry', label: 'Industry', sortParam: 'industry', hideBelow: 'lg', render: c => <span className="text-foreground-secondary">{c.industry}</span> },
    { key: 'status', label: 'Status', sortParam: 'status', render: c => <StatusBadge status={c.approval_status} map={APPROVAL_STATUS} /> },
    { key: 'joined', label: 'Joined', sortParam: 'created_at', sortType: 'date', render: c => <span className="text-xs text-foreground-secondary">{fmtDay(c.created_at)}</span> },
  ]

  return (
    <DataTable<BusinessCustomerRow>
      mode="server"
      rows={customers}
      cols={cols}
      rowKey={c => c.user_id}
      total={total}
      page={page}
      pageSize={pageSize}
      mobile={rows => <BusinessCustomersMobileList customers={rows} />}
      empty={{ title: 'No business customers found.' }}
      rowActions={c => [{ key: 'view', kind: 'view', label: 'View customer', href: c.href }]}
    />
  )
}
