'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { canonicalQuery } from '@jeffi/list-filters/client'
import { ap } from '@/lib/shared/admin-path'
import { ListFilters } from '@/components/admin/kit/list-filters'
import { SUPPLIER_FIELDS, SUPPLIER_SEARCH } from '@/lib/filters/fields/suppliers'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { useListSort } from '@/components/admin/kit/list-sort'
import { fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
import { StatusBadge, ACTIVE_STATUS } from '@/components/admin/kit/status'
import { DraftLockBadge } from '@/components/admin/kit/draft-lock'
import SuppliersMobileList from './SuppliersMobileList'
import { PAGE_SIZE, type Supplier } from '@/components/admin/purchasing/shared'

export default function SuppliersTab() {
  const canWriteSuppliers = useCanWrite('inventory')
  // The list's filters from the URL; all=true so no Status choice means every supplier.
  const sp = useSearchParams()
  const query = canonicalQuery(sp, SUPPLIER_FIELDS)
  const q = new URLSearchParams(query)
  const search = q.get('search') || ''
  const active = q.get('active')
  const { sort, dir } = useListSort()

  const list = useInfiniteList<Supplier>({
    key: `${query}|${sort}|${dir}`,
    pageSize: PAGE_SIZE,
    getKey: s => s.id,
    fetchPage: async (pg, signal) => {
      const params = new URLSearchParams(query)
      params.set('all', 'true')
      params.set('page', String(pg))
      params.set('limit', String(PAGE_SIZE))
      if (sort) {
        params.set('sort', sort)
        params.set('dir', dir)
      }
      const json = await fetchJson(`/api/admin/inventory/suppliers?${params}`, signal)
      return { rows: json?.suppliers || [], total: json?.total || 0 }
    },
  })
  const suppliers = list.rows

  async function toggleActive(s: Supplier) {
    const res = await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    if (!res.ok) return
    // A row that no longer matches the Status filter leaves the list.
    if (active === String(s.is_active)) list.setRows(rows => rows.filter(r => r.id !== s.id))
    else list.setRows(rows => rows.map(r => (r.id === s.id ? { ...r, is_active: !s.is_active } : r)))
  }

  const cols: DataCol<Supplier>[] = [
    {
      key: 'name',
      label: 'Name',
      sortParam: 'name',
      render: s => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href={ap(`/admin/suppliers/${s.id}/view`)} className="font-medium text-foreground hover:text-accent-500 hover:underline">
            {s.name}
          </Link>
          <DraftLockBadge lock={s.draft_lock} mine={s.draft_lock?.mine} />
        </span>
      ),
    },
    { key: 'gstin', label: 'GSTIN', sortParam: 'gstin', render: s => <span className="font-mono text-xs text-foreground-secondary">{s.gstin || '—'}</span> },
    { key: 'contact', label: 'Contact', hideBelow: 'sm', sortParam: 'contact', render: s => <span className="text-foreground-secondary">{s.contact_name || '—'}</span> },
    { key: 'phone', label: 'Phone', hideBelow: 'md', sortParam: 'phone', render: s => <span className="text-foreground-secondary">{s.phone ? `+91 ${s.phone}` : '—'}</span> },
    { key: 'terms', label: 'Terms', num: true, hideBelow: 'lg', sortParam: 'terms', render: s => <span className="text-foreground-secondary">{s.payment_terms}d</span> },
    { key: 'pos', label: 'POs', num: true, sortParam: 'pos', render: s => <span className="text-foreground-secondary">{s.po_count}</span> },
    { key: 'status', label: 'Status', sortParam: 'status', render: s => <StatusBadge status={String(s.is_active)} map={ACTIVE_STATUS} /> },
  ]

  return (
    <div className="space-y-5">
      <ListFilters entity="suppliers" fields={SUPPLIER_FIELDS} search={SUPPLIER_SEARCH} noun="Suppliers" tab="suppliers" exportable />

      {/* Pages of PAGE_SIZE load on scroll; column sort is server-side (?sort&dir). */}
      <DataTable<Supplier>
        rows={suppliers}
        cols={cols}
        rowKey={s => s.id}
        infinite={list}
        empty={search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
        mobile={rows => <SuppliersMobileList suppliers={rows} canWrite={canWriteSuppliers} onToggleActive={toggleActive} />}
        rowActions={s => [
          { key: 'edit', kind: 'edit', label: 'Edit supplier', href: ap(`/admin/suppliers/${s.id}/edit`), scope: 'inventory' },
          {
            key: 'toggle',
            kind: 'toggle',
            label: s.is_active ? 'Deactivate supplier' : 'Activate supplier',
            onSelect: () => toggleActive(s),
            scope: 'inventory',
          },
        ]}
      />
    </div>
  )
}
